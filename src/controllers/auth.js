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
const { sendEmail, sendCustomEmail } = require('../shared/email');
const EmailTemplate = require('../models/templates');
const ReferralLog = require('../models/referral_log');
const roomsModel = require("../models/room");
const PendingRegistration = require("../models/pending_registration");
const OtpRateLimit = require("../models/otp_rate_limit");

const OTP_EXPIRY_MINUTES = 10;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS_PER_HOUR = 5;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,})+$/.test(email);
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || "";
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function consumeOtpRateLimit(type, value) {
  if (!value) {
    return { allowed: true };
  }

  const now = new Date();
  const windowMs = 60 * 60 * 1000;
  const key = `${type}:${value}`;
  const existing = await OtpRateLimit.findOne({ key });

  if (!existing || existing.window_start.getTime() <= now.getTime() - windowMs) {
    await OtpRateLimit.findOneAndUpdate(
      { key },
      {
        $set: {
          count: 1,
          window_start: now,
          expires_at: new Date(now.getTime() + windowMs),
        },
      },
      { upsert: true, new: true }
    );
    return { allowed: true };
  }

  if (existing.count >= OTP_MAX_SENDS_PER_HOUR) {
    const retryAfter = Math.max(
      1,
      Math.ceil((existing.window_start.getTime() + windowMs - now.getTime()) / 1000)
    );
    return { allowed: false, retry_after: retryAfter };
  }

  await OtpRateLimit.updateOne(
    { key },
    {
      $inc: { count: 1 },
      $set: { expires_at: new Date(existing.window_start.getTime() + windowMs) },
    }
  );

  return { allowed: true };
}

