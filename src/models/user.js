const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const bcrypt = require("bcrypt");
const Counter = require("./counter");

const value = {
  type: String,
};

const BADGE_LIMITS = {
  RISING: 10,
  VERIFIED: 100,
  ICONA: 1000,
};

const BADGE_URLS = {
  RISING: "https://lh3.googleusercontent.com/d/1hlCe9xAY5hsjuNPGlBOM0eQlkFg2WHJf=w50",
  VERIFIED: "https://lh3.googleusercontent.com/d/19SheP1admSa7P4kikO5Y6jikx2iR1fsb=w50",
  ICONA: "https://lh3.googleusercontent.com/d/1GScLM8Db7jYvQnu09jPF5Q8ffom6g79M=w50",
};


const user = new Schema(
  {
    firstName: value,
    date_of_birth: {type: String, default: ""},
    lastName: { type: String, default: "" },
    applied_seller: {
      type: Boolean,
      default: false,
    },
    above_age:{
      type: Boolean,
      default: false,
    },
    defaultpaymentmethod: {
      type: Schema.Types.ObjectId,
      ref: "paymentMethod",
      default: null,
    },
    appleId: {
      type: String,
      default: null,
    },
    shipping_settings: {
      type: Object,
      default: {
        // Domestic Shipping Options
        priorityMailEnabled: true,         // USPS Priority Mail toggle
        groundAdvantageEnabled: true,      // USPS Ground Advantage toggle

        // Shipping Costs Settings
        shippingCostMode: "buyer_pays_all", // "seller_pays_all" | "buyer_pays_up_to" | "buyer_pays_all"
        reducedShippingCapAmount: 0,        // applicable if mode == "buyer_pays_up_to"

        // For convenience and backward compatibility
        buyer_pays: true,
        seller_pays: false,
        freePickupEnabled: false
      },
    },
    notification_settings: {
      type: Object,
      default: {
        'notify_on_follow': true,
        'notify_on_message': true,
        'notify_on_order': true,
        'notify_on_live': true
      },
    },
    blocked_by:[
      {
        type: Schema.Types.ObjectId,
        ref: "user",
        default: null,
    }],
    blocked:[
      {
        type: Schema.Types.ObjectId,
        ref: "user",
        default: null,
    }],
    system_blocked:{
        type: Boolean,
        default: false,
    },
    shipping: {
      type: Schema.Types.ObjectId,
      ref: "shipping",
      default: null,
    },
    stripe_account: {
      type: String,
      default: null,
    },
    bio: { type: String, default: "" },
    logintype: { type: String, default: "" },
    account_type: { type: String, default: "" },
    userName: {
      type: String,
      default: "",
    },
    phonenumber: { type: String },
    profilePhoto: { type: String, default: "" },
    coverPhoto: { type: String, default: "" },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      required: "Email address is required",
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please fill a valid email address",
      ],
    },
    tokshows: {
      type: Number,
      default: 0,
    },
    password: {
      type: String,
      default: null,
    },
    fcmToken: {
      type: String,
      default: null,
    },
    country: {
      type: String,
      default: "",
    },
    wcConsumerKey: {
      type: String,
      default: "",
    },
    wcSecretKey: {
      type: String,
      default: "",
    },
    wcUrl: {
      type: String,
      default: "",
    },
    stripeToken: {
      type: String,
      default: "",
    },
    gender: {
      type: String,
      default: "",
    },
    averagereviews: {
      type: Number,
      default: 0,
    },
    followersCount: {
      type: Number,
      default: 0,
    },
    suspended:{
      type: Boolean,
      default:false
    },
    suspend_end:{
      type: Date,
      default: null
    },
    followingCount: {
      type: Number,
      default: 0,
    },
    badge: { type: String, default: "" },
    badgeTier: { type: String, default: "" }, // rising | verified | icona


    followers: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    following: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
      },
    ],
    address: {
      type: Schema.Types.ObjectId,
      ref: "address",
      default: null,
    },
    reviewer: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
        default: null,
      },
    ],
    friends: [
      {
        type: Schema.Types.ObjectId,
        ref: "user",
        default: null,
      },
    ],
    seller: {
      type: Boolean,
      default: false,
    },
    appVersion: {
      type: String,
      default: "",
    },

    wallet: {
      type: Number,
      min: 0,
      default: 0,
    },
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "shop",
      default: null,
    },
    notificationToken: {
      type: String,
      default: "",
    },
    receivemessages: {
      type: Boolean,
      default: true,
    },
    muted: {
      type: Boolean,
      default: true,
    },
    stripeAccountId: {
      type: String,
      default: "",
    },
    awarded_referal_credit: {
      type: Boolean,
      default: false
    },
    referal_reward_banner_displayed: {
      type: Boolean,
      default: false
    },
    stripe_service_fee_account: {
      type: String,
      default: "",
    },
    referredBy: {
      type: Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },
    last_stripe_transfer: {
      type: Date,
      default: null
    },
    walletPending: {
      type: Number,
      default: 0,
    },
    wallet_pending_withdraw: {
      type: Number,
      default: 0,
    },
    stripeBankAccount: {
      type: String,
      default: "",
    },
    accountDisabled: {
      type: Boolean,
      default: false,
    }
  },
  {
    timestamps: true,
    autoCreate: true, // auto create collection
    autoIndex: true, // auto create indexes
  }
);



user.pre("save", async function (next) {

  // 1. Badge assignment should ALWAYS run when reviews change
  if (this.isModified("averagereviews")) {
    await this.assignBadgeOnce();
  }

  next();
});


user.methods.isValidPassword = async function (password) {
  const user = this;
  const compare = await bcrypt.compare(password, user.password);
  return compare;
};

user.methods.assignBadgeOnce = async function () {
  if (this.badge) return; // User already has a badge → do nothing

  // Only give badges when user reaches exactly 5 five-star reviews
  if (this.averagereviews < 5) return;

  const User = this.constructor;

  // Count current badge owners
  const risingCount = await User.countDocuments({ badgeTier: "rising" });
  const verifiedCount = await User.countDocuments({ badgeTier: "verified" });
  const iconaCount = await User.countDocuments({ badgeTier: "icona" });

  // Badge assignment in strict order
  if (risingCount < BADGE_LIMITS.RISING) {
    this.badge = BADGE_URLS.RISING;
    this.badgeTier = "rising";
    return;
  }

  if (verifiedCount < BADGE_LIMITS.VERIFIED) {
    this.badge = BADGE_URLS.VERIFIED;
    this.badgeTier = "verified";
    return;
  }

  if (iconaCount < BADGE_LIMITS.ICONA) {
    this.badge = BADGE_URLS.ICONA;
    this.badgeTier = "icona";
    return;
  }

  // No badge slots left
  this.badge = "";
  this.badgeTier = "";
};


const users = model("user", user);
module.exports = users;
