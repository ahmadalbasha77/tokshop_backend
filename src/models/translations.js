const mongoose = require("mongoose");

const TranslationSchema = new mongoose.Schema(
  {
    language: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    version: {
      type: Number,
      default: 1,
    },
    default_language: {
      type: String,
      default: "en",
    },
    keys: {
      type: Map,
      of: String,
      default: {},
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Translation", TranslationSchema);
