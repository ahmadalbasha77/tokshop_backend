const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const reviewSchema = new Schema(
  {
    review: String,
    overall: Number,
    shipping: Number,
    packaging: Number,
    accuracy: Number,
    reviewedItem: String,
    reviewType: String,
    from: { type: Schema.Types.ObjectId, ref: "user" },
    to: { type: Schema.Types.ObjectId, ref: "user" },
  },
  { timestamps: true }
);


const users = model("userreview", reviewSchema);
module.exports = users;
