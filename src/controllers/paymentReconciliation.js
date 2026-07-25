const mongoose = require("mongoose");
const appSettings = require("../models/settings");
const orderModel = require("../models/order");
const itemModel = require("../models/item");
const transactionModel = require("../models/transaction");
const paymentAttemptModel = require("../models/payment_attempt");

function id(value) {
  return value?.toString?.() || String(value || "");
}

function buildPaymentReconciliationReport({
  paymentIntents,
  orders,
  items,
  transactions,
  paymentAttempts = [],
}) {
  const orderById = new Map(orders.map((order) => [id(order._id), order]));
  const orderByPaymentIntent = new Map();
  for (const order of orders) {
    const linkedPaymentIntents = [
      order.paymentIntentId,
      ...(order.paymentIntentIds || []),
    ].filter(Boolean);
    for (const paymentIntentId of linkedPaymentIntents) {
      orderByPaymentIntent.set(paymentIntentId, order);
    }
  }
  const itemsByOrder = new Map();
  const attemptByPaymentIntent = new Map(
    paymentAttempts
      .filter((attempt) => attempt.paymentIntentId)
      .map((attempt) => [attempt.paymentIntentId, attempt])
  );
  for (const item of items) {
    const key = id(item.orderId);
    if (!itemsByOrder.has(key)) itemsByOrder.set(key, []);
    itemsByOrder.get(key).push(item);
  }

  const results = paymentIntents.map((paymentIntent) => {
    const metadataOrderId = paymentIntent.metadata?.orderId || null;
    const metadataSellerId = paymentIntent.metadata?.sellerId || null;
    const order = orderByPaymentIntent.get(paymentIntent.id) || orderById.get(metadataOrderId);
    const orderId = id(order?._id);
    const orderTransactions = transactions.filter(
      (transaction) =>
        transaction.paymentIntentId === paymentIntent.id ||
        (orderId && id(transaction.orderId) === orderId)
    );
    const earningTransactions = orderTransactions.filter(
      (transaction) => transaction.type === "order"
    );
    const orderItems = itemsByOrder.get(orderId) || [];
    const trustedSellerIds = new Set(orderItems.map((item) => id(item.seller)).filter(Boolean));
    const recordedSellerIds = new Set(
      earningTransactions.map((transaction) => id(transaction.to)).filter(Boolean)
    );
    const orderSellerId = id(order?.seller);
    const paymentAttempt = attemptByPaymentIntent.get(paymentIntent.id);
    const refunded = Number(paymentIntent.latest_charge?.amount_refunded || 0) > 0;
    const disputed = Boolean(paymentIntent.latest_charge?.disputed);
    const sellerMismatch = Boolean(
      (metadataSellerId && orderSellerId && metadataSellerId !== orderSellerId) ||
      [...trustedSellerIds].some((sellerId) => orderSellerId && sellerId !== orderSellerId) ||
      [...recordedSellerIds].some((sellerId) => orderSellerId && sellerId !== orderSellerId)
    );

    const issues = [];
    if (!order) issues.push("ORDER_MISSING");
    if (order && earningTransactions.length === 0) issues.push("EARNINGS_TRANSACTION_MISSING");
    if (earningTransactions.length > 1) issues.push("DUPLICATE_EARNINGS_TRANSACTION");
    if (sellerMismatch) issues.push("SELLER_MISMATCH");
    if (
      paymentAttempt?.stripeStatus === "succeeded" &&
      paymentAttempt.recordingStatus !== "recorded"
    ) {
      issues.push("PAYMENT_RECORDING_INCOMPLETE");
    }
    if (refunded) issues.push("REFUNDED");
    if (disputed) issues.push("DISPUTED");

    return {
      paymentIntentId: paymentIntent.id,
      stripeStatus: paymentIntent.status,
      orderId: orderId || metadataOrderId,
      earningsTransactionCount: earningTransactions.length,
      issues,
      excludedFromAutoRepair: refunded || disputed,
    };
  });

  return {
    mode: "report_only",
    autoRepair: false,
    walletPendingHistoricalCheck: "not_available_without_an_immutable_wallet_ledger",
    checked: results.length,
    mismatches: results.filter((result) => result.issues.length > 0),
  };
}

