const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const value = {
  type: String,
  required: true,
};

const roomSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      required: true,
      // unique: true,
      ref: "user",
    },
    activeCameraSessionId: {
      type: String,
      default: "",
    },
    featured: {
      type: Boolean,
      default: false,
    },
    featured_until: {
      type: Number,
      default: null,
    },
    title: {
      type: String,
      default: "",
    },
    recordingId: {
      type: String,
      default: "",
    },
    recordingToken: {
      type: String,
      default: "",
    },
    egressId: {
      type: String,
      default: "",
    },
    egressToken: {
      type: String,
      default: "",
    },
    description: {
      type: String,
      default: "",
    },
    hlsUrl: {
      type: String,
      default: '',
    },
    soldProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "product",
      },
    ],
    salesTotal: {
      type: Number,
      default: 0,
    },
    tipsTotal: {
      type: Number,
      default: 0,
    },
    giveawayCount: {
      type: Number,
      default: 0,
    },
    shipmentsCount: {
      type: Number,
      default: 0,
    },
    salesCount: {
      type: Number,
      default: 0,
    },
    pinned: {
      type: Schema.Types.ObjectId,
      ref: "product",
      defaul: null,
    },
    pinned_giveaway: {
      type: Schema.Types.ObjectId,
      ref: "giveaway",
      default: null,
    },
    streamOptions: {
      type: Array,
      default: [],
    },
    co_host_identity:{
      type: String,
      default: "",
    },
    co_host: {
      type: Schema.Types.ObjectId,
      ref: "user",
    },
    moderators: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    followersCount: {
      type: Number,
      default: 0,
    },
    banned:[
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    viewers: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    auctions: [
      {
        type: Schema.Types.ObjectId,
        ref: "auction",
      },
    ],
    activeauction: {
      type: Schema.Types.ObjectId,
      ref: "auction",
      default: null,
    },

    title: value,

    recordingIds: {
      type: Array,
      default: [],
    },
    invitedhostIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    status: {
      type: Boolean,
      default: true,
    },
    usersNotified: {
      type: Boolean,
      default: false,
    },
    audioMuted: {
      type: Boolean,
      default: false,
    },
    explicit_content: {
      type: Boolean,
      default: false,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "category",
    },
    token: {
      type: String,
    },
    notificationsent: {
      type: Boolean,
      default: false,
    },
    preview_videos: {
      type: String,
      default: "",
    },
    thumbnail: {
      type: String,
      default: "",
    },
    scan_form_url: { 
      type: String,
      default: null,
    },
    repeat: {
      type: String,
      enum: ["none", "hourly", "daily", "weekly", "monthly"],
      default: "none",
    },
    shipping_settings: {
      type: Object,
      default: null,
    },
    roomType: {
      type: String,
      default: "public",
    },
    activeTime: {
      type: Number,
      default: Date.now(),
    },
    started: {
      type: Boolean,
      default: false,
    },
    ended: {
      type: Boolean,
      default: false,
    },
    endedTime: {
      type: Number,
    },
    date: {
      type: Number,
    },
    startedTime:{
      type: Number,
      default: Date.now(),
    }
  },
  { timestamps: true, autoIndex: true, autoCreate: true }
);

const roomModel = model("rooms", roomSchema);
module.exports = roomModel;
