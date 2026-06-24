const transactionModel = require("../models/transaction");
const {
  buildPendingServiceFilter,
  buildPendingServiceResponse,
  isAllowedPendingServiceType,
  parseDateBoundary,
} = require("../shared/pendingServiceTransactions");

exports.getPendingShippingServiceTransactions = async (req, res) => {
  try {
    const { type, from, to } = req.query;

    if (!isAllowedPendingServiceType(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be shipping_deduction or service_fee",
      });
    }

    if (
      (from && parseDateBoundary(from) === null) ||
      (to && parseDateBoundary(to, true) === null)
    ) {
      return res.status(400).json({
        success: false,
        message: "from and to must use YYYY-MM-DD format",
      });
    }

    const filter = buildPendingServiceFilter({ type, from, to });
    const transactions = await transactionModel
      .find(filter)
      .sort({ date: -1 })
      .lean()
      .maxTimeMS(10000);

    return res.status(200).json({
      success: true,
      data: buildPendingServiceResponse(transactions),
    });
  } catch (error) {
    console.error(
      "GET /users/shipping/service/pending failed:",
      error.stack || error
    );

    const timedOut =
      error?.code === 50 ||
      error?.name === "MongoServerSelectionError" ||
      error?.name === "MongoNetworkTimeoutError";

    return res.status(timedOut ? 504 : 500).json({
      success: false,
      message: timedOut
        ? "Pending shipping service query timed out"
        : "Failed to fetch pending shipping service transactions",
    });
  }
};

exports.transferShippingServiceFunds = async (req, res) => {
  try {
    const { type, amount } = req.body;

    if (!isAllowedPendingServiceType(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be shipping_deduction or service_fee",
      });
    }

    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "amount must be a positive number",
      });
    }

    const filter = {
      type,
      status: "Pending",
      paid_out: false,
    };

    const transactions = await transactionModel
      .find(filter)
      .lean()
      .maxTimeMS(10000);

    const sum = transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0);

    // Compare sums in cents to avoid floating point precision issues
    if (Math.round(sum * 100) !== Math.round(requestedAmount * 100)) {
      return res.status(400).json({
        success: false,
        message: `Amount mismatch. Requested: $${requestedAmount.toFixed(2)}, DB Sum: $${sum.toFixed(2)}`,
      });
    }

    const ids = transactions.map(t => t._id);
    if (ids.length > 0) {
      await transactionModel.updateMany(
        { _id: { $in: ids } },
        { $set: { status: "Completed", paid_out: true } }
      );
    }

    return res.status(200).json({
      success: true,
      message: `${type} funds cleared successfully.`,
      count: ids.length,
      amount: sum,
    });
  } catch (error) {
    console.error("POST /users/shipping/service/transfer failed:", error.stack || error);
    return res.status(500).json({
      success: false,
      message: "Failed to transfer/clear shipping service funds",
    });
  }
};
