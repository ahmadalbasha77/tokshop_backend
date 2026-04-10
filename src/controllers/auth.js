const userModel = require("../models/user");
const axios = require("axios")
const jwt = require("jsonwebtoken");
var admin = require("firebase-admin");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const { createTestStripeToken } = require("./stripe");
const functions = require("../shared/functions");
require("dotenv").config({ path: `${__dirname}/../../.env` });
const ThemeSettings = require("../models/themes");
const crypto = require('crypto');
const ResetToken = require('../models/reset_tokens');
const { sendEmail } = require('../shared/email');
const EmailTemplate = require('../models/templates');
const ReferralLog = require('../models/referral_log');
const roomsModel = require("../models/room");
// Request password reset
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await userModel.findOne({ email: email.toLowerCase(), });

    if (!user) {
      // Don't reveal if email exists
      return res.json({ message: "If an account exists, a reset email has been sent", sucess: true });
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Delete any existing tokens for this user
    await ResetToken.deleteMany({ email: user.email });

    // Store new reset token
    await ResetToken.create({
      email: user.email,
      token: hashedToken,
      expiresAt,
    });

    // Send reset email
    await sendResetPasswordEmail(user, resetToken);

    res.json({ message: "If an account exists, a reset email has been sent", success: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Failed to process request", success: false });
  }
};

// Reset password with token
exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Token and password are required" });
    }

    // Hash the provided token
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    // Find valid reset token
    const resetRecord = await ResetToken.findOne({
      token: hashedToken,
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!resetRecord) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    // Find user
    const user = await userModel.findOne({ email: resetRecord.email });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update user password
    await userModel.updateOne(
      { _id: user._id },
      { $set: { password: hashedPassword } }
    );

    // Mark token as used
    await ResetToken.updateOne(
      { _id: resetRecord._id },
      { $set: { used: true } }
    );

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Failed to reset password" });
  }
};

