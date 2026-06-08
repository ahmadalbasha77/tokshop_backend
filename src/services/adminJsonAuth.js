const passport = require("passport");
const {
  getAdminAuthorizationFailure,
  isInvalidTokenError,
} = require("../shared/adminAuthorization");
const {
  attachAdminRequestLog,
  logAdminEndpointError,
} = require("../shared/adminRequestLog");

function requireAdminJson(req, res, next) {
  req.adminTokenType = "unverified";
  attachAdminRequestLog(req, res);

  return passport.authenticate(
    "jwt",
    { session: false },
    (error, account, info) => {
      if (error) {
        const invalidToken = isInvalidTokenError(error);
        const status = invalidToken ? 401 : 500;
        req.adminTokenType = invalidToken ? "expired_or_invalid" : "error";
        logAdminEndpointError(req, status, error);
        return res.status(status).json({
          success: false,
          message: invalidToken
            ? "Invalid or expired admin token"
            : "Failed to authenticate admin token",
        });
      }

      const authorizationFailure = getAdminAuthorizationFailure(account, info);
      if (authorizationFailure) {
        req.adminTokenType = account ? "user" : "expired_or_invalid";
        const authError =
          info instanceof Error
            ? info
            : new Error(authorizationFailure.message);
        logAdminEndpointError(req, authorizationFailure.status, authError);
        return res.status(authorizationFailure.status).json({
          success: false,
          message: authorizationFailure.message,
        });
      }

      req.adminTokenType = "admin";
      req.user = account;
      return next();
    }
  )(req, res, next);
}

module.exports = requireAdminJson;
