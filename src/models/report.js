const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const reportModel = Schema(
  {
    reported: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    reported_by: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    reason: {
      type: String,
      default: "",
    },
    
  },
  { timestamps: true, autoCreate: true, autoIndex: true }
);

const items = model("report", reportModel);
module.exports = items;
