const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const withdrawSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "user" },
    status: {
      type: String,
      enum: ["pending", "cancelled", "processed"],
      default: "pending",
    },
    amount: {
      type: Number,
      required: true,
      default: 1
    },
    date: {
      type: Number,
      default: Date.now(),
      required: true
    },
    withdrawCode: {
      type: String,
      default: "",
      required: true
    },
  },
  {
    timestamps: true,
    autoIndex: true,
    autoCreate: true,
  }
);

const withdraw = model("withdraw", withdrawSchema);

/*......................................
   *pre hook that saves the objectId of the order Schema in the quantity schema
   *
   *
   ......................................*/

module.exports = withdraw;
