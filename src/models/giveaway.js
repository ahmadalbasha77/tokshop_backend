const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const giveAway = new Schema(
  {
    name: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    duration: {
      type: Number,
      default: 30 , 
    },
    bookmarks: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    whocanenter: {
      type: String,
      default: "all",
    },
    quantity: {
      type: Number,
      default: 0,
    },
    reference: {
      type: String,
      default: "",
    },
    tokshow: {
      type: Schema.Types.ObjectId,
      ref: "rooms",
    },
    images: {
      type: Array,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "category",
    },
    type: {
      type: String,
      enum: ["icona", "seller","show"],
      default: "seller",
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    startedtime: {
      type: Date,
      default: null,
    },
    endedtime: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      default: "active",
    },
    winner: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    shipping_profile: {
      type: Schema.Types.ObjectId,
      ref: "shipping_profile",
    },
  },
  { timestamps: true, autoCreate: true, autoIndex: true }
);

module.exports = model("giveaway", giveAway);
