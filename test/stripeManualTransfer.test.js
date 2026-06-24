const assert = require("node:assert/strict");
const mongoose = require("mongoose");

function mockModule(relativePath, exports) {
  const modulePath = require.resolve(relativePath);
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
}

// Global/Local state for mocks
let transactionsMock = [];
let userUpdates = [];
let loggedEvents = [];
let userMock = {};
let settingsMock = { stripeSecretKey: "sk_test_mock" };

// Mock dependencies
mockModule("../src/models/settings", {
  findOne() {
    return {
      select() {
        return Promise.resolve(settingsMock);
      },
    };
  },
});

mockModule("../src/models/transaction", {
  find(filter) {
    // Return candidates matching criteria
    return {
      select(fields) {
        // Return matching transactions
        return Promise.resolve(transactionsMock);
      }
    };
  },
  updateMany(filter, update) {
    if (update.$set && update.$set.payout_batch_id) {
      const batchId = update.$set.payout_batch_id;
      const targetIds = filter._id.$in;
      let modifiedCount = 0;
      transactionsMock.forEach((tx) => {
        if (targetIds.includes(tx._id) && !tx.payout_batch_id && !tx.paid_out) {
          tx.payout_batch_id = batchId;
          modifiedCount++;
        }
      });
      return Promise.resolve({ modifiedCount });
    }

    const batchId = filter.payout_batch_id;
    if (batchId) {
      transactionsMock.forEach((tx) => {
        if (tx.payout_batch_id === batchId) {
          if (update.$set) {
            if (update.$set.paid_out !== undefined) tx.paid_out = update.$set.paid_out;
            if (update.$set.transferId !== undefined) tx.transferId = update.$set.transferId;
          }
          if (update.$unset && update.$unset.payout_batch_id !== undefined) {
            delete tx.payout_batch_id;
          }
        }
      });
    }
    return Promise.resolve({ modifiedCount: 1 });
  },
  create(doc) {
    return Promise.resolve(doc);
  },
});

mockModule("../src/models/user", {
  findById(id) {
    return Promise.resolve(userMock);
  },
  findOneAndUpdate(filter, update, options) {
    if (update.$inc && update.$inc.walletPending !== undefined) {
      userMock.walletPending += update.$inc.walletPending;
    }
    return Promise.resolve(userMock);
  },
  updateOne(filter, update) {
    userUpdates.push({ filter, update });
    if (update.$set && update.$set.walletPending !== undefined) {
      userMock.walletPending = update.$set.walletPending;
    }
    if (update.$inc) {
      if (update.$inc.walletPending !== undefined) {
        userMock.walletPending += update.$inc.walletPending;
      }
      if (update.$inc.wallet !== undefined) {
        userMock.wallet += update.$inc.wallet;
      }
    }
    return Promise.resolve({ modifiedCount: 1 });
  },
});

mockModule("../src/shared/sellerProfile", {
  checkSellerStripeActive(user) {
    return Promise.resolve({ active: true });
  },
  checkSellerProfileComplete(user) {
    return { complete: true };
  },
  getStripeAccountStatus(account) {
    return {
      charges_enabled: account.charges_enabled === true,
      payouts_enabled: account.payouts_enabled === true,
      card_payments: account.capabilities?.card_payments || "inactive",
      transfers: account.capabilities?.transfers || "inactive",
      legacy_payments: account.capabilities?.legacy_payments || "inactive",
      disabled_reason: account.requirements?.disabled_reason || null,
      currently_due: account.requirements?.currently_due || [],
    };
  },
  stripeRestrictionResponse(status) {
    return { success: false, message: "Stripe restricted" };
  }
});

mockModule("../src/shared/functions", {
  getSettings() {
    return Promise.resolve(settingsMock);
  },
  saveLogs(data) {
    loggedEvents.push(data);
  },
});

// Mock response creator
function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    },
  };
  return res;
}

// Require the controller under test
const { stripeTransfer } = require("../src/controllers/stripe");

// Mock Stripe API
const mockStripe = {
  accounts: {
    retrieve(accountId) {
      return Promise.resolve({
        id: accountId,
        charges_enabled: true,
        payouts_enabled: true,
        capabilities: {
          card_payments: "active",
          transfers: "active",
        },
        requirements: {
          disabled_reason: null,
          currently_due: [],
        },
      });
    },
  },
  transfers: {
    create(params) {
      if (params.destination === "acct_fail") {
        const error = new Error("Stripe Transfer Failed Mock");
        error.code = "balance_insufficient";
        error.type = "api_error";
        throw error;
      }
      return Promise.resolve({ id: "tr_manual_mock_123" });
    }
  }
};

// Require stripe client inside stripe.js uses require("stripe")
// We must mock "stripe" node module!
mockModule("stripe", function(key) {
  return mockStripe;
});

