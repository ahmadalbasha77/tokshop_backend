const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const orderModel = require("../src/models/order");
const itemModel = require("../src/models/item");
const productModel = require("../src/models/product");
const userModel = require("../src/models/user");
const transactionModel = require("../src/models/transaction");
const paymentAttemptModel = require("../src/models/payment_attempt");
const {
  finalizeSuccessfulPaymentAttempt,
  reconcileNextEligiblePaymentAttempt,
  runLocalTransactionWithRetry,
} = require("../src/shared/paymentFinalization");

process.env.PAYMENT_FINALIZATION_TRANSACTIONS_ENABLED = "true";

let replSet;

function ids() {
  return {
    attemptId: `order_payment_${new mongoose.Types.ObjectId()}`,
    orderId: new mongoose.Types.ObjectId(),
    itemId: new mongoose.Types.ObjectId(),
    buyerId: new mongoose.Types.ObjectId(),
    sellerId: new mongoose.Types.ObjectId(),
    productId: new mongoose.Types.ObjectId(),
    paymentIntentId: `pi_test_${new mongoose.Types.ObjectId()}`,
  };
}

async function resetDatabase() {
  await Promise.all([
    orderModel.deleteMany({}),
    itemModel.deleteMany({}),
    productModel.deleteMany({}),
    userModel.deleteMany({}),
    transactionModel.deleteMany({}),
    paymentAttemptModel.deleteMany({}),
  ]);
}

async function seedAttempt({
  recordingStatus = "stripe_succeeded",
  walletPending = 0,
  inventory = 5,
  activationAt = new Date(),
  refunded = false,
  disputed = false,
  canceled = false,
} = {}) {
  const value = ids();
  await userModel.collection.insertMany([
    { _id: value.buyerId, email: `${value.buyerId}@test.local`, walletPending: 0 },
    { _id: value.sellerId, email: `${value.sellerId}@test.local`, walletPending },
  ]);
  await productModel.collection.insertOne({
    _id: value.productId,
    ownerId: value.sellerId,
    quantity: inventory,
    salesCount: 0,
    order_reference_counter: 1,
  });

  const orderData = {
    _id: value.orderId,
    customer: value.buyerId,
    seller: value.sellerId,
    invoice: 101,
    date: Date.now(),
    earnings: 15,
    items: [],
    shipping_fee: 0,
    service_fee: 4,
    stripe_fees: 1,
    subtotal: 20,
    tax: 0,
    ordertype: "marketplace",
    bundleId: null,
    seller_shipping_fee_pay: 0,
    total_shipping_cost: 0,
    discount: 0,
    paymentIntentId: value.paymentIntentId,
    paymentIntentIds: [value.paymentIntentId],
    paymentAttemptId: value.attemptId,
  };
  const itemData = {
    _id: value.itemId,
    productId: value.productId,
    customer: value.buyerId,
    seller: value.sellerId,
    earnings: 15,
    quantity: 1,
    chargeId: "ch_test",
    paymentIntentId: value.paymentIntentId,
    paymentAttemptId: value.attemptId,
    price: 20,
    ordertype: "marketplace",
    shipping_fee: 0,
    seller_shipping_fee_pay: 0,
  };
  await paymentAttemptModel.create({
    _id: value.attemptId,
    orderId: value.orderId,
    itemId: value.itemId,
    buyerId: value.buyerId,
    sellerId: value.sellerId,
    productId: value.productId,
    flow: "marketplace",
    paymentIntentId: value.paymentIntentId,
    stripeStatus: "succeeded",
    recordingStatus,
    orderData,
    itemData,
    shippingData: { amount: 0 },
    earnings: 15,
    subtotal: 20,
    serviceFee: 4,
    stripeFee: 1,
    extraCharges: 0,
    tax: 0,
    chargeId: "ch_test",
    balanceTransactionId: "txn_test",
    availableOn: Date.now(),
    transactionalFinalization: true,
    activationAt,
    refunded,
    disputed,
    canceled,
  });
  return value;
}

