const userModel = require("../models/user");
const appSettings = require("../models/settings");
const {
  getStripeAccountStatus,
  getStripeAccountStatusCode,
} = require("./stripeAccountStatus");

const INCOMPLETE_PROFILE_CODE = "SELLER_PROFILE_INCOMPLETE";
const INCOMPLETE_PROFILE_MESSAGE =
  "Please complete your seller account information before continuing.";
const STRIPE_RESTRICTED_CODE = "SELLER_STRIPE_ACCOUNT_RESTRICTED";
const STRIPE_RESTRICTED_MESSAGE =
  "Your Stripe account must have payments and payouts enabled before you can sell.";
const STRIPE_VERIFICATION_PENDING_CODE = "STRIPE_VERIFICATION_PENDING";
const STRIPE_VERIFICATION_PENDING_MESSAGE =
  "Your identity document was submitted and is being reviewed by Stripe.";

const incompleteProfileResponse = (missingFields) => ({
  code: INCOMPLETE_PROFILE_CODE,
  message: INCOMPLETE_PROFILE_MESSAGE,
  missing_fields: missingFields,
});

const checkSellerProfileComplete = (user) => {
  const missingFields = [];

  if (!user?.stripe_account) {
    missingFields.push(
      "payout_account",
      "stripe_account",
      "phone_number",
      "date_of_birth",
      "ssn_last_4",
      "bank_account"
    );
  }

  return {
    complete: missingFields.length === 0,
    missing_fields: missingFields,
  };
};

const sendIncompleteProfileResponse = (res, missingFields, statusCode = 403) =>
  res.status(statusCode).json(incompleteProfileResponse(missingFields));

const stripeStatusResponse = (stripeStatus) => ({
  ready: stripeStatus?.ready === true,
  can_sell: stripeStatus?.can_sell === true,
  onboarding_required: stripeStatus?.onboarding_required === true,
  upfront_identity_document_required:
    stripeStatus?.upfront_identity_document_required === true,
  verification_pending: stripeStatus?.verification_pending === true,
  charges_enabled: stripeStatus?.charges_enabled === true,
  payouts_enabled: stripeStatus?.payouts_enabled === true,
  card_payments: stripeStatus?.card_payments || "inactive",
  transfers: stripeStatus?.transfers || "inactive",
  legacy_payments: stripeStatus?.legacy_payments || "inactive",
  details_submitted: stripeStatus?.details_submitted === true,
  disabled_reason: stripeStatus?.disabled_reason || null,
  current_deadline: stripeStatus?.current_deadline || null,
  currently_due: stripeStatus?.currently_due || [],
  past_due: stripeStatus?.past_due || [],
  eventually_due: stripeStatus?.eventually_due || [],
  pending_verification: stripeStatus?.pending_verification || [],
  errors: stripeStatus?.errors || [],
  future_requirements: stripeStatus?.future_requirements || {
    disabled_reason: null,
    current_deadline: null,
    currently_due: [],
    past_due: [],
    eventually_due: [],
    pending_verification: [],
    errors: [],
  },
});

const stripeRestrictionResponse = (stripeStatus) => {
  const verificationPending =
    stripeStatus?.verification_pending === true &&
    stripeStatus?.onboarding_required !== true;
  const code = verificationPending
    ? STRIPE_VERIFICATION_PENDING_CODE
    : STRIPE_RESTRICTED_CODE;
  const message = verificationPending
    ? STRIPE_VERIFICATION_PENDING_MESSAGE
    : STRIPE_RESTRICTED_MESSAGE;

  return {
    success: false,
    can_sell: false,
    code,
    message,
    error: message,
    onboarding_required: stripeStatus?.onboarding_required === true,
    verification_pending: stripeStatus?.verification_pending === true,
    stripe_status: {
      ...stripeStatusResponse(stripeStatus),
    },
  };
};

const checkSellerStripeActive = async (user) => {
  if (!user?.stripe_account) {
    return {
      active: false,
      ready: false,
      can_sell: false,
      onboarding_required: true,
      verification_pending: false,
      charges_enabled: false,
      payouts_enabled: false,
      card_payments: "inactive",
      transfers: "inactive",
      legacy_payments: "inactive",
      details_submitted: false,
      disabled_reason: "stripe_account_missing",
      currently_due: [],
      past_due: [],
      eventually_due: [],
      pending_verification: [],
      errors: [],
      future_requirements: {
        disabled_reason: null,
        current_deadline: null,
        currently_due: [],
        past_due: [],
        eventually_due: [],
        pending_verification: [],
        errors: [],
      },
    };
  }

  const settings = await appSettings.findOne().select("stripeSecretKey");
  if (!settings?.stripeSecretKey) {
    const error = new Error("Stripe configuration is unavailable");
    error.code = "STRIPE_CONFIGURATION_UNAVAILABLE";
    throw error;
  }

  const stripe = require("stripe")(settings.stripeSecretKey);
  const account = await stripe.accounts.retrieve(user.stripe_account);
  const stripeStatus = getStripeAccountStatus(account);

  return {
    active: stripeStatus.can_sell,
    ...stripeStatus,
  };
};

