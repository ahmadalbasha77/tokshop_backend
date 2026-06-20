const striptags = require("striptags");

const WEB_BASE_URL = "https://stealz.live";
const APP_BASE_URL = "stealz://";

function sanitizeText(value, maxLength = 180) {
  return striptags(String(value || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function publicHttpsImage(value) {
  const candidates = Array.isArray(value) ? value : [value];

  for (const candidate of candidates) {
    const raw =
      typeof candidate === "string"
        ? candidate
        : candidate?.url || candidate?.secure_url || candidate?.src;

    if (!raw) continue;

    try {
      const url = new URL(raw);
      const hostname = url.hostname.toLowerCase();
      const privateHost =
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".local") ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);

      if (url.protocol === "https:" && !privateHost) {
        return url.toString();
      }
    } catch (_error) {
      // Relative, malformed, and non-public image URLs are intentionally omitted.
    }
  }

  return "";
}

function shareResponse(type, id, title, description, image) {
  const safeId = String(id);
  return {
    type,
    id: safeId,
    title: sanitizeText(title, 120),
    description: sanitizeText(description, 220),
    image: publicHttpsImage(image),
    url: `${WEB_BASE_URL}/${type}/${encodeURIComponent(safeId)}`,
    appUrl: `${APP_BASE_URL}${type}/${encodeURIComponent(safeId)}`,
  };
}

module.exports = {
  publicHttpsImage,
  sanitizeText,
  shareResponse,
};