async function financialState(value) {
  const [orderCount, itemCount, transactionCount, product, seller, attempt] =
    await Promise.all([
      orderModel.countDocuments({ _id: value.orderId }),
      itemModel.countDocuments({ _id: value.itemId }),
      transactionModel.countDocuments({ paymentAttemptId: value.attemptId, type: "order" }),
      productModel.findById(value.productId).lean(),
      userModel.findById(value.sellerId).lean(),
      paymentAttemptModel.findById(value.attemptId).lean(),
    ]);
  return { orderCount, itemCount, transactionCount, product, seller, attempt };
}

async function assertRolledBack(value, { preexistingOrder = false } = {}) {
  const state = await financialState(value);
  assert.strictEqual(state.orderCount, preexistingOrder ? 1 : 0);
  assert.strictEqual(state.itemCount, 0);
  assert.strictEqual(state.transactionCount, 0);
  assert.strictEqual(state.product.quantity, 5);
  assert.strictEqual(Number(state.seller.walletPending || 0), 0);
  assert.strictEqual(state.attempt.recordingStatus, "needs_reconciliation");
}

async function run() {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replSet.getUri(), { dbName: "payment-finalization-test" });
  await Promise.all([
    orderModel.createCollection(),
    itemModel.createCollection(),
    productModel.createCollection(),
    userModel.createCollection(),
    transactionModel.createCollection(),
    paymentAttemptModel.createCollection(),
  ]);

  // 1. Commit all writes and idempotent replay after the response is lost.
  await resetDatabase();
  let value = await seedAttempt();
  const first = await finalizeSuccessfulPaymentAttempt(value.attemptId);
  const replay = await finalizeSuccessfulPaymentAttempt(value.attemptId);
  let state = await financialState(value);
  assert.strictEqual(first.success, true);
  assert.strictEqual(replay.idempotentReplay, true);
  assert.strictEqual(replay.orderId.toString(), first.orderId.toString());
  assert.strictEqual(state.orderCount, 1);
  assert.strictEqual(state.itemCount, 1);
  assert.strictEqual(state.transactionCount, 1);
  assert.strictEqual(state.product.quantity, 4);
  assert.strictEqual(state.seller.walletPending, 15);
  assert.strictEqual(state.attempt.recordingStatus, "recorded");
  assert.ok(state.attempt.transactionId);

  // 2. Order create failure rolls back the Item written earlier in the transaction.
  await resetDatabase();
  value = await seedAttempt();
  await orderModel.collection.insertOne({ _id: value.orderId, status: "payment_failed" });
  await assert.rejects(finalizeSuccessfulPaymentAttempt(value.attemptId));
  await assertRolledBack(value, { preexistingOrder: true });

  // 3. Inventory failure rolls back Order and Item.
  await resetDatabase();
  value = await seedAttempt({ inventory: 0 });
  await assert.rejects(
    finalizeSuccessfulPaymentAttempt(value.attemptId),
    (error) => error.code === "INSUFFICIENT_INVENTORY_DURING_FINALIZATION"
  );
  state = await financialState(value);
  assert.strictEqual(state.orderCount, 0);
  assert.strictEqual(state.itemCount, 0);
  assert.strictEqual(state.transactionCount, 0);
  assert.strictEqual(state.product.quantity, 0);
  assert.strictEqual(state.seller.walletPending, 0);

  // 4. walletPending failure rolls back Order, Item, and Inventory.
  await resetDatabase();
  value = await seedAttempt({ walletPending: null });
  await assert.rejects(
    finalizeSuccessfulPaymentAttempt(value.attemptId),
    (error) => error.code === "INVALID_WALLET_PENDING"
  );
  state = await financialState(value);
  assert.strictEqual(state.orderCount, 0);
  assert.strictEqual(state.itemCount, 0);
  assert.strictEqual(state.transactionCount, 0);
  assert.strictEqual(state.product.quantity, 5);
  assert.strictEqual(state.seller.walletPending, null);

  // 5. Earnings Transaction failure rolls back the preceding wallet $inc.
  await resetDatabase();
  value = await seedAttempt();
  const originalTransactionCreate = transactionModel.create;
  transactionModel.create = async function (_docs, options) {
    if (options?.session) throw new Error("injected transaction create failure");
    return originalTransactionCreate.apply(transactionModel, arguments);
  };
  await assert.rejects(finalizeSuccessfulPaymentAttempt(value.attemptId));
  transactionModel.create = originalTransactionCreate;
  await assertRolledBack(value);

  // 6. PaymentAttempt update failure rolls back every preceding write.
  await resetDatabase();
  value = await seedAttempt();
  const originalAttemptUpdate = paymentAttemptModel.updateOne;
  paymentAttemptModel.updateOne = async (filter, update, options) => {
    if (options?.session) return { matchedCount: 1, modifiedCount: 0 };
    return originalAttemptUpdate.call(paymentAttemptModel, filter, update, options);
  };
  await assert.rejects(
    finalizeSuccessfulPaymentAttempt(value.attemptId),
    (error) => error.code === "PAYMENT_ATTEMPT_RECORDING_UPDATE_FAILED"
  );
  paymentAttemptModel.updateOne = originalAttemptUpdate;
  await assertRolledBack(value);

  // 7. A Stripe-succeeded retry reuses the existing failed Order and Item.
  await resetDatabase();
  value = await seedAttempt();
  await paymentAttemptModel.updateOne(
    { _id: value.attemptId },
    { $set: { flow: "retry" } }
  );
  await orderModel.create({
    _id: value.orderId,
    customer: value.buyerId,
    seller: value.sellerId,
    items: [value.itemId],
    status: "payment_failed",
    payment_status: "failed",
    subtotal: 20,
    earnings: 15,
  });
  await itemModel.create({
    _id: value.itemId,
    orderId: value.orderId,
    productId: value.productId,
    customer: value.buyerId,
    seller: value.sellerId,
    quantity: 1,
    status: "payment_failed",
  });
  await finalizeSuccessfulPaymentAttempt(value.attemptId);
  state = await financialState(value);
  assert.strictEqual(state.orderCount, 1);
  assert.strictEqual(state.itemCount, 1);
  assert.strictEqual(state.transactionCount, 1);
  assert.strictEqual(state.seller.walletPending, 15);
  assert.strictEqual((await orderModel.findById(value.orderId)).payment_status, "paid");

  // 8. Two concurrent calls commit one financial unit and return one Order.
  await resetDatabase();
  value = await seedAttempt();
  const concurrent = await Promise.all([
    finalizeSuccessfulPaymentAttempt(value.attemptId),
    finalizeSuccessfulPaymentAttempt(value.attemptId),
  ]);
  state = await financialState(value);
  assert.strictEqual(concurrent[0].orderId.toString(), concurrent[1].orderId.toString());
  assert.strictEqual(state.orderCount, 1);
  assert.strictEqual(state.itemCount, 1);
  assert.strictEqual(state.transactionCount, 1);
  assert.strictEqual(state.seller.walletPending, 15);

  // 9. A labeled transient error retries only the local transaction body.
  let transientRuns = 0;
  await runLocalTransactionWithRetry(async (session) => {
    transientRuns += 1;
    await productModel.updateOne(
      { _id: value.productId },
      { $inc: { salesCount: 1 } },
      { session }
    );
    if (transientRuns === 1) {
      const error = new Error("transient");
      error.errorLabels = ["TransientTransactionError"];
      throw error;
    }
  });
  assert.strictEqual(transientRuns, 2);

  // 10. Unknown commit result retries commit, not the transaction body.
  const originalStartSession = mongoose.startSession;
  let transactionBodyRuns = 0;
  let unknownInjected = false;
  mongoose.startSession = async (...args) => {
    const session = await originalStartSession.apply(mongoose, args);
    const originalCommit = session.commitTransaction.bind(session);
    session.commitTransaction = async () => {
      if (!unknownInjected) {
        unknownInjected = true;
        await originalCommit();
        const error = new Error("unknown commit result");
        error.errorLabels = ["UnknownTransactionCommitResult"];
        throw error;
      }
      return originalCommit();
    };
    return session;
  };
  await runLocalTransactionWithRetry(async (session) => {
    transactionBodyRuns += 1;
    await productModel.updateOne(
      { _id: value.productId },
      { $inc: { salesCount: 1 } },
      { session }
    );
  });
  mongoose.startSession = originalStartSession;
  assert.strictEqual(transactionBodyRuns, 1);

  // 11. A post-commit side-effect failure cannot roll back or duplicate money.
  await resetDatabase();
  value = await seedAttempt();
  await finalizeSuccessfulPaymentAttempt(value.attemptId);
  await assert.rejects(Promise.reject(new Error("simulated socket failure")));
  await finalizeSuccessfulPaymentAttempt(value.attemptId);
  state = await financialState(value);
  assert.strictEqual(state.transactionCount, 1);
  assert.strictEqual(state.seller.walletPending, 15);

  // 12. needs_reconciliation performs local finalization without Stripe.
  await resetDatabase();
  value = await seedAttempt({ recordingStatus: "needs_reconciliation" });
  await finalizeSuccessfulPaymentAttempt(value.attemptId);
  state = await financialState(value);
  assert.strictEqual(state.attempt.recordingStatus, "recorded");
  assert.strictEqual(state.seller.walletPending, 15);

  // 13. Only one worker can claim a new, explicitly verified attempt.
  await resetDatabase();
  process.env.PAYMENT_FINALIZATION_ACTIVATION_AT = "2026-01-01T00:00:00.000Z";
  value = await seedAttempt({ recordingStatus: "needs_reconciliation" });
  await paymentAttemptModel.updateOne(
    { _id: value.attemptId },
    { $set: { reconciliationEligibility: "clear" } }
  );
  const workerResults = await Promise.all([
    reconcileNextEligiblePaymentAttempt(),
    reconcileNextEligiblePaymentAttempt(),
  ]);
  assert.strictEqual(workerResults.filter(Boolean).length, 1);
  state = await financialState(value);
  assert.strictEqual(state.transactionCount, 1);
  assert.strictEqual(state.seller.walletPending, 15);

  // 14. Attempts before the explicit activation cutoff stay report-only.
  await resetDatabase();
  process.env.PAYMENT_FINALIZATION_ACTIVATION_AT = "2026-01-02T00:00:00.000Z";
  value = await seedAttempt({
    recordingStatus: "needs_reconciliation",
    activationAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.strictEqual(await reconcileNextEligiblePaymentAttempt(), null);
  state = await financialState(value);
  assert.strictEqual(state.attempt.recordingStatus, "needs_reconciliation");
  assert.strictEqual(state.seller.walletPending, 0);

  // 15. Refunded/disputed attempts are never credited automatically.
  await resetDatabase();
  value = await seedAttempt({ recordingStatus: "needs_reconciliation", refunded: true });
  await assert.rejects(
    finalizeSuccessfulPaymentAttempt(value.attemptId),
    (error) => error.code === "PAYMENT_ATTEMPT_FINANCIALLY_BLOCKED"
  );
  state = await financialState(value);
  assert.strictEqual(state.seller.walletPending, 0);
  assert.strictEqual(state.transactionCount, 0);

  console.log("paymentFinalization Replica Set integration tests passed");
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
    await replSet?.stop().catch(() => {});
  });
