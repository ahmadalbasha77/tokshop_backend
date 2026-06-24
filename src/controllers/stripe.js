const userModel = require("../models/user");
const functions = require("../shared/functions");
var payouthodModel = require("../models/payout_methods");
var paymentmethodModel = require("../models/payment_methods");
const addressModel = require("../models/address");
const { createTestAddress } = require("./address");
const { DEFAULTS } = require("../../utils");
const { parsePhoneNumberFromString } = require("libphonenumber-js");
const transactionModel = require("../models/transaction");
const { sendEmail } = require("../shared/email");
const {
  checkSellerStripeActive,
  checkSellerProfileComplete,
  getStripeAccountStatus,
  getStripeAccountStatusCode,
  sendIncompleteProfileResponse,
  stripeRestrictionResponse,
} = require("../shared/sellerProfile");

var mongoose = require("mongoose");

const normalizeStripeCountryCode = (countryCode, country) => {
  const rawValue = String(countryCode || country || "").trim();
  if (!rawValue) return "";

  const compactValue = rawValue.replace(/[\s._-]+/g, "").toUpperCase();
  const aliases = {
    US: "US",
    USA: "US",
    UNITEDSTATES: "US",
    UNITEDSTATESOFAMERICA: "US",
  };

  if (aliases[compactValue]) return aliases[compactValue];
  if (/^[A-Z]{2}$/.test(compactValue)) return compactValue;
  return "";
};

const canManageStripeAccount = (req, userId) =>
  req.user?._authType === "admin" ||
  req.user?._id?.toString() === userId?.toString();

const sendStripeAccountAccessDenied = (res) =>
  res.status(403).json({
    success: false,
    code: "STRIPE_ACCOUNT_ACCESS_DENIED",
    message: "You cannot manage another user's Stripe account.",
  });

const emptyStripeTransferStatus = () => ({
  transfers: "inactive",
  payouts_enabled: false,
  disabled_reason: null,
  currently_due: [],
});

const stripeTransferStatus = (stripeStatus) => ({
  transfers: stripeStatus?.transfers || "inactive",
  payouts_enabled: stripeStatus?.payouts_enabled === true,
  disabled_reason: stripeStatus?.disabled_reason || null,
  currently_due: stripeStatus?.currently_due || [],
});

const sendStripeTransferError = (
  res,
  {
    statusCode,
    code,
    message,
    nextAction,
    stripeStatus = null,
  }
) =>
  res.status(statusCode).json({
    success: false,
    code,
    message,
    next_action: nextAction,
    stripe_status: stripeTransferStatus(
      stripeStatus || emptyStripeTransferStatus()
    ),
  });

const getStripeErrorDetails = (error) => ({
  type: error?.type || error?.raw?.type || null,
  code: error?.code || error?.raw?.code || null,
  message: error?.message || error?.raw?.message || String(error),
  requestId:
    error?.requestId ||
    error?.request_id ||
    error?.raw?.requestId ||
    error?.raw?.request_id ||
    error?.headers?.["request-id"] ||
    null,
  statusCode:
    error?.statusCode ||
    error?.status_code ||
    error?.raw?.statusCode ||
    error?.raw?.status_code ||
    null,
});

const logStripeTransferVerificationError = (user, error, classification) => {
  const details = getStripeErrorDetails(error);
  const payload = {
    userId: user?._id?.toString() || null,
    stripeAccount: user?.stripe_account || null,
    error: {
      type: details.type,
      code: details.code,
      message: details.message,
      requestId: details.requestId,
      statusCode: details.statusCode,
    },
    classification,
  };

  console.error("Stripe transfer account verification failed", payload);
  functions.saveLogs({
    user: user?._id,
    log_data: JSON.stringify({
      type: "STRIPE_TRANSFER_ACCOUNT_VERIFICATION_FAILED",
      ...payload,
    }),
  });
};

const isMissingStripeAccountError = (error) => {
  const details = getStripeErrorDetails(error);
  return (
    details.code === "resource_missing" ||
    /no such account/i.test(details.message)
  );
};

const isStripeAuthenticationError = (error) => {
  const details = getStripeErrorDetails(error);
  return (
    details.type === "StripeAuthenticationError" ||
    details.code === "api_key_expired" ||
    details.statusCode === 401
  );
};

