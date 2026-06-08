function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePagination(page, limit) {
  const pages = toPositiveInteger(page, 1);
  const limits = toPositiveInteger(limit, 10);

  return {
    pages,
    limits,
    skip: (pages - 1) * limits,
  };
}

module.exports = { normalizePagination, toPositiveInteger };
