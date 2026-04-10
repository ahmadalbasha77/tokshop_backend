const express = require("express");
const authRouter = require("./auth");
const userRouter = require("./user");
const orderRouter = require("./order");
const product = require("./product");
const addressRouter = require("./address");
const roomRouter = require("./room");
const transRouter = require("./transactions");
const activityRouter = require("./activities");
const notificationsRouter = require("./notification");
const shipping = require("./shipping");
const adminRouter = require("./admin");
const category = require("./category");
const auctionRouter = require("./auction");
const stripeRouter = require("./stripe");
const apiRouter = require("./rest_api");
const giveawayRouter = require("./giveaway");
const livekitRouter = require("./livekit");
const settingsRouter = require("./settings");
const contentsRouter = require("./contents")
const passport = require("passport");
const articles = require("./articles");
const offers = require("./offers");
const themeRoutes = require("./theme_settings");
const livekitPublic = require("./livekit.public");
const settingsController = require("../controllers/settings");
const shippingController = require("../controllers/shipping");
const userController = require("../controllers/users");

require("../services/authenticate");

const router = express.Router();

router.use("/themes", themeRoutes);
router.use("/livekit", livekitPublic);
router.use("/livekit",passport.authenticate("jwt", { session: false }),  livekitRouter);
router.use("/auth", authRouter);
router.use("/articles",  articles);
router.use("/offers",passport.authenticate("jwt", { session: false }),  offers);
router.get(
  "/settings/keys",
  settingsController.getFirebaseSettings
);
// router.use("/users",  userRouter);
router.use("/users/public/profile/:id", userController.publicProfile);
router.use("/users",
  passport.authenticate("jwt", { session: false }),   
  userRouter);
router.use("/orders",  orderRouter);
router.use("/orders",
  passport.authenticate("jwt", { session: false }), 
   orderRouter);
router.use("/shipping/webhook",  shippingController.webookShippo);
router.use("/shipping", 
  passport.authenticate("jwt", { session: false }),
   shipping);
router.use("/products", 
  passport.authenticate("jwt", { session: false }),
   product);
router.use("/category", passport.authenticate("jwt", { session: false }), category);
router.use("/auction",
  passport.authenticate("jwt", { session: false }),
    auctionRouter);
router.use("/stripe",  
  passport.authenticate("jwt", { session: false }),
   stripeRouter);
router.use("/api", passport.authenticate("jwt", { session: false }), apiRouter);
router.use("/giveaways",  giveawayRouter);
router.use("/giveaways", 
  passport.authenticate("jwt", { session: false }), 
  giveawayRouter);
router.use("/settings",  
  passport.authenticate("jwt", { session: false }),
   settingsRouter);
router.use("/content", contentsRouter);
router.use("/address", 
  passport.authenticate("jwt", { session: false }),
    addressRouter);
router.use("/rooms",
     passport.authenticate("jwt", { session: false }), 
roomRouter);
router.use("/transactions", 
  passport.authenticate("jwt", { session: false }), 
  transRouter);
router.use("/activities", passport.authenticate("jwt", { session: false }), activityRouter);
router.use("/notifications", passport.authenticate("jwt", { session: false }), notificationsRouter);
router.use("/admin",adminRouter);
router.use("/templates", require("./templates"));
router.use("/paypal", require("./paypal"));

module.exports = router;
