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
  assert.deepEqual(controller.normalizePagination("2", "500"), {
    page: 2,
    limit: 100,
    skip: 100,
  });

  let response = await request({ page: "1", limit: "10" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.payouts, []);
  assert.deepEqual(response.body.transactions, []);
  assert.equal(response.body.totalDocuments, 0);
  assert.deepEqual(lastFilter, { type: "payout" });
  assert.equal(lastSkip, 0);
  assert.equal(lastLimit, 10);

  rows = [{ _id: "payout-1", type: "payout", amount: 25 }];
  total = 11;
  response = await request({ page: "2", limit: "10" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.payouts, rows);
  assert.equal(response.body.totalPages, 2);
  assert.equal(response.body.currentPage, 2);
  assert.equal(lastSkip, 10);

  response = await request({ datefrom: "not-a-date" });
  assert.equal(response.statusCode, 400);

  response = await request({
    datefrom: "2026-06-01",
    dateto: "2026-06-11",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(typeof lastFilter.date.$gte, "number");
  assert.equal(typeof lastFilter.date.$lte, "number");

  console.log("admin payouts tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
