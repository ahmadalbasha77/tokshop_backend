function getRequestPath(req) {
  return req.originalUrl || req.path || req.url || "unknown";
}

function attachAdminRequestLog(req, res) {
  if (req._adminRequestLogAttached) return;
  req._adminRequestLogAttached = true;
  req.adminTokenType = req.adminTokenType || "unverified";

  res.on("finish", () => {
    console.log(
      "[Admin API]",
      JSON.stringify({
        path: getRequestPath(req),
        tokenType: req.adminTokenType,
        status: res.statusCode,
      })
    );
  });
}

function logAdminEndpointError(req, status, error) {
  console.error("[Admin API Error]", {
    path: getRequestPath(req),
    tokenType: req.adminTokenType || "unknown",
    status,
    message: error?.message || String(error),
    stack: error?.stack || null,
  });
}

module.exports = {
  attachAdminRequestLog,
  getRequestPath,
  logAdminEndpointError,
};
