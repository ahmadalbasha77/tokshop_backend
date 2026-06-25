const userModel = require("../models/user");
const roomsModel = require("../models/room");
const orderModel = require("../models/order");
const itemModel = require("../models/item");
const emailTemplateModel = require("../models/templates");
const logsModel = require("../models/activity_logs");
const { normalizePagination } = require("../shared/adminReadUtils");
const { logAdminEndpointError } = require("../shared/adminRequestLog");

const QUERY_TIMEOUT_MS = 10000;

function getDatabaseErrorResponse(error, fallbackMessage) {
  const timedOut =
    error?.code === 50 ||
    error?.name === "MongoServerSelectionError" ||
    error?.name === "MongoNetworkTimeoutError";

  return {
    status: timedOut ? 504 : 500,
    message: timedOut ? "Database request timed out" : fallbackMessage,
  };
}

exports.getUsers = async (req, res) => {
  const { title, currentUserId, status, type } = req.query;
  const { pages, limits, skip } = normalizePagination(
    req.query.page,
    req.query.limit
  );
  const query = {};

  if (title) {
    query.$or = ["userName", "firstName", "lastName", "email"].map(
      (field) => ({ [field]: { $regex: String(title), $options: "i" } })
    );
  }

  if (status === "pending") {
    const titleFilter = query.$or;
    const pendingFilter = [
      { "seller_application.status": "pending" },
      { "seller_application.status": { $exists: false } },
    ];
    query.applied_seller = true;
    query.seller = false;
    if (titleFilter) {
      delete query.$or;
      query.$and = [{ $or: titleFilter }, { $or: pendingFilter }];
    } else {
      query.$or = pendingFilter;
    }
  } else if (status === "suspended") {
    query.suspended = true;
  }

  if (type === "seller") query.seller = true;
  if (type === "customer") query.seller = false;

  try {
    if (currentUserId && /^[a-f\d]{24}$/i.test(String(currentUserId))) {
      const blockedOwners = await userModel
        .find({ blocked: currentUserId })
        .select("_id")
        .lean()
        .maxTimeMS(QUERY_TIMEOUT_MS);
      const blockedOwnerIds = blockedOwners.map((user) => user._id);
      if (blockedOwnerIds.length > 0) query._id = { $nin: blockedOwnerIds };
    }

    const [totalDoc, users] = await Promise.all([
      userModel.countDocuments(query).maxTimeMS(QUERY_TIMEOUT_MS),
      userModel
        .find(query)
        .skip(skip)
        .populate("following", [
          "firstName",
          "lastName",
          "bio",
          "userName",
          "email",
          "accountDisabled",
        ])
        .populate("followers", [
          "firstName",
          "lastName",
          "bio",
          "userName",
          "email",
          "accountDisabled",
        ])
        .populate("shipping")
        .sort("-_id")
        .limit(limits)
        .maxTimeMS(QUERY_TIMEOUT_MS),
    ]);

    return res.status(200).json({
      users: Array.isArray(users) ? users : [],
      totalDoc: Number(totalDoc) || 0,
      limits,
      pages,
    });
  } catch (error) {
    const response = getDatabaseErrorResponse(error, "Failed to fetch users");
    logAdminEndpointError(req, response.status, error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.verifyAdmin = async (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      id: req.user?._id,
      role: req.user?.role,
      admin: req.user?._authType === "admin",
    },
  });
};

