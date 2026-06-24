const assert = require("node:assert/strict");
const Module = require("node:module");

const transactionModelPath = require.resolve("../src/models/transaction");
let queryRows = [];
let queryError = null;
let lastFilter = null;
let lastMaxTimeMS = null;

let lastUpdateFilter = null;
let lastUpdateData = null;

require.cache[transactionModelPath] = {
  id: transactionModelPath,
  filename: transactionModelPath,
  loaded: true,
  exports: {
    find(filter) {
      lastFilter = filter;
      return {
        sort() {
          return this;
        },
        lean() {
          return this;
        },
        maxTimeMS(timeout) {
          lastMaxTimeMS = timeout;
          return queryError
            ? Promise.reject(queryError)
            : Promise.resolve(queryRows);
        },
      };
    },
    updateMany(filter, update) {
      lastUpdateFilter = filter;
      lastUpdateData = update;
      return Promise.resolve({ modifiedCount: queryRows.length });
    },
  },
};

const controller = require("../src/controllers/pendingServiceTransactions");

let passportAccount = null;
let passportError = null;
let passportInfo = {};
const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "passport") {
    return {
      authenticate(_strategy, _options, callback) {
        return (req, res, next) =>
          callback(passportError, passportAccount, passportInfo, req, res, next);
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const requireAdminJson = require("../src/services/adminJsonAuth");
Module._load = originalModuleLoad;

function createResponse() {
  return {
    statusCode: null,
    body: null,
    on() {
      return this;
    },
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

async function request(query) {
  const res = createResponse();
  await controller.getPendingShippingServiceTransactions({ query }, res);
  return res;
}

function authenticate(account, info = {}, error = null) {
  passportAccount = account;
  passportInfo = info;
  passportError = error;
  const req = {};
  const res = createResponse();
  let nextCalled = false;

  requireAdminJson(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
}

void (async () => {
  queryRows = [];
  let response = await request({ type: "shipping_deduction" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    success: true,
    data: {
      transactions: [],
      total: 0,
      amount: 0,
    },
  });
  assert.deepEqual(lastFilter, {
    type: "shipping_deduction",
    status: "Pending",
    paid_out: false,
  });
  assert.equal(lastMaxTimeMS, 10000);

  queryRows = [{ amount: 3 }, { amount: null }, { amount: "2.5" }];
  response = await request({ type: "service_fee" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.total, 5.5);
  assert.equal(response.body.data.amount, 5.5);
  assert.equal(lastFilter.type, "service_fee");

  response = await request({ type: "order" });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /shipping_deduction or service_fee/);

  const originalConsoleError = console.error;
  console.error = () => {};
  queryError = new Error("database failed");
  response = await request({ type: "service_fee" });
  assert.equal(response.statusCode, 500);
  assert.equal(
    response.body.message,
    "Failed to fetch pending shipping service transactions"
  );

  queryError = Object.assign(new Error("query timed out"), { code: 50 });
  response = await request({ type: "shipping_deduction" });
  assert.equal(response.statusCode, 504);
  console.error = originalConsoleError;

  let authResult = authenticate(null);
  assert.equal(authResult.res.statusCode, 401);
  assert.equal(authResult.nextCalled, false);

  authResult = authenticate({ _authType: "user" });
  assert.equal(authResult.res.statusCode, 403);
  assert.equal(authResult.nextCalled, false);

  const adminAccount = { _authType: "admin" };
  authResult = authenticate(adminAccount);
  assert.equal(authResult.nextCalled, true);
  assert.equal(authResult.req.user, adminAccount);

  authResult = authenticate(
    null,
    {},
    Object.assign(new Error("jwt expired"), { name: "TokenExpiredError" })
  );
  assert.equal(authResult.res.statusCode, 401);
  assert.equal(authResult.res.body.message, "Invalid or expired admin token");

  // --- POST /users/shipping/service/transfer Tests ---
  console.log("🏃 Running transferShippingServiceFunds tests...");
  queryError = null;

  // Mock response helper for transfer
  async function requestTransfer(body) {
    const res = createResponse();
    await controller.transferShippingServiceFunds({ body }, res);
    return res;
  }

  // Test 1: Successful transfer for service_fee
  queryRows = [{ _id: "tx1", amount: 10.50 }, { _id: "tx2", amount: 2.00 }];
  lastUpdateFilter = null;
  lastUpdateData = null;

  let transResponse = await requestTransfer({ type: "service_fee", amount: 12.50 });
  assert.equal(transResponse.statusCode, 200);
  assert.equal(transResponse.body.success, true);
  assert.equal(transResponse.body.amount, 12.50);
  assert.equal(transResponse.body.count, 2);
  assert.deepEqual(lastUpdateFilter, { _id: { $in: ["tx1", "tx2"] } });
  assert.deepEqual(lastUpdateData, { $set: { status: "Completed", paid_out: true } });

  // Test 2: Invalid type validation
  transResponse = await requestTransfer({ type: "order", amount: 12.50 });
  assert.equal(transResponse.statusCode, 400);
  assert.match(transResponse.body.message, /type must be shipping_deduction or service_fee/);

  // Test 3: Invalid amount validation
  transResponse = await requestTransfer({ type: "service_fee", amount: -5 });
  assert.equal(transResponse.statusCode, 400);
  assert.match(transResponse.body.message, /amount must be a positive number/);

  // Test 4: Amount mismatch
  queryRows = [{ _id: "tx1", amount: 10.00 }];
  transResponse = await requestTransfer({ type: "service_fee", amount: 12.50 });
  assert.equal(transResponse.statusCode, 400);
  assert.match(transResponse.body.message, /Amount mismatch/);

  // Test 5: Exception handling
  const originalTransferConsoleError = console.error;
  console.error = () => {};
  queryError = new Error("database crash");
  transResponse = await requestTransfer({ type: "service_fee", amount: 12.50 });
  assert.equal(transResponse.statusCode, 500);
  assert.equal(transResponse.body.message, "Failed to transfer/clear shipping service funds");
  console.error = originalTransferConsoleError;
  queryError = null;

  console.log("pending service endpoint tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
