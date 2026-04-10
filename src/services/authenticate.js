const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const JwtStrategy = require("passport-jwt").Strategy;
const ExtractJwt = require("passport-jwt").ExtractJwt;

const userModel = require("../models/user");
const adminModel = require("../models/admin");

require("dotenv").config({ path: ".env" });

/* =========================
   LOCAL LOGIN (USERS ONLY)
========================= */
passport.use(
  "login",
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },
    async (email, password, done) => {
      try {
        const user = await userModel.findOne({ email });
        console.log(user);
        if (!user) {
          return done(null, false, { message: "Invalid email address" });
        }

        const isValid = await user.isValidPassword(password);
        if (!isValid) {
          return done(null, false, { message: "Invalid password" });
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

/* =========================
   JWT STRATEGY (USER + ADMIN)
========================= */
if (!process.env.secret_key) {
  throw new Error("❌ secret_key is not defined in .env");
}

passport.use(
  "jwt",
  new JwtStrategy(
    {
      secretOrKey: process.env.secret_key,
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    },
    async (payload, done) => {
      try {
        // console.log("JWT PAYLOAD:", payload);
        const id = payload.userId || payload.id;
        if (!id) return done(null, false);

        let account = null;

        // 🔑 decide model based on token type
        if (payload.type === "admin") {
          account = await adminModel.findById(id);
        } else {
          account = await userModel.findById(id);
        }

        if (!account) return done(null, false);

        // attach role info
        account._authType = payload.type || "user";

        return done(null, account);
      } catch (err) {
        return done(err, false);
      }
    }
  )
);

module.exports = passport;
