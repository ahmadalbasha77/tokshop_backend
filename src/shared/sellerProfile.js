const userModel = require("../models/user");

const INCOMPLETE_PROFILE_CODE = "SELLER_PROFILE_INCOMPLETE";
const INCOMPLETE_PROFILE_MESSAGE =
  "Please complete your seller account information before continuing.";

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

  return { ok: true, user };
};

module.exports = {
  INCOMPLETE_PROFILE_CODE,
  INCOMPLETE_PROFILE_MESSAGE,
  checkSellerProfileComplete,
  incompleteProfileResponse,
  sendIncompleteProfileResponse,
  requireSellerProfileCompleteByUserId,
};
