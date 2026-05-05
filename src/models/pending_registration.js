const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const pendingRegistrationSchema = new Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      default: "",
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    password_hash: {
      type: String,
      required: true,
    },
    account_type: {
      type: String,
      default: "email_password",
    },
    code_hash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    last_sent_at: {
      type: Date,
      required: true,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    registration_data: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
    autoCreate: true,
    autoIndex: true,
  }
);

pendingRegistrationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 3600 });

module.exports = model("pending_registration", pendingRegistrationSchema);