const requireStripeTransferReady = async (res, user) => {
  if (!user?.stripe_account) {
    sendStripeTransferError(res, {
      statusCode: 409,
      code: "STRIPE_ACCOUNT_NOT_CONNECTED",
      message: "The seller must connect a Stripe account before receiving transfers.",
      nextAction: "RECONNECT_STRIPE",
    });
    return { ok: false };
  }

  let settings;
  try {
    settings = await functions.getSettings();
  } catch (error) {
    logStripeTransferVerificationError(user, error, "CONFIGURATION_LOOKUP_FAILED");
    sendStripeTransferError(res, {
      statusCode: 503,
      code: "STRIPE_CONFIGURATION_UNAVAILABLE",
      message: "Stripe configuration is unavailable. Please try again.",
      nextAction: "RETRY",
    });
    return { ok: false };
  }

  if (!settings?.stripeSecretKey) {
    const error = new Error("stripeSecretKey is not configured");
    error.code = "STRIPE_CONFIGURATION_UNAVAILABLE";
    logStripeTransferVerificationError(user, error, "MISSING_STRIPE_SECRET_KEY");
    sendStripeTransferError(res, {
      statusCode: 503,
      code: "STRIPE_CONFIGURATION_UNAVAILABLE",
      message: "Stripe configuration is unavailable. Please contact support.",
      nextAction: "CONTACT_SUPPORT",
    });
    return { ok: false };
  }

  try {
    const stripe = require("stripe")(settings.stripeSecretKey);
    const account = await stripe.accounts.retrieve(user.stripe_account);
    if (account?.deleted === true) {
      const error = new Error(`No such account: ${user.stripe_account}`);
      error.code = "resource_missing";
      throw error;
    }

    const normalizedStatus = getStripeAccountStatus(account);
    const transfersActive =
      normalizedStatus.transfers === "active" ||
      normalizedStatus.legacy_payments === "active";

    if (!transfersActive) {
      sendStripeTransferError(res, {
        statusCode: 409,
        code: "STRIPE_TRANSFERS_NOT_ACTIVE",
        message: "The seller Stripe account cannot receive transfers yet.",
        nextAction: "COMPLETE_STRIPE_ONBOARDING",
        stripeStatus: normalizedStatus,
      });
      return { ok: false, stripeStatus: normalizedStatus };
    }

    return {
      ok: true,
      stripe,
      account,
      stripeStatus: normalizedStatus,
    };
  } catch (error) {
    if (isMissingStripeAccountError(error)) {
      logStripeTransferVerificationError(
        user,
        error,
        "ACCOUNT_NOT_FOUND_OR_MODE_MISMATCH"
      );
      sendStripeTransferError(res, {
        statusCode: 409,
        code: "STRIPE_ACCOUNT_NOT_FOUND",
        message: "The seller Stripe account no longer exists and must be reconnected.",
        nextAction: "RECONNECT_STRIPE",
      });
      return { ok: false, error };
    }

    if (isStripeAuthenticationError(error)) {
      logStripeTransferVerificationError(
        user,
        error,
        "INVALID_STRIPE_SECRET_KEY"
      );
      sendStripeTransferError(res, {
        statusCode: 503,
        code: "STRIPE_CONFIGURATION_UNAVAILABLE",
        message: "Stripe configuration is invalid. Please contact support.",
        nextAction: "CONTACT_SUPPORT",
      });
      return { ok: false, error };
    }

    logStripeTransferVerificationError(user, error, "STRIPE_API_UNAVAILABLE");
    sendStripeTransferError(res, {
      statusCode: 503,
      code: "STRIPE_API_UNAVAILABLE",
      message: "Unable to verify the seller Stripe account right now. Please try again.",
      nextAction: "RETRY",
    });
    return { ok: false, error };
  }
};

const getAllowedOnboardingHosts = () => {
  const configuredHosts = String(
    process.env.STRIPE_ONBOARDING_ALLOWED_HOSTS || ""
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return new Set([
    "stealz.live",
    "www.stealz.live",
    // Temporary compatibility for app builds that still send the old typo.
    "steelz.live",
    "www.steelz.live",
    "iconaapp.com",
    "www.iconaapp.com",
    ...configuredHosts,
  ]);
};

const isAllowedOnboardingUrl = (value, expectedPath) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isLocalhost = ["localhost", "127.0.0.1"].includes(hostname);
    const validProtocol =
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLocalhost);
    const normalizedPath =
      url.pathname.replace(/\/+$/, "") || "/";

    return (
      validProtocol &&
      !url.username &&
      !url.password &&
      (isLocalhost || getAllowedOnboardingHosts().has(hostname)) &&
      normalizedPath === expectedPath
    );
  } catch {
    return false;
  }
};

const createStripeOnboardingLink = async ({
  stripe,
  accountId,
  refreshUrl,
  returnUrl,
  collectFutureRequirements = false,
}) =>
  stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
    collection_options: {
      fields: collectFutureRequirements ? "eventually_due" : "currently_due",
      future_requirements: collectFutureRequirements ? "include" : "omit",
    },
  });

const requireActiveSellerStripe = async (res, user) => {
  try {
    const stripeStatus = await checkSellerStripeActive(user);
    if (!stripeStatus.active) {
      res.status(403).json(stripeRestrictionResponse(stripeStatus));
      return false;
    }
    return true;
  } catch (error) {
    console.error("Unable to verify seller Stripe status", {
      userId: user?._id?.toString(),
      stripeAccount: user?.stripe_account,
      code: error.code,
      message: error.message,
    });
    res.status(503).json({
      success: false,
      can_sell: false,
      code: "SELLER_STRIPE_STATUS_UNAVAILABLE",
      message: "Unable to verify seller Stripe account status. Please try again.",
    });
    return false;
  }
};

