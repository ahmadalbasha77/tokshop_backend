const express = require("express");
const auctionController = require("../controllers/auction");
const auctionRouter = express.Router();

auctionRouter.route("/").get(auctionController.getAuctions);
auctionRouter.route("/").post(auctionController.createAuction);
auctionRouter.route("/:id").put(auctionController.updateAuction);
auctionRouter.route("/room/aution/:id").get(auctionController.getAuction);
auctionRouter.route("/:id").delete(auctionController.deleteAuction);
auctionRouter.route("/:roomid").get(auctionController.getActiveAuctionByRoom);
auctionRouter.route("/all/:roomid").get(auctionController.getAuctionsByRoom);
auctionRouter.route("/bid").post(auctionController.bid);
auctionRouter.route("/bid/:id").put(auctionController.updateBid);
module.exports = auctionRouter;  