const IDENTITY_DOCUMENT_REQUIREMENT = "individual.verification.document";

const includesIdentityDocument = (requirements = []) =>
  requirements.some((requirement) =>
    String(requirement).startsWith(IDENTITY_DOCUMENT_REQUIREMENT)
  );

const errorsIncludeIdentityDocument = (errors = []) =>
  errors.some((error) =>
    String(error?.requirement || "").startsWith(IDENTITY_DOCUMENT_REQUIREMENT)
  );

const getStripeAccountStatus = (account) => {
  const disabledReason = account?.requirements?.disabled_reason || null;
  const currentlyDue = account?.requirements?.currently_due || [];
  const pastDue = account?.requirements?.past_due || [];
  const eventuallyDue = account?.requirements?.eventually_due || [];
  const pendingVerification =
    account?.requirements?.pending_verification || [];
  const requirementErrors = account?.requirements?.errors || [];
  const futureCurrentlyDue =
    account?.future_requirements?.currently_due || [];
  const futurePastDue = account?.future_requirements?.past_due || [];
  const futureEventuallyDue =
    account?.future_requirements?.eventually_due || [];
  const futurePendingVerification =
    account?.future_requirements?.pending_verification || [];
  const futureRequirementErrors =
    account?.future_requirements?.errors || [];
  const futureDisabledReason =
    account?.future_requirements?.disabled_reason || null;
  const cardPayments =
    account?.capabilities?.card_payments || "inactive";
  const transfers =
    account?.capabilities?.transfers || "inactive";
  const legacyPayments =
    account?.capabilities?.legacy_payments || "inactive";
  const pendingRequirements = new Set(pendingVerification);
  const identityDocumentCurrentlyRequired =
    includesIdentityDocument(currentlyDue) ||
    includesIdentityDocument(pastDue) ||
    errorsIncludeIdentityDocument(requirementErrors);
  const identityDocumentRequiredInFuture =
    includesIdentityDocument(eventuallyDue) ||
    includesIdentityDocument(futureCurrentlyDue) ||
    includesIdentityDocument(futurePastDue) ||
    includesIdentityDocument(futureEventuallyDue) ||
    errorsIncludeIdentityDocument(futureRequirementErrors);
  const identityDocumentVerificationPending =
    includesIdentityDocument(pendingVerification) ||
    includesIdentityDocument(futurePendingVerification);
  const upfrontIdentityDocumentRequired =
    identityDocumentRequiredInFuture &&
    !identityDocumentCurrentlyRequired &&
    !identityDocumentVerificationPending;
  const isPendingDisabledReason = (reason) =>
    reason === "requirements.pending_verification" ||
    reason === "under_review";
  const isActionableRequirementsReason = (reason) =>
    typeof reason === "string" &&
    reason.startsWith("requirements.") &&
    !isPendingDisabledReason(reason);
  const hasActionableRequirements = (requirements) =>
    requirements.some((requirement) => !pendingRequirements.has(requirement));
  const hasCollectableRequirements =
    account?.details_submitted !== true ||
    requirementErrors.length > 0 ||
    isActionableRequirementsReason(disabledReason) ||
    hasActionableRequirements(currentlyDue) ||
    hasActionableRequirements(pastDue) ||
    upfrontIdentityDocumentRequired;
  const capabilityPending =
    cardPayments === "pending" ||
    transfers === "pending" ||
    legacyPayments === "pending";
  const verificationPending =
    pendingVerification.length > 0 ||
    identityDocumentVerificationPending ||
    isPendingDisabledReason(disabledReason) ||
    (capabilityPending && !hasCollectableRequirements);
  const capabilitiesReady =
    account?.charges_enabled === true &&
    account?.payouts_enabled === true &&
    (cardPayments === "active" || legacyPayments === "active") &&
    (transfers === "active" || legacyPayments === "active") &&
    !disabledReason;
  const ready =
    capabilitiesReady &&
    currentlyDue.length === 0 &&
    pastDue.length === 0 &&
    !verificationPending;
  const onboardingRequired = hasCollectableRequirements;
  const canSell =
    ready &&
    !onboardingRequired &&
    !verificationPending;
  const nextAction = onboardingRequired
    ? "OPEN_STRIPE_ONBOARDING"
    : verificationPending
      ? "WAIT_FOR_STRIPE_VERIFICATION"
      : canSell
        ? "SELLER_READY"
        : "CONTACT_SUPPORT";
  const statusMessage = onboardingRequired
    ? "Complete the required information in Stripe to activate your seller account."
    : verificationPending
      ? "Your seller information was submitted and is being reviewed by Stripe."
      : canSell
        ? "Your seller account is ready to sell."
        : "Your Stripe account is restricted. Please contact support.";

  return {
    ready,
    can_sell: canSell,
    onboarding_required: onboardingRequired,
    requires_onboarding_link: onboardingRequired,
    next_action: nextAction,
    status_message: statusMessage,
    upfront_identity_document_required: upfrontIdentityDocumentRequired,
    verification_pending: verificationPending,
    charges_enabled: account?.charges_enabled === true,
    payouts_enabled: account?.payouts_enabled === true,
    card_payments: cardPayments,
    transfers,
    legacy_payments: legacyPayments,
    details_submitted: account?.details_submitted === true,
    disabled_reason: disabledReason,
    current_deadline: account?.requirements?.current_deadline || null,
    currently_due: currentlyDue,
    past_due: pastDue,
    eventually_due: eventuallyDue,
    pending_verification: pendingVerification,
    errors: requirementErrors,
    future_requirements: {
      disabled_reason: futureDisabledReason,
      current_deadline:
        account?.future_requirements?.current_deadline || null,
      currently_due: futureCurrentlyDue,
      past_due: futurePastDue,
      eventually_due: futureEventuallyDue,
      pending_verification: futurePendingVerification,
      errors: futureRequirementErrors,
    },
  };
};

const getStripeAccountStatusCode = (stripeStatus) => {
  if (stripeStatus?.onboarding_required) {
    return stripeStatus?.ready
      ? "STRIPE_FUTURE_REQUIREMENTS_PENDING"
      : "STRIPE_ONBOARDING_REQUIRED";
  }
  if (stripeStatus?.verification_pending) {
    return "STRIPE_VERIFICATION_PENDING";
  }
  if (stripeStatus?.can_sell) {
    return "STRIPE_ACCOUNT_READY";
  }
  return "STRIPE_ACCOUNT_RESTRICTED";
};

module.exports = {
  getStripeAccountStatus,
  getStripeAccountStatusCode,
};