exports.getRevenue = async (req, res) => {
  try {
    let { from, to, page, limit } = req.query;
    let dateMatch = {};
    if (from) dateMatch.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999); // include full day
      dateMatch.$lte = end;
    }
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    const skip = (page - 1) * limit;
    const response = await functions.getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);
    const balance = await stripe.balance.retrieve();
    console.log(balance);
    let available = balance.available[0]["amount"] / 100;
    let pending = balance.pending[0]["amount"] / 100;

    // get stripe_fee total from transactions
    const result = await transactionModel.aggregate([
      {
        $match: {
          serviceFee: { $exists: true, $ne: null },
          ...(Object.keys(dateMatch).length && { createdAt: dateMatch })
        }
      },

      // 🔹 Lookup FROM user
      {
        $lookup: {
          from: "users",
          localField: "from",
          foreignField: "_id",
          as: "fromUser"
        }
      },

      // 🔹 Lookup TO user
      {
        $lookup: {
          from: "users",
          localField: "to",
          foreignField: "_id",
          as: "toUser"
        }
      },

      // 🔹 Shape from/to
      {
        $addFields: {
          from: {
            _id: "$from",
            userName: { $arrayElemAt: ["$fromUser.userName", 0] }
          },
          to: {
            _id: "$to",
            userName: { $arrayElemAt: ["$toUser.userName", 0] }
          }
        }
      },

      {
        $facet: {
          // 🔹 TRANSACTIONS LIST
          totalCount: [
            { $count: "count" }
          ],
          transactions: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                from: 1,
                to: 1,
                chargeId: 1,
                orderId: 1,
                itemId: 1,

                amount: 1,
                type: 1,

                stripe_fee: { $toDouble: { $ifNull: ["$stripe_fee", 0] } },
                extra_charges: { $toDouble: { $ifNull: ["$extra_charges", 0] } },
                shippingFee: { $toDouble: { $ifNull: ["$shippingFee", 0] } },
                serviceFee: { $toDouble: { $ifNull: ["$serviceFee", 0] } },
                total: { $toDouble: { $ifNull: ["$total", 0] } },

                payment_available: 1,
                availableOn: 1,
                paid_out: 1,
                order_fulfilled: 1,
                status: 1,
                deducting: 1,

                createdAt: 1
              }
            }
          ],

          // 🔹 SERVICE FEES (PLATFORM)
          pendingServiceFee: [
            { $match: { payment_available: { $ne: true } } },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$serviceFee" } }
              }
            }
          ],
          availableServiceFee: [
            { $match: { payment_available: true } },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$serviceFee" } }
              }
            }
          ],

          // 🔹 PAYOUTS (SELLERS)
          pendingPayouts: [
            {
              $match: {
                deducting: false,
                payment_available: { $ne: true },
                paid_out: { $ne: true }
              }
            },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" }
              }
            }
          ],
          availablePayouts: [
            {
              $match: {
                deducting: false,
                payment_available: true,
                paid_out: { $ne: true }
              }
            },
            {
              $group: {
                _id: null,
                total: { $sum: "$amount" }
              }
            }
          ]
        }
      },

      {
        $project: {
          transactions: 1,
          pagination: {
            page: page,
            limit: limit,
            total: { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
            pages: {
              $ceil: {
                $divide: [
                  { $ifNull: [{ $arrayElemAt: ["$totalCount.count", 0] }, 0] },
                  limit
                ]
              }
            }
          },

          serviceFees: {
            pending: {
              $ifNull: [{ $arrayElemAt: ["$pendingServiceFee.total", 0] }, 0]
            },
            available: {
              $ifNull: [{ $arrayElemAt: ["$availableServiceFee.total", 0] }, 0]
            }
          },

          payouts: {
            pending: {
              $ifNull: [{ $arrayElemAt: ["$pendingPayouts.total", 0] }, 0]
            },
            available: {
              $ifNull: [{ $arrayElemAt: ["$availablePayouts.total", 0] }, 0]
            }
          }
        }
      }
    ]);



    console.log(result);
    // const total = result[0]?.totalServiceFee || 0;
    res.json({
      balance: {
        stripe_available_balance: available,
        stripe_pending_balance: pending
      },
      transactions: result[0]['transactions'] || [],
      pagination: result[0]?.pagination || {},
      serviceFees: result[0]['serviceFees'] || {},
      payouts: result[0]['payouts'] || {},
    });
  } catch (err) {
    res.status(500).send({
      message: err.message,
    });
  }
};

exports.appfees = async (req, res) => {
  try {
    const response = await functions.getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);

    // Extract filters from query params
    const {
      limit = 50,
      starting_after,
      ending_before,
      from,          // e.g. 2025-01-01
      to,            // e.g. 2025-01-31
      charge,        // filter by charge ID
      account        // filter by connected account
    } = req.query;

    // Build created filter
    let createdFilter = {};
    if (from) createdFilter.gte = Math.floor(new Date(from).getTime() / 1000);
    if (to) createdFilter.lte = Math.floor(new Date(to).getTime() / 1000);

    // Build query object
    const query = {
      limit: Math.min(limit, 100),
      ...(Object.keys(createdFilter).length > 0 && { created: createdFilter }),
      ...(starting_after && { starting_after }),
      ...(ending_before && { ending_before }),
      ...(charge && { charge }),
      ...(account && { account })
    };

    // Fetch application fees
    const fees = await stripe.applicationFees.list(query);

    // Reverse results → newest first
    const orderedData = [...fees.data].reverse();

    // Transform results
    const result = fees.data.map(fee => ({
      id: fee.id,
      amount: fee.amount,     // 💰 in cents
      currency: fee.currency,
      charge: fee.charge,
      account: fee.account,
      created: fee.created
    }));

    // Calculate total earnings in this page
    const totalAmount = result.reduce((sum, f) => sum + f.amount, 0);

    res.json({
      has_more: fees.has_more,
      total_amount: totalAmount, // 💰 total application fees in cents
      data: result
    });

  } catch (error) {
    console.error("Error fetching application fees:", error.message);
    res.status(500).json({ error: error.message });
  }
};

