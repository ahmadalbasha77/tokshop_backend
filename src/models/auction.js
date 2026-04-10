const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const decode = require("../shared/base64");

const value = {
  type: String,
  required: [true, "This field is required"],
};

const auctionSchema = new Schema(
  {
    higestbid: {
      type: Number,
      default: 0,
    },
    watchers: {
      type: Number,
      default: 0,
    },
    schedule_viewers: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    newbaseprice: {
      type: Number,
      default: 0,
    },
    winner: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    winning: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    bids: [
      {
        type: Schema.Types.ObjectId,
        ref: "bids",
      },
    ],
    product: {
      type: Schema.Types.ObjectId,
      ref: "product",
      default: null,
    },
    tokshow: {
      type: Schema.Types.ObjectId,
      ref: "rooms",
    },
    egressId: {
      type: String,
      default: "",
    },
    videoReceipt: {
      type: String,
      default: "",
    },
    baseprice: {
      type: Number,
      default: 0,
    },
    increaseBidBy: {
      type: Number,
      default: 0,
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    duration: {
      type: Number,
      default: 0,
    },
    startedTime: {
      type: Number,
      default: 0,
    },
    quantity: {
      type: Number,
      default: 1,
    },
    endTime: { type: Date },
    sudden: {
      type: Boolean,
      default: false,
    },
    started: {
      type: Boolean,
      default: false,
    },
    start_time_date:{
      type: Number,
      default: 0.0
    },
    end_time_date:{
      type: Number,
      default: 0.0
    },
    type: {
      type: String,
      enum: ["scheduled", "show"],
      default: "show",
    },
    ended: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true, autoCreate: true, autoIndex: true }
);

auctionSchema.index({ end_time_date: 1, started: 1, ended: 1, sudden: 1 }); 
auctionSchema.index({ bids: 1 }); 
auctionSchema.index({ product: 1 }); 
auctionSchema.index({ winner: 1 });  

const auction = model("auction", auctionSchema);
module.exports = auction;
