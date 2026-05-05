const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const otpRateLimitSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    window_start: {
      type: Date,
      required: true,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    autoCreate: true,
    autoIndex: true,
  }
);

otpRateLimitSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = model("otp_rate_limit", otpRateLimitSchema);