const getSellerEligibility = async (user) => {
  if (!user) {
    return {
      success: false,
      can_sell: false,
      code: "USER_NOT_FOUND",
      message: "User not found",
      seller_approved: false,
      profile_complete: false,
      stripe_status: null,
    };
  }

  const status = user?.seller_application?.status;
  const sellerApproved = user.seller === true && (!status || status === "approved");
  if (!sellerApproved) {
    return {
      success: false,
      can_sell: false,
      code: "SELLER_NOT_APPROVED",
      message: "Seller approval is required before continuing.",
      seller_approved: false,
      profile_complete: false,
      stripe_status: null,
    };
  }

  const profileStatus = checkSellerProfileComplete(user);
  if (!profileStatus.complete) {
    return {
      success: false,
      can_sell: false,
      ...incompleteProfileResponse(profileStatus.missing_fields),
      seller_approved: true,
      profile_complete: false,
      stripe_status: null,
    };
  }

  const stripeStatus = await checkSellerStripeActive(user);
  if (!stripeStatus.active) {
    return {
      can_sell: false,
      ...stripeRestrictionResponse(stripeStatus),
      seller_approved: true,
      profile_complete: true,
    };
  }

  return {
    success: true,
    can_sell: true,
    code: "SELLER_ELIGIBLE",
    message: "Seller account is eligible to sell.",
    seller_approved: true,
    profile_complete: true,
    onboarding_required: false,
    verification_pending: false,
    stripe_status: stripeStatusResponse(stripeStatus),
  };
};

const requireSellerProfileCompleteByUserId = async (res, userId) => {
  if (!userId) {
    res.status(400).json({ success: false, message: "Seller user ID is required" });
    return { ok: false, user: null };
  }

  const user = await userModel.findById(userId).select(
    "seller applied_seller seller_application stripe_account"
  );

  if (!user) {
    res.status(404).json({ success: false, message: "User not found" });
    return { ok: false, user: null };
  }

  const status = user?.seller_application?.status;
  if (!user.seller || (status && status !== "approved")) {
    res.status(403).json({
      success: false,
      code: "SELLER_NOT_APPROVED",
      message: "Seller approval is required before continuing.",
    });
    return { ok: false, user };
  }

  const profileStatus = checkSellerProfileComplete(user);
  if (!profileStatus.complete) {
    sendIncompleteProfileResponse(res, profileStatus.missing_fields);
    return { ok: false, user };
  }

  try {
    const stripeStatus = await checkSellerStripeActive(user);
    if (!stripeStatus.active) {
      res.status(403).json(stripeRestrictionResponse(stripeStatus));
      return { ok: false, user, stripe_status: stripeStatus };
    }
    return { ok: true, user, stripe_status: stripeStatus };
  } catch (error) {
    console.error("Unable to verify seller Stripe status", {
      userId: user._id?.toString(),
      stripeAccount: user.stripe_account,
      message: error.message,
      stack: error.stack,
    });
    res.status(503).json({
      success: false,
      code: "SELLER_STRIPE_STATUS_UNAVAILABLE",
      message: "Unable to verify your Stripe account status. Please try again.",
    });
    return { ok: false, user, error };
  }
};

module.exports = {
  INCOMPLETE_PROFILE_CODE,
  INCOMPLETE_PROFILE_MESSAGE,
  STRIPE_RESTRICTED_CODE,
  STRIPE_RESTRICTED_MESSAGE,
  STRIPE_VERIFICATION_PENDING_CODE,
  STRIPE_VERIFICATION_PENDING_MESSAGE,
  checkSellerProfileComplete,
  checkSellerStripeActive,
  getStripeAccountStatus,
  getStripeAccountStatusCode,
  getSellerEligibility,
  incompleteProfileResponse,
  stripeRestrictionResponse,
  stripeStatusResponse,
  sendIncompleteProfileResponse,
  requireSellerProfileCompleteByUserId,
};
