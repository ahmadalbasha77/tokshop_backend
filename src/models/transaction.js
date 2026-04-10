const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const value = {
  type: String,
  required: true,
};

const transaction = new Schema(
  {
    from: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    chargeId: {
      type: String,
    },
    transferId: {
      type: String,
    },
    itemId: {
      type: Schema.Types.ObjectId,
      ref: "item",
    },
    order_channel: {
      type: String,
    },
    stripe_fee: {
      type: String,
    },
    extra_charges: {
      type: String,
    },
    shippingFee: {
      type: String,
    },
    serviceFee: {
      type: String,
    },
    total: {
      type: String,
      default: 0,
    },
    balanceTransactionId: {
      type: String,
    },
    availableOn: {
      type: Number,
      default: 0,
    },
    to: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "order",
    },
    reason: value,

    order_fulfilled: {
      type: Boolean,
      default: false,
    },
    paid_out: {
      type: Boolean,
      default: false,
    },

    amount: {
      type: Number,
    },
    type: {
      type: String,
      enum: [
        "purchase",
        "sending",
        "order",
        "tip",
        "withdraw",
        "refund",
        "shipping_deduction",
        "transfer",
        "payout", "referral_credit","service_fee"
      ],
    },
    //this is set to true when stripe clears this charge/transaction
    payment_available:{
      type: Boolean,
      required: false,
    },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Failed","cancelled","Refunded"],
      default: "Pending",
    },
    deducting: {
      type: Boolean,
    },
    date: {
      type: Number,
      default: 0,
    },
    payoutId: {
      type: String,
    },
    payout_type: {
      type: String,
    },
    transfer_batch_id: {
      type: String,
    },
    bank_name: {
      type: String,
    },
    payout_account: {
      type: String,
    },
    balance_after_payout: {
      type: Number,
      default: 0,
    },
    refundId: {
      type: String,
    },
    stripeBankAccount: {
      type: String,
      required: false,
    },
    payout_batch_id: {
      type: String,
    },
    new_pending_balance: {
      type: Number,
      default: 0.0,
    },
  },
  { timestamps: true, autoIndex: true, autoCreate: true }
);

const transactionModel = model("transaction", transaction);

module.exports = transactionModel;
