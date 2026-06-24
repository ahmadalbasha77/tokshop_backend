const ApplicationLog = require("../models/applicationLog");

const QUERY_TIMEOUT_MS = 10000;

function normalizePagination(pageValue, limitValue) {
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(limitValue, 10) || 20)
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

exports.submitClientLog = (req, res) => {
  const {
    platform,
    appVersion,
    buildNumber,
    userId,
    userName,
    email,
    level = "error",
    screenName,
    fileName,
    functionName,
    endpointUrl,
    message,
    stackTrace,
    extraDetails,
    osVersion,
    deviceModel,
    networkType,
    locale,
    clientTimestamp,
  } = req.body;

  // Basic synchronous validations
  if (!platform || !["android", "ios", "dashboard", "web", "backend"].includes(platform)) {
    return res.status(400).json({
      success: false,
      message: "platform is required and must be one of: android, ios, dashboard, web, backend",
    });
  }

  if (!appVersion || typeof appVersion !== "string" || appVersion.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "appVersion is required and must be a non-empty string",
    });
  }

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "message is required and must be a non-empty string",
    });
  }

  if (clientTimestamp === undefined || clientTimestamp === null || Number.isNaN(Number(clientTimestamp))) {
    return res.status(400).json({
      success: false,
      message: "clientTimestamp is required and must be a valid number",
    });
  }

  // Extracted user context fallback (if JWT payload exists)
  const resolvedUserId = userId || req.user?._id || req.user?.id || null;
  const resolvedUserName = userName || req.user?.userName || req.user?.username || null;
  const resolvedEmail = email || req.user?.email || null;

  // Truncate fields to protect database storage & performance
  const truncatedMessage = message.slice(0, 2000);
  const truncatedStackTrace = stackTrace ? stackTrace.slice(0, 10000) : null;

  // Metadata
  const ipAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress || null;
  const userAgent = req.headers["user-agent"] || null;

  const logData = {
    platform,
    appVersion,
    buildNumber,
    userId: resolvedUserId,
    userName: resolvedUserName,
    email: resolvedEmail,
    level,
    screenName,
    fileName,
    functionName,
    endpointUrl,
    message: truncatedMessage,
    stackTrace: truncatedStackTrace,
    extraDetails,
    osVersion,
    deviceModel,
    networkType,
    locale,
    ipAddress,
    userAgent,
    clientTimestamp: Number(clientTimestamp),
  };

  // Immediate Fire-and-Forget response (Fast, lightweight, non-blocking)
  res.status(202).json({
    success: true,
    message: "Log queued",
  });

  // Asynchronously save log to database in background
  ApplicationLog.create(logData).catch((err) => {
    console.error("Failed to asynchronously save remote client log:", err.message);
  });
};

exports.getAdminClientLogs = async (req, res) => {
  const { page, limit, skip } = normalizePagination(
    req.query.page,
    req.query.limit
  );

  const filter = {};

  if (req.query.platform) {
    filter.platform = req.query.platform;
  }

  if (req.query.level) {
    filter.level = req.query.level;
  }

  if (req.query.appVersion) {
    filter.appVersion = req.query.appVersion;
  }

  if (req.query.userId) {
    filter.userId = req.query.userId;
  }

  if (req.query.email) {
    filter.email = req.query.email;
  }

  // Text search on message, stackTrace, or fileName
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, "i");
    filter.$or = [
      { message: searchRegex },
      { stackTrace: searchRegex },
      { fileName: searchRegex },
      { screenName: searchRegex },
    ];
  }

  // Date filter by createdAt (server time) or clientTimestamp
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

    filter.createdAt = {};
    if (dateFrom !== null) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo !== null) filter.createdAt.$lte = new Date(dateTo);
  }

  try {
    const [totalDocuments, logs] = await Promise.all([
      ApplicationLog.countDocuments(filter).maxTimeMS(QUERY_TIMEOUT_MS),
      ApplicationLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .maxTimeMS(QUERY_TIMEOUT_MS),
    ]);

    const totalPages = Math.ceil(totalDocuments / limit);

    return res.status(200).json({
      success: true,
      logs,
      totalDocuments,
      totalPages,
      currentPage: page,
      limit,
    });
  } catch (error) {
    console.error("Failed to query application logs:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch application logs",
      error: error.message,
    });
  }
};
