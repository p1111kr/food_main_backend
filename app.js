require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const transporter = require('./models/mailer');
const { Category, Meal } = require('./models');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(email => email.trim().toLowerCase())
  .filter(Boolean);

app.use(cors({
  origin: '*',
  allowedHeaders: ['Content-Type', 'user-id', 'x-admin-secret'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));



// --- MIDDLEWARE ---


app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const defaultCategories = [
  { id: 'c1', title: 'Italian', color: 'purple', gradientStart: '#9c27b0', gradientEnd: '#6a1b9a' },
  { id: 'c2', title: 'Quick & easy', color: 'red', gradientStart: '#f44336', gradientEnd: '#b71c1c' },
  { id: 'c3', title: 'Ethiopian', color: 'lightGreen', gradientStart: '#8bc34a', gradientEnd: '#33691e' },
  { id: 'c4', title: 'German', color: 'amber', gradientStart: '#ffc107', gradientEnd: '#ff8f00' },
  { id: 'c5', title: 'Light & Lovely', color: 'blue', gradientStart: '#2196f3', gradientEnd: '#0d47a1' },
  { id: 'c6', title: 'Exotic', color: 'green', gradientStart: '#4caf50', gradientEnd: '#1b5e20' },
  { id: 'c7', title: 'Breakfast', color: 'lightBlue', gradientStart: '#03a9f4', gradientEnd: '#01579b' },
  { id: 'c8', title: 'Asian', color: 'orange', gradientStart: '#ff9800', gradientEnd: '#e65100' },
  { id: 'c9', title: 'French', color: 'pink', gradientStart: '#e91e63', gradientEnd: '#880e4f' },
  { id: 'c10', title: 'Summer', color: 'teal', gradientStart: '#009688', gradientEnd: '#004d40' },
  { id: 'c11', title: 'My Meals', color: 'orange', gradientStart: '#ff9800', gradientEnd: '#f57c00' },
];

const requiredMealFields = [
  'imageUrl',
  'title',
  'categories',
  'ingredients',
  'steps',
  'duration',
  'complexity',
  'affordability',
];

const requiredFilterFlags = [
  'isGlutenFree',
  'isLactoseFree',
  'isVegan',
  'isVegetarian',
];

const MAX_IMAGE_URL_LENGTH = 12 * 1024 * 1024;

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [];
}

function buildMealPayload(body, scope, userId) {
  const payload = {
    id: body.id || `m${Date.now()}`,
    scope,
    categories: normalizeStringList(body.categories),
    title: String(body.title || '').trim(),
    imageUrl: String(body.imageUrl || '').trim(),
    ingredients: normalizeStringList(body.ingredients),
    steps: normalizeStringList(body.steps),
    duration: Number(body.duration),
    complexity: String(body.complexity || '').trim(),
    affordability: String(body.affordability || '').trim(),
    isGlutenFree: body.isGlutenFree,
    isLactoseFree: body.isLactoseFree,
    isVegan: body.isVegan,
    isVegetarian: body.isVegetarian,
  };

  if (userId) {
    payload.userId = userId;
  }

  return payload;
}

function validateMealPayload(payload) {
  const missingFields = requiredMealFields.filter((field) => {
    const value = payload[field];
    return value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0) ||
      (field === 'duration' && (!Number.isFinite(value) || value <= 0));
  });

  if (missingFields.length > 0) {
    return `Missing or invalid fields: ${missingFields.join(', ')}`;
  }

  if (payload.imageUrl.length > MAX_IMAGE_URL_LENGTH) {
    return 'Image is too large. Please choose a smaller image.';
  }

  const badFlags = requiredFilterFlags.filter(flag => typeof payload[flag] !== 'boolean');
  if (badFlags.length > 0) {
    return `Filter flags must be booleans: ${badFlags.join(', ')}`;
  }

  return null;
}

