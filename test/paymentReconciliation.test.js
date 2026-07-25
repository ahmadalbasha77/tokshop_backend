const assert = require("assert");
const {
  buildPaymentReconciliationReport,
} = require("../src/controllers/paymentReconciliation");

const report = buildPaymentReconciliationReport({
  paymentIntents: [
    { id: "pi_ok", status: "succeeded", metadata: { orderId: "o1", sellerId: "s1" } },
    { id: "pi_missing", status: "succeeded", metadata: { orderId: "o2", sellerId: "s2" } },
    {
      id: "pi_duplicate",
      status: "succeeded",
      metadata: { orderId: "o3", sellerId: "s3" },
      latest_charge: { amount_refunded: 100, disputed: false },
    },
  ],
  orders: [
    { _id: "o1", seller: "s1", paymentIntentId: "pi_ok" },
    { _id: "o3", seller: "s3", paymentIntentId: "pi_duplicate" },
  ],
  items: [
    { orderId: "o1", seller: "s1" },
    { orderId: "o3", seller: "wrong-seller" },
  ],
  transactions: [
    { orderId: "o1", to: "s1", type: "order", paymentIntentId: "pi_ok" },
    { orderId: "o3", to: "s3", type: "order", paymentIntentId: "pi_duplicate" },
    { orderId: "o3", to: "s3", type: "order", paymentIntentId: "pi_duplicate" },
  ],
  paymentAttempts: [
    {
      paymentIntentId: "pi_duplicate",
      stripeStatus: "succeeded",
      recordingStatus: "stripe_succeeded",
    },
  ],
});

assert.strictEqual(report.mode, "report_only");
assert.strictEqual(report.autoRepair, false);
const missing = report.mismatches.find((entry) => entry.paymentIntentId === "pi_missing");
assert(missing.issues.includes("ORDER_MISSING"));
const duplicate = report.mismatches.find((entry) => entry.paymentIntentId === "pi_duplicate");
assert(duplicate.issues.includes("DUPLICATE_EARNINGS_TRANSACTION"));
assert(duplicate.issues.includes("SELLER_MISMATCH"));
assert(duplicate.issues.includes("REFUNDED"));
assert(duplicate.issues.includes("PAYMENT_RECORDING_INCOMPLETE"));
assert.strictEqual(duplicate.excludedFromAutoRepair, true);

console.log("paymentReconciliation tests passed");
