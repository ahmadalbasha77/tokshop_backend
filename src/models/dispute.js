const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const dispute = new Schema({
  orderId: {
    type: Schema.Types.ObjectId,
      default: "",
      ref: "order",
  },
  seller_response: {
      type: String,
      default: "" 
  },
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: "user", 
  },
  status: {
      type: String,
      default: "submitted",
      enum: ["seller_response", "reviewing", "resolved", "submitted"],
  },
  favored: {
    type: Schema.Types.ObjectId,
    ref: "user", 
  },
  final_comments: {
    type: String,
      default: ""
  },
  reason: {
    type: String,
      default: ""
  },
  details: {
      type: String,
      default: ""
  },
  
}, { timestamps: true, autoIndex: true, autoCreate: true })

module.exports = model("dispute", dispute);