async function sendVerificationEmail(email, firstName, code) {
  const placeholders = {
    name: firstName || "there",
    code,
    expiry_time: `${OTP_EXPIRY_MINUTES} minutes`,
  };

  try {
    await sendEmail(placeholders, email, "email_verification", "Your verification code");
    return;
  } catch (error) {
    if (!/Email template not found/i.test(error.message || "")) {
      throw error;
    }
  }

  const settings = await functions.getSettings();
  const appName = settings?.app_name || settings?.seo_title || "Stealz";
  const primaryColor = settings?.primary_color
    ? (settings.primary_color.startsWith("#") ? settings.primary_color : "#" + settings.primary_color.replace(/^FF/i, ""))
    : "#111827";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 16px">${appName}</h2>
      <p>Your verification code is:</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;color:${primaryColor};margin:24px 0">${code}</div>
      <p>This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
      <p style="color:#6b7280">If you did not request this, you can ignore this email.</p>
    </div>
  `;
  const text = `Your verification code is: ${code}\n\nThis code expires in ${OTP_EXPIRY_MINUTES} minutes.\nIf you did not request this, you can ignore this email.`;

  await sendCustomEmail(email, "Your verification code", html, text);
}
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
    await sendResetPasswordEmail(user, resetToken, req);

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
async function sendResetPasswordEmail(user, resetToken, req) {
  const themesettings = await ThemeSettings.findOne({});
  const emailTemplate = await EmailTemplate.findOne({ slug: "password_reset" });

  if (!emailTemplate) {
    throw new Error("Password reset email template not found");
  }

  // Build reset URL using the API server's own URL
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const resetUrl = `${protocol}://${host}/reset-password?token=${resetToken}`;
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

async function createVerifiedEmailUser(pending, req, res) {
  const registrationData = {
    ...pending.registration_data,
    email: pending.email,
    firstName: pending.firstName,
    lastName: pending.lastName || "",
    account_type: pending.account_type || "email_password",
  };

  let validReferral = false;
  const { referredBy, clientIp } = registrationData;
  if (referredBy && clientIp) {
    const existingReferral = await ReferralLog.findOne({ ip: clientIp });
    if (!existingReferral) {
      validReferral = true;
    }
  }

  const settings = await functions.getSettings();
  const autoapprove = settings?.demoMode == true || settings?.seller_auto_approve == true;
  const user = await userModel.create({
    ...registrationData,
    password: pending.password_hash,
    seller: autoapprove,
    applied_seller: autoapprove,
    referredBy: validReferral ? referredBy : undefined,
    emailVerified: true,
    email_verified: true,
    email_verified_at: new Date(),
  });

  await createReferalLog(validReferral, referredBy, user, clientIp);

  if (settings?.demoMode == true) {
    try {
      await sendEmail(
        { name: user.firstName + (user.lastName ? ` ${user.lastName}` : "") },
        user.email,
        "promotion",
        "Check Out Stealz All Features"
      );
    } catch (error) {
      console.error("Promotion email failed:", error);
    }
  }

  const tokenResponse = await generateAuthTokens(user, true);
  await createStripeCustomer(user, req, res);
  return tokenResponse;
}

exports.requestEmailVerification = async (req, res) => {
  const { password, firstName } = req.body;
  const email = normalizeEmail(req.body.email);
  const accountType = req.body.account_type || "email_password";

  try {
    if (!firstName || !String(firstName).trim()) {
      return res.status(400).json({ success: false, message: "First name is required" });
    }

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    if (!password || String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "The password must be at least 6 characters long.",
      });
    }

    let existingUser = await userModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const pending = await PendingRegistration.findOne({ email }).lean();
    if (pending?.last_sent_at) {
      const secondsSinceLastSend = Math.floor((Date.now() - pending.last_sent_at.getTime()) / 1000);
      if (secondsSinceLastSend < OTP_COOLDOWN_SECONDS) {
        return res.status(429).json({
          success: false,
          message: "Please wait before requesting another code",
          retry_after: OTP_COOLDOWN_SECONDS - secondsSinceLastSend,
        });
      }
    }

    const emailRateLimit = await consumeOtpRateLimit("email", email);
    if (!emailRateLimit.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many verification code requests. Please try again later.",
        retry_after: emailRateLimit.retry_after,
      });
    }

    const ipRateLimit = await consumeOtpRateLimit("ip", getClientIp(req));
    if (!ipRateLimit.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many verification code requests. Please try again later.",
        retry_after: ipRateLimit.retry_after,
      });
    }

    const otp = generateOtp();
    const codeHash = await bcrypt.hash(otp, 10);
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
    const registrationData = {
      ...req.body,
      email,
      account_type: accountType,
      clientIp: req.body.clientIp || getClientIp(req),
    };
    delete registrationData.password;

    await PendingRegistration.findOneAndUpdate(
      { email },
      {
        $set: {
          firstName: String(firstName).trim(),
          lastName: req.body.lastName || "",
          email,
          password_hash: passwordHash,
          account_type: accountType,
          code_hash: codeHash,
          attempts: 0,
          last_sent_at: now,
          expires_at: expiresAt,
          registration_data: registrationData,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      await sendVerificationEmail(email, firstName, otp);
    } catch (error) {
      if (pending) {
        await PendingRegistration.replaceOne({ _id: pending._id }, pending);
      } else {
        await PendingRegistration.deleteOne({ email });
      }
      console.error("Verification email failed:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to send verification email",
      });
    }

    return res.json({
      success: true,
      message: "Verification code sent",
    });

  } catch (error) {
    console.error("Request email verification error:", error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
};

exports.resendEmailCode = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  try {
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    const pending = await PendingRegistration.findOne({ email });
    if (!pending) {
      return res.status(400).json({
        success: false,
        message: "Verification session expired. Please register again.",
      });
    }

    if (pending.last_sent_at) {
      const secondsSinceLastSend = Math.floor((Date.now() - pending.last_sent_at.getTime()) / 1000);
      if (secondsSinceLastSend < OTP_COOLDOWN_SECONDS) {
        return res.status(429).json({
          success: false,
          message: "Please wait before requesting another code",
          retry_after: OTP_COOLDOWN_SECONDS - secondsSinceLastSend,
        });
      }
    }

    const emailRateLimit = await consumeOtpRateLimit("email", email);
    const ipRateLimit = await consumeOtpRateLimit("ip", getClientIp(req));
    if (!emailRateLimit.allowed || !ipRateLimit.allowed) {
      return res.status(429).json({
        success: false,
        message: "Too many verification code requests. Please try again later.",
        retry_after: emailRateLimit.retry_after || ipRateLimit.retry_after,
      });
    }

    const otp = generateOtp();
    const codeHash = await bcrypt.hash(otp, 10);
    const now = new Date();
    const previousPendingState = {
      code_hash: pending.code_hash,
      attempts: pending.attempts,
      last_sent_at: pending.last_sent_at,
      expires_at: pending.expires_at,
    };
    pending.code_hash = codeHash;
    pending.attempts = 0;
    pending.last_sent_at = now;
    pending.expires_at = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await pending.save();

    try {
      await sendVerificationEmail(email, pending.firstName, otp);
    } catch (error) {
      pending.code_hash = previousPendingState.code_hash;
      pending.attempts = previousPendingState.attempts;
      pending.last_sent_at = previousPendingState.last_sent_at;
      pending.expires_at = previousPendingState.expires_at;
      await pending.save();
      console.error("Verification email resend failed:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to send verification email",
      });
    }

    return res.json({ success: true, message: "Verification code resent" });
  } catch (error) {
    console.error("Resend email code error:", error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
};

exports.verifyEmailCode = async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || "").trim();

  try {
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ success: false, message: "Verification code must be 6 digits" });
    }

    const pending = await PendingRegistration.findOne({ email });
    if (!pending) {
      return res.status(400).json({
        success: false,
        message: "Verification session expired. Please register again.",
      });
    }

    if (pending.expires_at.getTime() < Date.now()) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({
        success: false,
        message: "Verification code expired",
      });
    }

    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please request a new code.",
      });
    }

    const isCodeValid = await bcrypt.compare(code, pending.code_hash);
    if (!isCodeValid) {
      pending.attempts += 1;
      await pending.save();
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const tokenResponse = await createVerifiedEmailUser(pending, req, res);
    await PendingRegistration.deleteOne({ _id: pending._id });
    return res.json({
      ...tokenResponse,
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Verify email code error:", error);
    if (error.code === 11000) {
      await PendingRegistration.deleteOne({ email });
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred.",
      error: error.message,
    });
  }
};

exports.signupWithEmail = exports.requestEmailVerification;

/**
 * Login with email/password
 */
exports.loginWithEmail = async (req, res) => {
  const { password } = req.body;
  const email = normalizeEmail(req.body.email);
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
      email = normalizeEmail(googleUser.email);
    }
    if (type === "apple") {
      const appleUser = await verifyAppleAccessToken(providerToken);
      email = normalizeEmail(appleUser.email);
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
          await sendEmail({ name: userName ?? firstName + (lastName ? ` ${lastName}` : '') }, email, 'promotion', "Check Out Stealz All Features");
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
        email_verified: true,
        email_verified_at: new Date(),
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
