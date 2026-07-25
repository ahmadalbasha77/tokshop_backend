const crypto = require("crypto");
const appSettings = require("../models/settings");
const orderModel = require("../models/order");
const transactionModel = require("../models/transaction");
const userModel = require("../models/user");
const { sendEmail } = require("./email");
const { saveLogs } = require("./functions");

const RELEASE_ELIGIBLE_ORDER_STATUSES = ["delivered"];

function normalizeOrderIds(orderIds) {
  if (!Array.isArray(orderIds)) return [];
  return [...new Set(orderIds.filter(Boolean).map((id) => id.toString()))];
}

async function sendPaymentAvailableEmail(seller, amount) {
  if (!seller?.email) return;

  try {
    await sendEmail(
      {
        name: seller.userName,
        amount: `$${amount.toFixed(2)}`,
      },
      seller.email,
      "payment_available"
    );
  } catch (error) {
    console.error("Payment available email failed:", error.message);
  }
}

async function getStripeClient() {
  const settings = await appSettings.findOne().select("stripeSecretKey");
  if (!settings?.stripeSecretKey) {
    throw new Error("Stripe configuration is unavailable");
  }
  return require("stripe")(settings.stripeSecretKey);
}

async function releaseEligibleOrderPayments({
  orderIds,
  stripeClient = null,
}) {
  const normalizedOrderIds = normalizeOrderIds(orderIds);
  if (!normalizedOrderIds.length) return [];

  const orderFilter = {
    _id: { $in: normalizedOrderIds },
  };
  orderFilter.status = { $in: RELEASE_ELIGIBLE_ORDER_STATUSES };

  const eligibleOrderIds = await orderModel.distinct("_id", orderFilter);
  if (!eligibleOrderIds.length) return [];

  const candidates = await transactionModel.find({
    orderId: { $in: eligibleOrderIds },
    type: "order",
    status: "Completed",
    order_fulfilled: true,
    payment_available: true,
    paid_out: false,
    to: { $ne: null },
    payout_batch_id: { $exists: false },
  });
  if (!candidates.length) return [];

  const grouped = new Map();
  for (const transaction of candidates) {
    const sellerId = transaction.to.toString();
    if (!grouped.has(sellerId)) grouped.set(sellerId, []);
    grouped.get(sellerId).push(transaction);
  }

  const stripe = stripeClient || (await getStripeClient());
  const releases = [];
  let lastError = null;

  for (const [sellerId, sellerTransactions] of grouped.entries()) {
    const batchId = crypto.randomUUID();
    const candidateIds = sellerTransactions.map((transaction) => transaction._id);
    const locked = await transactionModel.updateMany(
      {
        _id: { $in: candidateIds },
        paid_out: false,
        payout_batch_id: { $exists: false },
      },
      { $set: { payout_batch_id: batchId } }
    );

    if (locked.modifiedCount === 0) continue;

    let seller = null;
    let totalAmount = 0;
    let netAmount = 0;
    try {
      const claimedTransactions = await transactionModel.find({
        payout_batch_id: batchId,
        paid_out: false,
      });
      if (!claimedTransactions.length) {
        await transactionModel.updateMany(
          { payout_batch_id: batchId },
          { $unset: { payout_batch_id: "" } }
        );
        continue;
      }

      seller = await userModel.findById(sellerId);
      if (!seller?.stripe_account) {
        await transactionModel.updateMany(
          { payout_batch_id: batchId },
          { $unset: { payout_batch_id: "" } }
        );
        const err = new Error(`Seller ${sellerId} does not have a Stripe account`);
        err.code = "SELLER_STRIPE_ACCOUNT_REQUIRED";
        throw err;
      }

      totalAmount = claimedTransactions.reduce(
        (sum, transaction) => sum + Number(transaction.amount || 0),
        0
      );
      const owed = Math.min(0, Number(seller.wallet || 0));
      netAmount = totalAmount + owed;

      if (netAmount <= 0) {
        await transactionModel.updateMany(
          { payout_batch_id: batchId },
          { $unset: { payout_batch_id: "" } }
        );
        continue;
      }

      const transactionKey = claimedTransactions
        .map((transaction) => transaction._id.toString())
        .sort()
        .join(":");
      const releaseKey = crypto
        .createHash("sha256")
        .update(`${sellerId}:${transactionKey}`)
        .digest("hex");
      const transfer = await stripe.transfers.create(
        {
          amount: Math.round(netAmount * 100),
          currency: "usd",
          destination: seller.stripe_account,
          transfer_group: `seller_${sellerId}_${releaseKey.slice(0, 24)}`,
        },
        { idempotencyKey: `seller_release_${releaseKey}` }
      );

      // Log success
      saveLogs({
        user: sellerId,
        log_data: JSON.stringify({
          type: "STRIPE_TRANSFER_SUCCESS",
          transferId: transfer.id,
          amount: netAmount,
          destination: seller?.stripe_account,
          status: "Completed",
          message: "Stripe Connect payout transferred successfully"
        })
      });

      const updatedSeller = await userModel.findOneAndUpdate(
        { _id: sellerId },
        {
          $inc: {
            wallet: netAmount,
            walletPending: -totalAmount,
          },
          $set: {
            last_stripe_transfer: new Date(),
          },
        },
        { new: true }
      );
      if (!updatedSeller) {
        throw new Error(`Seller ${sellerId} was not found during payment release`);
      }

      await transactionModel.updateMany(
        { payout_batch_id: batchId },
        {
          $set: {
            paid_out: true,
            transferId: transfer.id,
          },
          $unset: { payout_batch_id: "" },
        }
      );
      await transactionModel.create({
        from: null,
        to: sellerId,
        reason: "Transfer Initiated",
        type: "transfer",
        amount: netAmount,
        status: "Completed",
        deducting: false,
        date: Date.now(),
        new_pending_balance: updatedSeller.walletPending,
        transferId: transfer.id,
      });

      releases.push({
        sellerId,
        totalAmount,
        netAmount,
        transferId: transfer.id,
      });
      await sendPaymentAvailableEmail(seller, netAmount);
    } catch (error) {
      if (error.code === "resource_missing") {
        // Mark transactions as Failed in database to exclude them from future retries
        await transactionModel.updateMany(
          { payout_batch_id: batchId },
          { $set: { status: "Failed" }, $unset: { payout_batch_id: "" } }
        );
        // Clear user's missing/deleted Stripe Connect account details to deactivate integration
        await userModel.updateOne(
          { _id: sellerId },
          {
            $set: {
              stripe_account: null,
              stripe_status_code: "",
              stripe_verification_pending: false,
              stripe_status_updated_at: new Date()
            }
          }
        );
      } else {
        // For transient errors, unlock transactions so they can be processed on next cron run
        await transactionModel.updateMany(
          { payout_batch_id: batchId },
          { $unset: { payout_batch_id: "" } }
        );
      }

      // Log failure (skip saving logs if it is just a missing Stripe Connect configuration locally)
      if (error.code !== "SELLER_STRIPE_ACCOUNT_REQUIRED") {
        saveLogs({
          user: sellerId,
          log_data: JSON.stringify({
            type: "STRIPE_TRANSFER_FAILED",
            errorCode: error.code || null,
            errorType: error.type || null,
            errorMessage: error.message || error.toString(),
            amount: typeof netAmount !== 'undefined' ? netAmount : null,
            message: "Stripe Connect payout transfer failed"
          })
        });
      }

      lastError = error;
    }
  }

  if (releases.length === 0 && lastError && grouped.size === 1) {
    throw lastError;
  }

  return releases;
}

module.exports = {
  normalizeOrderIds,
  releaseEligibleOrderPayments,
};
