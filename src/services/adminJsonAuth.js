const passport = require("passport");
const {
  getAdminAuthorizationFailure,
} = require("../shared/adminAuthorization");

function requireAdminJson(req, res, next) {
  return passport.authenticate(
    "jwt",
    { session: false },
    (error, account, info) => {
      if (error) {
        console.error("Admin token authentication error:", error.stack || error);
        return res.status(500).json({
          success: false,
          message: "Failed to authenticate admin token",
        });
      }

      const authorizationFailure = getAdminAuthorizationFailure(account, info);
      if (authorizationFailure) {
        return res.status(authorizationFailure.status).json({
          success: false,
          message: authorizationFailure.message,
        });
      }

      req.user = account;
      return next();
    }
  )(req, res, next);
}

module.exports = requireAdminJson;
