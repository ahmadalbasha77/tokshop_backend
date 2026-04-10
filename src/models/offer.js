const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const OfferSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "product",
      required: true,
    },
    shippingFee: {
      type: Number,
      default: 0.0,
    },
    rate_id: {
      type: String,
      default: null,
    },
    seller_shipping_fee_pay: {
      type: Number,
      default: 0.0,
    },
    subtotal: {
      type: Number,
      default: 0.0,
    },
    tax: {
      type: Number,
      default: 0.0,
    },
    quantity: {
      type: Number,
      default: 1,
    },
    total: {
      type: Number,
      default: 0.0,
    },
    bundleId: {
      type: String,
      default: null,
    },
    totalWeightOz: {
      type: Number,
      default: 0.0,
    },

    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },

    // Buyer offer
    offeredPrice: {
      type: Number,
      required: true,
    },

    // Seller counter offer (optional)
    counterPrice: {
      type: Number,
      default: null,
    },
    servicelevel:{
      type: String,
      default: ""
    },
    tokshow: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "room",
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "countered", "expired"],
      default: "pending",
    },

    expireAt: {
      type: Date,
      default: () => Date.now() + 1000 * 60 * 60 * 24 * 30, 
      index: { expires: 0 },
    },

    acceptedAt: Date,
    rejectedAt: Date,
    counteredAt: Date,
    counteredAt: Date,
  },
  { timestamps: true }
);

const offer = model("offer", OfferSchema);
module.exports = offer;