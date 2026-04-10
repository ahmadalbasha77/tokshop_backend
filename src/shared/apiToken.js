const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const envPath = path.resolve(process.cwd(), ".env");

async function generateSystemTokenOnce(domain) {
  // ❌ Do nothing if token already exists
  if (process.env.SYSTEM_API_TOKEN) {
    return null;
  }

  // 🔐 Encrypt domain
  const domainHash = crypto
    .createHmac("sha256", process.env.secret_key)
    .update(domain)
    .digest("hex");

  // 🎫 Sign token
  const token = jwt.sign(
    {
      type: "system",
      domainHash,
    },
    process.env.secret_key
  );

  // 💾 Persist permanently
  fs.appendFileSync(
    envPath,
    `\nSYSTEM_API_TOKEN=${token}\n`,
    "utf8"
  );

  process.env.SYSTEM_API_TOKEN = token;

  console.log("✅ SYSTEM_API_TOKEN generated during first admin creation");
  return token;
}

module.exports = {
  generateSystemTokenOnce,
};