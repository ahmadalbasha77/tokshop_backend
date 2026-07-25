const mongoose = require("mongoose");

const stripeEventSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    stripeEventId: { type: String, required: true },
    endpoint: { type: String, required: true },
    eventType: { type: String, required: true },
    account: { type: String, default: null },
    livemode: { type: Boolean, default: false },
    stripeCreated: { type: Number, default: null },
    status: {
      type: String,
      enum: ["processing", "processed", "failed"],
      required: true,
    },
    attempts: { type: Number, default: 1 },
    processedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
  },
  {
    timestamps: true,
    autoIndex: false,
    autoCreate: true,
  }
);

module.exports = mongoose.model("stripe_event", stripeEventSchema);
