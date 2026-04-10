const jwt = require("jsonwebtoken");
const crypto = require("crypto");

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Token required" });
  console.log(token);
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.secret_key);
  console.log(decoded);
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }

  // if (decoded.type !== "system") {
  //   return res.status(403).json({ message: "Invalid token type" });
  // }

  const origin = req.headers.origin || "";
  let domain = req.headers.host;
  try {
    if (origin) domain = new URL(origin).hostname;
  } catch {}

  const domainHash = crypto
    .createHmac("sha256", process.env.secret_key)
    .update(domain)
    .digest("hex");
  // console.log(domainHash,decoded.domainHash,domain);
  // if (domainHash !== decoded.domainHash) {
  //   return res.status(403).json({ message: "Domain not authorized" });
  // }

  next();
};
