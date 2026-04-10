const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const shippingProfile = new Schema({
  weight: {
    type: Number,
    default: 0,
  },
  name: {
    type: String,
    default: "",
  },
  scale: {
    type: String,
    default: "",
  },
  type: {
    type: String,
    default: "",
  },
  taxCode: {
    type: String,
    default: "",
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: "user",
  },
  length: {
    type: Number,
    default: 12,
  },
  width: {
    type: Number,
    default: 12,
  },
  height: {
    type: Number,
    default: 12,
  },
});
module.exports = model("shipping_profile", shippingProfile);
