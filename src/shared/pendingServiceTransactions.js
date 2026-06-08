const ALLOWED_PENDING_SERVICE_TYPES = new Set([
  "shipping_deduction",
  "service_fee",
]);

function isAllowedPendingServiceType(type) {
  return ALLOWED_PENDING_SERVICE_TYPES.has(type);
}

function parseDateBoundary(value, endOfDay = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const timestamp = Date.parse(`${value}${suffix}`);
  if (!Number.isFinite(timestamp)) return null;

  return new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function buildPendingServiceFilter({ type, from, to }) {
  const filter = {
    type,
    status: "Pending",
    paid_out: false,
  };

  const fromTimestamp = parseDateBoundary(from);
  const toTimestamp = parseDateBoundary(to, true);

  if (fromTimestamp !== null || toTimestamp !== null) {
    filter.date = {};
    if (fromTimestamp !== null) filter.date.$gte = fromTimestamp;
    if (toTimestamp !== null) filter.date.$lte = toTimestamp;
  }

  return filter;
}

function buildPendingServiceResponse(transactions) {
  const safeTransactions = Array.isArray(transactions) ? transactions : [];
  const total = safeTransactions.reduce((sum, transaction) => {
    const amount = Number(transaction?.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

  return {
    transactions: safeTransactions,
    total,
    amount: total,
  };
}

module.exports = {
  buildPendingServiceFilter,
  buildPendingServiceResponse,
  isAllowedPendingServiceType,
  parseDateBoundary,
};
