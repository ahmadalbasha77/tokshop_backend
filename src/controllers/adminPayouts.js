const transactionModel = require("../models/transaction");
const userModel = require("../models/user");
const { logAdminEndpointError } = require("../shared/adminRequestLog");

const QUERY_TIMEOUT_MS = 10000;

function normalizePagination(pageValue, limitValue) {
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(limitValue, 10) || 10)
  );

  return { page, limit, skip: (page - 1) * limit };
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }
  return date.getTime();
}

exports.getStripePayouts = async (req, res) => {
  const { page, limit, skip } = normalizePagination(
    req.query.page,
    req.query.limit
  );
  const filter = { type: "payout" };

  if (req.query.datefrom || req.query.dateto) {
    const dateFrom = parseDate(req.query.datefrom);
    const dateTo = parseDate(req.query.dateto, true);

    if (
      (req.query.datefrom && dateFrom === null) ||
      (req.query.dateto && dateTo === null)
    ) {
      return res.status(400).json({
        success: false,
        message: "datefrom and dateto must be valid dates",
      });
    }

    filter.date = {};
    if (dateFrom !== null) filter.date.$gte = dateFrom;
    if (dateTo !== null) filter.date.$lte = dateTo;
  }

  try {
    const [totalDocuments, payouts] = await Promise.all([
      transactionModel
        .countDocuments(filter)
        .maxTimeMS(QUERY_TIMEOUT_MS),
      transactionModel
        .find(filter)
        .populate("from", "userName firstName lastName email profilePhoto")
        .populate("to", "userName firstName lastName email profilePhoto")
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(QUERY_TIMEOUT_MS),
    ]);
    const processedPayouts = payouts.map(payout => {
      if (!payout.from) {
        payout.from = { userName: "Deleted User", email: "N/A", firstName: "Deleted", lastName: "User", profilePhoto: "" };
      }
      if (!payout.to) {
        payout.to = { userName: "Deleted User", email: "N/A", firstName: "Deleted", lastName: "User", profilePhoto: "" };
      }
      return payout;
    });
    const totalPages = Math.ceil(totalDocuments / limit);

    return res.status(200).json({
      success: true,
      payouts: processedPayouts,
      transactions: processedPayouts,
      totalDocuments,
      totalPages,
      currentPage: page,
      limit,
    });
  } catch (error) {
    const timedOut =
      error?.code === 50 ||
      error?.name === "MongoServerSelectionError" ||
      error?.name === "MongoNetworkTimeoutError";
    const status = timedOut ? 504 : 500;

    logAdminEndpointError(req, status, error);
    return res.status(status).json({
      success: false,
      message: timedOut
        ? "Stripe payouts query timed out"
        : "Failed to fetch Stripe payouts",
    });
  }
};

exports.resolveOrphanPayout = async (req, res) => {
  const { oldUserId, action, newUserId } = req.body;

  if (!oldUserId || !action) {
    return res.status(400).json({
      success: false,
      message: "oldUserId and action are required",
    });
  }

  if (action !== "reassign" && action !== "cancel") {
    return res.status(400).json({
      success: false,
      message: "action must be either 'reassign' or 'cancel'",
    });
  }

  if (action === "reassign" && !newUserId) {
    return res.status(400).json({
      success: false,
      message: "newUserId is required for reassign action",
    });
  }

  try {
    const todayStart = new Date("2026-02-26T00:00:00.000Z").getTime();
    
    const pendingTransactions = await transactionModel.find({
      to: oldUserId,
      payment_available: true,
      paid_out: false,
      type: "order",
      status: "Completed",
      itemId: { $exists: true },
      chargeId: { $exists: true },
      availableOn: { $gte: todayStart }
    }).maxTimeMS(QUERY_TIMEOUT_MS);

    if (pendingTransactions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No pending payout transactions found for this user",
      });
    }

    const transactionIds = pendingTransactions.map(t => t._id);
    const totalAmount = pendingTransactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);

    if (action === "cancel") {
      await transactionModel.updateMany(
        { _id: { $in: transactionIds } },
        { $set: { status: "Failed", payment_available: false } }
      ).maxTimeMS(QUERY_TIMEOUT_MS);

      return res.status(200).json({
        success: true,
        message: `Successfully cancelled ${pendingTransactions.length} transactions totaling $${totalAmount.toFixed(2)}`,
        data: {
          count: pendingTransactions.length,
          totalAmount,
        }
      });
    }

    if (action === "reassign") {
      const newUser = await userModel.findById(newUserId).maxTimeMS(QUERY_TIMEOUT_MS);
      if (!newUser) {
        return res.status(404).json({
          success: false,
          message: "New user not found",
        });
      }

      await transactionModel.updateMany(
        { _id: { $in: transactionIds } },
        { $set: { to: newUserId } }
      ).maxTimeMS(QUERY_TIMEOUT_MS);

      await userModel.updateOne(
        { _id: newUserId },
        { $inc: { walletPending: totalAmount } }
      ).maxTimeMS(QUERY_TIMEOUT_MS);

      return res.status(200).json({
        success: true,
        message: `Successfully reassigned ${pendingTransactions.length} transactions totaling $${totalAmount.toFixed(2)} to user ${newUser.userName || newUserId}`,
        data: {
          count: pendingTransactions.length,
          totalAmount,
          newUserId,
        }
      });
    }

  } catch (error) {
    logAdminEndpointError(req, 500, error);
    return res.status(500).json({
      success: false,
      message: "Failed to resolve orphan payout transactions",
      error: error.message
    });
  }
};

exports.normalizePagination = normalizePagination;
