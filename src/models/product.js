const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const decode = require("../shared/base64");

const value = {
  type: String,
  required: [true, "This field is required"],
};

const productSchema = new Schema(
  {
    name: value,
    wcid: { type: Number },
    spId: { type: Number },
    prebids: [
  {
    user: { type: Schema.Types.ObjectId, ref: "user" },
    amount: { type: Number, required: true }
  }
],
    reserved: {
      type: String,
      default: "public",
    },
    flash_sale: {
      type: Boolean,
      default: false,
    },
    flash_sale_discount_type: {
      type: String,
      default: "percentage",
    },
    flash_sale_discount_value: {
      type: Number,
      default: 0,
    },
    flash_live_reserved: {
      type: Boolean,
      default: false,
    },
    salesCount: {
      type: Number,
      default: 0,
    },
    flash_sale_price: {
      type: Number,
      default: 0.0,
    },
    flash_sale_buy_limit: {
      type: Number,
      default: 0,
    },
    flash_sale_started:{
      type: Boolean,
      default: false
    },
    flash_sale_ended:{
      type: Boolean,
      default: false
    },
    flash_sale_end_time: {
      type: Date,
      default: null,
    },

    flash_sale_duration:{
      type: Number,
      default: 0
    },
    favoriteCount: {
      type: Number,
      default: 0,
    },
    price: {
      type: Number,
      default: 0.0,
    },
   
    default_sudden: {
      type: Boolean,
      default: false,
    },
    default_duration: {
      type: Number,
      default: 0,
    },
    discountedPrice: {
      type: Number,
      default: 0.0,
    },
    default_startprice: {
      type: Number,
      default: 0.0,
    },
    sizes: {
      type: Array,
    },
    colors: {
      type: Array,
    },
    order_reference_counter: {
      type: Number,
      default: 1,
    },
    quantity: {
      type: Number,
      min: 0,
      required: true,
    },
    favorited: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    tokshow: {
      type: Schema.Types.ObjectId,
      ref: "rooms",
    },

    reviews: [
      {
        type: Schema.Types.ObjectId,
        ref: "review",
      },
    ],
    deleted: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String, 
      enum: ["active", "inactive"],
      default: "active",
    },

    available: {
      type: Boolean,
      default: true,
    },
    listing_type: {
      type: String,
      enum: ["auction", "buy_now", "giveaway", "offers"],
      default: "buy_now",
    },
    images: {
      type: Array,
    },
    auction: {
      type: Schema.Types.ObjectId,
      ref: "auction",
      default: null,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "category",
    },
    offer:{
      type: Boolean,
      default: false
    },
    offersCount:{
      type: Number,
      default: 0
    },
    offers:[
      {
        type: Schema.Types.ObjectId,
        ref: "offer",
      }
    ],
    description: {
      type: String,
    },
    type: {
      type: String,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    shipping_profile: {
      type: Schema.Types.ObjectId,
      ref: "shipping_profile",
    },
    type: {
      type: String,
      default: "tokshop",
    },
  },
  { timestamps: true, autoIndex: true, autoCreate: true }
);

const products = model("product", productSchema);

module.exports = products;
