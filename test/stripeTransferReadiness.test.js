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

let userMock;
let settingsMock;
let transactionsMock;
let loggedEvents;
let transactionFindCalls;
let transactionMutationCalls;
let walletMutationCalls;
let transferCalls;
let accountRetrieveCalls;

mockModule("../src/models/transaction", {
  find() {
    transactionFindCalls += 1;
    return {
      select() {
        return Promise.resolve(transactionsMock);
      },
    };
  },
  updateMany(filter, update) {
    transactionMutationCalls += 1;
    if (update.$set?.payout_batch_id) {
      const batchId = update.$set.payout_batch_id;
      let modifiedCount = 0;
      for (const transaction of transactionsMock) {
        if (!transaction.payout_batch_id && !transaction.paid_out) {
          transaction.payout_batch_id = batchId;
          modifiedCount += 1;
        }
      }
      return Promise.resolve({ modifiedCount });
    }
    if (filter.payout_batch_id) {
      for (const transaction of transactionsMock) {
        if (transaction.payout_batch_id !== filter.payout_batch_id) continue;
        if (update.$set?.paid_out !== undefined) {
          transaction.paid_out = update.$set.paid_out;
        }
        if (update.$set?.transferId !== undefined) {
          transaction.transferId = update.$set.transferId;
        }
        if (update.$unset?.payout_batch_id !== undefined) {
          delete transaction.payout_batch_id;
        }
      }
    }
    return Promise.resolve({ modifiedCount: 1 });
  },
  create(doc) {
    transactionMutationCalls += 1;
    return Promise.resolve(doc);
  },
});

mockModule("../src/models/user", {
  findById() {
    return Promise.resolve(userMock);
  },
  findOneAndUpdate(_filter, update) {
    walletMutationCalls += 1;
    if (update.$inc?.walletPending !== undefined) {
      userMock.walletPending += update.$inc.walletPending;
    }
    return Promise.resolve(userMock);
  },
  updateOne(_filter, update) {
    walletMutationCalls += 1;
    if (update.$set?.walletPending !== undefined) {
      userMock.walletPending = update.$set.walletPending;
    }
    if (update.$inc?.walletPending !== undefined) {
      userMock.walletPending += update.$inc.walletPending;
    }
    if (update.$inc?.wallet !== undefined) {
      userMock.wallet += update.$inc.wallet;
    }
    return Promise.resolve({ modifiedCount: 1 });
  },
});

