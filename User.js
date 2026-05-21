const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isAdmin: { type: Boolean, default: false },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    favorites: [{ type: String }],
    filters: {
        glutenFree: { type: Boolean, default: false },
        lactoseFree: { type: Boolean, default: false },
        vegan: { type: Boolean, default: false },
        vegetarian: { type: Boolean, default: false },
    }
});

// THIS LINE IS CRITICAL
module.exports = mongoose.model('User', userSchema);
