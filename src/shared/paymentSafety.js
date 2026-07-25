const crypto = require("crypto");

const PAYMENT_INTENT_ERROR_CODES = {
  processing: "PAYMENT_INTENT_PROCESSING",
  requires_action: "PAYMENT_INTENT_REQUIRES_ACTION",
  requires_payment_method: "PAYMENT_INTENT_REQUIRES_PAYMENT_METHOD",
  requires_capture: "PAYMENT_INTENT_REQUIRES_CAPTURE",
  canceled: "PAYMENT_INTENT_CANCELED",
};
const PAYMENT_INTENT_RETRY_POLICY = {
  processing: false,
  requires_action: false,
  requires_capture: false,
  requires_payment_method: true,
  canceled: true,
};

function paymentSafetyError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.type = "payment_validation_error";
  return error;
}

function assertSucceededPaymentIntent(paymentIntent) {
  const status = paymentIntent?.status || "unknown";
  if (status === "succeeded") return paymentIntent;

  const code =
    PAYMENT_INTENT_ERROR_CODES[status] || "PAYMENT_INTENT_NOT_SUCCEEDED";
  const error = paymentSafetyError(
    `PaymentIntent is not complete (status: ${status})`,
    code
  );
  error.paymentIntentId = paymentIntent?.id || null;
  error.paymentIntentStatus = status;
  error.retryPayment = PAYMENT_INTENT_RETRY_POLICY[status] ?? false;
  throw error;
}

function finiteNumber(value, fieldName, { min = null } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw paymentSafetyError(
      `Invalid numeric value for ${fieldName}`,
      "INVALID_PAYMENT_AMOUNT"
    );
  }
  if (min !== null && number < min) {
    throw paymentSafetyError(
      `${fieldName} cannot be less than ${min}`,
      "INVALID_PAYMENT_AMOUNT"
    );
  }
  return number;
}

function validateEarnings({
  subtotal,
  serviceFee,
  stripeFee,
  extraCharges,
  earnings,
}) {
  finiteNumber(subtotal, "subtotal", { min: 0 });
  finiteNumber(serviceFee, "serviceFee", { min: 0 });
  finiteNumber(stripeFee, "stripeFee", { min: 0 });
  finiteNumber(extraCharges, "extraCharges", { min: 0 });
  return finiteNumber(earnings, "earnings", { min: 0 });
}

function normalizeOrderShipping({
  shipping,
  shippingFee,
  totalWeightOz,
  bundleId,
  sellerShippingFeePay,
  carrierAccount,
  carrier,
  rateId,
}) {
  const source = shipping && typeof shipping === "object" ? shipping : {};
  const amount = finiteNumber(
    source.amount ?? shippingFee ?? 0,
    "shipping.amount",
    { min: 0 }
  );
  const sellerFee = finiteNumber(
    source.seller_shipping_fee_pay ?? sellerShippingFeePay ?? 0,
    "shipping.seller_shipping_fee_pay",
    { min: 0 }
  );
  const weightValue = source.totalWeightOz ?? totalWeightOz;
  const normalizedWeight =
    weightValue == null || weightValue === ""
      ? weightValue
      : finiteNumber(weightValue, "shipping.totalWeightOz", { min: 0 });

  return {
    carrierAccount: source.carrierAccount ?? carrierAccount ?? null,
    amount,
    totalWeightOz: normalizedWeight,
    bundleId: source.bundleId ?? bundleId ?? null,
    seller_shipping_fee_pay: sellerFee,
    provider: source.provider ?? carrier ?? null,
    rate_id: source.rate_id ?? source.objectId ?? rateId ?? null,
  };
}

function assertProductSeller(product, requestedSellerId) {
  const trustedSellerId = product?.ownerId?.toString?.();
  const requestedId = requestedSellerId?.toString?.();
  if (!trustedSellerId) {
    throw paymentSafetyError(
      "Product seller is unavailable",
      "PRODUCT_SELLER_MISSING"
    );
  }
  if (!requestedId || requestedId !== trustedSellerId) {
    throw paymentSafetyError(
      "The requested seller does not own this product",
      "SELLER_PRODUCT_MISMATCH"
    );
  }
  return trustedSellerId;
}

function buildStripeIdempotencyKey({ checkoutAttemptId, buyerId, orderId }) {
  const rawAttempt = String(checkoutAttemptId || "").trim();
  const fallbackOrderId = orderId?.toString?.() || String(orderId || "");
  const source = rawAttempt
    ? `checkout:${buyerId || "unknown"}:${rawAttempt}`
    : `order:${fallbackOrderId}`;
  const digest = crypto.createHash("sha256").update(source).digest("hex");
  return `order_payment_${digest}`;
}

module.exports = {
  assertProductSeller,
  assertSucceededPaymentIntent,
  buildStripeIdempotencyKey,
  normalizeOrderShipping,
  validateEarnings,
};
