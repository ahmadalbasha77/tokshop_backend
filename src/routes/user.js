const express = require("express");
const userRouter = express.Router();
const userController = require("../controllers/users");

const passport = require("passport");

require("../services/authenticate");

const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];
  allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(null, false);
};

let upload = multer({ storage, fileFilter });
userRouter
  .route(`/`)
  .get(
    // passport.authenticate("jwt", { session: false }),
    userController.getUsers
  );
userRouter.post("/", upload.single("profilePicture"), userController.addUser);

userRouter
  .route("/:userId")
  .get(
    // passport.authenticate("jwt", { session: false }),
    userController.getUserById
  )
  .put(userController.editUserById)
  .delete(
    passport.authenticate("jwt", { session: false }),
    userController.deleteUserById
  );

userRouter
  .route("/followers/:userId")
  .get(
    userController.userFollowers
  );
userRouter
  .route("/following/:userId")
  .get(
    userController.userFollowing
  );

userRouter
  .route("/followersfollowing/:userId")
  .get(
    passport.authenticate("jwt", { session: false }),
    userController.userFollowersFollowing
  );

userRouter
  .route("/followersfollowing/search/:userId/:name")
  .get(
    passport.authenticate("jwt", { session: false }),
    userController.searchForUserFriends
  );

userRouter
  .route("/following/:userId")
  .get(
    passport.authenticate("jwt", { session: false }),
    userController.userFollowing
  );

userRouter
  .route("/follow/:myUid/:toFollowUid")
  .put(
    passport.authenticate("jwt", { session: false }),
    userController.followUser
  );

userRouter
  .route("/block/:myUid/:toBlockUid")
  .put(
    passport.authenticate("jwt", { session: false }),
    userController.blockUser
  );

userRouter
  .route("/unblock/:myUid/:toBlockUid")
  .put(
    passport.authenticate("jwt", { session: false }),
    userController.unblockUser
  );

userRouter
  .route("/unfollow/:myUid/:toFollowUid")
  .put(
    passport.authenticate("jwt", { session: false }),
    userController.unFollowUser
  );

userRouter
  .route("/updateWallet/:userId")
  .put(
    passport.authenticate("jwt", { session: false }),
    userController.updateWallet
  );



userRouter
  .route("/profile/summary/:shopid")
  .get(
    passport.authenticate("jwt", { session: false }),
    userController.getProfileSummary
  );

userRouter
  .route("/paymentmethod/:id")
  .get(
    userController.getPaymentmethodByUserId
  )

  .post(
    userController.createPaymentMethod
  )
  .delete(
    userController.deletePaymentmethod
  ).patch(
    userController.updatePaymentmethod
  );

userRouter
  .route("/payoutmethod/:id")
  .get(
    userController.getPayoutmethodByUserId
  )

  .post(
    userController.createPayoutMethod
  )
  .delete(
    userController.deletePayoutmethod
  );
userRouter.route("/review/:id").post(userController.addUserReview);
userRouter.route("/review/:id").get(userController.getUserReviews);
userRouter.route("/canreview/:id").post(userController.checkCanReview);
userRouter.route("/approveseller/:id").patch(userController.approveSeller);
userRouter
  .route("/review/delete/review/:id")
  .delete(userController.deleteUserReviewsById);

userRouter.route("/tip").post(userController.sendTip);
userRouter.route("/friends/:id").get(userController.getFriends);
userRouter.route("/bank/:id").get(userController.getbank);
userRouter.route("/bank/:id").delete(userController.deleteBank);
userRouter.route("/report/:id").post(userController.reportUser);
userRouter.route("/delete/user/:id").delete(userController.deleteUserData);
userRouter.route("/reports/cases").get(userController.getreportedcases);
userRouter.route("/shipping/:id").put(userController.updateShipingSettings);
userRouter.route("/account/statistics/:id").get(userController.accountStatistics);
userRouter.route("/stats/all").get(userController.userStats);
userRouter.route("/payouts/pending").get(userController.pendingUserPayouts);
userRouter.route("/public/profile/:id").get(userController.publicProfile);
userRouter.route("/referalstats/:userId").get(userController.referalStats);
userRouter.route("/referal/stats/logs").get(userController.getReferalLogs);

module.exports = userRouter; 
