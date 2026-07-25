const mongoose = require("mongoose");

const paymentAttemptSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "order", required: true },
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: "item", required: true },
    buyerId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "product", required: true },
    flow: { type: String, required: true },
    paymentIntentId: { type: String, default: null },
    stripeStatus: { type: String, default: null },
    recordingStatus: {
      type: String,
      enum: [
        "created",
        "stripe_incomplete",
        "stripe_succeeded",
        "needs_reconciliation",
        "recorded",
      ],
      default: "created",
    },
    orderData: { type: mongoose.Schema.Types.Mixed, default: null },
    itemData: { type: mongoose.Schema.Types.Mixed, default: null },
    shippingData: { type: mongoose.Schema.Types.Mixed, default: null },
    earnings: { type: Number, default: null },
    subtotal: { type: Number, default: null },
    serviceFee: { type: Number, default: null },
    stripeFee: { type: Number, default: null },
    extraCharges: { type: Number, default: null },
    tax: { type: Number, default: null },
    chargeId: { type: String, default: null },
    balanceTransactionId: { type: String, default: null },
    availableOn: { type: Number, default: null },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "transaction",
      default: null,
    },
    transactionalFinalization: { type: Boolean, default: false },
    activationAt: { type: Date, default: null },
    recordingAttempts: { type: Number, default: 0 },
    lastRecordingError: { type: String, default: null },
    reconciliationLock: { type: String, default: null },
    reconciliationLockedAt: { type: Date, default: null },
    refunded: { type: Boolean, default: false },
    disputed: { type: Boolean, default: false },
    canceled: { type: Boolean, default: false },
    reconciliationEligibility: {
      type: String,
      enum: ["unverified", "clear", "blocked"],
      default: "unverified",
    },
    lastErrorCode: { type: String, default: null },
    recordedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    autoIndex: false,
    autoCreate: true,
  }
);

module.exports = mongoose.model("payment_attempt", paymentAttemptSchema);