async function requireAdmin(req, res, next) {
  try {
    const userId = req.headers['user-id'];
    if (!userId) {
      return res.status(401).json({ error: 'Missing user-id header' });
    }

    const user = await User.findById(userId);
    if (!user || (!user.isAdmin && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.adminUser = user;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Admin verification failed' });
  }
}

async function ensureDefaultCategories() {
  await Category.updateMany(
    { scope: { $exists: false } },
    { $set: { scope: 'public' } }
  );

  for (const category of defaultCategories) {
    await Category.findOneAndUpdate(
      { id: category.id },
      { $set: category },
      { upsert: true, new: true }
    );
  }

  console.log('Public categories are ready');
}


// --- DATABASE CONNECTION ---
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB: test');
    await ensureDefaultCategories();
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });
transporter.verify(function (error, success) {
  if (error) {
    console.log("Mailer Connection Error: " + error);
  } else {
    console.log("Mail server is ready to send messages!");
  }
});

// --- NEW: CHECK STATUS ROUTE (Fixes Refresh Logout) ---
app.get('/check-status/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (user) {
      res.status(200).json({
        valid: true,
        email: user.email,
        isAdmin: user.isAdmin || user.role === 'admin',
        role: user.role || 'user',
        favorites: user.favorites || [],
        filters: user.filters || { glutenFree: false, lactoseFree: false, vegan: false, vegetarian: false }
      });
    } else {
      res.status(404).json({ valid: false });
    }
  } catch (error) {
    res.status(500).json({ valid: false });
  }
});

// --- AUTH ROUTES ---

