const functions = require("../shared/functions");
const transactionModel = require("../models/transaction");
const userModel = require("../models/user");
var mongoose = require("mongoose");
const { sendEmail } = require('../shared/email');
const CUTOFF_UTC_MS = Date.parse("2026-02-25T03:00:00.000Z");
exports.handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);
  try {
    console.log("req.body", req.body);
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
  await handleStripeEvent(event, stripe);
  res.status(200).json({ received: true });
};
exports.handleStripePlatformWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);
  try {
    console.log("req.body", req.body);
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
  await handleStripePlatformEvent(event, stripe);
  res.status(200).json({ received: true });
};
async function handleStripePlatformEvent(event, stripe) {
  // Use event type and data object to do other things
  switch (event.type) {
    case "charge.succeeded":
      console.log("💳 Charge succeeded:", event.data.object.id);
      break;
    case "balance.available":
      console.log("💰 Balance available:", event.data.object, event.account);
      if (event.account) {
        console.log("🔕 Ignoring connected account balance.available", event.account);
        return;
      }
      console.log("💰 Balance available:", event.data.object);
      await processClearedTransactions(stripe);
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


      if (user) {
        const placeholders = {
          name: user?.userName,
          amount: `$${amount.toFixed(2)}`,
          dashboard_url: "https://iconaapp.com",
          bank_name: transaction?.bank_name,
        };

        await sendEmail(placeholders, user?.email, "payout_completed");
      }

      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

async function processClearedTransactions(stripe) {
  // 1. Find cleared transactions
  const clearedTxs = await transactionModel.find({
    status: "Pending",
    availableOn: { $gte: CUTOFF_UTC_MS, $lte: Date.now() },
    to: { $ne: null },
    type: { $in: ["order", "tip"] }, paid_out: false
  });
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
      let totalAmount = 0;
      try {
        if (seller.stripe_account) {
          // Mark transactions

          await transactionModel.updateMany(
            { _id: { $in: sellerTxs.map((tx) => tx._id) } },
            { status: "Completed", payment_available: true }
          );
          let ordertransactions = await transactionModel.find(
            { _id: { $in: sellerTxs.map((tx) => tx._id) }, order_fulfilled: true, paid_out: false, type: "order" },
          );
          console.log("ordertransactions", seller?._id, ordertransactions)
          if (ordertransactions.length) {

            totalAmount = ordertransactions.reduce(
              (sum, tx) => sum + tx.amount,
              0
            );
            console.log("amot ", totalAmount)
            const owed = Math.min(0, seller.wallet || 0);
            const netAmount = totalAmount + owed;
            if (netAmount <= 0) {
              console.log("Nothing to pay after shipping deduction");
              continue;
            }
            const stripeAmount = Math.round(netAmount * 100);
            // let stripeAmount = Math.round(parseFloat(totalAmount).toFixed(2) * 100);
            console.log("stripeAmount", stripeAmount)
            const batchId = new mongoose.Types.ObjectId().toString();

            const locked = await transactionModel.updateMany(
              {
                _id: { $in: ordertransactions.map(t => t._id) },
                paid_out: false,
                payout_batch_id: { $exists: false }
              },
              { $set: { payout_batch_id: batchId } }
            );

            if (locked.modifiedCount === 0) continue;
            try {
               const idemKey = `seller_${sellerId}_${batchId}`
              const transfer = await stripe.transfers.create({
                amount: stripeAmount,
                currency: "usd",
                destination: seller.stripe_account,
                transfer_group: `seller_${sellerId}_${batchId}`,
              }, { idempotencyKey: idemKey });


              console.log("transfer from web hook ", transfer);
              console.log(`✅ Paid $${totalAmount} to seller ${sellerId}`);
              let ss = await userModel.findOneAndUpdate(
                { _id: sellerId },
                {
                  $inc: {
                    wallet: netAmount,
                    walletPending: -totalAmount
                  },
                  $set: {
                    last_stripe_transfer: new Date(),
                  }
                },
                { new: true }
              );

              await transactionModel.updateMany(
                { payout_batch_id: batchId },
                { $set: { paid_out: true, transferId: transfer.id }, $unset: { payout_batch_id: "" } }
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
                new_pending_balance: ss?.walletPending,
                transferId: transfer?.id
              })
            } catch (err) {
              await transactionModel.updateMany(
                { payout_batch_id: batchId },
                { $unset: { payout_batch_id: "" } }
              );
              throw err;
            }
            await sendPaymentEmail(seller, `${netAmount.toFixed(2)}`);
          }
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
                return;
              }
              touser.walletPending -= tiptransaction.amount;
              touser.wallet = (touser.wallet || 0) + tiptransaction.amount;
              await touser.save();
              await transactionModel.updateMany(
                { _id: { $in: tiptransactions.map((tx) => tx._id) } },
                { $set: { paid_out: true } }
              );

            }
            ))
        }
      } catch (err) {
        console.error(`❌ Failed payout for seller ${sellerId}:`, err.message);
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
  } catch (e) {
    await transactionModel.updateMany(
      { transfer_batch_id: batchId },
      { $unset: { transfer_batch_id: "" } }
    );
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
    }
  }
}

async function sendPaymentEmail(seller, amount) {
  try {
    let ownerEmail = seller?.email;
    console.log("ownerEmail", ownerEmail)
    if (!ownerEmail) {
      console.error('❌ [Analytics Email] Room owner email not found');
      return;
    }

    const placeholders = {
      name: seller?.userName,
      amount: '$' + amount
    };

    await sendEmail(placeholders, ownerEmail, "payment_available");

    console.log(`✅ [Analytics Email] Successfully sent to ${ownerEmail}`);

  } catch (error) {
    console.error(`❌ [Analytics Email] Error:`, error.message);
  }
}