exports.getPaymentReconciliationReport = async (req, res) => {
  try {
    const settings = await appSettings.findOne().lean();
    if (!settings?.stripeSecretKey) {
      throw new Error("Stripe configuration is unavailable");
    }
    const stripe = require("stripe")(settings.stripeSecretKey);
    const requestedLimit = Number(req.query.limit || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
      : 50;
    const parsedFrom = Date.parse(req.query.from || "");
    const createdGte = Number.isFinite(parsedFrom)
      ? Math.floor(parsedFrom / 1000)
      : Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);

    const stripePage = await stripe.paymentIntents.list({
      created: { gte: createdGte },
      limit,
      expand: ["data.latest_charge"],
    });
    const paymentIntents = stripePage.data.filter(
      (paymentIntent) => paymentIntent.status === "succeeded"
    );
    const paymentIntentIds = paymentIntents.map((paymentIntent) => paymentIntent.id);
    const metadataOrderIds = paymentIntents
      .map((paymentIntent) => paymentIntent.metadata?.orderId)
      .filter((orderId) => mongoose.isValidObjectId(orderId));

    let orders = await orderModel
      .find({
        $or: [
          { paymentIntentId: { $in: paymentIntentIds } },
          { paymentIntentIds: { $in: paymentIntentIds } },
          { _id: { $in: metadataOrderIds } },
        ],
      })
      .select("_id seller paymentIntentId paymentIntentIds payment_status status")
      .lean();
    let orderIds = orders.map((order) => order._id);
    let transactions = await transactionModel
      .find({
        $or: [
          { paymentIntentId: { $in: paymentIntentIds } },
          { orderId: { $in: orderIds } },
        ],
      })
      .select("orderId to type paymentIntentId amount status")
      .lean();
    const transactionOrderIds = transactions
      .map((transaction) => transaction.orderId)
      .filter((orderId) => mongoose.isValidObjectId(orderId));
    const knownOrderIds = new Set(orderIds.map(id));
    const missingOrderIds = transactionOrderIds.filter(
      (orderId) => !knownOrderIds.has(id(orderId))
    );
    if (missingOrderIds.length) {
      const linkedOrders = await orderModel
        .find({ _id: { $in: missingOrderIds } })
        .select("_id seller paymentIntentId paymentIntentIds payment_status status")
        .lean();
      orders = orders.concat(linkedOrders);
      orderIds = orders.map((order) => order._id);
      transactions = await transactionModel
        .find({
          $or: [
            { paymentIntentId: { $in: paymentIntentIds } },
            { orderId: { $in: orderIds } },
          ],
        })
        .select("orderId to type paymentIntentId amount status")
        .lean();
    }
    const [items, paymentAttempts] = await Promise.all([
      itemModel
        .find({ orderId: { $in: orderIds } })
        .select("orderId seller paymentIntentId")
        .lean(),
      paymentAttemptModel
        .find({ paymentIntentId: { $in: paymentIntentIds } })
        .select("orderId sellerId paymentIntentId stripeStatus recordingStatus")
        .lean(),
    ]);

    return res.status(200).json({
      ...buildPaymentReconciliationReport({
        paymentIntents,
        orders,
        items,
        transactions,
        paymentAttempts,
      }),
      range: { from: new Date(createdGte * 1000).toISOString(), limit },
      hasMore: Boolean(stripePage.has_more),
    });
  } catch (error) {
    console.error("Payment reconciliation report failed", {
      code: error.code || null,
      message: error.message,
    });
    return res.status(500).json({
      success: false,
      error: "Unable to generate payment reconciliation report",
    });
  }
};

exports.buildPaymentReconciliationReport = buildPaymentReconciliationReport;
