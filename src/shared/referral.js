const mongoose = require("mongoose");

function requestedReferrer(data = {}) {
  return data.referrer || data.referredBy || null;
}

function activeInviterFilter(referrer) {
  return {
    _id: referrer,
    accountDisabled: { $ne: true },
    system_blocked: { $ne: true },
    suspended: { $ne: true },
  };
}

async function validateNewUserReferral({
  data,
  clientIp,
  User,
  ReferralLog,
}) {
  const referrer = requestedReferrer(data);
  if (!referrer) return { valid: false, referrer: null };
  if (!mongoose.isValidObjectId(referrer)) {
    return { valid: false, referrer: null, reason: "invalid_referrer" };
  }

  const inviter = await User.findOne(activeInviterFilter(referrer)).select("_id email").lean();
  if (!inviter) return { valid: false, referrer: null, reason: "invalid_referrer" };

  const email = String(data.email || "").trim().toLowerCase();
  if (email && String(inviter.email || "").trim().toLowerCase() === email) {
    return { valid: false, referrer: null, reason: "self_referral" };
  }

  const duplicateChecks = [
    ...(clientIp ? [{ ip: clientIp }] : []),
    ...(email ? [{ referredEmail: email }] : []),
  ];
  const priorReferral = duplicateChecks.length
    ? await ReferralLog.findOne({ $or: duplicateChecks }).lean()
    : null;

  if (priorReferral) {
    return { valid: false, referrer: null, reason: "duplicate_or_multi_account" };
  }

  return { valid: true, referrer: inviter._id };
}

module.exports = {
  requestedReferrer,
  validateNewUserReferral,
};
