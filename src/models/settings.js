const mongoose = require("mongoose");

const AppSettingsSchema = mongoose.Schema({
  forceUpdate: {
    type: Boolean,
    default: false,
  },
  seller_auto_approve: {
    type: Boolean,
    default: false,
  },
  google_api_key:{
    type: String,
    default: "",
  },
  support_email: {
    type: String,
    default: "",
  },
  firebase_auth_domain: {
    type: String,
    default: "",
  },
  firebase_project_id: {
    type: String,
    default: "",
  },
  firebase_storage_bucket: {
    type: String,
    default: "",
  },
  firebase_app_id: {
    type: String,
    default: "",
  },
  commission: {
    type: String,
    default: "",
  },
  currency: {
    type: String,
    default: "",
  },
  stripe_connect_account: {
    type: String,
    default: "",
  },
  stripe_service_fee_account: {
    type: String,
    default: "",
  },
  stripe_fee: {
    type: String,
    default: "",
  },
  extra_charges: {
    type: String,
    default: "",
  },
  appVersion: {
    type: Number,
    default: 0,
  },
  demoMode: {
    type: Boolean,
    default: false,
  },
  androidVersion: {
    type: String,
    default: "",
  },
  iosVersion: {
    type: String,
    default: "",
  },
  FIREBASE_API_KEY: {
    type: String,
    default: "",
  },
  default_email_provider: {
    type: String,
    default: "mail_gun",
  },
  shippo_api_key: {
    type: String,
    default: "",
  },
  stripeSecretKey: {
    type: String,
    default: "",
  },
  stripepublickey: {
    type: String,
    default: "",
  },
  stripe_webhook_key:{
    type: String,
    default: "",
  },
  livekit_url:{
    type: String,
    default: "",
  },
  livekit_api_key:{
    type: String,
    default: "",
  },
  livekit_api_secret:{
    type: String,
    default: "",
  },
  tip_processing: {
    type: String,
    default: "",
  },
  email_service_provider: {
    type: String,
    default: "",
  },
  email_api_key: {
    type: String,
    default: "",
  },
  referral_credit: {
    type: Number,
    default: 0,
  },
  referral_credit_limit: {
    type: Number,
    default: 0,
  },
  stripe_platform_webhook_key: {
    type: String,
    default: "",
  },
  email_from_address: {
    type: String,
    default: "",
  },
  email_from_name: {
    type: String,
    default: "",
  },
  email_mailgun_domain: {
    type: String,
    default: "",
  },
  email_smtp_host: {
    type: String,
    default: "",
  },
  email_smtp_port: {
    type: String,
    default: "",
  },
  email_smtp_user: {
    type: String,
    default: "",
  },
  email_smtp_pass: {
    type: String,
    default: "",
  },
  email_reply_to: {
    type: String,
    default: "",
  },
  ios_link: {
    type: String,
    default: "", 
  },
  android_link: {
    type: String,
    default: "",
  },
  email_reply_name: {
    type: String,
    default: "",
  },
});

module.exports = mongoose.model("appsettings", AppSettingsSchema);