exports.getUserStats = async (req, res) => {
  try {
    const [
      totalUsers,
      blockedUsers,
      totalCustomers,
      pendingSellers,
      activeSellers,
    ] = await Promise.all([
      userModel.countDocuments().maxTimeMS(QUERY_TIMEOUT_MS),
      userModel
        .countDocuments({ system_blocked: true })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      userModel
        .countDocuments({ applied_seller: false, seller: false })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      userModel
        .countDocuments({
          applied_seller: true,
          seller: false,
          $or: [
            { "seller_application.status": "pending" },
            { "seller_application.status": { $exists: false } },
          ],
        })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      userModel
        .countDocuments({ applied_seller: true, seller: true })
        .maxTimeMS(QUERY_TIMEOUT_MS),
    ]);

    return res.status(200).json({
      totalUsers: Number(totalUsers) || 0,
      blockedUsers: Number(blockedUsers) || 0,
      totalCustomers: Number(totalCustomers) || 0,
      pendingSellers: Number(pendingSellers) || 0,
      activeSellers: Number(activeSellers) || 0,
    });
  } catch (error) {
    const response = getDatabaseErrorResponse(
      error,
      "Failed to fetch user statistics"
    );
    logAdminEndpointError(req, response.status, error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.getRoomStats = async (req, res) => {
  try {
    const now = Date.now();
    const [total, live, upcoming, recentShows] = await Promise.all([
      roomsModel
        .countDocuments({ ended: false })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      roomsModel
        .countDocuments({ ended: false, started: true })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      roomsModel
        .countDocuments({ ended: false, activeTime: { $lt: now } })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      roomsModel
        .find({ ended: false, activeTime: { $lt: now } })
        .populate("owner", "userName profilePhoto")
        .sort({ date: 1 })
        .limit(5)
        .maxTimeMS(QUERY_TIMEOUT_MS),
    ]);

    return res.status(200).json({
      total: Number(total) || 0,
      live: Number(live) || 0,
      upcoming: Number(upcoming) || 0,
      recentshows: Array.isArray(recentShows) ? recentShows : [],
    });
  } catch (error) {
    const response = getDatabaseErrorResponse(
      error,
      "Failed to fetch room statistics"
    );
    logAdminEndpointError(req, response.status, error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.getOrderStats = async (req, res) => {
  try {
    const [total, shipped, delivered, orderValues] = await Promise.all([
      orderModel.countDocuments({}).maxTimeMS(QUERY_TIMEOUT_MS),
      orderModel
        .countDocuments({ status: "shipped" })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      orderModel
        .countDocuments({ status: "delivered" })
        .maxTimeMS(QUERY_TIMEOUT_MS),
      itemModel
        .aggregate([
          {
            $group: {
              _id: null,
              totalValue: { $sum: { $ifNull: ["$price", 0] } },
            },
          },
        ])
        .option({ maxTimeMS: QUERY_TIMEOUT_MS }),
    ]);

    return res.status(200).json({
      total: Number(total) || 0,
      shipped: Number(shipped) || 0,
      delivered: Number(delivered) || 0,
      ordersValue: Number(orderValues?.[0]?.totalValue) || 0,
    });
  } catch (error) {
    const response = getDatabaseErrorResponse(
      error,
      "Failed to fetch order statistics"
    );
    logAdminEndpointError(req, response.status, error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.getOrdersDiagnostics = async (req, res) => {
  const { sellerEmail, customerEmail } = req.query;

  try {
    const [totalOrders, missingCustomer, missingSeller, recentOrders] =
      await Promise.all([
        orderModel.countDocuments({}).maxTimeMS(QUERY_TIMEOUT_MS),
        orderModel
          .countDocuments({
            $or: [{ customer: { $exists: false } }, { customer: null }],
          })
          .maxTimeMS(QUERY_TIMEOUT_MS),
        orderModel
          .countDocuments({
            $or: [{ seller: { $exists: false } }, { seller: null }],
          })
          .maxTimeMS(QUERY_TIMEOUT_MS),
        orderModel
          .find({})
          .select("_id customer seller status invoice createdAt")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean()
          .maxTimeMS(QUERY_TIMEOUT_MS),
      ]);

    const result = {
      totalOrders: Number(totalOrders) || 0,
      missingCustomer: Number(missingCustomer) || 0,
      missingSeller: Number(missingSeller) || 0,
      recentOrders,
    };

    if (sellerEmail) {
      const seller = await userModel
        .findOne({ email: sellerEmail })
        .select("_id userName email")
        .lean()
        .maxTimeMS(QUERY_TIMEOUT_MS);

      if (!seller) {
        result.seller = { email: sellerEmail, found: false };
      } else {
        const sellerOrders = await orderModel
          .find({ seller: seller._id })
          .select("_id customer status createdAt")
          .lean()
          .maxTimeMS(QUERY_TIMEOUT_MS);
        const distinctCustomerIds = [
          ...new Set(sellerOrders.map((o) => String(o.customer))),
        ];

        // Same shape of query GET /orders runs when the logged-in seller's
        // own id is sent as both customer and userId ("my orders" on the app).
        const myOrdersAsCustomerOrSeller = await orderModel
          .countDocuments({
            $and: [
              { customer: { $exists: true, $ne: null } },
              { seller: { $exists: true, $ne: null } },
            ],
            $or: [{ customer: seller._id }, { seller: seller._id }],
          })
          .maxTimeMS(QUERY_TIMEOUT_MS);

        const sellerOnly = await orderModel
          .countDocuments({
            $and: [
              { customer: { $exists: true, $ne: null } },
              { seller: { $exists: true, $ne: null } },
            ],
            seller: seller._id,
          })
          .maxTimeMS(QUERY_TIMEOUT_MS);

        result.seller = {
          email: sellerEmail,
          found: true,
          id: String(seller._id),
          userName: seller.userName,
          totalAsSeller: sellerOrders.length,
          distinctCustomerCount: distinctCustomerIds.length,
          distinctCustomerIds,
          myOrdersQueryCount: myOrdersAsCustomerOrSeller,
          sellerOnlyQueryCount: sellerOnly,
        };

        if (customerEmail) {
          const customer = await userModel
            .findOne({ email: customerEmail })
            .select("_id userName email")
            .lean()
            .maxTimeMS(QUERY_TIMEOUT_MS);

          if (!customer) {
            result.customer = { email: customerEmail, found: false };
          } else {
            result.customer = {
              email: customerEmail,
              found: true,
              id: String(customer._id),
              userName: customer.userName,
              ordersFromThisCustomerToSeller: sellerOrders.filter(
                (o) => String(o.customer) === String(customer._id)
              ).length,
            };
          }
        }
      }
    }

    return res.status(200).json(result);
  } catch (error) {
    const response = getDatabaseErrorResponse(
      error,
      "Failed to fetch order diagnostics"
    );
    logAdminEndpointError(req, response.status, error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.getTemplates = async (req, res) => {
  try {
    const templates = await emailTemplateModel
      .find()
      .lean()
      .maxTimeMS(QUERY_TIMEOUT_MS);
    return res.status(200).json(Array.isArray(templates) ? templates : []);
  } catch (error) {
    const response = getDatabaseErrorResponse(
      error,
      "Failed to fetch email templates"
    );
    logAdminEndpointError(req, response.status, error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};

exports.getFinancialLogs = async (req, res) => {
  const { type } = req.query;
  const { pages, limits, skip } = normalizePagination(
    req.query.page,
    req.query.limit
  );
  const query = {};

  if (type) {
    const escapedType = type.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    query.log_data = { $regex: `"type"\\s*:\\s*"${escapedType}"`, $options: "i" };
  }

  try {
    const [totalDoc, logs] = await Promise.all([
      logsModel.countDocuments(query).maxTimeMS(QUERY_TIMEOUT_MS),
      logsModel
        .find(query)
        .skip(skip)
        .populate("user", ["firstName", "lastName", "userName", "email", "profilePhoto"])
        .sort("-_id")
        .limit(limits)
        .maxTimeMS(QUERY_TIMEOUT_MS),
    ]);

    return res.status(200).json({
      logs: Array.isArray(logs) ? logs : [],
      totalDoc: Number(totalDoc) || 0,
      limits,
      pages,
    });
  } catch (error) {
    const response = getDatabaseErrorResponse(
      error,
      "Failed to fetch financial logs"
    );
    logAdminEndpointError(req, response.status, error);
    return res.status(response.status).json({
      success: false,
      message: response.message,
    });
  }
};
