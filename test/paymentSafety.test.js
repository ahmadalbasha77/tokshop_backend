const assert = require("assert");
const {
  assertProductSeller,
  assertSucceededPaymentIntent,
  buildStripeIdempotencyKey,
  normalizeOrderShipping,
  validateEarnings,
} = require("../src/shared/paymentSafety");

function expectCode(fn, code) {
  assert.throws(fn, (error) => error.code === code);
}

assert.strictEqual(
  assertSucceededPaymentIntent({ id: "pi_test", status: "succeeded" }).id,
  "pi_test"
);

for (const [status, code] of Object.entries({
  processing: "PAYMENT_INTENT_PROCESSING",
  requires_action: "PAYMENT_INTENT_REQUIRES_ACTION",
  requires_payment_method: "PAYMENT_INTENT_REQUIRES_PAYMENT_METHOD",
  requires_capture: "PAYMENT_INTENT_REQUIRES_CAPTURE",
  canceled: "PAYMENT_INTENT_CANCELED",
})) {
  assert.throws(
    () => assertSucceededPaymentIntent({ id: "pi_test", status }),
    (error) => {
      assert.strictEqual(error.code, code);
      assert.strictEqual(
        error.retryPayment,
        ["requires_payment_method", "canceled"].includes(status)
      );
      return true;
    }
  );
}

assert.strictEqual(
  validateEarnings({
    subtotal: 10,
    serviceFee: 1,
    stripeFee: 0.5,
    extraCharges: 0,
    earnings: 8.5,
  }),
  8.5
);
assert.strictEqual(
  validateEarnings({ subtotal: 0, serviceFee: 0, stripeFee: 0, extraCharges: 0, earnings: 0 }),
  0
);
expectCode(
  () => validateEarnings({ subtotal: 10, serviceFee: 1, stripeFee: 1, extraCharges: 0, earnings: -1 }),
  "INVALID_PAYMENT_AMOUNT"
);
expectCode(
  () => validateEarnings({ subtotal: 10, serviceFee: 1, stripeFee: 1, extraCharges: 0, earnings: NaN }),
  "INVALID_PAYMENT_AMOUNT"
);

assert.deepStrictEqual(
  normalizeOrderShipping({ shipping: null, shippingFee: 0 }),
  {
    carrierAccount: null,
    amount: 0,
    totalWeightOz: undefined,
    bundleId: null,
    seller_shipping_fee_pay: 0,
    provider: null,
    rate_id: null,
  }
);
assert.strictEqual(
  normalizeOrderShipping({ shipping: { amount: "4.25", totalWeightOz: "2" } }).amount,
  4.25
);

assert.strictEqual(
  assertProductSeller({ ownerId: { toString: () => "seller-a" } }, { toString: () => "seller-a" }),
  "seller-a"
);
expectCode(
  () => assertProductSeller({ ownerId: { toString: () => "seller-a" } }, { toString: () => "seller-b" }),
  "SELLER_PRODUCT_MISMATCH"
);

const firstKey = buildStripeIdempotencyKey({
  checkoutAttemptId: "attempt-1",
  buyerId: "buyer-1",
  orderId: "order-1",
});
assert.strictEqual(
  firstKey,
  buildStripeIdempotencyKey({
    checkoutAttemptId: "attempt-1",
    buyerId: "buyer-1",
    orderId: "different-order",
  })
);
assert.notStrictEqual(
  firstKey,
  buildStripeIdempotencyKey({
    checkoutAttemptId: "attempt-2",
    buyerId: "buyer-1",
    orderId: "order-1",
  })
);

console.log("paymentSafety tests passed");
