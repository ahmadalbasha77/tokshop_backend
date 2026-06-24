const express = require("express");
const passport = require("passport");
const controller = require("../controllers/applicationLog");
const { requireAdminJson } = require("../services/adminJsonAuth");

const router = express.Router();

// Public remote client logging (optional JWT authentication)
router.post(
  "/client",
  (req, res, next) => {
    passport.authenticate("jwt", { session: false }, (err, user) => {
      if (user) {
        req.user = user;
      }
      next();
    })(req, res, next);
  },
  controller.submitClientLog
);

// Admin-only remote client logs viewing
router.get(
  "/admin/client",
  requireAdminJson,
  controller.getAdminClientLogs
);

module.exports = router;
