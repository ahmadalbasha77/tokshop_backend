const express = require("express");
const router = express.Router();
const contents = require("../controllers/contents");
const passport = require("passport");
router.get("/:pageType", contents.getContent);
router.put("/:pageType",passport.authenticate("jwt", { session: false }),  contents.updateContent);
router.post("/:pageType/reset", passport.authenticate("jwt", { session: false }), contents.resetContent);
module.exports = router;