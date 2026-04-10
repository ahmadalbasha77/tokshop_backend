const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const value = {
  type: String,
  required: [true, "This field is required"],
};

const paymentMethodSchema = new Schema(
  {
    name: {
      type: String,
      default: "",
    },

    type: {
      type: String,
      default: "",
    },
    last4: {
      type: String,
      default: "",
    },
    cardid: {
      type: String,
      default: "",
    },
    expiry: {
      type: String,
      default: "",
    },
    token: {
      type: String,
      default: "",
    },
    customerid: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      default: "active",
    },
    paymentMethodId: {
      type: String,
      default: "",
    },
    walletType: {
      type: String,
      default: "",
    },
    userid: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    primary: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    autoIndex: true,
    autoCreate: true,
  }
);
const users = model("paymentMethod", paymentMethodSchema);
module.exports = users;
