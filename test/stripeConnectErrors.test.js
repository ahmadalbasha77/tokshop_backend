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

let transactionsMock = [];
let transactionUpdates = [];
let userUpdates = [];
let loggedEvents = [];

mockModule("../src/models/settings", {
  findOne() {
    return {
      select() {
        return Promise.resolve({ stripeSecretKey: "sk_test_mock" });
      },
    };
  },
});

mockModule("../src/models/order", {
  distinct() {
    return Promise.resolve(["order_1", "order_2"]);
  },
});

mockModule("../src/models/transaction", {
  find(filter) {
    if (filter.orderId) {
      // Candidates search
      return Promise.resolve(transactionsMock);
    }
    // Claimed transactions search (by batch ID)
    const claimed = transactionsMock.filter((tx) => tx.payout_batch_id === filter.payout_batch_id);
    return Promise.resolve(claimed);
  },
  updateMany(filter, update) {
    transactionUpdates.push({ filter, update });
    if (update.$set && update.$set.payout_batch_id) {
      // Lock batch ID
      const batchId = update.$set.payout_batch_id;
      const targetIds = filter._id.$in.map((id) => id.toString());
      transactionsMock.forEach((tx) => {
        if (targetIds.includes(tx._id.toString())) {
          tx.payout_batch_id = batchId;
        }
      });
      return Promise.resolve({ modifiedCount: targetIds.length });
    }
    const batchId = filter.payout_batch_id;
    if (update.$set && update.$set.status) {
      transactionsMock.forEach((tx) => {
        if (tx.payout_batch_id === batchId) {
          tx.status = update.$set.status;
        }
      });
    }
    if (update.$unset && update.$unset.payout_batch_id !== undefined) {
      transactionsMock.forEach((tx) => {
        if (tx.payout_batch_id === batchId) {
          delete tx.payout_batch_id;
        }
      });
    }
    return Promise.resolve({ modifiedCount: 1 });
  },
  create(doc) {
    return Promise.resolve(doc);
  },
});

const mockSellers = {
  "seller_failed": {
    _id: "seller_failed",
    stripe_account: "acct_failed",
    wallet: 0,
    walletPending: 100,
  },
  "seller_success": {
    _id: "seller_success",
    stripe_account: "acct_success",
    wallet: 0,
    walletPending: 200,
  },
  "seller_missing": {
    _id: "seller_missing",
    stripe_account: null, // missing stripe account
    wallet: 0,
    walletPending: 300,
  },
};

mockModule("../src/models/user", {
  findById(id) {
    return Promise.resolve(mockSellers[id]);
  },
  findOneAndUpdate(filter, update, options) {
    const seller = mockSellers[filter._id];
    if (seller) {
      if (update.$inc) {
        seller.wallet += update.$inc.wallet || 0;
        seller.walletPending += update.$inc.walletPending || 0;
      }
    }
    return Promise.resolve(seller);
  },
  updateOne(filter, update) {
    userUpdates.push({ filter, update });
    const seller = mockSellers[filter._id];
    if (seller && update.$set) {
      Object.assign(seller, update.$set);
    }
    return Promise.resolve({ modifiedCount: 1 });
  },
});

mockModule("../src/shared/email", {
  sendEmail() {
    return Promise.resolve();
  },
});

mockModule("../src/shared/functions", {
  saveLogs(data) {
    loggedEvents.push(data);
  },
});

const { releaseEligibleOrderPayments } = require("../src/shared/orderPaymentRelease");

void (async () => {
  // Test Setup:
  // We have 3 transaction entries:
  // 1. seller_failed -> fails with Stripe resource_missing
  // 2. seller_success -> succeeds
  // 3. seller_missing -> fails because stripe_account is null (local config error)
  transactionsMock = [
    {
      _id: "tx_1",
      orderId: "order_1",
      to: "seller_failed",
      amount: 50,
      type: "order",
      status: "Completed",
      order_fulfilled: true,
      payment_available: true,
      paid_out: false,
    },
    {
      _id: "tx_2",
      orderId: "order_2",
      to: "seller_success",
      amount: 120,
      type: "order",
      status: "Completed",
      order_fulfilled: true,
      payment_available: true,
      paid_out: false,
    },
    {
      _id: "tx_3",
      orderId: "order_1",
      to: "seller_missing",
      amount: 80,
      type: "order",
      status: "Completed",
      order_fulfilled: true,
      payment_available: true,
      paid_out: false,
    },
  ];

  // Mock Stripe Transfers
  const mockStripe = {
    transfers: {
      create(params) {
        if (params.destination === "acct_failed") {
          const error = new Error("No such destination");
          error.code = "resource_missing";
          error.type = "invalid_request_error";
          throw error;
        }
        return Promise.resolve({ id: "tr_mock_success" });
      },
    },
  };

  console.log("🏃 Running releaseEligibleOrderPayments error loop tests...");
  const releases = await releaseEligibleOrderPayments({
    orderIds: ["order_1", "order_2"],
    stripeClient: mockStripe,
    requireDelivered: false,
  });

  // 1. Verify successful payout completed and returned in the releases array
  assert.equal(releases.length, 1);
  assert.equal(releases[0].sellerId, "seller_success");
  assert.equal(releases[0].transferId, "tr_mock_success");
  assert.equal(releases[0].netAmount, 120);

  // 2. Verify that user_failed's Stripe Connect settings were deactivated/cleared
  const failedUserUpdate = userUpdates.find((u) => u.filter._id === "seller_failed");
  assert.ok(failedUserUpdate);
  assert.equal(failedUserUpdate.update.$set.stripe_account, null);
  assert.equal(failedUserUpdate.update.$set.stripe_status_code, "");
  assert.equal(failedUserUpdate.update.$set.stripe_verification_pending, false);

  // 3. Verify that transactions for user_failed were updated to status: "Failed"
  const failedTx = transactionsMock.find((tx) => tx._id === "tx_1");
  assert.equal(failedTx.status, "Failed");

  // 4. Verify that transactions for user_missing were unlocked but status is still Completed (so they can retry when a Stripe account is linked)
  const missingTx = transactionsMock.find((tx) => tx._id === "tx_3");
  assert.equal(missingTx.status, "Completed");
  assert.equal(missingTx.payout_batch_id, undefined);

  // 5. Verify that STRIPE_TRANSFER_FAILED log was recorded for seller_failed
  const failedLog = loggedEvents.find((evt) => evt.user === "seller_failed");
  assert.ok(failedLog);
  const parsedLogData = JSON.parse(failedLog.log_data);
  assert.equal(parsedLogData.type, "STRIPE_TRANSFER_FAILED");
  assert.equal(parsedLogData.errorCode, "resource_missing");

  // 6. Verify that NO transfer failed log was recorded for seller_missing (we skip to avoid DB clutter for missing local config)
  const missingLog = loggedEvents.find((evt) => evt.user === "seller_missing");
  assert.equal(missingLog, undefined);

  console.log("✅ stripeConnectErrors.test.js unit tests passed successfully!");
})().catch((error) => {
  console.error("❌ Test execution failed:", error);
  process.exitCode = 1;
});
