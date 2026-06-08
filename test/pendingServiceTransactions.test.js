const assert = require("node:assert/strict");
const {
  buildPendingServiceFilter,
  buildPendingServiceResponse,
  isAllowedPendingServiceType,
  parseDateBoundary,
} = require("../src/shared/pendingServiceTransactions");
const {
  getAdminAuthorizationFailure,
} = require("../src/shared/adminAuthorization");

assert.equal(isAllowedPendingServiceType("shipping_deduction"), true);
assert.equal(isAllowedPendingServiceType("service_fee"), true);
assert.equal(isAllowedPendingServiceType("order"), false);
assert.equal(isAllowedPendingServiceType(undefined), false);

assert.deepEqual(buildPendingServiceResponse([]), {
  transactions: [],
  total: 0,
  amount: 0,
});

assert.deepEqual(
  buildPendingServiceResponse([
    { amount: 10 },
    { amount: "2.5" },
    { amount: null },
    { amount: undefined },
    {},
  ]),
  {
    transactions: [
      { amount: 10 },
      { amount: "2.5" },
      { amount: null },
      { amount: undefined },
      {},
    ],
    total: 12.5,
    amount: 12.5,
  }
);

assert.deepEqual(
  buildPendingServiceFilter({
    type: "shipping_deduction",
    from: undefined,
    to: undefined,
  }),
  {
    type: "shipping_deduction",
    status: "Pending",
    paid_out: false,
  }
);

const serviceFeeFilter = buildPendingServiceFilter({
  type: "service_fee",
  from: "2026-06-01",
  to: "2026-06-08",
});
assert.equal(serviceFeeFilter.type, "service_fee");
assert.equal(serviceFeeFilter.date.$gte, Date.parse("2026-06-01T00:00:00.000Z"));
assert.equal(serviceFeeFilter.date.$lte, Date.parse("2026-06-08T23:59:59.999Z"));

assert.equal(parseDateBoundary("not-a-date"), null);
assert.equal(parseDateBoundary("2026-02-31"), null);

assert.deepEqual(getAdminAuthorizationFailure(null, {}), {
  status: 401,
  message: "Invalid or expired admin token",
});
assert.deepEqual(getAdminAuthorizationFailure({ _authType: "user" }), {
  status: 403,
  message: "Admin access required",
});
assert.equal(getAdminAuthorizationFailure({ _authType: "admin" }), null);

console.log("pending service transaction tests passed");
