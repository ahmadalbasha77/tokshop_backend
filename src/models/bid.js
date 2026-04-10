const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const bidSchema = new Schema(
  {
    amount: {
      type: Number,
      default: 0,
    },
    autobid: {
      type: Boolean,
      default: false,
    },
    custom_bid: {
      type: Boolean,
      default: false,
    },
    autobidamount: {
      type: Number,
      default: 0,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    auction: {
      type: Schema.Types.ObjectId,
      ref: "auction",
    }
  },
  { timestamps: true, autoCreate: true, autoIndex: true }
);

bidSchema.index({ auction: 1, amount: -1 });
bidSchema.index({ user: 1 });
const bidModel = model("bids", bidSchema);
module.exports = bidModel;