exports.getRefunds = async (req, res) => {
  try {
    // Get pagination params from query string (optional)
    const limit = parseInt(req.query.limit) || 10;
    // const starting_after = req.query.starting_after || null;
    // const ending_before = req.query.ending_before || null;

    const response = await functions.getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);
    // Fetch refunds from Stripe
    const refunds = await stripe.refunds.list({
      limit,
    });

    return res.json({
      success: true,
      refunds: refunds.data,
      has_more: refunds.has_more,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
exports.getStripeBankAccount = async (req, res) => {
  if (!canManageStripeAccount(req, req.params.userId)) {
    return sendStripeAccountAccessDenied(res);
  }
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);

  try {
    let payoutdata = await userModel.findById(req.params.userId);
    if (payoutdata == null) {
      return res.json({ banks: [], status: false });
    }
    const profileStatus = checkSellerProfileComplete(payoutdata);
    if (!profileStatus.complete) {
      return sendIncompleteProfileResponse(res, profileStatus.missing_fields);
    }
    const account = await stripe.accounts.retrieve(
      payoutdata["stripe_account"]
    );
    if (account["external_accounts"] != null) {
      let banks = account["external_accounts"]["data"];
      res.json(banks);
    } else {
      res.json({ banks: [], status: false });
    }
  } catch (err) {
    res.send({
      message: err.message,
      status: false,
    });
  }
};

exports.stripeTransfer = async (req, res) => {
  let { amount, user } = req.body;
  if (!user) {
    return res.status(400).json({
      response: "User is required",
      status: false,
    });
  }
  if (!canManageStripeAccount(req, user)) {
    return sendStripeAccountAccessDenied(res);
  }
  amount = Number(amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      response: "Amount must be a positive number",
      status: false,
    });
  }
  let payoutdata = await userModel.findById(user);
  if (!payoutdata) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const transferReadiness = await requireStripeTransferReady(res, payoutdata);
  if (!transferReadiness.ok) return;
  const { stripe, stripeStatus } = transferReadiness;

  const todayStart = new Date("2026-02-26T00:00:00.000Z").getTime();
  let transaction = await transactionModel.find({
    to: user,
    payment_available: true,
    paid_out: false,
    type: "order",
    status: "Completed",
    itemId: { $exists: true },
    chargeId: { $exists: true },
    availableOn: { $gte: todayStart, $lte: Date.now() }
  }).select("amount _id");
  if (transaction.length == 0) {
    return res.status(500).json({
      response: "No transactions found",
      status: false,
    });
  }

  let total = Number(transaction.reduce((sum, t) => sum + t.amount, 0).toFixed(0));
  let ids = transaction.map((t) => t._id);
  
  if (total != Number(amount.toFixed(0))) {
    return res.status(500).json({
      response: "Amount does not match",
      status: false,
    });
  }
  let originalAmount = Number(amount.toFixed(2)); //1458.85



  const batchId = new mongoose.Types.ObjectId().toString();

  try {
    // 1. Lock the candidate transactions to prevent concurrent processing
    const lockResult = await transactionModel.updateMany(
      {
        _id: { $in: ids },
        paid_out: false,
        payout_batch_id: { $exists: false }
      },
      { $set: { payout_batch_id: batchId } }
    );

    if (lockResult.modifiedCount === 0) {
      return res.status(400).json({
        response: "Transactions are already being processed or paid out.",
        status: false
      });
    }

    // 2. Lock user walletPending by decrementing the amount.
    // Bypass strict $gte check to accommodate desynchronized balances.
    const locked = await userModel.findOneAndUpdate(
      { _id: user },
      { $inc: { walletPending: -originalAmount } },
      { new: true }
    );

    if (!locked) {
      // Release transactions
      await transactionModel.updateMany(
        { payout_batch_id: batchId },
        { $unset: { payout_batch_id: "" } }
      );
      return res.status(400).json({
        response: "User not found",
        status: false
      });
    }

    // Cap walletPending at 0 if the decrement made it negative or extremely close to 0
    if (locked.walletPending < 0.00001) {
      await userModel.updateOne(
        { _id: user },
        { $set: { walletPending: 0 } }
      );
    }

    const owed = Math.min(0, payoutdata.wallet || 0);
    const netAmount = originalAmount + owed;
    let transfer;

    if (netAmount > 0) {
      let stripeamount = Math.round(netAmount * 100);
      let stripe_account = payoutdata["stripe_account"];
      if (stripe_account == null) {
        // Rollback walletPending
        await userModel.updateOne(
          { _id: user },
          { $inc: { walletPending: originalAmount } }
        );
        // Release transactions
        await transactionModel.updateMany(
          { payout_batch_id: batchId },
          { $unset: { payout_batch_id: "" } }
        );
        return res.status(500).json({
          response: "Stripe account not found",
          status: false,
        });
      }
      const idempotencyKey = `manual_${user}_${batchId}`;
      transfer = await stripe.transfers.create({
        amount: stripeamount,
        currency: "usd",
        destination: stripe_account,
      }, { idempotencyKey });

      if (transfer?.status == false) {
        functions.saveLogs({
          user: user,
          log_data: JSON.stringify({
            type: "MANUAL_TRANSFER_FAILED",
            amount: originalAmount,
            errorMessage: transfer?.message || "Transfer status is false",
            message: "Manual transfer failed"
          })
        });
        await transactionModel.create({
          from: null,
          to: user,
          reason: "Transfer Initiated",
          type: "transfer",
          amount: originalAmount,
          status: "Failed",
          deducting: false,
          date: Date.now(),
          transferId: transfer.id ?? null
        });
        // Rollback walletPending
        await userModel.updateOne(
          { _id: user },
          { $inc: { walletPending: originalAmount } }
        );
        // Release transactions
        await transactionModel.updateMany(
          { payout_batch_id: batchId },
          { $unset: { payout_batch_id: "" } }
        );
        return sendStripeTransferError(res, {
          statusCode: 502,
          code: "STRIPE_TRANSFER_FAILED",
          message: transfer?.message || "Stripe transfer failed.",
          nextAction: "RETRY",
          stripeStatus,
        });
      }

      await transactionModel.create({
        from: null,
        to: user,
        reason: "Transfer Initiated",
        type: "transfer",
        amount: netAmount,
        status: "Completed",
        deducting: false,
        date: Date.now(),
        transferId: transfer?.id
      });
    }

    //update wallet balance
    await userModel.updateOne({ _id: user }, { $inc: { wallet: originalAmount } });

    //mark transaction as paid and clear batch id
    await transactionModel.updateMany(
      { payout_batch_id: batchId },
      { $set: { paid_out: true, transferId: transfer?.id }, $unset: { payout_batch_id: "" } }
    );

    // Log success
    functions.saveLogs({
      user: user,
      log_data: JSON.stringify({
        type: "MANUAL_TRANSFER_SUCCESS",
        transferId: transfer?.id,
        amount: originalAmount,
        netAmount: netAmount,
        destination: payoutdata?.stripe_account,
        status: "Completed",
        message: "Manual transfer completed successfully"
      })
    });

    return res.status(200).json({
      response: "Transfer successful",
      status: true,
    });
  } catch (err) {
    console.error(err);

    // Rollback walletPending
    try {
      await userModel.updateOne(
        { _id: user },
        { $inc: { walletPending: originalAmount } }
      );
    } catch (dbErr) {
      console.error("Failed to rollback walletPending:", dbErr);
    }

    // Release transactions
    try {
      await transactionModel.updateMany(
        { payout_batch_id: batchId },
        { $unset: { payout_batch_id: "" } }
      );
    } catch (dbErr) {
      console.error("Failed to release transactions:", dbErr);
    }

    functions.saveLogs({
      user: user,
      log_data: JSON.stringify({
        type: "MANUAL_TRANSFER_FAILED",
        errorCode: err.code || null,
        errorType: err.type || null,
        errorMessage: err.message || err.toString(),
        amount: typeof originalAmount !== 'undefined' ? originalAmount : null,
        message: "Manual transfer failed with exception"
      })
    });

    return sendStripeTransferError(res, {
      statusCode: 502,
      code: "STRIPE_TRANSFER_FAILED",
      message: err.message || "Stripe transfer failed.",
      nextAction: "RETRY",
      stripeStatus,
    });
  }
};

