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

let logsCount = 0;
let createdLog = null;
let lastQueryFilter = null;
let lastSortValue = null;
let lastSkipValue = null;
let lastLimitValue = null;
let testLogs = [];

function createFindQuery() {
  return {
    sort(val) {
      lastSortValue = val;
      return this;
    },
    skip(val) {
      lastSkipValue = val;
      return this;
    },
    limit(val) {
      lastLimitValue = val;
      return this;
    },
    lean() {
      return this;
    },
    maxTimeMS() {
      return Promise.resolve(testLogs);
    },
  };
}

// Mock ApplicationLog model
mockModule("../src/models/applicationLog", {
  create(data) {
    createdLog = data;
    return Promise.resolve(data);
  },
  countDocuments(filter) {
    lastQueryFilter = filter;
    return {
      maxTimeMS() {
        return Promise.resolve(logsCount);
      },
    };
  },
  find(filter) {
    lastQueryFilter = filter;
    return createFindQuery();
  },
});

mockModule("../src/shared/adminRequestLog", {
  logAdminEndpointError() {},
});

const controller = require("../src/controllers/applicationLog");

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

void (async () => {
  // Test Case 1: Validation failure - missing platform
  let res = createResponse();
  await controller.submitClientLog({
    body: {
      appVersion: "1.0.0",
      message: "Test error",
      clientTimestamp: Date.now(),
    },
    headers: {},
    socket: {},
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /platform is required/);

  // Test Case 2: Validation failure - invalid platform
  res = createResponse();
  await controller.submitClientLog({
    body: {
      platform: "nintendo",
      appVersion: "1.0.0",
      message: "Test error",
      clientTimestamp: Date.now(),
    },
    headers: {},
    socket: {},
  }, res);
  assert.equal(res.statusCode, 400);

  // Test Case 3: Validation failure - missing message
  res = createResponse();
  await controller.submitClientLog({
    body: {
      platform: "android",
      appVersion: "1.0.0",
      clientTimestamp: Date.now(),
    },
    headers: {},
    socket: {},
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /message is required/);

  // Test Case 4: Successful log submission - Fire-and-Forget
  createdLog = null;
  res = createResponse();
  const timestamp = Date.now();
  await controller.submitClientLog({
    body: {
      platform: "ios",
      appVersion: "1.0.2",
      buildNumber: "12",
      message: "Something went wrong",
      stackTrace: "Error stack here...",
      clientTimestamp: timestamp,
      screenName: "Home",
      extraDetails: { orderId: "123" },
    },
    headers: {
      "user-agent": "iOS test client",
      "x-forwarded-for": "192.168.1.1",
    },
    socket: {},
    user: { id: "user-123", userName: "buyer_test", email: "test@buyer.com" },
  }, res);

  assert.equal(res.statusCode, 202); // 202 Accepted
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Log queued");

  // Wait a split second to allow asynchronous create to populate createdLog
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.ok(createdLog);
  assert.equal(createdLog.platform, "ios");
  assert.equal(createdLog.appVersion, "1.0.2");
  assert.equal(createdLog.buildNumber, "12");
  assert.equal(createdLog.message, "Something went wrong");
  assert.equal(createdLog.stackTrace, "Error stack here...");
  assert.equal(createdLog.clientTimestamp, timestamp);
  assert.equal(createdLog.screenName, "Home");
  assert.deepEqual(createdLog.extraDetails, { orderId: "123" });
  assert.equal(createdLog.ipAddress, "192.168.1.1");
  assert.equal(createdLog.userAgent, "iOS test client");
  // Check optional user context extraction from req.user
  assert.equal(createdLog.userId, "user-123");
  assert.equal(createdLog.userName, "buyer_test");
  assert.equal(createdLog.email, "test@buyer.com");

  // Test Case 5: Payload truncation verification
  createdLog = null;
  res = createResponse();
  const hugeMessage = "A".repeat(3000);
  const hugeStack = "B".repeat(12000);
  await controller.submitClientLog({
    body: {
      platform: "dashboard",
      appVersion: "2.1.0",
      message: hugeMessage,
      stackTrace: hugeStack,
      clientTimestamp: Date.now(),
    },
    headers: {},
    socket: {},
  }, res);

  assert.equal(res.statusCode, 202);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(createdLog);
  assert.equal(createdLog.message.length, 2000); // Truncated to 2000
  assert.equal(createdLog.stackTrace.length, 10000); // Truncated to 10000

  // Test Case 6: Admin Logs Querying with filters
  testLogs = [
    { platform: "android", level: "error", message: "Failure 1" },
    { platform: "android", level: "fatal", message: "Crash 2" },
  ];
  logsCount = 2;

  res = createResponse();
  await controller.getAdminClientLogs({
    query: {
      platform: "android",
      level: "error",
      search: "Failure",
      page: "1",
      limit: "10",
      datefrom: "2026-06-01",
      dateto: "2026-06-15",
    },
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.logs, testLogs);
  assert.equal(res.body.totalDocuments, 2);
  assert.equal(res.body.totalPages, 1);
  assert.equal(res.body.currentPage, 1);
  assert.equal(lastLimitValue, 10);
  assert.equal(lastSkipValue, 0);

  // Assert query filters were correctly applied to database find call
  assert.equal(lastQueryFilter.platform, "android");
  assert.equal(lastQueryFilter.level, "error");
  assert.ok(lastQueryFilter.$or);
  assert.ok(lastQueryFilter.createdAt.$gte instanceof Date);
  assert.ok(lastQueryFilter.createdAt.$lte instanceof Date);

  console.log("applicationLog controller unit tests passed successfully!");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
