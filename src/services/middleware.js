const express = require("express");
const path = require("path");
const logger = require("morgan");
const passport = require("passport");
const cors = require("cors");
const helmet = require("helmet");

const router = express.Router();

router.use(cors());
router.use(logger("dev"));
router.use(express.json({ limit: "50mb" }));
router.use(express.urlencoded({ extended: true }));
router.use(express.static(path.join(__dirname, "./public")));
router.use(passport.initialize());

router.use(function (err, req, res, next) {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};
  res.status(err.status || 500);
  res.json("error");
});

module.exports = router;