exports.stripePayoutPayments = async (req, res) => {
  if (!canManageStripeAccount(req, req.params.userId)) {
    return sendStripeAccountAccessDenied(res);
  }
  let payoutdata = await userModel.findById(req.params.userId);
  if (!payoutdata) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const profileStatus = checkSellerProfileComplete(payoutdata);
  if (!profileStatus.complete) {
    return sendIncompleteProfileResponse(res, profileStatus.missing_fields);
  }
  if (!(await requireActiveSellerStripe(res, payoutdata))) return;
  let stripe_account = payoutdata["stripe_account"];
  // return res.json({ banks: [], status: false });
  if (stripe_account == null) {
    return res.json({ banks: [], status: false });
  }
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      status: false,
      error: "Amount must be a positive number",
    });
  }
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);
  const account = await stripe.accounts.retrieve(stripe_account);
  // console.log(account);
  try {
    let banks = account["external_accounts"]["data"];

    const userres = await userModel.findOneAndUpdate(
      {
        _id: req.params.userId,
        wallet: { $gte: amount } // SAFETY CHECK
      },
      {
        $inc: {
          wallet: -amount
        }
      },
      { new: true }
    );

    if (!userres) {
      return res.status(400).json({
        status: false,
        error: "Insufficient balance"
      });
    }

    const stripeAmount = Math.round(amount * 100);
    const payoutresponse = await stripe.payouts.create(
      {
        amount: stripeAmount,
        currency: "usd",
        destination: banks[0]["id"],
        metadata: {
          userId: req.params.userId,
          source: "manual"
        }
      },

      { stripeAccount: stripe_account }
    );
    // console.log(payoutresponse);
    if (payoutresponse["id"]) {
      //create a transaction record
      await transactionModel.create({
        from: req.params.userId,
        to: req.params.userId,
        reason: "Payout Initiated",
        type: "payout",
        amount: amount,
        status: "Pending",
        deducting: true,
        bank_name: `${banks[0]["bank_name"]}****${banks[0]["last4"]}`,
        date: Date.now(),
        payout_type: "Stripe",
        payout_account: banks[0]["id"],
        balance_after_payout: userres?.wallet,
        payoutId: payoutresponse.id
      })

      const placeholders = {
        name: userres?.userName,
        amount: `$${amount}`,
        dashboard_url: "https://www.stealz.live",
        balance_after_payout: `$${userres?.wallet.toFixed(2)}`,
        bank_name: `${banks[0]["bank_name"]}****${banks[0]["last4"]}`
      };
      console.log(placeholders);
      await sendEmail(placeholders, userres?.email, "payout_initiated");

      return res.json({
        response: payoutresponse,
        status: true,
        wallet: userres?.wallet,
      });
    }

    return res.json({
      response: payoutresponse,
      status: true,
    });
  } catch (err) {
    console.log(err);
    await userModel.findByIdAndUpdate(
      req.params.userId,
      {
        $inc: {
          wallet: +amount,
        }
      }
    );
    if (err.type === "StripeInvalidRequestError") {
      // Check for specific error codes
      if (err.code === "payouts_not_allowed") {
        // You know the account hasn't met the required KYC or other criteria
        return res.status(400).json({
          status: false,
          error:
            "Payouts not allowed. Please complete missing requirements in Stripe.",
          stripeMessage: err.message,
        });
      }
    }
    res.json({
      response: err.message,
      status: false,
    });
  }
};
stripeAccount = async (account) => {
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);
  let accountresponse = await stripe.accounts.retrieveCapability(
    account,
    "card_payments"
  );
  return accountresponse;
};

exports.stripeAccountStatus = async (req, res) => {
  let payoutdata = await payouthodModel.findOne({ userid: req.params.id });
  return res.json(await stripeAccount(payoutdata["accountno"]));
};
exports.stripePayoutBalance = async (req, res) => {
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);

  try {
    let payoutdata = await payouthodModel.findOne({
      userid: req.params.userId,
    });
    const balance = await stripe.balance.retrieve({
      stripeAccount: payoutdata["accountno"],
    });
    res.json(balance);
  } catch (err) {
    res.status(500).send({
      message: err.message,
    });
  }
};

