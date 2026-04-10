const mongoose = require("mongoose");

const ThemeSchema = mongoose.Schema({
  app_name: {
    type: String,
    default: "",
  },
  app_logo: {
    type: String,
    default: "",
  }, 
  website_url:{
    type: String,
    default: "",

  },
  privacy_url: {
    type: String,
    default: "",
  },
  terms_url: {
    type: String,
    default: "",
  },
  resources: [
    {
      key: String,
      url: String
    }
  ],
  slogan:{
    type: String,
    default: "",
  },
  button_color:{
    type: String,
    default: "",},
  button_text_color:{
    type: String,
    default: "",},
  primary_color: {
    type: String,
    default: "",
  },
  secondary_color: {
    type: String,
    default: "",
  },
  seo_title: {
    type: String,
    default: "Tokshop Live Shopping"
  },
})

module.exports = mongoose.model("themesettings", ThemeSchema);
