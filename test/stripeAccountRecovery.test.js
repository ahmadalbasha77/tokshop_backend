const assert = require("node:assert/strict");
const {
  isStripeIdempotencyMismatch,
  selectRecoverableStripeAccount,
} = require("../src/shared/stripeAccountRecovery");

const metadataAccount = {
  id: "acct_metadata",
  type: "custom",
  business_type: "individual",
  email: "different@example.com",
  country: "US",
  metadata: { tokshop_user_id: "user-1" },
};
const legacyAccount = {
  id: "acct_legacy",
  type: "custom",
  business_type: "individual",
  email: "seller@example.com",
  country: "US",
  metadata: {},
};

assert.equal(
  selectRecoverableStripeAccount([legacyAccount], {
    userId: "user-1",
    email: "SELLER@example.com",
    country: "us",
  })?.id,
  "acct_legacy"
);

assert.equal(
  selectRecoverableStripeAccount([legacyAccount, metadataAccount], {
    userId: "user-1",
    email: "seller@example.com",
    country: "US",
  })?.id,
  "acct_metadata"
);

assert.equal(
  selectRecoverableStripeAccount(
    [legacyAccount],
    {
      userId: "user-1",
      email: "seller@example.com",
      country: "US",
      linkedAccountIds: new Set(["acct_legacy"]),
    }
  ),
  null
);

assert.equal(
  selectRecoverableStripeAccount(
    [legacyAccount, { ...legacyAccount, id: "acct_duplicate" }],
    {
      userId: "user-1",
      email: "seller@example.com",
      country: "US",
    }
  ),
  null
);

assert.equal(
  isStripeIdempotencyMismatch({ type: "StripeIdempotencyError" }),
  true
);
assert.equal(
  isStripeIdempotencyMismatch({
    message:
      "Keys for idempotent requests can only be used with the same parameters",
  }),
  true
);
assert.equal(isStripeIdempotencyMismatch({ type: "StripeCardError" }), false);

console.log("stripe account recovery tests passed");