app.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const lowerEmail = email.trim().toLowerCase();

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({
      email: lowerEmail,
      password: hashedPassword,
      name: name || '',
      role: 'user',
      isAdmin: false
    });
    await newUser.save();

    console.log(`New user created: ${lowerEmail}`);

    const welcomeMailOptions = {
      from: '"Agerga Support" <peterkoru94@gmail.com>',
      to: lowerEmail,
      subject: 'Welcome to Agerga!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
          <h1 style="color: #562100; text-align: center;">Welcome to Agerga!</h1>
          <p>Hi there,</p>
          <p>Thank you for joining Agerga. We are excited to have you!</p>
          <p>Happy cooking,<br>The Agerga Team</p>
        </div>
      `
    };

    transporter.sendMail(welcomeMailOptions).catch(err => console.error("Email error:", err));

    res.status(201).json({
      message: 'User created successfully!',
      userId: newUser._id.toString(),
      isAdmin: false,
      role: 'user',
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(400).json({ error: 'User already exists' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const lowerEmail = email.toLowerCase();

    const user = await User.findOne({ email: lowerEmail });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });

    }

    if (ADMIN_EMAILS.includes(user.email) && (!user.isAdmin || user.role !== 'admin')) {
      user.isAdmin = true;
      user.role = 'admin';
      await user.save();
    }

    const isAdmin = user.isAdmin || user.role === 'admin';

    // Return everything Flutter needs to prevent empty pages
    res.status(200).json({
      userId: user._id.toString(),
      email: user.email,
      isAdmin,
      role: isAdmin ? 'admin' : 'user',
      favorites: user.favorites || [],
      filters: user.filters || { glutenFree: false, lactoseFree: false, vegan: false, vegetarian: false }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/dev/make-admin', async (req, res) => {
  try {
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    if (!setupSecret) {
      return res.status(500).json({ error: 'ADMIN_SETUP_SECRET is not configured' });
    }

    if (req.headers['x-admin-secret'] !== setupSecret) {
      return res.status(403).json({ error: 'Invalid admin setup secret' });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOneAndUpdate(
      { email },
      { isAdmin: true, role: 'admin' },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      message: 'Admin account enabled',
      userId: user._id.toString(),
      email: user.email,
      isAdmin: true,
      role: 'admin',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enable admin account' });
  }
});

// --- FORGOT PASSWORD LOGIC ---
app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const mailOptions = {
      from: '"Agerga Support" <peterkoru94@gmail.com>',
      to: user.email,
      subject: 'Agerga Password Reset',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #562100;">
          <h2 style="color: #562100;">Agerga Password Reset</h2>
          <a href="${PUBLIC_BASE_URL}/reset-password-page/${token}" 
             style="background: #562100; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
             Reset Password
          </a>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Reset email sent!' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// --- RESET PASSWORD PAGES ---
app.get('/reset-password-page/:token', async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) return res.send("<h1>Error</h1><p>Link expired.</p>");

  res.send(`
    <body style="background: #0A0A0A; color: white; text-align: center; font-family: sans-serif; padding-top: 50px;">
      <h2>Reset Password</h2>
      <form action="/reset-password/${req.params.token}" method="POST">
        <input type="password" name="password" placeholder="New Password" required style="padding: 10px; width: 250px;"><br><br>
        <button type="submit" style="background: #562100; color: white; border: none; padding: 10px 20px; border-radius: 5px;">Update Password</button>
      </form>
    </body>
  `);
});

app.post('/reset-password/:token', async (req, res) => {
  try {
    const { password } = req.body;
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) return res.status(400).send("Invalid token.");

    user.password = await bcrypt.hash(password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.send("<h1>Success!</h1><p>Password updated. You can now log in.</p>");
  } catch (error) {
    res.status(500).send("Error.");
  }
});

// --- DATA & SYNC ROUTES ---

app.get('/user-favorites/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    const favoriteMeals = await Meal.find({ id: { $in: user.favorites } });
    res.json(favoriteMeals);
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/update-favorites', async (req, res) => {
  const { userId, favorites } = req.body;
  await User.findByIdAndUpdate(userId, { favorites });
  res.status(200).send('Updated');
});

app.get('/user-filters/:userId', async (req, res) => {
  const user = await User.findById(req.params.userId);
  res.json(user.filters || { glutenFree: false, lactoseFree: false, vegan: false, vegetarian: false });
});

app.post('/update-filters', async (req, res) => {
  const { userId, filters } = req.body;
  await User.findByIdAndUpdate(userId, { filters });
  res.status(200).send('Updated');
});

app.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find({ scope: 'public' }).sort({ createdAt: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

app.get('/admin/meals', requireAdmin, async (req, res) => {
  try {
    const meals = await Meal.find({ scope: 'public' }).sort({ createdAt: -1 });
    res.json(meals);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load admin meals' });
  }
});

app.post('/admin/meals', requireAdmin, async (req, res) => {
  try {
    const payload = buildMealPayload(req.body, 'public');
    const validationError = validateMealPayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    delete payload.userId;
    const newMeal = new Meal(payload);
    await newMeal.save();

    res.status(201).json({
      message: 'Public meal created',
      meal: newMeal,
    });
  } catch (error) {
    console.error('Admin meal create error:', error);
    const message = error && error.message ? error.message : '';
    if (message.includes('BSONObj size') || message.includes('larger than maximum')) {
      return res.status(413).json({ error: 'Image is too large. Please choose a smaller image.' });
    }

    if (error && error.code === 11000) {
      return res.status(409).json({ error: 'A meal with this id already exists. Try again.' });
    }

    res.status(500).json({
      error: 'Failed to create public meal',
      details: message,
    });
  }
});

app.put('/admin/meals/:id', requireAdmin, async (req, res) => {
  try {
    const payload = buildMealPayload({ ...req.body, id: req.params.id }, 'public');
    const validationError = validateMealPayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    delete payload.userId;
    const meal = await Meal.findOneAndUpdate(
      { id: req.params.id, scope: 'public' },
      payload,
      { new: true, runValidators: true }
    );

    if (!meal) {
      return res.status(404).json({ error: 'Public meal not found' });
    }

    res.json({ message: 'Public meal updated', meal });
  } catch (error) {
    console.error('Admin meal update error:', error);
    const message = error && error.message ? error.message : '';
    if (message.includes('BSONObj size') || message.includes('larger than maximum')) {
      return res.status(413).json({ error: 'Image is too large. Please choose a smaller image.' });
    }

    res.status(500).json({
      error: 'Failed to update public meal',
      details: message,
    });
  }
});

app.delete('/admin/meals/:id', requireAdmin, async (req, res) => {
  try {
    const result = await Meal.findOneAndDelete({ id: req.params.id, scope: 'public' });
    if (!result) {
      return res.status(404).json({ error: 'Public meal not found' });
    }

    res.json({ message: 'Public meal deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete public meal' });
  }
});

app.post('/admin/categories', requireAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const gradientStart = String(req.body.gradientStart || '').trim();
    const gradientEnd = String(req.body.gradientEnd || '').trim();

    if (!title || !gradientStart || !gradientEnd) {
      return res.status(400).json({ error: 'Title and both gradient colors are required' });
    }

    const category = new Category({
      id: req.body.id || `c${Date.now()}`,
      title,
      color: req.body.color || 'orange',
      gradientStart,
      gradientEnd,
      scope: 'public',
    });

    await category.save();
    res.status(201).json({ message: 'Category created', category });
  } catch (error) {
    console.error('Admin category create error:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

app.put('/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    const gradientStart = String(req.body.gradientStart || '').trim();
    const gradientEnd = String(req.body.gradientEnd || '').trim();

    if (!title || !gradientStart || !gradientEnd) {
      return res.status(400).json({ error: 'Title and both gradient colors are required' });
    }

    const category = await Category.findOneAndUpdate(
      { id: req.params.id, scope: 'public' },
      {
        title,
        color: req.body.color || 'orange',
        gradientStart,
        gradientEnd,
      },
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category updated', category });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update category' });
  }
});

app.delete('/admin/categories/:id', requireAdmin, async (req, res) => {
  try {
    if (req.params.id === 'c11') {
      return res.status(400).json({ error: 'My Meals category cannot be deleted' });
    }

    const usedByMeal = await Meal.exists({ scope: 'public', categories: req.params.id });
    if (usedByMeal) {
      return res.status(409).json({ error: 'Category is used by public meals' });
    }

    const result = await Category.findOneAndDelete({ id: req.params.id, scope: 'public' });
    if (!result) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Add 'async' here! 
app.get('/meals', async (req, res) => {
  try {
    const requestedUserId = req.query.userId || req.headers['user-id'];
    const userId = requestedUserId ? String(requestedUserId).trim() : undefined;

    console.log("--- SERVER CHECK ---");
    console.log("GET /meals requested userId:", userId);

    const meals = userId
      ? await Meal.find({
        userId: userId,
        $or: [{ scope: 'personal' }, { scope: { $exists: false } }]
      })
      : await Meal.find({ scope: 'public' });

    console.log(`GET /meals returning ${meals.length} meal(s)`);
    res.status(200).json(meals);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch meals" });
  }
});
// --- NEW: POST ROUTE TO SAVE MEALS ---
app.post('/meals', async (req, res) => {
  try {
    const mealData = req.body;
    console.log("POST /meals req.body.userId:", req.body.userId);
    const userId = mealData.userId ? String(mealData.userId).trim() : undefined;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    // This creates a new document in your MongoDB "meals" collection
    // using the data sent from your Flutter app
    const payload = buildMealPayload(mealData, 'personal', userId);
    const validationError = validateMealPayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const newMeal = new Meal(payload);

    await newMeal.save();
    console.log(`Success: Added new meal - ${mealData.title} for user ${userId}`);
    console.log("Saved meal userId:", newMeal.userId);

    res.status(201).json({
      message: 'Meal created successfully!',
      meal: newMeal
    });
  } catch (error) {
    console.error("Error saving meal:", error);
    res.status(500).json({ error: 'Failed to save meal to database' });
  }
});
// Add this near your other /meals routes
app.delete('/meals/:id', async (req, res) => {
  try {
    const mealId = req.params.id;
    const userId = req.headers['user-id'];
    if (!userId) {
      return res.status(401).json({ error: "Missing user-id header" });
    }

    // We use the custom 'id' field you created (e.g., m171234...)
    const result = await Meal.findOneAndDelete({
      id: mealId,
      userId: String(userId).trim(),
      $or: [{ scope: 'personal' }, { scope: { $exists: false } }]
    });

    if (!result) {
      return res.status(404).json({ message: "Meal not found" });
    }

    res.status(200).json({ message: "Deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error during deletion" });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
