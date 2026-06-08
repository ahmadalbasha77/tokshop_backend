const assert = require("node:assert/strict");
const {
  getStripeAccountStatus,
  getStripeAccountStatusCode,
} = require("../src/shared/stripeAccountStatus");

const activeWithFutureRequirements = getStripeAccountStatus({
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: "active", transfers: "active" },
  requirements: {
    currently_due: [],
    past_due: [],
    eventually_due: ["individual.id_number"],
  },
});

assert.equal(activeWithFutureRequirements.ready, true);
assert.equal(activeWithFutureRequirements.onboarding_required, true);
assert.equal(activeWithFutureRequirements.can_sell, false);
assert.equal(
  getStripeAccountStatusCode(activeWithFutureRequirements),
  "STRIPE_FUTURE_REQUIREMENTS_PENDING"
);

const restrictedAccount = getStripeAccountStatus({
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  capabilities: { card_payments: "inactive", transfers: "inactive" },
  requirements: {
    disabled_reason: "requirements.past_due",
    currently_due: ["individual.id_number"],
    past_due: ["individual.id_number"],
  },
});

assert.equal(restrictedAccount.ready, false);
assert.equal(restrictedAccount.onboarding_required, true);
assert.equal(restrictedAccount.can_sell, false);

const fullyActiveAccount = getStripeAccountStatus({
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { card_payments: "active", transfers: "active" },
  requirements: {
    currently_due: [],
    past_due: [],
    eventually_due: [],
  },
  future_requirements: {
    currently_due: [],
    past_due: [],
    eventually_due: [],
  },
});

assert.equal(fullyActiveAccount.ready, true);
assert.equal(fullyActiveAccount.onboarding_required, false);
assert.equal(fullyActiveAccount.verification_pending, false);
assert.equal(fullyActiveAccount.can_sell, true);
assert.equal(
  getStripeAccountStatusCode(fullyActiveAccount),
  "STRIPE_ACCOUNT_READY"
);

const identityDocumentUnderReview = getStripeAccountStatus({
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: true,
  capabilities: { card_payments: "pending", transfers: "pending" },
  requirements: {
    disabled_reason: "requirements.pending_verification",
    currently_due: [],
    past_due: [],
    eventually_due: ["individual.verification.document"],
    pending_verification: ["individual.verification.document"],
  },
});

assert.equal(identityDocumentUnderReview.ready, false);
assert.equal(identityDocumentUnderReview.can_sell, false);
assert.equal(identityDocumentUnderReview.verification_pending, true);
assert.equal(identityDocumentUnderReview.onboarding_required, false);
assert.deepEqual(identityDocumentUnderReview.pending_verification, [
  "individual.verification.document",
]);
assert.equal(
  getStripeAccountStatusCode(identityDocumentUnderReview),
  "STRIPE_VERIFICATION_PENDING"
);

const documentPendingWithAnotherMissingRequirement = getStripeAccountStatus({
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: true,
  capabilities: { card_payments: "pending", transfers: "pending" },
  requirements: {
    disabled_reason: "requirements.pending_verification",
    currently_due: ["individual.id_number"],
    eventually_due: [
      "individual.id_number",
      "individual.verification.document",
    ],
    pending_verification: ["individual.verification.document"],
  },
});

assert.equal(documentPendingWithAnotherMissingRequirement.can_sell, false);
assert.equal(
  documentPendingWithAnotherMissingRequirement.verification_pending,
  true
);
assert.equal(
  documentPendingWithAnotherMissingRequirement.onboarding_required,
  true
);
assert.equal(
  getStripeAccountStatusCode(documentPendingWithAnotherMissingRequirement),
  "STRIPE_ONBOARDING_REQUIRED"
);

const failedDocumentRequiresAction = getStripeAccountStatus({
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: true,
  capabilities: { card_payments: "inactive", transfers: "inactive" },
  requirements: {
    disabled_reason: "requirements.past_due",
    currently_due: [],
    past_due: [],
    eventually_due: [],
    pending_verification: [],
    errors: [
      {
        requirement: "individual.verification.document",
        code: "verification_document_not_readable",
      },
    ],
  },
});

assert.equal(failedDocumentRequiresAction.verification_pending, false);
assert.equal(failedDocumentRequiresAction.onboarding_required, true);
assert.equal(failedDocumentRequiresAction.can_sell, false);
assert.equal(
  getStripeAccountStatusCode(failedDocumentRequiresAction),
  "STRIPE_ONBOARDING_REQUIRED"
);

const accountUnderReview = getStripeAccountStatus({
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: true,
  capabilities: {
    card_payments: "pending",
    transfers: "pending",
  },
  requirements: {
    disabled_reason: "under_review",
    currently_due: [],
    past_due: [],
    eventually_due: [],
    pending_verification: [],
    errors: [],
  },
});

assert.equal(accountUnderReview.verification_pending, true);
assert.equal(accountUnderReview.onboarding_required, false);
assert.equal(accountUnderReview.can_sell, false);
assert.equal(
  getStripeAccountStatusCode(accountUnderReview),
  "STRIPE_VERIFICATION_PENDING"
);

const rejectedAccount = getStripeAccountStatus({
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: true,
  capabilities: {
    card_payments: "inactive",
    transfers: "inactive",
  },
  requirements: {
    disabled_reason: "rejected.fraud",
    currently_due: [],
    past_due: [],
    eventually_due: [],
    pending_verification: [],
    errors: [],
  },
});

assert.equal(rejectedAccount.verification_pending, false);
assert.equal(rejectedAccount.onboarding_required, false);
assert.equal(rejectedAccount.can_sell, false);
assert.equal(
  getStripeAccountStatusCode(rejectedAccount),
  "STRIPE_ACCOUNT_RESTRICTED"
);

const transfersInactive = getStripeAccountStatus({
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: {
    card_payments: "active",
    transfers: "inactive",
  },
  requirements: {
    currently_due: [],
    past_due: [],
    eventually_due: [],
  },
});

assert.equal(transfersInactive.ready, false);
assert.equal(transfersInactive.can_sell, false);
assert.equal(
  getStripeAccountStatusCode(transfersInactive),
  "STRIPE_ACCOUNT_RESTRICTED"
);

const requirementsDisabledWithoutExpandedList = getStripeAccountStatus({
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: true,
  capabilities: {
    card_payments: "inactive",
    transfers: "inactive",
  },
  requirements: {
    disabled_reason: "requirements.past_due",
    currently_due: [],
    past_due: [],
    eventually_due: [],
  },
});

assert.equal(requirementsDisabledWithoutExpandedList.onboarding_required, true);
assert.equal(requirementsDisabledWithoutExpandedList.can_sell, false);

const legacyPaymentsAccount = getStripeAccountStatus({
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: {
    legacy_payments: "active",
  },
  requirements: {
    currently_due: [],
    past_due: [],
    eventually_due: [],
  },
});

assert.equal(legacyPaymentsAccount.ready, true);
assert.equal(legacyPaymentsAccount.can_sell, true);
assert.equal(
  getStripeAccountStatusCode(legacyPaymentsAccount),
  "STRIPE_ACCOUNT_READY"
);

console.log("stripe account status tests passed");
