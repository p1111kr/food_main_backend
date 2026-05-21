const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  color: { type: String, default: 'orange' },
  gradientStart: { type: String, default: '#ff9800' },
  gradientEnd: { type: String, default: '#f57c00' },
  scope: { type: String, enum: ['public'], default: 'public' },
}, { timestamps: true });

const mealSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  userId: {
    type: String,
    required: function () {
      return this.scope !== 'public';
    },
  },
  scope: { type: String, enum: ['public', 'personal'], default: 'personal' },
  categories: { type: [String], required: true, default: [] },
  title: { type: String, required: true },
  imageUrl: { type: String, required: true },
  ingredients: { type: [String], required: true, default: [] },
  steps: { type: [String], required: true, default: [] },
  duration: { type: Number, required: true },
  complexity: { type: String, required: true },
  affordability: { type: String, required: true },
  isGlutenFree: { type: Boolean, required: true },
  isLactoseFree: { type: Boolean, required: true },
  isVegan: { type: Boolean, required: true },
  isVegetarian: { type: Boolean, required: true },
}, { timestamps: true });

const Category = mongoose.models.Category || mongoose.model('Category', categorySchema);
const Meal = mongoose.models.Meal || mongoose.model('Meal', mealSchema);

module.exports = { Category, Meal };
