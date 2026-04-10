const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const orderItems = Schema(
  {
    orderId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "order",
    },

    ordertype: {
      type: String,
      default: null
    },
    giveawayId: {
      type: Schema.Types.ObjectId,
      ref: "giveaway",
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    order_reference: {
      type: String,
      default: ""
    },
    shipping_fee: {
      type: Number,
      default: 0.0,
    },
    seller_shipping_fee_pay: {
      type: Number,
      default: 0.0,
    },
    chargeId: {
      type: String,
    },
    status: {
      type: String,
      default: "processing",
    },
    price: {
      type: Number,
    },
    stripe_fees: {
      type: Number,
      default: 0.0,
    },
    earnings: {
      type: Number,
      default: 0.0,
    },  
    service_fee: {
      type: Number,
      default: 0.0,
    },
    weight: {
      type: String,
      default: "0",
    },
    height: {
      type: String,
      default: "0",
    },
    scale: {
      type: String,
      default: "",
    },
    length: {
      type: String,
      default: "0",
    },
    width: {
      type: String,
      default: "0",
    },
    tokshow: {
      type: Schema.Types.ObjectId,
      ref: "rooms",
      default: null,
    },
    tax: {
      type: Number,
      default: 0.0,
    },
    egressId: {
      type: String,
      default: "",
    },
    reject_cancel_reason:{
      type: String,
      default: null,
    },
    videoReceipt: {
      type: String,
      default: "",
    },
    customer: { type: Schema.Types.ObjectId, ref: "user" },
    seller: { type: Schema.Types.ObjectId, ref: "user" },
    quantity: {
      type: Number,
      required: true,
    },
    productId: {
      type: Schema.Types.ObjectId,
      ref: "product",
    },
    color: {
      type: String,
    },
    size: {
      type: String,
    },
  },
  { timestamps: true, autoCreate: true, autoIndex: true }
);

const items = model("item", orderItems);
module.exports = items;
