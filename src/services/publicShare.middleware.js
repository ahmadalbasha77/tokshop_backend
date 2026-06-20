const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 60;
const requests = new Map();

function getClientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  return forwarded
    ? forwarded.split(",")[0].trim()
    : req.ip || req.socket?.remoteAddress || "unknown";
}

function publicShareCors(req, res, next) {
  const origin = req.headers?.origin;
  if (origin === "https://stealz.live") {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  next();
}

function publicShareRateLimit(req, res, next) {
  const now = Date.now();
  const key = getClientIp(req);
  const current = requests.get(key);

  if (!current || current.resetAt <= now) {
    requests.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (current.count >= MAX_REQUESTS) {
    res.setHeader("Retry-After", Math.ceil((current.resetAt - now) / 1000));
    return res.status(429).json({
      success: false,
      message: "Too many share requests. Please try again shortly.",
    });
  }

  current.count += 1;
  return next();
}

module.exports = {
  publicShareCors,
  publicShareRateLimit,
};
