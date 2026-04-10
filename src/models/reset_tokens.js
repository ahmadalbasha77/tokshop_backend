const mongoose = require("mongoose");

const resetTokenSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
  used: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Auto-delete expired tokens
resetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ResetToken = mongoose.model("ResetToken", resetTokenSchema);

module.exports = ResetToken;