// Helper function to send password reset email
async function sendResetPasswordEmail(user, resetToken) {
  const themesettings = await ThemeSettings.findOne({});
  const emailTemplate = await EmailTemplate.findOne({ slug: "password_reset" });

  if (!emailTemplate) {
    throw new Error("Password reset email template not found");
  }

  const resetUrl = `${themesettings.website_url}/reset-password?token=${resetToken}`;
  let placeholders = {
    name: user.userName || user.firstName + (user.lastName ? ` ${user.lastName}` : ''),
    reset_url: resetUrl,
    expiry_time: '1 hour',
  };
  await sendEmail(placeholders, user.email, 'password_reset')
}
async function verifyAppleAccessToken(accessToken) {
  const response = await axios.get(
    "https://appleid.apple.com/auth/keys",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  const keys = response.data;
  return jwt.decode(accessToken, keys, true);
}
async function verifyGoogleAccessToken(accessToken) {
  const response = await axios.get(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return response.data;
}

async function createFirebaseUserWithMongoID(user) {
  let payload = {
    uid: user._id.toString(), // MongoDB ID as Firebase UID
    email: user.email,
    displayName: user.firstName + (user.lastName ? ` ${user.lastName}` : ''),
    emailVerified: true
  }
  if (user.profilePhoto) {
    payload.photoURL = user.profilePhoto
  }
  await admin.auth().createUser(payload);
}
async function ensureFirebaseUserExists(user) {
  try {
    // First, check if Firebase user exists with MongoDB ID as UID
    await admin.auth().getUser(user._id.toString());
    return;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      // MongoDB ID doesn't exist as Firebase UID
      // Check if email exists with different UID
      try {
        const existingUser = await admin.auth().getUserByEmail(user.email);
        console.log(`🔄 Found existing Firebase user with email ${user.email} but different UID: ${existingUser.uid}`);

        // Delete the old Firebase user and create new one with MongoDB ID
        await admin.auth().deleteUser(existingUser.uid);
        console.log(`🗑️ Deleted old Firebase user: ${existingUser.uid}`);

        // Now create new user with MongoDB ID as UID
        await createFirebaseUserWithMongoID(user);

      } catch (emailError) {
        if (emailError.code === 'auth/user-not-found') {
          // Email doesn't exist either - create new user
          await createFirebaseUserWithMongoID(user);
        } else {
          throw emailError;
        }
      }
    } else {
      throw error;
    }
  }
}
exports.impersonateUser = async (req, res) => {
  const { userId } = req.body;
  try {

    // 2. Find the target user
    const targetUser = await userModel.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // 3. Generate tokens for the target user
    const tokenResponse = await generateAuthTokens(targetUser, false);

    // 4. Return tokens (admin will use these to login as the user)
    let response = {
      success: true,
      ...tokenResponse,
      impersonating: true,
      impersonatedUser: {
        _id: targetUser._id,
        userName: targetUser.userName,
        email: targetUser.email
      }
    };
    return res.json(response);

  } catch (error) {
    console.error("Impersonate error:", error);
    return res.status(500).json({ message: "Failed to impersonate user" });
  }
};

/**
 * Generates authentication tokens for a user
 * @param {Object} user - MongoDB user object
 * @param {boolean} isNewUser - Whether this is a new user
 * @returns {Object} Token response object
 */
// UPDATE your generateAuthTokens function with logging
async function generateAuthTokens(user, isNewUser = false) {
  try {
    // Ensure Firebase user exists before creating token
    await ensureFirebaseUserExists(user);

    // Create Firebase custom token using MongoDB ID
    const firebaseToken = await admin.auth().createCustomToken(user._id.toString());

    // Create JWT access token
    const accessToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.secret_key,
      { expiresIn: '30d' }
    );

    const response = {
      authtoken: firebaseToken,
      success: true,
      data: user,
      accessToken: accessToken,
      newuser: isNewUser,
    };

    return response;

  } catch (error) {
    console.error("❌ Error generating tokens:", error);
    throw error;
  }
}
/**
 * Creates Stripe customer for new users
 * @param {Object} user - MongoDB user object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
// UPDATE your createStripeCustomer to not block the response
async function createStripeCustomer(user, req, res) {
  var response = await functions.getSettings();
  let demoMode = false;
  if (response) {
    demoMode = response["demoMode"];
  }
  if (demoMode === false) {
    return;
  }
  try {
    // Create a new request object to avoid conflicts
    const stripeReq = {
      body: {
        userid: user._id,
        name: user.firstName + (user.lastName ? ` ${user.lastName}` : ''),
        email: user.email
      }
    };

    // Create a dummy response object since we don't want to block
    const dummyRes = {
      json: () => { },
      status: () => ({ json: () => { } })
    };

    await createTestStripeToken(stripeReq, dummyRes);
    await functions.stripeConnect(
      {},
      user._id,
      user.lastName,
      user.lastName,
      user.email
    );

  } catch (error) {
    console.error("❌ Error creating Stripe customer:", error);
    // Don't throw - this shouldn't block authentication
  }
}

exports.signupWithEmail = async (req, res) => {
  const { email, password, firstName, lastName, country, } = req.body;
  try {

    // Check if user already exists
    let existingUser = await userModel.findOne({ email: email });
    if (existingUser) {
      return res.status(400).json({
        message: "User with that email already exists",
        success: false,
      });
    }

    let validReferral = false;
    const { referredBy, clientIp } = req.body;
    if (referredBy && clientIp) {
      // Check if this IP already used a referral
      const existingReferral = await ReferralLog.findOne({ ip: clientIp });
      if (!existingReferral) {
        validReferral = true;
      }
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    let userid = new mongoose.Types.ObjectId();


    // Create Firebase user with MongoDB ID as UID
    let respose = await admin.auth().createUser({
      uid: userid.toString(), // MongoDB ID as Firebase UID
      email: email,
      password: password, // Firebase needs unhashed password
      displayName: firstName + (lastName ? ` ${lastName}` : ''),
      emailVerified: false,
      account_type: "email_password"
    });
    // Create user in MongoDB
    var response = await functions.getSettings();
    var autoapprove = response["demoMode"] == true || response["seller_auto_approve"] == true;
    console.log("autoapprove ", autoapprove)
    const user = await userModel.create({
      ...req.body,
      password: hashedPassword,
      _id: userid,
      seller: autoapprove,
      applied_seller: autoapprove, referredBy: validReferral ? referredBy : undefined
    });
    await createReferalLog(validReferral, referredBy, user, clientIp);
    if (response["demoMode"] == true) {
      await sendEmail({ name: firstName + (lastName ? ` ${lastName}` : '') }, email, 'promotion', "Check Out Tokshop All Features");
    }


    // Generate tokens
    const tokenResponse = await generateAuthTokens(user, true);

    // Create Stripe customer
    await createStripeCustomer(user, req, res);

    return res.json(tokenResponse);

  } catch (error) {
    console.error("❌ Error creating user:", error);

    // Handle Firebase Auth errors
    if (error.code === "auth/invalid-password") {
      return res.status(400).json({
        success: false,
        message: "The password must be at least 6 characters long.",
      });
    } else if (error.code === "auth/email-already-exists") {
      return res.status(400).json({
        success: false,
        message: "This email is already in use.",
      });
    } else if (error.code === "auth/invalid-email") {
      return res.status(400).json({
        success: false,
        message: "Invalid email format.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
};

/**
 * Login with email/password
 */
