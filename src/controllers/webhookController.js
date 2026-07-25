const functions = require("../shared/functions");
const transactionModel = require("../models/transaction");
const userModel = require("../models/user");
var mongoose = require("mongoose");
const { sendEmail } = require('../shared/email');
const {
  getStripeAccountStatus,
  getStripeAccountStatusCode,
} = require("../shared/stripeAccountStatus");
const {
  releaseEligibleOrderPayments,
} = require("../shared/orderPaymentRelease");
const { processStripeEventOnce } = require("../shared/stripeEventProcessing");
const CUTOFF_UTC_MS = Date.parse("2026-02-25T03:00:00.000Z");
exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw buffer
      sig,
      response["stripe_webhook_key"]
    );
    // console.log("event", event);
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    const result = await processStripeEventOnce(event, "connected", () =>
      handleStripeEvent(event, stripe)
    );
    if (result.inProgress) {
      return res.status(500).json({ received: false, retry: true });
    }
  } catch (err) {
    console.error("❌ Error processing Stripe webhook event:", err);
    return res.status(500).json({ received: false, retry: true });
  }
  return res.status(200).json({ received: true });
};
exports.handleStripePlatformWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw buffer
      sig,
      response["stripe_platform_webhook_key"]
    );
    // console.log("event", event);
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    const result = await processStripeEventOnce(event, "platform", () =>
      handleStripePlatformEvent(event, stripe)
    );
    if (result.inProgress) {
      return res.status(500).json({ received: false, retry: true });
    }
  } catch (err) {
    console.error("❌ Error processing Stripe platform webhook event:", err);
    return res.status(500).json({ received: false, retry: true });
  }
  return res.status(200).json({ received: true });
};
async function handleStripePlatformEvent(event, stripe) {
  // Use event type and data object to do other things
  switch (event.type) {
    case "account.updated":
      await syncConnectedAccountStatus(event.data.object);
      break;
    case "charge.succeeded":
      console.log("💳 Charge succeeded:", event.data.object.id);
      break;
    case "balance.available":
      if (event.account) {
        await exports.processClearedTransactions(stripe, event.account);
      } else {
        await exports.processClearedTransactions(stripe);
      }
      break;
    case "refund.updated":
      const refund = event.data.object;
      console.log("💸 Charge refunded:", refund.id);
      await transactionModel.findOneAndUpdate(
        { refundId: refund.id },
        { status: "Refunded", reason: "Refund Updated" }
      );
      break;
    case "charge.refund.updated":
      const charge = event.data.object;
      console.log("💸 Charge refunded updated:", charge.id);
      await transactionModel.findOneAndUpdate(
        { chargeId: charge.id },
        { status: "Refunded", reason: "Refund Completed" }
      );
      break;
    case "charge.refunded": {
      const charge = event.data.object;
      console.log("💸 Charge refunded:", charge.id);
      await transactionModel.findOneAndUpdate(
        { chargeId: charge.id },
        { status: "Refunded", reason: "Refund Completed" }
      );
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

async function handleStripeEvent(event, stripe) {
  // Use event type and data object to do other things
  switch (event.type) {
    case "account.updated":
      await syncConnectedAccountStatus(event.data.object);
      break;
    case "charge.succeeded":
      console.log("💳 Charge succeeded:", event.data.object.id);
      break;
    case "payout.paid":
      const payout = event.data.object;
      const amount = payout.amount / 100;

      const tx = await transactionModel.findOne({
        payoutId: payout.id,
        status: "Completed"
      });

      if (tx) return; 
      let user = await userModel.findOneAndUpdate(
          {
            stripe_account: event.account,
            wallet: { $gte: amount }
          },
          { $inc: { wallet: -amount } },
          { new: true }
        );

        if (!user) {
          functions.saveLogs({
            log_data: JSON.stringify({
              type: "WEBHOOK_PAYOUT_WALLET_MISMATCH",
              payoutId: payout.id,
              amount: amount,
              stripe_account: event.account,
              message: "Payout webhook received but user wallet insufficient or user not found"
            })
          });
          return;
        }
      // }

      let transaction = await transactionModel.findOneAndUpdate(
        { payoutId: payout.id },
        { status: "Completed", balanceTransactionId: event.data.object.balance_transaction, payout_type: event.data.object.payout_type }
      );
      if (!transaction) {
        var response = await functions.getSettings();
        const stripe = require("stripe")(response["stripeSecretKey"]);
        const account = await stripe.accounts.retrieve(event.account);
        let banks = account["external_accounts"]["data"];
        transaction = await transactionModel.create({
          from: user?._id,
          to: user?._id,
          payoutId: payout.id,
          amount,
          reason: "Payout Initiated",
          status: "Completed",
          type: "payout",
          deducting: true,
          bank_name: `${banks[0]["bank_name"]}****${banks[0]["last4"]}`,
          payout_account: banks[0]["id"],
          date: Date.now(),
          payout_type: "Stripe",
          balance_after_payout: user?.wallet,
        });

      }

      functions.saveLogs({
        user: user?._id,
        log_data: JSON.stringify({
          type: "WEBHOOK_PAYOUT_COMPLETED",
          payoutId: payout.id,
          amount: amount,
          stripe_account: event.account,
          balance_after_payout: user?.wallet,
          bank_name: transaction?.bank_name,
          message: "Payout completed and wallet deducted via webhook"
        })
      });

      if (user) {
        const placeholders = {
          name: user?.userName,
          amount: `$${amount.toFixed(2)}`,
          dashboard_url: "https://www.stealz.live",
          bank_name: transaction?.bank_name,
        };

        await sendEmail(placeholders, user?.email, "payout_completed");
      }

      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

async function syncConnectedAccountStatus(account) {
  if (!account?.id) return;

  const stripeStatus = getStripeAccountStatus(account);
  const statusCode = getStripeAccountStatusCode(stripeStatus);
  const user = await userModel.findOneAndUpdate(
    { stripe_account: account.id },
    {
      $set: {
        stripe_status_code: statusCode,
        stripe_verification_pending: stripeStatus.verification_pending,
        stripe_status_updated_at: new Date(),
      },
    },
    { new: true }
  );

  console.log("Stripe connected account status updated", {
    stripeAccount: account.id,
    userId: user?._id?.toString() || null,
    code: statusCode,
    onboardingRequired: stripeStatus.onboarding_required,
    verificationPending: stripeStatus.verification_pending,
    canSell: stripeStatus.can_sell,
  });
}

exports.processClearedTransactions = async function (stripe, connectedAccountId = null) {
  // 1. Find cleared transactions
  const query = {
    status: "Pending",
    availableOn: { $gte: CUTOFF_UTC_MS, $lte: Date.now() },
    to: { $ne: null },
    type: { $in: ["order", "tip"] }, paid_out: false
  };

  if (connectedAccountId) {
    const seller = await userModel.findOne({ stripe_account: connectedAccountId });
    if (!seller) return;
    query.to = seller._id;
  }

  const clearedTxs = await transactionModel.find(query);
  console.log("Cleared transactions:", clearedTxs.length);

  if (clearedTxs.length) {

    // 2. Group by seller
    const grouped = {};
    for (let tx of clearedTxs) {
      const key = tx.to.toString();
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(tx);
    }

    // 3. Loop sellers
    for (let sellerId of Object.keys(grouped)) {
      const seller = await userModel.findById(sellerId);
      if (!seller) {
        console.error(`Seller ${sellerId} not found`);
        continue;
      }

      const sellerTxs = grouped[sellerId];
      try {
        if (seller.stripe_account) {
          // Mark transactions

          await transactionModel.updateMany(
            { _id: { $in: sellerTxs.map((tx) => tx._id) } },
            { status: "Completed", payment_available: true }
          );
          await releaseEligibleOrderPayments({
            orderIds: sellerTxs.map((transaction) => transaction.orderId),
            stripeClient: stripe,
          });
        } else {
          console.log("no stripe account ", seller);
          await transactionModel.updateMany(
            { _id: { $in: sellerTxs.map((tx) => tx._id) } },
            { status: "Completed", payment_available: true } // mark as available but not paid
          );
        }

        //tips transactions
        let tiptransactions = await transactionModel.find(
          { _id: { $in: sellerTxs.map((tx) => tx._id) }, type: "tip", paid_out: false },
        );
        //credit wallet
        if (tiptransactions.length) {
          await Promise.all(
            tiptransactions.map(async (tiptransaction) => {
              const touser = await userModel.findById(tiptransaction.to);
              if (!touser) {
                console.error(`User ${tiptransaction.to} not found`);
                functions.saveLogs({
                  log_data: JSON.stringify({
                    type: "TIP_CREDIT_USER_NOT_FOUND",
                    userId: tiptransaction.to?.toString(),
                    amount: tiptransaction.amount,
                    message: "Tip credit failed - seller user not found"
                  })
                });
                return;
              }
              touser.walletPending -= tiptransaction.amount;
              touser.wallet = (touser.wallet || 0) + tiptransaction.amount;
              await touser.save();
              await transactionModel.updateMany(
                { _id: { $in: tiptransactions.map((tx) => tx._id) } },
                { $set: { paid_out: true } }
              );

              functions.saveLogs({
                user: tiptransaction.to,
                log_data: JSON.stringify({
                  type: "TIP_CREDIT_SUCCESS",
                  amount: tiptransaction.amount,
                  sellerId: tiptransaction.to?.toString(),
                  walletAfter: touser.wallet,
                  message: "Tip payment credited to seller wallet"
                })
              });
            }
            ))
        }
      } catch (err) {
        console.error(`❌ Failed payout for seller ${sellerId}:`, err.message);
        functions.saveLogs({
          user: sellerId,
          log_data: JSON.stringify({
            type: "SELLER_PAYOUT_PROCESSING_FAILED",
            sellerId: sellerId,
            errorCode: err.code || null,
            errorMessage: err.message || err.toString(),
            message: "Failed to process cleared transactions for seller"
          })
        });
      }
    }

  }


  //transfer shipping fee to platform connected account
  await transfer_shipping_fee(stripe);

  // transfer service fee to platform connected account
  await transfer_service_fee(stripe);
}
async function transfer_shipping_fee(stripe) {
  const txs = await transactionModel.find({
    type: "shipping_deduction",
    status: "Pending",
    // availableOn: { $lte: Date.now() },
    availableOn: { $gte: CUTOFF_UTC_MS, $lte: Date.now() },
    paid_out: false
  });

  if (!txs.length) return;

  const total = txs.reduce((s, t) => s + t.amount, 0);
  const cents = Math.round(total * 100);

  const response = await functions.getSettings();
  if (!response["stripe_connect_account"]) return;

  const batchId = new mongoose.Types.ObjectId().toString();
  const locked = await transactionModel.updateMany(
    { _id: { $in: txs.map(t => t._id) }, paid_out: false, transfer_batch_id: { $exists: false } },
    { $set: { transfer_batch_id: batchId } }
  );
  if (locked.modifiedCount === 0) return;

  try {
    const batchKey = txs.map(t => t._id.toString()).sort().join("_");
    const idKey = `shipping_${batchId}`;
    const transfer = await stripe.transfers.create(
      { amount: cents, currency: "usd", destination: response["stripe_connect_account"], transfer_group: `shipping_${batchId}` },
      { idempotencyKey: `shipping_${idKey}` }
    );

    await transactionModel.updateMany(
      { transfer_batch_id: batchId },
      { $set: { paid_out: true, transferId: transfer.id, status: "Completed" }, $unset: { transfer_batch_id: "" } }
    );

    functions.saveLogs({
      log_data: JSON.stringify({
        type: "SHIPPING_FEE_TRANSFER_SUCCESS",
        transferId: transfer.id,
        amount: total,
        destination: response["stripe_connect_account"],
        transactionCount: txs.length,
        message: "Shipping fee transferred to platform account"
      })
    });
  } catch (e) {
    await transactionModel.updateMany(
      { transfer_batch_id: batchId },
      { $unset: { transfer_batch_id: "" } }
    );
    functions.saveLogs({
      log_data: JSON.stringify({
        type: "SHIPPING_FEE_TRANSFER_FAILED",
        amount: total,
        errorCode: e.code || null,
        errorMessage: e.message || e.toString(),
        message: "Shipping fee transfer to platform account failed"
      })
    });
    throw e;
  }
}


async function transfer_service_fee(stripe) {
  let servicefeetransactions = await transactionModel.find({
    type: "service_fee",
    status: "Pending",
    // availableOn: { $lte: Date.now() },
    availableOn: { $gte: CUTOFF_UTC_MS, $lte: Date.now() },
    paid_out: false
  });
  if (servicefeetransactions.length) {
    let totalAmount = servicefeetransactions.reduce(
      (sum, tx) => sum + tx.amount,
      0
    );
    let servicefeeCents = Math.round(totalAmount * 100);
    const transferBatchId = new mongoose.Types.ObjectId().toString();
    const locked = await transactionModel.updateMany(
      {
        _id: { $in: servicefeetransactions.map(t => t._id) },
        paid_out: false,
        transfer_batch_id: { $exists: false }
      },
      { $set: { transfer_batch_id: transferBatchId } }
    );

    if (locked.modifiedCount === 0) return;
    try {
      var response = await functions.getSettings();
      if (response["stripe_service_fee_account"]) {
        let transfer = await stripe.transfers.create({
          amount: servicefeeCents,
          currency: "usd",
          destination: response["stripe_service_fee_account"]
        });
        await transactionModel.updateMany(
          { transfer_batch_id: transferBatchId },
          { $set: { paid_out: true, transferId: transfer.id, status: "Completed" }, $unset: { transfer_batch_id: "" } }
        );
        functions.saveLogs({
          log_data: JSON.stringify({
            type: "SERVICE_FEE_TRANSFER_SUCCESS",
            transferId: transfer.id,
            amount: totalAmount,
            destination: response["stripe_service_fee_account"],
            transactionCount: servicefeetransactions.length,
            message: "Service fee transferred to platform account"
          })
        });
      } else {
        if (!response["stripe_service_fee_account"]) {
          await transactionModel.updateMany(
            { transfer_batch_id: transferBatchId },
            { $unset: { transfer_batch_id: "" } }
          );
          return;
        }
      }
    } catch (err) {
      await transactionModel.updateMany(
        { transfer_batch_id: transferBatchId },
        { $unset: { transfer_batch_id: "" } }
      );
      functions.saveLogs({
        log_data: JSON.stringify({
          type: "SERVICE_FEE_TRANSFER_FAILED",
          amount: totalAmount,
          errorCode: err.code || null,
          errorMessage: err.message || err.toString(),
          message: "Service fee transfer to platform account failed"
        })
      });
    }
  }
}
