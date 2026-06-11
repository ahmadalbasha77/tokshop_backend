const orderModel = require("../models/order");
const transactionModel = require("../models/transaction");
const {
  releaseEligibleOrderPayments,
} = require("../shared/orderPaymentRelease");
const { logAdminEndpointError } = require("../shared/adminRequestLog");

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function isPaymentReady(transaction) {
  return (
    transaction.status === "Completed" &&
    transaction.payment_available === true &&
    transaction.paid_out !== true
  );
}

function summarizeOrderPayments(transactions) {
  const unpaid = transactions.filter(
    (transaction) => transaction.paid_out !== true
  );
  const releasableTransactions = unpaid.filter(isPaymentReady);
  let blockReason = null;

  if (!transactions.length) {
    blockReason = "NO_ORDER_TRANSACTIONS";
  } else if (!unpaid.length) {
    blockReason = "ALREADY_RELEASED";
  } else if (releasableTransactions.length !== unpaid.length) {
    blockReason = unpaid.some(
      (transaction) => transaction.status !== "Completed"
    )
      ? "PAYMENT_NOT_COMPLETED"
      : "STRIPE_FUNDS_NOT_AVAILABLE";
  }

  return {
    transactionCount: transactions.length,
    unpaidTransactionCount: unpaid.length,
    releasableTransactionCount: releasableTransactions.length,
    releasableAmount: releasableTransactions.reduce(
      (sum, transaction) => sum + Number(transaction.amount || 0),
      0
    ),
    paidOut: transactions.length > 0 && unpaid.length === 0,
    releasable:
      unpaid.length > 0 &&
      releasableTransactions.length === unpaid.length,
    blockReason,
    unpaid,
    releasableTransactions,
  };
}

async function findOrder(orderId) {
  return orderModel
    .findById(orderId)
    .select("_id status seller")
    .lean()
    .maxTimeMS(10000);
}

async function findOrderTransactions(orderId) {
  return transactionModel
    .find({
      orderId,
      type: "order",
      to: { $ne: null },
    })
    .select(
      "_id orderId to amount status payment_available paid_out order_fulfilled transferId"
    )
    .lean()
    .maxTimeMS(10000);
}

function invalidOrderIdResponse(res) {
  return res.status(400).json({
    success: false,
    code: "INVALID_ORDER_ID",
    message: "Invalid order ID",
  });
}

exports.getOrderFundsStatus = async (req, res) => {
  const orderId = String(req.params.orderId || "");
  if (!OBJECT_ID_PATTERN.test(orderId)) return invalidOrderIdResponse(res);

  try {
    const order = await findOrder(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        code: "ORDER_NOT_FOUND",
        message: "Order not found",
      });
    }

    const transactions = await findOrderTransactions(orderId);
    const summary = summarizeOrderPayments(transactions);

    return res.status(200).json({
      success: true,
      data: {
        orderId,
        orderStatus: order.status,
        transactionCount: summary.transactionCount,
        unpaidTransactionCount: summary.unpaidTransactionCount,
        releasableTransactionCount: summary.releasableTransactionCount,
        releasableAmount: summary.releasableAmount,
        paidOut: summary.paidOut,
        releasable: summary.releasable,
        blockReason: summary.blockReason,
      },
    });
  } catch (error) {
    logAdminEndpointError(req, 500, error);
    return res.status(500).json({
      success: false,
      message: "Failed to inspect order funds",
    });
  }
};

exports.releaseOrderFunds = async (req, res) => {
  const orderId = String(req.params.orderId || "");
  if (!OBJECT_ID_PATTERN.test(orderId)) return invalidOrderIdResponse(res);

  try {
    const order = await findOrder(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        code: "ORDER_NOT_FOUND",
        message: "Order not found",
      });
    }

    const transactions = await findOrderTransactions(orderId);
    const summary = summarizeOrderPayments(transactions);

    if (summary.blockReason) {
      const status = summary.blockReason === "NO_ORDER_TRANSACTIONS" ? 404 : 409;
      const messages = {
        NO_ORDER_TRANSACTIONS: "No seller payment transactions found for this order",
        ALREADY_RELEASED: "Order funds have already been released",
        PAYMENT_NOT_COMPLETED: "Order payment is not completed",
        STRIPE_FUNDS_NOT_AVAILABLE: "Stripe funds are not available yet",
      };

      return res.status(status).json({
        success: false,
        code: summary.blockReason,
        message: messages[summary.blockReason],
      });
    }

    const transactionIds = summary.releasableTransactions.map(
      (transaction) => transaction._id
    );
    await transactionModel.updateMany(
      {
        _id: { $in: transactionIds },
        paid_out: false,
        status: "Completed",
        payment_available: true,
      },
      { $set: { order_fulfilled: true } }
    );

    const releases = await releaseEligibleOrderPayments({
      orderIds: [orderId],
      requireDelivered: false,
    });

    if (!releases.length) {
      return res.status(409).json({
        success: false,
        code: "NO_TRANSFERABLE_AMOUNT",
        message: "No transferable amount is currently available for this order",
      });
    }

    const totalReleased = releases.reduce(
      (sum, release) => sum + Number(release.netAmount || 0),
      0
    );
    console.log(
      "[Admin Order Payment Release]",
      JSON.stringify({
        adminId: req.user?._id?.toString(),
        orderId,
        orderStatus: order.status,
        totalReleased,
        transferIds: releases.map((release) => release.transferId),
      })
    );

    return res.status(200).json({
      success: true,
      message: "Order funds released successfully",
      data: {
        orderId,
        orderStatus: order.status,
        totalReleased,
        releases,
      },
    });
  } catch (error) {
    const sellerStripeMissing = /does not have a Stripe account/.test(
      error?.message || ""
    );
    const stripeUnavailable =
      error?.message === "Stripe configuration is unavailable";
    const status = sellerStripeMissing ? 409 : stripeUnavailable ? 503 : 500;
    const code = sellerStripeMissing
      ? "SELLER_STRIPE_ACCOUNT_REQUIRED"
      : stripeUnavailable
        ? "STRIPE_CONFIGURATION_UNAVAILABLE"
        : "ORDER_FUNDS_RELEASE_FAILED";

    logAdminEndpointError(req, status, error);
    return res.status(status).json({
      success: false,
      code,
      message: sellerStripeMissing
        ? "Seller does not have a connected Stripe account"
        : stripeUnavailable
          ? "Stripe configuration is unavailable"
          : "Failed to release order funds",
    });
  }
};

exports.summarizeOrderPayments = summarizeOrderPayments;