exports.connect = async (req, res) => {
  let {
    email,
    first_name,
    last_name,
    routing_number,
    account_number,
    phone,
    country,
    postal_code,
    line1,
    line2,
    state,
    city,
    day,
    month,
    ssn_last_4,
    year, countryCode, applying, create_address, iban = null, url = 'https://www.stealz.live', mcc = '5999'
  } = req.body;
  if (!canManageStripeAccount(req, req.params.id)) {
    return res.status(403).json({
      success: false,
      code: "STRIPE_ACCOUNT_ACCESS_DENIED",
      message: "You cannot manage another user's Stripe account.",
    });
  }

  const user = await userModel
    .findById(req.params.id)
    .select("seller seller_application stripe_account");
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }
  const sellerStatus = user?.seller_application?.status;
  if (!user.seller || (sellerStatus && sellerStatus !== "approved")) {
    return res.status(403).json({
      success: false,
      code: "SELLER_NOT_APPROVED",
      message: "Seller approval is required before completing payout setup.",
    });
  }

  var settings = await functions.getSettings();
  if (!settings?.stripeSecretKey) {
    return res.status(503).json({
      success: false,
      code: "STRIPE_CONFIGURATION_UNAVAILABLE",
      error: "Stripe configuration is unavailable.",
    });
  }
  const stripe = require("stripe")(settings.stripeSecretKey);

  if (user.stripe_account) {
    try {
      const existingAccount = await stripe.accounts.retrieve(user.stripe_account);
      const stripeStatus = getStripeAccountStatus(existingAccount);
      return res.json({
        success: true,
        account_created: false,
        account_id: existingAccount.id,
        can_sell: stripeStatus.can_sell,
        onboarding_required: stripeStatus.onboarding_required,
        requires_onboarding_link: stripeStatus.requires_onboarding_link,
        next_action: stripeStatus.next_action,
        message: stripeStatus.status_message,
        verification_pending: stripeStatus.verification_pending,
        code: getStripeAccountStatusCode(stripeStatus),
        stripe_status: stripeStatus,
      });
    } catch (error) {
      console.error("Unable to retrieve existing Stripe account", {
        userId: req.params.id,
        stripeAccount: user.stripe_account,
        code: error.code,
        type: error.type,
        message: error.message,
      });
      return res.status(502).json({
        success: false,
        code: "STRIPE_ACCOUNT_RETRIEVAL_FAILED",
        error: "Unable to retrieve the existing Stripe account.",
      });
    }
  }

  countryCode = normalizeStripeCountryCode(countryCode, country);
  if (!countryCode) {
    return res.status(400).json({
      success: false,
      error: "Country code must be a 2-character ISO code, such as US, EG, or GB.",
    });
  }
  if (
    countryCode === "US" &&
    (!/^\d{4}$/.test(String(ssn_last_4 || "")) ||
      String(ssn_last_4) === "0000")
  ) {
    return res.status(400).json({
      success: false,
      code: "INVALID_SSN_LAST_4",
      error: "ssn_last_4 must contain the last 4 digits of the SSN.",
    });
  }

  // if (create_address == true) {
  const phoneNumber = parsePhoneNumberFromString(phone, countryCode);

  if (!phoneNumber || !phoneNumber.isValid()) {
    return res
      .status(400)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, error: "Phone number is not valid" });
  }
  // }


  let currency = req.body.currency ?? "usd";

  const payload = {
    country: countryCode,
    type: "custom",
    email,

    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },

    business_type: "individual",

    business_profile: {
      url,
      mcc,
    },

    individual: {
      first_name,
      last_name,
      email,
      phone,
      ssn_last_4: countryCode === "US" ? ssn_last_4 : undefined,

      address: {
        country: countryCode,
        city,
        state,
        line1,
        line2,
        postal_code,
      },

      dob: { day, month, year },
    },

    external_account:
      countryCode === "US"
        ? {
          object: "bank_account",
          country: "US",
          currency: "usd",
          routing_number,
          account_number,
        }
        : {
          object: "bank_account",
          country: countryCode,
          currency,
          iban,
        },
  };
  // console.log(payload);
  const account = await functions.stripeConnect(
    payload,
    req.params.id,
    first_name,
    last_name,
    email,
    applying
  );
  if (!account?.success) {
    return res.status(400).json(account);
  }
  if (create_address == true) {
    const newAddress = await addressModel.create({
      name: first_name,
      addrress1: line1,
      city,
      countryCode,
      state,
      country,
      zipcode: postal_code,
      phone,
      email,
      userId: req.params.id
    });
    newAddress.save();
    await userModel.findByIdAndUpdate(req.params.id, { address: newAddress?._id })
  }
  return res.json(account);
};

