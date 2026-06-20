const express = require("express");
const controller = require("../controllers/publicShare");
const {
  publicShareCors,
  publicShareRateLimit,
} = require("../services/publicShare.middleware");

const router = express.Router();

router.use(publicShareCors, publicShareRateLimit);
router.get("/live/:id", controller.live);
router.get("/product/:id", controller.product);
router.get("/profile/:id", controller.profile);
router.get("/auction/:id", controller.auction);
router.get("/giveaway/:id", controller.giveaway);
router.get("/invite/:id", controller.invite);

module.exports = router;
