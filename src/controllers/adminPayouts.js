const transactionModel = require("../models/transaction");
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
    const totalPages = Math.ceil(totalDocuments / limit);

    return res.status(200).json({
      success: true,
      payouts,
      transactions: payouts,
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

exports.normalizePagination = normalizePagination;
