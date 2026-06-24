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
const roomController = require("../controllers/rooms");
const requireAdminJson = require("../services/adminJsonAuth");
const pendingServiceTransactionsController = require("../controllers/pendingServiceTransactions");
const adminReadController = require("../controllers/adminRead");
const adminOrderPaymentsController = require("../controllers/adminOrderPayments");
const adminPayoutsController = require("../controllers/adminPayouts");
const publicShareRouter = require("./publicShare");

require("../services/authenticate");

const router = express.Router();

router.use("/themes", themeRoutes);
router.use("/share", publicShareRouter);
router.use("/livekit", livekitPublic);
router.use("/livekit",passport.authenticate("jwt", { session: false }),  livekitRouter);
router.use("/auth", authRouter);
router.use("/articles",  articles);
router.use("/offers",passport.authenticate("jwt", { session: false }),  offers);
router.get(
  "/settings/keys",
  settingsController.getFirebaseSettings
);
router.get("/public/app-update", settingsController.getPublicAppUpdate);
// router.use("/users",  userRouter);
router.use("/users/public/profile/:id", userController.publicProfile);
router.get(
  "/admin/verify",
  requireAdminJson,
  adminReadController.verifyAdmin
);
router.get(
  "/admin/stripe-payouts",
  requireAdminJson,
  adminPayoutsController.getStripePayouts
);
router.get(
  "/admin/financial-logs",
  requireAdminJson,
  adminReadController.getFinancialLogs
);
router.get("/users", requireAdminJson, adminReadController.getUsers);
router.get(
  "/users/stats/all",
  requireAdminJson,
  adminReadController.getUserStats
);
router.get(
  "/users/shipping/service/pending",
  requireAdminJson,
  pendingServiceTransactionsController.getPendingShippingServiceTransactions
);
router.post(
  "/users/shipping/service/transfer",
  requireAdminJson,
  pendingServiceTransactionsController.transferShippingServiceFunds
);
router.get(
  "/orders/stats/all",
  requireAdminJson,
  adminReadController.getOrderStats
);
router.get(
  "/admin/orders/:orderId/payment-release",
  requireAdminJson,
  adminOrderPaymentsController.getOrderFundsStatus
);
router.post(
  "/admin/orders/:orderId/payment-release",
  requireAdminJson,
  adminOrderPaymentsController.releaseOrderFunds
);
router.get(
  "/rooms/stats/all",
  requireAdminJson,
  adminReadController.getRoomStats
);
router.get("/templates", requireAdminJson, adminReadController.getTemplates);
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
router.use("/admin/categories", requireAdminJson, category);
router.use("/api/admin/categories", requireAdminJson, category);
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
router.get("/tokshows/most-viewed-live",
  passport.authenticate("jwt", { session: false }),
  roomController.getMostViewedLiveShows
);
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
