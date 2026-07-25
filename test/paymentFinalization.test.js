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

mockModule("../src/shared/send_notification", { sendPushNotification() {} });
mockModule("../src/shared/socketEmitter", { emitTo() {} });
mockModule("../src/shared/livekit", { stopEgress: async () => {} });
class ActivityLogMock { async save() {} }
mockModule("../src/models/activity_logs", ActivityLogMock);

const userModel = require("../src/models/user");
const productModel = require("../src/models/product");
const transactionModel = require("../src/models/transaction");
const orderModel = require("../src/models/order");
const itemModel = require("../src/models/item");
const roomsModel = require("../src/models/room");
const referralLogModel = require("../src/models/referral_log");
const { finalizeOrder } = require("../src/shared/functions");

const originals = {
  userExists: userModel.exists,
  userFindOneAndUpdate: userModel.findOneAndUpdate,
  productFindOneAndUpdate: productModel.findOneAndUpdate,
  transactionFindOne: transactionModel.findOne,
  transactionCreate: transactionModel.create,
  orderFindById: orderModel.findById,
  itemFindById: itemModel.findById,
  roomFindByIdAndUpdate: roomsModel.findByIdAndUpdate,
  referralUpdateOne: referralLogModel.updateOne,
};

async function runFinalization({
  earnings = 15,
  shipping = null,
  sellerState = "valid",
  inventoryAvailable = true,
  existingTransaction = null,
} = {}) {
  const writes = { inventory: 0, wallet: 0, transactions: [] };
  userModel.exists = async (filter) => {
    if (filter.$or) return sellerState === "valid" ? { _id: "seller-1" } : null;
    return sellerState === "missing" ? null : { _id: "seller-1" };
  };
  userModel.findOneAndUpdate = async (_filter, update) => {
    writes.wallet += update.$inc.walletPending;
    return { _id: "seller-1", walletPending: writes.wallet };
  };
  productModel.findOneAndUpdate = async () => {
    writes.inventory += 1;
    return inventoryAvailable ? { _id: "product-1", quantity: 4 } : null;
  };
  transactionModel.findOne = async () => existingTransaction;
  transactionModel.create = async (document) => {
    writes.transactions.push(document);
    return document;
  };
  orderModel.findById = async () => ({
    _id: "original-order",
    seller: "seller-1",
    customer: "buyer-1",
  });
  itemModel.findById = async () => ({ _id: "original-item" });
  roomsModel.findByIdAndUpdate = async () => null;
  referralLogModel.updateOne = async () => ({ modifiedCount: 1 });

  const result = await finalizeOrder({
    order: {
      _id: "order-1",
      seller: "seller-1",
      customer: "buyer-1",
      invoice: 100,
      payment_status: "processing",
      shipping_fee: 0,
      stripe_fees: 1,
      extra_charges: 0,
      discount: 0,
    },
    item: { _id: "item-1", quantity: 1 },
    productres: { _id: "product-1", tokshow: null, flash_sale: false },
    charge: { id: "ch_test", balance_transaction: { id: "txn_test" } },
    balanceTx: { available_on: 123 },
    earnings,
    subtotal: 20,
    serviceFee: 4,
    tax: 0,
    shipping,
    stripe_fee: 1,
    paymentIntentId: "pi_test",
    paymentAttemptId: "attempt_test",
  });
  return { result, writes };
}

void (async () => {
  try {
    const buyNow = await runFinalization();
    assert.strictEqual(buyNow.result.success, true);
    assert.strictEqual(buyNow.writes.wallet, 15);
    assert.strictEqual(
      buyNow.writes.transactions.filter((transaction) => transaction.type === "order").length,
      1
    );

    const noShipping = await runFinalization({ shipping: null });
    assert.strictEqual(noShipping.result.success, true);
    const withShipping = await runFinalization({
      shipping: { amount: 5, totalWeightOz: 2, seller_shipping_fee_pay: 0 },
    });
    assert.strictEqual(
      withShipping.writes.transactions.some((transaction) => transaction.type === "shipping_deduction"),
      true
    );

    const zeroEarnings = await runFinalization({ earnings: 0 });
    assert.strictEqual(zeroEarnings.writes.wallet, 0);

    await assert.rejects(
      runFinalization({ sellerState: "null" }),
      (error) => error.code === "INVALID_WALLET_PENDING"
    );
    await assert.rejects(
      runFinalization({ sellerState: "missing" }),
      (error) => error.code === "SELLER_NOT_FOUND_DURING_PAYMENT_RECORDING"
    );
    await assert.rejects(
      runFinalization({ inventoryAvailable: false }),
      (error) => error.code === "INSUFFICIENT_INVENTORY_DURING_FINALIZATION"
    );

    const replay = await runFinalization({
      existingTransaction: { orderId: "original-order", itemId: "original-item" },
    });
    assert.strictEqual(replay.result.idempotentReplay, true);
    assert.strictEqual(replay.writes.wallet, 0);
    assert.strictEqual(replay.writes.inventory, 0);
    assert.strictEqual(replay.writes.transactions.length, 0);

    console.log("paymentFinalization tests passed");
  } finally {
    userModel.exists = originals.userExists;
    userModel.findOneAndUpdate = originals.userFindOneAndUpdate;
    productModel.findOneAndUpdate = originals.productFindOneAndUpdate;
    transactionModel.findOne = originals.transactionFindOne;
    transactionModel.create = originals.transactionCreate;
    orderModel.findById = originals.orderFindById;
    itemModel.findById = originals.itemFindById;
    roomsModel.findByIdAndUpdate = originals.roomFindByIdAndUpdate;
    referralLogModel.updateOne = originals.referralUpdateOne;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
