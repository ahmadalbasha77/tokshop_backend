const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  requestedReferrer,
  validateNewUserReferral,
} = require("../src/shared/referral");

const inviterId = new mongoose.Types.ObjectId();
let inviter = { _id: inviterId, email: "inviter@example.com" };
let priorReferral = null;

function result(value) {
  return {
    select() {
      return this;
    },
    lean() {
      return Promise.resolve(value);
    },
  };
}

const User = {
  findOne() {
    return result(inviter);
  },
};

const ReferralLog = {
  findOne() {
    return result(priorReferral);
  },
};

void (async () => {
  assert.equal(requestedReferrer({ referrer: "new", referredBy: "old" }), "new");
  assert.equal(requestedReferrer({ referredBy: "old" }), "old");

  let referral = await validateNewUserReferral({
    data: { referrer: "invalid", email: "new@example.com" },
    clientIp: "203.0.113.1",
    User,
    ReferralLog,
  });
  assert.equal(referral.valid, false);
  assert.equal(referral.reason, "invalid_referrer");

  referral = await validateNewUserReferral({
    data: { referrer: inviterId.toString(), email: "inviter@example.com" },
    clientIp: "203.0.113.1",
    User,
    ReferralLog,
  });
  assert.equal(referral.reason, "self_referral");

  priorReferral = { _id: new mongoose.Types.ObjectId() };
  referral = await validateNewUserReferral({
    data: { referrer: inviterId.toString(), email: "new@example.com" },
    clientIp: "203.0.113.1",
    User,
    ReferralLog,
  });
  assert.equal(referral.reason, "duplicate_or_multi_account");

  priorReferral = null;
  referral = await validateNewUserReferral({
    data: { referrer: inviterId.toString(), email: "new@example.com" },
    clientIp: "203.0.113.1",
    User,
    ReferralLog,
  });
  assert.equal(referral.valid, true);
  assert.equal(referral.referrer.toString(), inviterId.toString());

  inviter = null;
  referral = await validateNewUserReferral({
    data: { referrer: inviterId.toString(), email: "new@example.com" },
    clientIp: "203.0.113.2",
    User,
    ReferralLog,
  });
  assert.equal(referral.reason, "invalid_referrer");

  console.log("referral validation tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
