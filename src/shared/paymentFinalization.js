const crypto = require("crypto");
const mongoose = require("mongoose");
const orderModel = require("../models/order");
const itemModel = require("../models/item");
const productModel = require("../models/product");
const userModel = require("../models/user");
const transactionModel = require("../models/transaction");
const paymentAttemptModel = require("../models/payment_attempt");
const { validateEarnings } = require("./paymentSafety");

const MAX_TRANSACTION_ATTEMPTS = 3;
const MAX_COMMIT_ATTEMPTS = 3;

function isTransactionalPaymentFinalizationEnabled() {
  return process.env.PAYMENT_FINALIZATION_TRANSACTIONS_ENABLED === "true";
}

function hasErrorLabel(error, label) {
  return Boolean(error?.hasErrorLabel?.(label) || error?.errorLabels?.includes?.(label));
}

function isRetryableTransactionError(error) {
  return (
    hasErrorLabel(error, "TransientTransactionError") ||
    error?.code === 112 ||
    error?.codeName === "WriteConflict"
  );
}

async function commitWithRetry(session) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
    try {
      await session.commitTransaction();
      return;
    } catch (error) {
      lastError = error;
      if (!hasErrorLabel(error, "UnknownTransactionCommitResult")) throw error;
    }
  }
  throw lastError;
}

