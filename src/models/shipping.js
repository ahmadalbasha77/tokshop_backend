const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const shipping = new Schema({
  cost: {
    type: Number,
    default: 0,
  },
  name: {
    type: String,
    default: "",
  },
});
module.exports = model("shipping", shipping);
