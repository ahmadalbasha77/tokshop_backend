const mongoose = require('mongoose');
const helpArticleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  excerpt: {
    type: String,
    required: true,
    trim: true
  },
  content: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['general', 'seller', 'buyer', 'payments', 'shipping', 'other'],
    default: 'general'
  },
  published: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

helpArticleSchema.index({ slug: 1 }, { unique: true });
helpArticleSchema.index({ category: 1, published: 1, order: 1 });
helpArticleSchema.index({ published: 1, order: 1 });
const HelpArticle = mongoose.model('HelpArticle', helpArticleSchema);

module.exports = HelpArticle;
