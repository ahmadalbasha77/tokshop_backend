const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const AutoIncrement = require("mongoose-sequence")(mongoose);

const order = new Schema(
  {
    customer: { type: Schema.Types.ObjectId, ref: "user" },
    seller: { type: Schema.Types.ObjectId, ref: "user" },
    need_label: {
      type: Boolean,
      default: true,
    },
    reject_cancel_reason:{
      type: String,
      default: null,
    },
    carrier: {
      type: String,
      default: null,
    },
    carrierAccount: { 
      type: String,
      default: null,
    },
    bundleId: {
      type: String,
      default: null,
    },
    manifest_id: {
      type: String,
      default: null,
    },
    paymentMethod: {
      type: Schema.Types.ObjectId,
      ref: "paymentMethod",
    },
    platform_order: { //orders done by the platform itself e.g giveaways run by the admin
      type: Boolean,
      default: false,
    },
    auctionid: {
      type: String,
      default: null,
    },
    giveaway: {
      type: Schema.Types.ObjectId,
      ref: "giveaway",
    },
    ordertype: {
      type: String,
      default: "tokshop",
    },
    invoice: {
      type: Number,
      required: false,
    },
    shipping_surge: {
      type: Number,
      default: 0.0,
    },
    wcOrderId: {
      type: Number,
      default: null,
    },
    service_fee: {
      type: Number,
      default: 0.0,
    },
    stripe_fees: {
      type: Number,
      default: 0.0,
    },
    earnings:{
      type: Number,
      default: 0.0,
    },
    paymentMethod: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      default: "processing",
    },
    dispute: {
      type: Schema.Types.ObjectId,
      ref: "dispute",
      default: null,
    },
    discount: {
      type: Number,
      default: 0.0,
    },

    tokshow: {
      type: Schema.Types.ObjectId,
      ref: "rooms",
      default: null,
    },

    date: {
      type: Number,
      default: Date.now(),
    },
    shipment_date: { type: Date },
    delivered_at:{type: Date },
    delivery_eta:{type: Date },
    shipped_at:{type: Date },
    cancelleddate: {
      type: Number,
      default: null,
    },
    shippeddate: {
      type: Number,
      default: null,
    },
    tax: {
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
    total_shipping_cost: {
      type: Number,
      default: 0.0,
    },
    items: [
      {
        type: Schema.Types.ObjectId,
        ref: "item",
      },
    ],
    weight: {
      type: Number,
      default: 0,
    },
    height: {
      type: String,
      default: "12",
    },
    scale: {
      type: String,
      default: "oz",
    },
    length: {
      type: String,
      default: "12",
    },
    width: {
      type: String,
      default: "12",
    },
    shipment_id: {
      type: String,
      default: null,
    },
    tracking_number: {
      type: String,
      default: null,
    },
    tracking_url: {
      type: String,
      default: null,
    },
    label: {
      type: String,
      default: null,
    },
    shipping_fee: {
      type: Number,
      default: 0.0,
    },
    retry_count: {
      type: Number,
      default: 0,
    },
    subtotal: {
      type: Number,
      default: 0.0,
    },
    last_payment_error: {
      type: String,
      default: null,
    },
    servicelevel: {
      type: String,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    payment_status: {
      type: String,
      default: "paid",
    }
  },
  {
    timestamps: true,
    autoIndex: true,
    autoCreate: true,
  }
);

module.exports = model("order", order);
