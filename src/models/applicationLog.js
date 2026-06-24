const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const applicationLogSchema = new Schema({
  platform: {
    type: String,
    required: true,
    enum: ["android", "ios", "dashboard", "web", "backend"],
  },
  appVersion: {
    type: String,
    required: true,
  },
  buildNumber: {
    type: String,
    default: null,
  },
  userId: {
    type: String,
    default: null,
  },
  userName: {
    type: String,
    default: null,
  },
  email: {
    type: String,
    default: null,
  },
  level: {
    type: String,
    required: true,
    enum: ["debug", "info", "warn", "error", "fatal"],
    default: "error",
  },
  screenName: {
    type: String,
    default: null,
  },
  fileName: {
    type: String,
    default: null,
  },
  functionName: {
    type: String,
    default: null,
  },
  endpointUrl: {
    type: String,
    default: null,
  },
  message: {
    type: String,
    required: true,
  },
  stackTrace: {
    type: String,
    default: null,
  },
  extraDetails: {
    type: Schema.Types.Mixed,
    default: null,
  },
  osVersion: {
    type: String,
    default: null,
  },
  deviceModel: {
    type: String,
    default: null,
  },
  networkType: {
    type: String,
    default: null,
  },
  locale: {
    type: String,
    default: null,
  },
  ipAddress: {
    type: String,
    default: null,
  },
  userAgent: {
    type: String,
    default: null,
  },
  clientTimestamp: {
    type: Number,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index for fast queries by platform, level, and creation date
applicationLogSchema.index({ platform: 1, level: 1, createdAt: -1 });
applicationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ApplicationLog", applicationLogSchema);
