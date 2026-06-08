function getAdminAuthorizationFailure(account, info) {
  if (!account) {
    return {
      status: 401,
      message: info?.message || "Invalid or expired admin token",
    };
  }

  if (account._authType !== "admin") {
    return {
      status: 403,
      message: "Admin access required",
    };
  }

  return null;
}

module.exports = { getAdminAuthorizationFailure };