exports.loginWithEmail = async (req, res) => {
  const { email, password } = req.body;
  try {

    // Find user in MongoDB
    const user = await userModel.findOneAndUpdate({ email: email }, { 'account_type': 'email_password' }, { new: true });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found."
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Incorrect password."
      });
    }

    // Generate tokens
    const tokenResponse = await generateAuthTokens(user);
    return res.json(tokenResponse);

  } catch (error) {
    console.error("❌ Login error:", error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
};

// ====================================
// SOCIAL AUTHENTICATION (Google, Apple)
// ====================================

/**
 * Authenticate with social providers (Google, Apple)
 */
exports.authenticate = async (req, res) => {
  let { firstName, lastName, type, country, phone, profilePhoto, gender, userName, providerToken, account_type } = req.body;
  try {
    console.log(req.body);
    if (!type) {
      type = account_type;
    }
    let email = '';
    if (type === "google") {
      const googleUser = await verifyGoogleAccessToken(providerToken);
      // 🔐 SECURITY CHECKS (IMPORTANT)
      if (!googleUser.email_verified) {
        return res.status(401).json({
          message: "Google email not verified",
        });
      }
      email = googleUser.email;
    }
    if (type === "apple") {
      const appleUser = await verifyAppleAccessToken(providerToken);
      email = appleUser.email;
    }
    if (email == '') {
      return res.status(401).json({
        message: "Email not found",
      });
    }
    let user = await userModel.findOne({ email: email });
    let isNewUser = false;
    if (!user) {
      var response = await functions.getSettings();
      console.log("response ", response)
      let autoapprove = false;
      if (response) {
        autoapprove = response["demoMode"] == true;
      }
      if (autoapprove == true) {
        try {
          await sendEmail({ name: userName ?? firstName + (lastName ? ` ${lastName}` : '') }, email, 'promotion', "Check Out Tokshop All Features");
        } catch (e) {
          console.log(e);


        }
      }


      let validReferral = false;
      const { referredBy, clientIp } = req.body;
      if (referredBy && clientIp) {
        const existingReferral = await ReferralLog.findOne({ ip: clientIp });
        if (!existingReferral) {
          validReferral = true;
        }
      }
      // Create new user for social login
      user = await userModel.create({
        email,
        firstName,
        lastName: lastName || '',
        country: country || '',
        phonenumber: phone || '',
        profilePhoto: profilePhoto || '',
        gender: gender || '',
        userName: userName || '',
        account_type: type,
        emailVerified: true,
        seller: autoapprove,
        applied_seller: autoapprove, referredBy: validReferral ? referredBy : undefined
      });

      await createReferalLog(validReferral, referredBy, user, clientIp);
      isNewUser = true;
    } else {
      await userModel.updateOne(
        { _id: user._id },
        {
          $set: {
            userName: userName || user.userName,
            firstName: firstName || user.firstName,
            lastName: lastName || user.lastName,
            country: country || user.country,
            phonenumber: phone || user.phonenumber,
            gender: gender || user.gender,
          }
        }
      );
    }

    // Generate tokens
    const tokenResponse = await generateAuthTokens(user, isNewUser);

    // DON'T BLOCK ON STRIPE - Make it async
    if (isNewUser) {
      createStripeCustomer(user, req, res).catch(err => {
        console.error("❌ Stripe customer creation failed (non-blocking):", err);
      });
    }
    return res.json(tokenResponse);

  } catch (error) {
    console.error("❌ Error in social authentication:", error);
    return res.status(500).json({
      success: false,
      message: "Authentication failed",
      error: error.message,
    });
  } finally {
    // 
  }
};

async function createReferalLog(validReferral, referredBy, user, clientIp) {

  if (validReferral) {
    await ReferralLog.create({
      referrerId: new mongoose.Types.ObjectId(referredBy),
      referredUserId: user?._id,
      ip: clientIp
    });
    // follow the referrer
    await userModel.updateOne(
      { _id: referredBy },
      {
        $addToSet: { followers: user._id },
        $inc: { followingCount: 1 },
      }
    );
    await userModel.updateOne(
      { _id: user._id },
      {
        $addToSet: { following: referredBy },
        $inc: { followersCount: 1 },
      }
    );
    // get one room of the referredBy that is not ended and the soonest
    let room = await roomsModel.findOne({
      owner: referredBy,
      ended: false,
      started: false,
      date: { $gt: Date.now() }
    }).sort({ date: 1 });
    if (room) {
      await roomsModel.updateOne(
        { _id: room._id },
        {
          $addToSet: { invitedhostIds: user._id }
        }
      );
    }
  }
}


exports.authenticate = exports.authenticate;
exports.loginByEmail = exports.loginWithEmail;
exports.createUserByEmail = exports.signupWithEmail;