async function runLocalTransactionWithRetry(work) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      });
      const result = await work(session);
      await commitWithRetry(session);
      return result;
    } catch (error) {
      lastError = error;
      if (session.inTransaction()) {
        await session.abortTransaction().catch(() => {});
      }
      if (!isRetryableTransactionError(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
}

function requireFinancialSnapshot(attempt) {
  if (
    !attempt.orderData ||
    !attempt.itemData ||
    !attempt.paymentIntentId ||
    !attempt.sellerId ||
    !attempt.productId
  ) {
    const error = new Error("PaymentAttempt financial snapshot is incomplete");
    error.code = "PAYMENT_ATTEMPT_SNAPSHOT_INCOMPLETE";
    throw error;
  }
  const sameId = (left, right) => left?.toString?.() === right?.toString?.();
  if (
    !sameId(attempt.orderData.seller, attempt.sellerId) ||
    !sameId(attempt.itemData.seller, attempt.sellerId) ||
    !sameId(attempt.itemData.productId, attempt.productId)
  ) {
    const error = new Error("PaymentAttempt financial snapshot ownership mismatch");
    error.code = "PAYMENT_ATTEMPT_SNAPSHOT_MISMATCH";
    throw error;
  }
  return validateEarnings({
    subtotal: attempt.subtotal,
    serviceFee: attempt.serviceFee,
    stripeFee: attempt.stripeFee,
    extraCharges: attempt.extraCharges,
    earnings: attempt.earnings,
  });
}

async function loadRecordedResult(attempt, session, transaction = null) {
  const [order, item] = await Promise.all([
    orderModel.findById(attempt.orderId).session(session),
    itemModel.findById(attempt.itemId).session(session),
  ]);
  if (!order || !item) {
    const error = new Error("Recorded PaymentAttempt is missing its Order or Item");
    error.code = "RECORDED_PAYMENT_DATA_MISSING";
    throw error;
  }
  return {
    success: true,
    orderId: order._id,
    message: "Order completed",
    newOrder: order,
    newItem: item,
    seller: order.seller,
    buyer: order.customer,
    transactionId: transaction?._id || attempt.transactionId,
    idempotentReplay: true,
  };
}

async function finalizeAttemptInTransaction(paymentAttemptId, session) {
  const attempt = await paymentAttemptModel.findById(paymentAttemptId).session(session);
  if (!attempt) {
    const error = new Error("PaymentAttempt not found");
    error.code = "PAYMENT_ATTEMPT_NOT_FOUND";
    throw error;
  }
  if (attempt.recordingStatus === "recorded") {
    return loadRecordedResult(attempt, session);
  }
  if (attempt.stripeStatus !== "succeeded") {
    const error = new Error("PaymentAttempt is not Stripe-succeeded");
    error.code = "PAYMENT_ATTEMPT_NOT_SUCCEEDED";
    throw error;
  }
  if (attempt.refunded || attempt.disputed || attempt.canceled) {
    const error = new Error("PaymentAttempt is not eligible for automatic credit");
    error.code = "PAYMENT_ATTEMPT_FINANCIALLY_BLOCKED";
    throw error;
  }

  const earnings = requireFinancialSnapshot(attempt);
  const existingTransaction = await transactionModel
    .findOne({
      type: "order",
      $or: [
        { paymentAttemptId: attempt._id },
        { paymentIntentId: attempt.paymentIntentId },
      ],
    })
    .session(session);
  if (existingTransaction) {
    await paymentAttemptModel.updateOne(
      { _id: attempt._id, recordingStatus: { $ne: "recorded" } },
      {
        $set: {
          recordingStatus: "recorded",
          orderId: existingTransaction.orderId,
          itemId: existingTransaction.itemId,
          transactionId: existingTransaction._id,
          recordedAt: new Date(),
          reconciliationLock: null,
          reconciliationLockedAt: null,
          lastRecordingError: null,
        },
      },
      { session }
    );
    attempt.orderId = existingTransaction.orderId;
    attempt.itemId = existingTransaction.itemId;
    attempt.transactionId = existingTransaction._id;
    return loadRecordedResult(attempt, session, existingTransaction);
  }

  const orderData = attempt.orderData;
  const itemData = attempt.itemData;
  let order = null;
  if (orderData.bundleId) {
    order = await orderModel
      .findOne({
        status: "processing",
        bundleId: orderData.bundleId,
        customer: attempt.buyerId,
        seller: attempt.sellerId,
        tokshow: orderData.tokshow || null,
      })
      .session(session);
  }

  const isNewBundle = !order;
  const targetOrderId = order?._id || attempt.orderId;
  let item;
  if (attempt.flow === "retry") {
    item = await itemModel.findByIdAndUpdate(
      attempt.itemId,
      {
        $set: {
          orderId: targetOrderId,
          status: "processing",
          chargeId: attempt.chargeId,
          paymentIntentId: attempt.paymentIntentId,
          paymentAttemptId: attempt._id,
        },
      },
      { new: true, session }
    );
    if (!item) {
      const error = new Error("Retry Order Item is missing");
      error.code = "PAYMENT_ATTEMPT_ITEM_MISSING";
      throw error;
    }
  } else {
    item = (
      await itemModel.create(
        [{ ...itemData, _id: attempt.itemId, orderId: targetOrderId, status: "processing" }],
        { session }
      )
    )[0];
  }

  if (order) {
    order = await orderModel.findByIdAndUpdate(
      order._id,
      {
        $push: { items: item._id },
        $addToSet: { paymentIntentIds: attempt.paymentIntentId },
        $inc: {
          shipping_fee: Number(orderData.shipping_fee || 0),
          stripe_fees: Number(orderData.stripe_fees || 0),
          service_fee: Number(orderData.service_fee || 0),
          tax: Number(orderData.tax || 0),
          earnings,
          discount: Number(orderData.discount || 0),
          seller_shipping_fee_pay: Number(orderData.seller_shipping_fee_pay || 0),
          total_shipping_cost: Number(orderData.total_shipping_cost || 0),
        },
        $set: {
          weight: orderData.weight,
          order_reference: itemData.order_reference,
          carrier: orderData.carrier,
          rate_id: orderData.rate_id,
          ordertype: orderData.ordertype,
          carrierAccount: orderData.carrierAccount,
          updatedAt: new Date(),
        },
      },
      { new: true, session }
    );
  } else {
    if (attempt.flow === "retry") {
      order = await orderModel.findByIdAndUpdate(
        attempt.orderId,
        {
          $set: {
            status: "processing",
            payment_status: "paid",
            paymentIntentId: attempt.paymentIntentId,
            paymentAttemptId: attempt._id,
            last_payment_error: null,
            updatedAt: new Date(),
          },
          $addToSet: { paymentIntentIds: attempt.paymentIntentId },
        },
        { new: true, session }
      );
      if (!order) {
        const error = new Error("Retry Order is missing");
        error.code = "PAYMENT_ATTEMPT_ORDER_MISSING";
        throw error;
      }
    } else {
      order = (
        await orderModel.create(
          [{ ...orderData, _id: attempt.orderId, items: [item._id], status: "processing" }],
          { session }
        )
      )[0];
    }
  }

  if (attempt.flow === "retry" && order._id.toString() !== attempt.orderId.toString()) {
    await orderModel.deleteOne({ _id: attempt.orderId }, { session });
  }

  const inventory = await productModel.findOneAndUpdate(
    { _id: attempt.productId, quantity: { $gte: item.quantity } },
    {
      $inc: {
        quantity: -item.quantity,
        salesCount: item.quantity,
        order_reference_counter: 1,
      },
    },
    { new: true, session }
  );
  if (!inventory) {
    const error = new Error("Product inventory is no longer available");
    error.code = "INSUFFICIENT_INVENTORY_DURING_FINALIZATION";
    throw error;
  }

  const seller = await userModel.findOneAndUpdate(
    {
      _id: attempt.sellerId,
      $or: [
        { walletPending: { $type: "number" } },
        { walletPending: { $exists: false } },
      ],
    },
    { $inc: { walletPending: earnings } },
    { new: true, session }
  );
  if (!seller) {
    const sellerExists = await userModel.exists({ _id: attempt.sellerId }).session(session);
    const error = new Error(
      sellerExists ? "Seller walletPending must be numeric" : "Seller not found"
    );
    error.code = sellerExists
      ? "INVALID_WALLET_PENDING"
      : "SELLER_NOT_FOUND_DURING_PAYMENT_RECORDING";
    throw error;
  }

  const transaction = (
    await transactionModel.create(
      [
        {
          from: attempt.buyerId,
          to: attempt.sellerId,
          chargeId: attempt.chargeId,
          paymentIntentId: attempt.paymentIntentId,
          paymentAttemptId: attempt._id,
          balanceTransactionId: attempt.balanceTransactionId,
          availableOn: attempt.availableOn || Date.now(),
          amount: earnings,
          total: attempt.subtotal,
          shippingFee: attempt.shippingData?.amount || 0,
          serviceFee: attempt.serviceFee,
          tax: attempt.tax,
          deducting: false,
          reason: `Purchase of product order #${order.invoice}`,
          status: "Pending",
          type: "order",
          orderId: order._id,
          itemId: item._id,
          date: Date.now(),
          stripe_fee: order.stripe_fees,
          extra_charges: attempt.extraCharges,
          new_pending_balance: seller.walletPending,
        },
      ],
      { session }
    )
  )[0];

  const attemptUpdate = await paymentAttemptModel.updateOne(
    { _id: attempt._id, recordingStatus: { $ne: "recorded" } },
    {
      $set: {
        recordingStatus: "recorded",
        orderId: order._id,
        itemId: item._id,
        transactionId: transaction._id,
        sellerId: attempt.sellerId,
        paymentIntentId: attempt.paymentIntentId,
        recordedAt: new Date(),
        reconciliationLock: null,
        reconciliationLockedAt: null,
        lastRecordingError: null,
      },
    },
    { session }
  );
  if (attemptUpdate.modifiedCount !== 1) {
    const error = new Error("PaymentAttempt recording state was not updated");
    error.code = "PAYMENT_ATTEMPT_RECORDING_UPDATE_FAILED";
    throw error;
  }

  return {
    success: true,
    orderId: order._id,
    message: "Order completed",
    newOrder: order,
    newItem: item,
    seller: order.seller,
    buyer: order.customer,
    transactionId: transaction._id,
    isNewBundle,
    idempotentReplay: false,
  };
}

async function markNeedsReconciliation(paymentAttemptId, error) {
  await paymentAttemptModel.updateOne(
    { _id: paymentAttemptId, stripeStatus: "succeeded", recordingStatus: { $ne: "recorded" } },
    {
      $set: {
        recordingStatus: "needs_reconciliation",
        lastRecordingError: String(error?.code || error?.message || "LOCAL_FINALIZATION_FAILED").slice(0, 200),
        reconciliationLock: null,
        reconciliationLockedAt: null,
      },
      $inc: { recordingAttempts: 1 },
    }
  ).catch(() => {});
}

async function finalizeSuccessfulPaymentAttempt(paymentAttemptId) {
  if (!isTransactionalPaymentFinalizationEnabled()) {
    const error = new Error("Transactional payment finalization is disabled");
    error.code = "PAYMENT_FINALIZATION_TRANSACTIONS_DISABLED";
    throw error;
  }
  try {
    return await runLocalTransactionWithRetry((session) =>
      finalizeAttemptInTransaction(paymentAttemptId, session)
    );
  } catch (error) {
    await markNeedsReconciliation(paymentAttemptId, error);
    throw error;
  }
}

function configuredActivationCutoff() {
  const value = Date.parse(process.env.PAYMENT_FINALIZATION_ACTIVATION_AT || "");
  return Number.isFinite(value) ? new Date(value) : null;
}

async function reconcileNextEligiblePaymentAttempt() {
  if (!isTransactionalPaymentFinalizationEnabled()) return null;
  const cutoff = configuredActivationCutoff();
  if (!cutoff) return null;

  const lockId = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
  const attempt = await paymentAttemptModel.findOneAndUpdate(
    {
      activationAt: { $gte: cutoff },
      transactionalFinalization: true,
      stripeStatus: "succeeded",
      recordingStatus: "needs_reconciliation",
      paymentIntentId: { $nin: [null, ""] },
      sellerId: { $ne: null },
      productId: { $ne: null },
      earnings: { $type: "number" },
      refunded: false,
      disputed: false,
      canceled: false,
      reconciliationEligibility: "clear",
      recordingAttempts: { $lt: 3 },
      $or: [
        { reconciliationLock: null },
        { reconciliationLockedAt: { $lt: staleBefore } },
      ],
    },
    {
      $set: { reconciliationLock: lockId, reconciliationLockedAt: new Date() },
    },
    { new: true }
  );
  if (!attempt) return null;

  try {
    return await finalizeSuccessfulPaymentAttempt(attempt._id);
  } catch (error) {
    await paymentAttemptModel.updateOne(
      { _id: attempt._id, reconciliationLock: lockId, recordingStatus: { $ne: "recorded" } },
      {
        $set: { reconciliationLock: null, reconciliationLockedAt: null },
      }
    ).catch(() => {});
    throw error;
  }
}

module.exports = {
  finalizeSuccessfulPaymentAttempt,
  isRetryableTransactionError,
  isTransactionalPaymentFinalizationEnabled,
  reconcileNextEligiblePaymentAttempt,
  runLocalTransactionWithRetry,
};
