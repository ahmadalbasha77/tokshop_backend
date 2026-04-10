const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const category = new mongoose.Schema({
  name: {
    type: String,
    default: "",
  },
  tax_code:{
    type: String,
    default: "",
  },
  hs_code: {
    type: String,
    default: null,
  },
  icon: {
    type: String,
    default: "",
  },
  followers: [
    {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
  ],
  followers: [
    {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
  ],
  viewersCount: {
    type: Number,
    default: 0,
  },
  followersCount: {
    type: Number,
    default: 0,
  },
  commission_enabled: {
    type: Boolean,
    default: false,
  },
  commission: {
    type: Number,
    default: 0,
  },
  type: {
    type: String,
    default: "parent",
  },
  subCategories: [
    {
      type: Schema.Types.ObjectId,
      ref: "category",
    },
  ],
  parent: {
    type: Schema.Types.ObjectId,
    ref: "category",
  },
  rooms: [
    {
      type: Schema.Types.ObjectId,
      ref: "rooms",
    },
  ],
});

module.exports = mongoose.model("category", category);
