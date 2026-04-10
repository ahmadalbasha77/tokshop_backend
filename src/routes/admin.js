const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin");
const auth = require("../controllers/auth");
const passport = require("passport");

router.get("/",passport.authenticate("jwt", { session: false }), adminController.getAllAdmins);

router.get("/profile/:id", passport.authenticate("jwt", { session: false }),adminController.getAdminById);

router.post("/", passport.authenticate("jwt", { session: false }),adminController.saveAdmin);
router.post("/register",adminController.registerAdmin);

router.post("/login", adminController.logInAdmin);

router.patch("/:id", passport.authenticate("jwt", { session: false }),adminController.updateAdmin);

router.delete("/:id", passport.authenticate("jwt", { session: false }),adminController.deleteAdmin);
router.get("/exists", adminController.checkAdminRoleExists);
router.post("/impersonate/user", auth.impersonateUser);
module.exports = router;
 