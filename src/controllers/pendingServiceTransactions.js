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
