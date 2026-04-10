const express = require("express");
const notificationRouter = express.Router();
const userModel = require("../models/user");
const functions = require("../shared/functions");

notificationRouter.route("/settings/:id").put(async (req, res) => {
  let id = req.params.id;
  try {
    await userModel.findOneAndUpdate(
      { _id: id },
      { $set: { notification_settings: req.body } },
      { new: true, upsert: true }
    );
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ Success: true });
  } catch (e) {
    console.log("Error sending notification " + e);
    res
      .status(400)
      .setHeader("Content-Type", "application/json")
      .json({ Success: false });
  }
});
notificationRouter.route("/settings/:id").get(async (req, res) => {
  let id = req.params.id;
  try {
    let settings = await userModel.findOne({ _id: id });
    if (settings?.notification_settings) {
      settings = settings.notification_settings;
    }
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json(settings);
  } catch (e) {
    console.log("Error sending notification " + e);
    res
      .status(400)
      .setHeader("Content-Type", "application/json")
      .json({ Success: false });
  }
});

notificationRouter.route("/").post(async (req, res) => {
  try {
    console.log(req.body);
    function isFirebaseImageUrl(message) {
      if (typeof message !== "string") return false;
      // Check if it's a Firebase Storage URL
      const isFirebase = message.startsWith("http") && message.includes("firebasestorage.googleapis.com");
      // Optionally, check common image extensions in the path (before ? query params)
      const hasImageExt = /\.(jpeg|jpg|png|gif|webp|bmp)$/i.test(message.split('?')[0]);
      return isFirebase && hasImageExt;
    }
    const isImage = isFirebaseImageUrl(req.body.message);

    for (let i = 0; i < req.body.ids.length; i++) {
      var user = await userModel.findOne({ _id: req.body.ids[i] });
      if (user != null && user.fcmToken != "") {      
        functions.sendNotification(
          [user.fcmToken],
          req.body.title,
          isImage ? "📷 Image" : req.body.message,
          {
            screen: req.body.screen ?? "",
            id: req.body.id ?? "",
            sender: req.body.sender ?? "",
            receiver: req.body.ids[i] ?? "",
            senderusername: req.body.senderName ?? "",
            senderphoto:req.body.senderphoto ?? ""
          }  
        ) 
        
      }
    }

    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ Success: true });
  } catch (e) {
    console.log("Error sending notification " + e);
    res
      .status(400)
      .setHeader("Content-Type", "application/json")
      .json({ Success: false });
  }
});

module.exports = notificationRouter;
