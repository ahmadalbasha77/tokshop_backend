const webhookController = require("../controllers/webhookController");
const express = require("express");
const webhookRouter = express.Router();
webhookRouter.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  webhookController.handleStripeWebhook
);
  

webhookRouter.post(
  "/stripe/platform",
  express.raw({ type: "application/json" }),
  webhookController.handleStripePlatformWebhook
);
module.exports = webhookRouter;