void (async () => {
  console.log("🏃 Running stripeTransfer manual transfer unit tests...");

  // ----------------------------------------------------
  // Test Case 1: Success with desynchronized balance
  // ----------------------------------------------------
  console.log("\n🧪 Test Case 1: Success with desynchronized balance");
  userMock = {
    _id: "user_123",
    stripe_account: "acct_success",
    wallet: 0.00,
    walletPending: 1.32, // Desynchronized! Transactions sum to 1.60
    userName: "taraflive26",
    email: "taraflive2026@gmail.com"
  };

  transactionsMock = [
    { _id: "tx_1", amount: 0.47, paid_out: false },
    { _id: "tx_2", amount: 0.47, paid_out: false },
    { _id: "tx_3", amount: 0.66, paid_out: false },
  ];

  userUpdates = [];
  loggedEvents = [];

  let req = {
    body: { amount: 1.60, user: "user_123" },
    user: { _authType: "admin" }
  };
  let res = createMockResponse();

  await stripeTransfer(req, res);

  // Assertions:
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, true);
  assert.equal(res.body.response, "Transfer successful");

  // walletPending should be 0 because 1.32 - 1.60 = -0.28, which is capped at 0.
  assert.equal(userMock.walletPending, 0);
  assert.equal(userMock.wallet, 1.60); // wallet increased by originalAmount

  // Transactions should be paid_out
  assert.ok(transactionsMock.every(tx => tx.paid_out === true));
  assert.ok(transactionsMock.every(tx => tx.transferId === "tr_manual_mock_123"));

  // Check logs
  const successLog = loggedEvents.find(e => {
    const data = JSON.parse(e.log_data);
    return data.type === "MANUAL_TRANSFER_SUCCESS";
  });
  assert.ok(successLog);

  // ----------------------------------------------------
  // Test Case 2: Rollback on Stripe failure
  // ----------------------------------------------------
  console.log("\n🧪 Test Case 2: Rollback on Stripe failure");
  userMock = {
    _id: "user_123",
    stripe_account: "acct_fail", // triggers mock stripe failure
    wallet: 0.00,
    walletPending: 2.00,
    userName: "taraflive26",
    email: "taraflive2026@gmail.com"
  };

  transactionsMock = [
    { _id: "tx_1", amount: 0.47, paid_out: false },
    { _id: "tx_2", amount: 0.47, paid_out: false },
    { _id: "tx_3", amount: 0.66, paid_out: false },
  ];

  userUpdates = [];
  loggedEvents = [];

  req = {
    body: { amount: 1.60, user: "user_123" },
    user: { _authType: "admin" }
  };
  res = createMockResponse();

  await stripeTransfer(req, res);

  // Assertions:
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, "STRIPE_TRANSFER_FAILED");
  assert.match(res.body.message, /Stripe Transfer Failed Mock/);

  // walletPending should be rolled back to 2.00
  // (First decremented by 1.60 to 0.40, then rolled back +1.60 back to 2.00)
  assert.equal(userMock.walletPending, 2.00);

  // Transactions should NOT be paid_out, and payout_batch_id should be cleared
  assert.ok(transactionsMock.every(tx => tx.paid_out === false));
  assert.ok(transactionsMock.every(tx => !tx.payout_batch_id));

  // Check logs
  const failedLog = loggedEvents.find(e => {
    const data = JSON.parse(e.log_data);
    return data.type === "MANUAL_TRANSFER_FAILED";
  });
  assert.ok(failedLog);

  // ----------------------------------------------------
  // Test Case 3: Amount mismatch
  // ----------------------------------------------------
  console.log("\n🧪 Test Case 3: Amount mismatch");
  userMock = {
    _id: "user_123",
    stripe_account: "acct_success",
    wallet: 0.00,
    walletPending: 2.00,
    userName: "taraflive26",
    email: "taraflive2026@gmail.com"
  };

  transactionsMock = [
    { _id: "tx_1", amount: 0.47, paid_out: false },
    { _id: "tx_2", amount: 0.47, paid_out: false },
    { _id: "tx_3", amount: 0.66, paid_out: false },
  ];

  req = {
    body: { amount: 5.00, user: "user_123" }, // non-matching amount
    user: { _authType: "admin" }
  };
  res = createMockResponse();

  await stripeTransfer(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.status, false);
  assert.equal(res.body.response, "Amount does not match");
  assert.equal(userMock.walletPending, 2.00);
  assert.ok(transactionsMock.every(tx => tx.paid_out === false));

  console.log("\n✅ All manual transfer unit tests passed successfully!");
})().catch((error) => {
  console.error("❌ Test execution failed:", error);
  process.exit(1);
});
