const giveawayController = require("../controllers/giveaway");
const express = require("express");
const giveawayRouter = express.Router();

giveawayRouter
  .route("/")
  .get(giveawayController.getGiveaways)
  .post(giveawayController.createGiveaway);

giveawayRouter
  .route("/:id")
  .get(giveawayController.getGiveawayById)
  .put(giveawayController.updateGiveaway)
  .delete(giveawayController.deleteGiveaway);
giveawayRouter.route("/bulkedit/all").put(giveawayController.bulkUpdateGiveaway)
giveawayRouter.route("/:id/bookmark").post(giveawayController.bookmarkGiveaway);
giveawayRouter.route("/:id/join").post(giveawayController.joinGiveaway);

module.exports = giveawayRouter;