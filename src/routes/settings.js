const express = require("express");
const settingsController = require("../controllers/settings.js");
const settingsRouter = express.Router();
settingsRouter.route("/").post(settingsController.saveAppSettings);
settingsRouter.route("/").get(settingsController.getAppSettings);
settingsRouter.route("/keys").get(settingsController.getFirebaseSettings);
module.exports = settingsRouter;  