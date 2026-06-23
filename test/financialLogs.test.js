const assert = require("node:assert/strict");

function resolvedQuery(value) {
  const query = {
    select() {
      return this;
    },
    lean() {
      return this;
    },
    skip() {
      return this;
    },
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    maxTimeMS() {
      return Promise.resolve(value);
    },
  };
  return query;
}

function mockModel(relativePath, exports) {
  const modelPath = require.resolve(relativePath);
  require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports,
  };
}

// Mock logsModel
const mockLogs = [
  {
    _id: "log_1",
    user: "user_1",
    log_data: JSON.stringify({
      type: "STRIPE_TRANSFER_SUCCESS",
      transferId: "tr_1",
      amount: 100,
    }),
    date: Date.now(),
  },
  {
    _id: "log_2",
    user: "user_1",
    log_data: JSON.stringify({
      type: "STRIPE_TRANSFER_FAILED",
      errorCode: "card_declined",
      errorMessage: "Card declined",
    }),
    date: Date.now(),
  },
];

mockModel("../src/models/activity_logs", {
  find(query) {
    let filtered = mockLogs;
    if (query?.log_data?.$regex) {
      const typeRegex = new RegExp(query.log_data.$regex, "i");
      filtered = mockLogs.filter((log) => typeRegex.test(log.log_data));
    }
    return resolvedQuery(filtered);
  },
  countDocuments(query) {
    let filtered = mockLogs;
    if (query?.log_data?.$regex) {
      const typeRegex = new RegExp(query.log_data.$regex, "i");
      filtered = mockLogs.filter((log) => typeRegex.test(log.log_data));
    }
    return resolvedQuery(filtered.length);
  },
});

mockModel("../src/models/user", {});
mockModel("../src/models/room", {});
mockModel("../src/models/order", {});
mockModel("../src/models/item", {});
mockModel("../src/models/templates", {});

const controller = require("../src/controllers/adminRead");

function createResponse() {
  return {
    statusCode: null,
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

async function call(handler, query = {}) {
  const req = {
    query,
    originalUrl: "/admin/financial-logs",
    user: { _id: "admin", role: "admin", _authType: "admin" },
  };
  const res = createResponse();
  await handler(req, res);
  return res;
}

void (async () => {
  // Test 1: Fetch all logs (no filter)
  let response = await call(controller.getFinancialLogs);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totalDoc, 2);
  assert.equal(response.body.logs.length, 2);

  // Test 2: Filter by STRIPE_TRANSFER_FAILED
  response = await call(controller.getFinancialLogs, { type: "STRIPE_TRANSFER_FAILED" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totalDoc, 1);
  assert.equal(response.body.logs.length, 1);
  const parsedData = JSON.parse(response.body.logs[0].log_data);
  assert.equal(parsedData.type, "STRIPE_TRANSFER_FAILED");
  assert.equal(parsedData.errorCode, "card_declined");

  // Test 3: Filter by non-existent type
  response = await call(controller.getFinancialLogs, { type: "ORDER_REFUND_SUCCESS" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totalDoc, 0);
  assert.equal(response.body.logs.length, 0);

  console.log("financial log controller tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
