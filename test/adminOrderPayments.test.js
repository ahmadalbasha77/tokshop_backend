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

const orderId = "6a2882e8f302ca59efad59d9";
let order = { _id: orderId, status: "processing", seller: "seller-1" };
let transactions = [];
let transactionUpdate = null;
let releaseCalls = [];
let releases = [];

function queryResult(value) {
  return {
    select() {
      return this;
    },
    lean() {
      return this;
    },
    maxTimeMS() {
      return Promise.resolve(value);
    },
  };
}

mockModule("../src/models/order", {
  findById(id) {
    assert.equal(id, orderId);
    return queryResult(order);
  },
});
mockModule("../src/models/transaction", {
  find(filter) {
    assert.equal(filter.orderId, orderId);
    assert.equal(filter.type, "order");
    return queryResult(transactions);
  },
  updateMany(filter, update) {
    transactionUpdate = { filter, update };
    return Promise.resolve({ modifiedCount: filter._id.$in.length });
  },
});
mockModule("../src/shared/orderPaymentRelease", {
  releaseEligibleOrderPayments(options) {
    releaseCalls.push(options);
    return Promise.resolve(releases);
  },
});
mockModule("../src/shared/adminRequestLog", {
  logAdminEndpointError() {},
});

const controller = require("../src/controllers/adminOrderPayments");

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

async function request(handler, requestedOrderId = orderId) {
  const req = {
    params: { orderId: requestedOrderId },
    user: { _id: "admin-1" },
  };
  const res = createResponse();
  await handler(req, res);
  return res;
}

void (async () => {
  let response = await request(controller.getOrderFundsStatus, "invalid");
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, "INVALID_ORDER_ID");

  order = null;
  response = await request(controller.getOrderFundsStatus);
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, "ORDER_NOT_FOUND");

  order = { _id: orderId, status: "processing", seller: "seller-1" };
  transactions = [];
  response = await request(controller.getOrderFundsStatus);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.releasable, false);
  assert.equal(response.body.data.blockReason, "NO_ORDER_TRANSACTIONS");

  transactions = [
    {
      _id: "transaction-1",
      amount: 0.66,
      status: "Completed",
      payment_available: false,
      paid_out: false,
    },
  ];
  response = await request(controller.releaseOrderFunds);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "STRIPE_FUNDS_NOT_AVAILABLE");
  assert.equal(releaseCalls.length, 0);

  transactions[0].payment_available = true;
  releases = [
    {
      sellerId: "seller-1",
      totalAmount: 0.66,
      netAmount: 0.66,
      transferId: "tr_admin_release",
    },
  ];
  response = await request(controller.releaseOrderFunds);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.totalReleased, 0.66);
  assert.deepEqual(releaseCalls[0], {
    orderIds: [orderId],
    requireDelivered: false,
  });
  assert.deepEqual(transactionUpdate.update, {
    $set: { order_fulfilled: true },
  });

  transactions[0].paid_out = true;
  response = await request(controller.releaseOrderFunds);
  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, "ALREADY_RELEASED");
  assert.equal(releaseCalls.length, 1);

  console.log("admin order payments tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