exports.createConnectOnboardingLink = async (req, res) => {
  try {
    const userId = req.params.id;
    if (!canManageStripeAccount(req, userId)) {
      return res.status(403).json({
        success: false,
        code: "STRIPE_ACCOUNT_ACCESS_DENIED",
        message: "You cannot manage another user's Stripe account.",
      });
    }

    const { refresh_url, return_url } = req.body;
    if (
      !isAllowedOnboardingUrl(refresh_url, "/stripe/refresh") ||
      !isAllowedOnboardingUrl(return_url, "/stripe/return")
    ) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ONBOARDING_URL",
        message:
          "Stripe onboarding URLs must use an approved app domain and path.",
      });
    }

    const user = await userModel
      .findById(userId)
      .select("seller seller_application stripe_account");
    if (!user) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "User not found",
      });
    }
    const sellerStatus = user?.seller_application?.status;
    if (!user.seller || (sellerStatus && sellerStatus !== "approved")) {
      return res.status(403).json({
        success: false,
        code: "SELLER_NOT_APPROVED",
        message: "Seller approval is required before completing Stripe onboarding.",
      });
    }
    if (!user.stripe_account) {
      return res.status(409).json({
        success: false,
        code: "STRIPE_ACCOUNT_MISSING",
        message: "Create the seller Stripe account before requesting onboarding.",
      });
    }

    const settings = await functions.getSettings();
    if (!settings?.stripeSecretKey) {
      return res.status(503).json({
        success: false,
        code: "STRIPE_CONFIGURATION_UNAVAILABLE",
        message: "Stripe configuration is unavailable.",
      });
    }
    const stripe = require("stripe")(settings.stripeSecretKey);
    const account = await stripe.accounts.retrieve(user.stripe_account);
    const stripeStatus = getStripeAccountStatus(account);

    if (!stripeStatus.onboarding_required) {
      const code = getStripeAccountStatusCode(stripeStatus);
      return res.json({
        success: true,
        can_sell: stripeStatus.can_sell,
        onboarding_required: false,
        requires_onboarding_link: false,
        next_action: stripeStatus.next_action,
        verification_pending: stripeStatus.verification_pending,
        code,
        message: stripeStatus.status_message,
        stripe_status: stripeStatus,
      });
    }

    const accountLink = await createStripeOnboardingLink({
      stripe,
      accountId: user.stripe_account,
      refreshUrl: refresh_url,
      returnUrl: return_url,
      collectFutureRequirements:
        stripeStatus.upfront_identity_document_required === true,
    });

    return res.json({
      success: true,
      can_sell: false,
      onboarding_required: true,
      requires_onboarding_link: true,
      next_action: "OPEN_STRIPE_ONBOARDING",
      verification_pending: stripeStatus.verification_pending,
      code: "STRIPE_ONBOARDING_REQUIRED",
      message: stripeStatus.status_message,
      url: accountLink.url,
      expires_at: accountLink.expires_at,
      stripe_status: stripeStatus,
    });
  } catch (error) {
    console.error("Unable to create Stripe onboarding link", {
      userId: req.params.id,
      code: error.code,
      type: error.type,
      message: error.message,
      stack: error.stack,
    });
    return res.status(502).json({
      success: false,
      code: "STRIPE_ONBOARDING_LINK_FAILED",
      message: "Unable to start Stripe onboarding. Please try again.",
    });
  }
};
async function createCustomer(email, stripe) {
  const customer = await stripe.customers.create({
    email: email,
  });
  return customer.id;
}
exports.setupIntent = async (req, res) => {
  try {
    let { email } = req.body;
    var response = await functions.getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);
    let customer_id = await createCustomer(email, stripe);
    let payload = {
      customer: customer_id,
      payment_method_types: ["card"],
    };
    const setupIntent = await stripe.setupIntents.create(payload);
    res.json({ clientSecret: setupIntent.client_secret, customer_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.savepaymentmethod = async (req, res) => {
  try {
    let { customer_id, userid, methodid } = req.body;
    var response = await functions.getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);
    // Get all payment methods from Stripe
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customer_id,
      type: "card",
    });

    // Get existing payment methods from database to avoid duplicates
    const existingPaymentMethods = await paymentmethodModel.find({
      userid: userid,
      customerid: customer_id
    });

    // Create a Set of existing payment method IDs for quick lookup
    const existingIds = new Set(existingPaymentMethods.map(pm => pm.paymentMethodId));

    let newPaymentMethods = [];
    let latestPaymentMethod = null;

    // Process each payment method from Stripe
    for (const method of paymentMethods.data) {
      // Skip if this payment method already exists in database
      if (existingIds.has(method.id)) {
        console.log(`Payment method ${method.id} already exists, skipping...`);
        continue;
      }

      // Detect wallet type (Google Pay, Apple Pay, or regular card)
      let paymentType = 'card';
      let walletType = null;

      if (method.card.wallet) {
        walletType = method.card.wallet.type;
        if (walletType === 'google_pay') {
          paymentType = 'google_pay';
        } else if (walletType === 'apple_pay') {
          paymentType = 'apple_pay';
        }
      }
      let primary = false;
      console.log("prevmethod ", primary)
      // Prepare payment method data
      const paymentMethodData = {
        paymentMethodId: method.id,
        customerid: method.customer,
        last4: method.card.last4,
        expiry: `${method.card.exp_month}/${method.card.exp_year}`,
        userid,
        name: method.card.brand,
        type: paymentType, // 'card', 'google_pay', or 'apple_pay'
        walletType: walletType, // null for regular cards
        primary: primary, // We'll set this later
        createdAt: new Date()
      };

      try {
        // Save the new payment method
        let savedMethod = await paymentmethodModel.create(paymentMethodData);
        newPaymentMethods.push(savedMethod);

        // Keep track of the most recently created one
        latestPaymentMethod = savedMethod;

        console.log(`✅ Saved new payment method: ${method.id} (${paymentType})`);
      } catch (error) {
        console.error(`❌ Failed to save payment method ${method.id}:`, error.message);
      }
    }

    // Handle default payment method logic
    if (newPaymentMethods.length > 0) {
      await paymentmethodModel.findByIdAndDelete(methodid);
      const firstNewMethod = newPaymentMethods[0];

      // Make sure ALL payment methods for this user are NOT primary first
      await paymentmethodModel.updateMany(
        { userid: userid },
        { $set: { primary: false } }
      );

      // Then set only the first new one as primary
      await paymentmethodModel.findByIdAndUpdate(firstNewMethod._id, {
        $set: { primary: true }
      });

      // Update user's default payment method reference
      await userModel.findByIdAndUpdate(userid, {
        $set: { defaultpaymentmethod: firstNewMethod._id }
      });

      console.log(`✅ Set default payment method: ${firstNewMethod.paymentMethodId}`);
    }

    // Return summary of what was done
    return res.json(paymentMethods)

  } catch (err) {
    console.error("❌ Error in savepaymentmethod:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

exports.deletePaymentMethod = async (req, res) => {
  try {
    const { paymentMethodId, userid } = req.body;

    const deletedMethod = await paymentmethodModel.findByIdAndDelete(paymentMethodId);
    if (!deletedMethod) {
      return res.status(404).json({ success: false, error: "Payment method not found" });
    }
    res.json({ success: true, message: "Payment method deleted" });
  } catch (err) {
    console.error("❌ Error in deletePaymentMethod:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// Optional: Helper function to set a specific payment method as default
exports.setDefaultPaymentMethod = async (req, res) => {
  try {
    const { userid, paymentMethodId } = req.body;

    // Remove primary flag from all user's payment methods
    await paymentmethodModel.updateMany(
      { userid: userid },
      { $set: { primary: false } }
    );

    // Set the specified payment method as primary
    const updatedMethod = await paymentmethodModel.findOneAndUpdate(
      { userid: userid, _id: paymentMethodId },
      { $set: { primary: true } },
      { new: true }
    );

    if (!updatedMethod) {
      return res.status(404).json({
        success: false,
        error: "Payment method not found"
      });
    }

    // Update user's default payment method reference
    await userModel.findByIdAndUpdate(userid, {
      $set: { defaultpaymentmethod: updatedMethod._id }
    });

    res.json({
      success: true,
      message: "Default payment method updated",
      defaultMethod: {
        id: updatedMethod.paymentMethodId,
        type: updatedMethod.type,
        last4: updatedMethod.last4
      }
    });

  } catch (err) {
    console.error("❌ Error setting default payment method:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

exports.getdefaultPaymetmethod = async (req, res) => {

  let { id } = req.params;
  const updatedMethod = await paymentmethodModel.findOne(
    { userid: id, primary: true },
  );
  res.status(200).json(updatedMethod);
}
exports.allPayoutTransactions = async (req, res) => {
  try {
    let { limit = 10, page = 1, datefrom, dateto } = req.query;
    let filter = {
      type: "payout"
    };
    if (datefrom && dateto) {
      filter.date = { $gte: new Date(datefrom), $lte: new Date(dateto) };
    }

    let totalDocuments = await transactionModel.countDocuments(filter);
    let totalPages = Math.ceil(totalDocuments / limit);
    let rawTransactions = await transactionModel
      .find(filter)
      .populate("from", "userName firstName lastName email profilePhoto")
      .populate("to", "userName firstName lastName email profilePhoto")
      .limit(limit)
      .skip((page - 1) * limit)
      .sort({ date: -1 })
      .lean();

    const transactions = rawTransactions.map(t => {
      if (!t.from) {
        t.from = { userName: "Deleted User", email: "N/A", firstName: "Deleted", lastName: "User", profilePhoto: "" };
      }
      if (!t.to) {
        t.to = { userName: "Deleted User", email: "N/A", firstName: "Deleted", lastName: "User", profilePhoto: "" };
      }
      return t;
    });

    res.status(200).json({
      transactions,
      totalDocuments,
      totalPages,
      currentPage: page
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};




exports.payoutTransactions = async (req, res) => {
  try {
    if (!canManageStripeAccount(req, req.params.userId)) {
      return sendStripeAccountAccessDenied(res);
    }
    var response = await functions.getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);
    let user = await userModel.findById(req.params.userId);
    if (!user?.stripe_account) {
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const profileStatus = checkSellerProfileComplete(user);
      return sendIncompleteProfileResponse(res, profileStatus.missing_fields);
    }
    const payout = await stripe.payouts.list(
      { limit: 20, expand: ["data.destination"] },
      { stripeAccount: user?.stripe_account }
    );
    res.json(payout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


exports.createTestStripeToken = async (req, res) => {
  var response = await functions.getSettings();
  if (response["demoMode"] === false) {
    return;
  }
  const { email, name, userid } = req.body;
  if (!email || !name) {
    return;
  }

  // check if user has payment method
  let paymentmethod = await paymentmethodModel.findOne({
    userid: userid,
  });
  if (paymentmethod && paymentmethod?.customerid) {
    return;
  }
  await createTestAddress(userid);

  var response = await functions.getSettings();
  if (!response) {
    return;
  }
  if (!response["stripeSecretKey"]) {
    return;
  }
  const stripe = require("stripe")(response["stripeSecretKey"]);

  try {
    // 1. Create Stripe Customer
    const customer = await stripe.customers.create({
      email,
      name,
      description: "Demo customer for app signup",
    });
    console.log(customer);

    // 2. Attach a test card using a test token
    const paymentMethodResponse = await stripe.paymentMethods.create({
      type: "card",
      card: { token: "tok_visa" }, // use Stripe test token
    });
    let paymentMethod = {
      paymentMethodId: paymentMethodResponse.id,
      customerid: customer.id,
      last4: paymentMethodResponse.card.last4,
      expiry: `${paymentMethodResponse.card.exp_month}/${paymentMethodResponse.card.exp_year}`,
      userid: userid,
      name: paymentMethodResponse.card.brand,
      primary: true,
    };
    if (!paymentmethod) {
      let ress = await paymentmethodModel.create(paymentMethod);
      await userModel.findByIdAndUpdate(paymentMethod.userid, {
        $set: { defaultpaymentmethod: ress._id, seller: true, applied_seller: true },
      });
    } else {
      await paymentmethodModel.findByIdAndUpdate(
        paymentmethodModel?._id,
        paymentMethod
      );
    }

    await stripe.paymentMethods.attach(paymentMethodResponse.id, {
      customer: customer.id,
    });

    // 3. Set default card
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethod.id,
      },
    });

    // 4. Return Stripe customer ID to your database or client
    return { customerId: customer.id };
  } catch (err) {
    console.error(err);
    return { error: err.message };
  }
};

exports.getTaxEstimate = async (req, res) => {
  let {
    customerId,
    amount,
    reference,
    tax_code = "txcd_99999999",
    quantity = 1,
  } = req.body;
  try {
    let customer = await userModel
      .findOne({ _id: customerId })
      .populate("address");
    const calculation = await functions.estimateTax(
      customer?.address == null ? {
        line1: DEFAULTS.CUSTOMER_ADDRESS.street1,
        city: DEFAULTS.CUSTOMER_ADDRESS.city,
        state: DEFAULTS.CUSTOMER_ADDRESS.state,
        postal_code: DEFAULTS.CUSTOMER_ADDRESS.zip,
        country: DEFAULTS.CUSTOMER_ADDRESS.country,
      } : {
        line1: customer?.address?.addrress1,
        city: customer?.address?.city,
        state: customer?.address?.state,
        postal_code: customer?.address?.zipcode,
        country: customer?.address?.countryCode,
      },
      [
        {
          amount: parseInt(amount),
          reference,
          tax_code: tax_code == "" ? "txcd_99999999" : tax_code, // general goods
          quantity,
        },
      ]
    );
    res.json(calculation);
  } catch (err) {
    console.log(err?.raw?.message);
    res.status(500).json({ error: err.message });
  }
};
