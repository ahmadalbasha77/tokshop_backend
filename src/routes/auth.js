const express = require("express");
const authRouter = express.Router();
const authController = require("../controllers/auth");
authRouter.post("/signup", authController.signupWithEmail);
authRouter.post("/login", authController.loginWithEmail);
authRouter.post("/", authController.authenticate); 
authRouter.post('/forgot-password', authController.forgotPassword);
authRouter.post('/reset-password', authController.resetPassword);
module.exports = authRouter;