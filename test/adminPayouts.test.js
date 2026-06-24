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

let rows = [];
let total = 0;
let lastFilter = null;
let lastSkip = null;
let lastLimit = null;

let lastUserUpdateFilter = null;
let lastUserUpdate = null;
let mockUser = null;
let lastUpdateFilter = null;
let lastUpdate = null;
let lastUserId = null;

function createFindQuery() {
  return {
    populate() {
      return this;
    },
    sort() {
      return this;
    },
    skip(value) {
      lastSkip = value;
      return this;
    },
    limit(value) {
      lastLimit = value;
      return this;
    },
    lean() {
      return this;
    },
    maxTimeMS() {
      return Promise.resolve(rows);
    },
  };
}

mockModule("../src/models/transaction", {
  countDocuments(filter) {
    lastFilter = filter;
    return {
      maxTimeMS() {
        return Promise.resolve(total);
      },
    };
  },
  find(filter) {
    lastFilter = filter;
    return createFindQuery();
  },
  updateMany(filter, update) {
    lastUpdateFilter = filter;
    lastUpdate = update;
    return {
      maxTimeMS() {
        return Promise.resolve({ modifiedCount: 1 });
      }
    };
  }
});

mockModule("../src/models/user", {
  findById(id) {
    lastUserId = id;
    return {
      maxTimeMS() {
        return Promise.resolve(mockUser);
      }
    };
  },
  updateOne(filter, update) {
    lastUserUpdateFilter = filter;
    lastUserUpdate = update;
    return {
      maxTimeMS() {
        return Promise.resolve({ modifiedCount: 1 });
      }
    };
  }
});

mockModule("../src/shared/adminRequestLog", {
  logAdminEndpointError() {},
});

const controller = require("../src/controllers/adminPayouts");

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

async function request(query = {}) {
  const res = createResponse();
  await controller.getStripePayouts({ query }, res);
  return res;
}

void (async () => {
  // Test normalizePagination
  assert.deepEqual(controller.normalizePagination("2", "500"), {
    page: 2,
    limit: 100,
    skip: 100,
  });

  // Test getStripePayouts
  let response = await request({ page: "1", limit: "10" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.payouts, []);
  assert.deepEqual(response.body.transactions, []);
  assert.equal(response.body.totalDocuments, 0);
  assert.deepEqual(lastFilter, { type: "payout" });
  assert.equal(lastSkip, 0);
  assert.equal(lastLimit, 10);

  // Test getStripePayouts handles missing users with fallback
  rows = [{ _id: "payout-1", type: "payout", amount: 25, from: null, to: null }];
  total = 11;
  response = await request({ page: "2", limit: "10" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.totalPages, 2);
  assert.equal(response.body.currentPage, 2);
  assert.equal(lastSkip, 10);
  assert.deepEqual(response.body.payouts[0].from, {
    userName: "Deleted User",
    email: "N/A",
    firstName: "Deleted",
    lastName: "User",
    profilePhoto: ""
  });
  assert.deepEqual(response.body.payouts[0].to, {
    userName: "Deleted User",
    email: "N/A",
    firstName: "Deleted",
    lastName: "User",
    profilePhoto: ""
  });

  response = await request({ datefrom: "not-a-date" });
  assert.equal(response.statusCode, 400);

  response = await request({
    datefrom: "2026-06-01",
    dateto: "2026-06-11",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(typeof lastFilter.date.$gte, "number");
  assert.equal(typeof lastFilter.date.$lte, "number");

  // Test resolveOrphanPayout validations
  let resolveRes = createResponse();
  await controller.resolveOrphanPayout({ body: {} }, resolveRes);
  assert.equal(resolveRes.statusCode, 400);

  resolveRes = createResponse();
  await controller.resolveOrphanPayout({ body: { oldUserId: "123", action: "invalid" } }, resolveRes);
  assert.equal(resolveRes.statusCode, 400);

  resolveRes = createResponse();
  await controller.resolveOrphanPayout({ body: { oldUserId: "123", action: "reassign" } }, resolveRes);
  assert.equal(resolveRes.statusCode, 400);

  // Test resolveOrphanPayout - no transactions found
  rows = [];
  resolveRes = createResponse();
  await controller.resolveOrphanPayout({ body: { oldUserId: "old-1", action: "cancel" } }, resolveRes);
  assert.equal(resolveRes.statusCode, 404);

  // Test resolveOrphanPayout - cancel action success
  rows = [{ _id: "tx-1", amount: 10.5 }, { _id: "tx-2", amount: 20 }];
  resolveRes = createResponse();
  await controller.resolveOrphanPayout({ body: { oldUserId: "old-1", action: "cancel" } }, resolveRes);
  assert.equal(resolveRes.statusCode, 200);
  assert.deepEqual(lastUpdateFilter, { _id: { $in: ["tx-1", "tx-2"] } });
  assert.deepEqual(lastUpdate, { $set: { status: "Failed", payment_available: false } });
  assert.equal(resolveRes.body.data.count, 2);
  assert.equal(resolveRes.body.data.totalAmount, 30.5);

  // Test resolveOrphanPayout - reassign new user not found
  mockUser = null;
  resolveRes = createResponse();
  await controller.resolveOrphanPayout({ body: { oldUserId: "old-1", action: "reassign", newUserId: "new-1" } }, resolveRes);
  assert.equal(resolveRes.statusCode, 404);

  // Test resolveOrphanPayout - reassign success
  mockUser = { _id: "new-1", userName: "active_user", walletPending: 50 };
  resolveRes = createResponse();
  await controller.resolveOrphanPayout({ body: { oldUserId: "old-1", action: "reassign", newUserId: "new-1" } }, resolveRes);
  assert.equal(resolveRes.statusCode, 200);
  assert.deepEqual(lastUpdateFilter, { _id: { $in: ["tx-1", "tx-2"] } });
  assert.deepEqual(lastUpdate, { $set: { to: "new-1" } });
  assert.deepEqual(lastUserUpdateFilter, { _id: "new-1" });
  assert.deepEqual(lastUserUpdate, { $inc: { walletPending: 30.5 } });
  assert.equal(resolveRes.body.data.count, 2);
  assert.equal(resolveRes.body.data.totalAmount, 30.5);

  console.log("admin payouts tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