mockModule("../src/shared/sellerProfile", {
  checkSellerStripeActive() {
    return Promise.resolve({ active: true });
  },
  checkSellerProfileComplete() {
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
  getStripeAccountStatusCode() {
    return "SELLER_READY";
  },
  sendIncompleteProfileResponse() {
    throw new Error("Profile completeness must not gate historical transfers");
  },
  stripeRestrictionResponse(status) {
    return { success: false, stripe_status: status };
  },
});

mockModule("../src/shared/functions", {
  getSettings() {
    return Promise.resolve(settingsMock);
  },
  saveLogs(entry) {
    loggedEvents.push(entry);
  },
});

function stripeAccount(accountId) {
  if (accountId === "acct_missing") {
    const error = new Error("No such account: acct_missing");
    error.type = "StripeInvalidRequestError";
    error.code = "resource_missing";
    error.requestId = "req_missing";
    error.statusCode = 404;
    throw error;
  }
  if (accountId === "acct_temporary_failure") {
    const error = new Error("Stripe API connection failed");
    error.type = "StripeConnectionError";
    error.code = "api_connection_error";
    error.requestId = "req_temporary";
    error.statusCode = 503;
    throw error;
  }
  if (accountId === "acct_transfers_inactive") {
    return {
      charges_enabled: true,
      payouts_enabled: false,
      capabilities: { card_payments: "active", transfers: "inactive" },
      requirements: {
        disabled_reason: "requirements.past_due",
        currently_due: ["external_account"],
      },
    };
  }
  if (accountId === "acct_charges_disabled") {
    return {
      charges_enabled: false,
      payouts_enabled: false,
      capabilities: { card_payments: "inactive", transfers: "active" },
      requirements: { disabled_reason: null, currently_due: [] },
    };
  }
  return {
    charges_enabled: true,
    payouts_enabled: true,
    capabilities: { card_payments: "active", transfers: "active" },
    requirements: { disabled_reason: null, currently_due: [] },
  };
}

const mockStripe = {
  accounts: {
    retrieve(accountId) {
      accountRetrieveCalls += 1;
      return Promise.resolve().then(() => stripeAccount(accountId));
    },
  },
  transfers: {
    create(params) {
      transferCalls += 1;
      if (params.destination === "acct_transfer_failure") {
        const error = new Error("Stripe Transfer Failed Mock");
        error.type = "StripeAPIError";
        error.code = "balance_insufficient";
        error.requestId = "req_transfer_failure";
        error.statusCode = 402;
        throw error;
      }
      return Promise.resolve({ id: "tr_manual_mock_123" });
    },
  },
};

mockModule("stripe", () => mockStripe);

function reset({
  stripeAccount = "acct_success",
  walletPending = 1.6,
  settings = { stripeSecretKey: "sk_test_mock" },
} = {}) {
  userMock = {
    _id: "user_123",
    stripe_account: stripeAccount,
    walletPending,
    wallet: 0,
  };
  transactionsMock = [
    { _id: "tx_1", amount: 0.8, paid_out: false },
    { _id: "tx_2", amount: 0.8, paid_out: false },
  ];
  settingsMock = settings;
  loggedEvents = [];
  transactionFindCalls = 0;
  transactionMutationCalls = 0;
  walletMutationCalls = 0;
  transferCalls = 0;
  accountRetrieveCalls = 0;
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

const request = () => ({
  body: { amount: 1.6, user: "user_123" },
  user: { _authType: "admin" },
});

function assertNoFinancialMutation() {
  assert.equal(transactionFindCalls, 0);
  assert.equal(transactionMutationCalls, 0);
  assert.equal(walletMutationCalls, 0);
  assert.equal(transferCalls, 0);
}

const { stripeTransfer } = require("../src/controllers/stripe");

void (async () => {
  reset({ stripeAccount: null });
  let res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "STRIPE_ACCOUNT_NOT_CONNECTED");
  assertNoFinancialMutation();

  reset({ stripeAccount: "acct_missing" });
  res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "STRIPE_ACCOUNT_NOT_FOUND");
  assert.equal(res.body.next_action, "RECONNECT_STRIPE");
  assertNoFinancialMutation();
  const errorLog = loggedEvents
    .map((entry) => JSON.parse(entry.log_data))
    .find((entry) => entry.classification === "ACCOUNT_NOT_FOUND_OR_MODE_MISMATCH");
  assert.deepEqual(
    {
      userId: errorLog.userId,
      stripeAccount: errorLog.stripeAccount,
      error: errorLog.error,
    },
    {
      userId: "user_123",
      stripeAccount: "acct_missing",
      error: {
        type: "StripeInvalidRequestError",
        code: "resource_missing",
        message: "No such account: acct_missing",
        requestId: "req_missing",
        statusCode: 404,
      },
    }
  );

  reset({ settings: {} });
  res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "STRIPE_CONFIGURATION_UNAVAILABLE");
  assert.equal(accountRetrieveCalls, 0);
  assertNoFinancialMutation();

  reset({ stripeAccount: "acct_temporary_failure" });
  res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "STRIPE_API_UNAVAILABLE");
  assertNoFinancialMutation();

  reset({ stripeAccount: "acct_transfers_inactive" });
  res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "STRIPE_TRANSFERS_NOT_ACTIVE");
  assert.equal(res.body.stripe_status.transfers, "inactive");
  assert.deepEqual(res.body.stripe_status.currently_due, ["external_account"]);
  assertNoFinancialMutation();

  reset({ stripeAccount: "acct_charges_disabled" });
  res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(transferCalls, 1);
  assert.ok(transactionsMock.every((transaction) => transaction.paid_out));

  reset();
  res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(userMock.walletPending, 0);
  assert.equal(userMock.wallet, 1.6);
  assert.ok(transactionsMock.every((transaction) => transaction.paid_out));

  reset({ stripeAccount: "acct_transfer_failure", walletPending: 2 });
  res = response();
  await stripeTransfer(request(), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "STRIPE_TRANSFER_FAILED");
  assert.equal(userMock.walletPending, 2);
  assert.ok(transactionsMock.every((transaction) => !transaction.paid_out));
  assert.ok(transactionsMock.every((transaction) => !transaction.payout_batch_id));

  console.log("Stripe transfer readiness tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
