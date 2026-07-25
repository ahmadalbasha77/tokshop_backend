const assert = require("node:assert/strict");

function mockModule(relativePath, exports) {
  const modulePath = require.resolve(relativePath);
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

let eligibleOrderIds = ["order-1"];
let candidates = [
  {
    _id: "transaction-1",
    orderId: "order-1",
    to: "seller-1",
    amount: 0.66,
  },
];
let claimedTransactions = candidates;
let batchId = null;
let transferCalls = [];
let transactionUpdates = [];
let walletUpdate = null;
let transferRecord = null;
let emailCalls = [];

mockModule("../src/models/settings", {});
mockModule("../src/shared/functions", {
  saveLogs() {},
});
mockModule("../src/models/order", {
  distinct(_field, filter) {
    assert.deepEqual(filter.status, { $in: ["delivered"] });
    return Promise.resolve(eligibleOrderIds);
  },
});
mockModule("../src/models/transaction", {
  find(filter) {
    if (typeof filter.payout_batch_id === "string") {
      assert.equal(filter.payout_batch_id, batchId);
      return Promise.resolve(claimedTransactions);
    }
    assert.equal(filter.type, "order");
    assert.equal(filter.status, "Completed");
    assert.equal(filter.order_fulfilled, true);
    assert.equal(filter.payment_available, true);
    assert.equal(filter.paid_out, false);
    return Promise.resolve(candidates);
  },
  updateMany(filter, update) {
    transactionUpdates.push({ filter, update });
    if (update.$set?.payout_batch_id) {
      batchId = update.$set.payout_batch_id;
      return Promise.resolve({ modifiedCount: candidates.length });
    }
    return Promise.resolve({ modifiedCount: claimedTransactions.length });
  },
  create(data) {
    transferRecord = data;
    return Promise.resolve(data);
  },
});
mockModule("../src/models/user", {
  findById(id) {
    assert.equal(id, "seller-1");
    return Promise.resolve({
      _id: id,
      stripe_account: "acct_seller",
      wallet: 0,
      walletPending: 0.66,
      userName: "Seller",
      email: "seller@example.com",
    });
  },
  findOneAndUpdate(filter, update) {
    walletUpdate = { filter, update };
    return Promise.resolve({
      _id: filter._id,
      wallet: 0.66,
      walletPending: 0,
    });
  },
});
mockModule("../src/shared/email", {
  sendEmail(placeholders, email, template) {
    emailCalls.push({ placeholders, email, template });
    return Promise.resolve();
  },
});

const {
  normalizeOrderIds,
  releaseEligibleOrderPayments,
} = require("../src/shared/orderPaymentRelease");

const stripeClient = {
  transfers: {
    create(payload, options) {
      transferCalls.push({ payload, options });
      return Promise.resolve({ id: "tr_release_1" });
    },
  },
};

void (async () => {
  assert.deepEqual(normalizeOrderIds(["order-1", "order-1", null]), [
    "order-1",
  ]);

  eligibleOrderIds = [];
  const shippedAndAvailable = await releaseEligibleOrderPayments({
    orderIds: ["order-1"],
    stripeClient,
    requireDelivered: false,
  });
  assert.deepEqual(shippedAndAvailable, []);
  assert.equal(transferCalls.length, 0);

  eligibleOrderIds = ["order-1"];
  candidates = [];
  claimedTransactions = [];
  const deliveredAndNotAvailable = await releaseEligibleOrderPayments({
    orderIds: ["order-1"],
    stripeClient,
  });
  assert.deepEqual(deliveredAndNotAvailable, []);
  assert.equal(transferCalls.length, 0);

  candidates = [
    {
      _id: "transaction-1",
      orderId: "order-1",
      to: "seller-1",
      amount: 0.66,
    },
  ];
  claimedTransactions = candidates;
  const releases = await releaseEligibleOrderPayments({
    orderIds: ["order-1"],
    stripeClient,
  });

  assert.deepEqual(releases, [
    {
      sellerId: "seller-1",
      totalAmount: 0.66,
      netAmount: 0.66,
      transferId: "tr_release_1",
    },
  ]);
  assert.equal(transferCalls.length, 1);
  assert.equal(transferCalls[0].payload.amount, 66);
  assert.equal(transferCalls[0].payload.destination, "acct_seller");
  assert.match(
    transferCalls[0].options.idempotencyKey,
    /^seller_release_/
  );
  assert.equal(walletUpdate.update.$inc.wallet, 0.66);
  assert.equal(walletUpdate.update.$inc.walletPending, -0.66);
  assert.equal(transferRecord.type, "transfer");
  assert.equal(transferRecord.transferId, "tr_release_1");
  assert.equal(emailCalls.length, 1);

  const completedUpdate = transactionUpdates.find(
    ({ update }) => update.$set?.paid_out === true
  );
  assert.ok(completedUpdate);
  assert.equal(completedUpdate.update.$set.transferId, "tr_release_1");

  candidates = [];
  claimedTransactions = [];
  const duplicateResult = await releaseEligibleOrderPayments({
    orderIds: ["order-1"],
    stripeClient,
  });
  assert.deepEqual(duplicateResult, []);
  assert.equal(transferCalls.length, 1);

  console.log("order payment release tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
