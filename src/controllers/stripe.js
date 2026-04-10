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

var mongoose = require("mongoose");

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
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);

  try {
    let payoutdata = await userModel.findById(req.params.userId);
    if (payoutdata == null) {
      return res.json({ banks: [], status: false });
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
  console.log(req.body);
  if (!amount) {
    return res.status(500).json({
      response: "Amount is required",
      status: false,
    });
  }
  if (!user) {
    return res.status(500).json({
      response: "User is required",
      status: false,
    });
  }

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
  console.log(transaction);
  if (transaction.length == 0) {
    return res.status(500).json({
      response: "No transactions found",
      status: false,
    });
  }

  let total = Number(transaction.reduce((sum, t) => sum + t.amount, 0).toFixed(0));
  console.log(total);
  console.log(amount.toFixed(0));
  let ids = transaction.map((t) => t._id);
  
  if (total != Number(amount.toFixed(0))) {
    return res.status(500).json({
      response: "Amount does not match",
      status: false,
    });
  }
  let originalAmount = Number(req.body.amount.toFixed(2)); //1458.85
  console.log(originalAmount);
  let payoutdata = await userModel.findById(user);



  try {
    const locked = await userModel.findOneAndUpdate(
      {
        _id: user,
        walletPending: { $gte: originalAmount }
      },
      {
        $inc: {
          walletPending: -originalAmount
        }
      },
      { new: true }
    )

    if (!locked) {
      return res.status(400).json({
        response: "Insufficient pending balance",
        status: false
      })
    }
    await userModel.updateOne(
      { _id: user, walletPending: { $lt: 0.00001, $gt: -0.00001 } },
      { $set: { walletPending: 0 } }
    )
    const owed = Math.min(0, payoutdata.wallet || 0);
    const netAmount = originalAmount + owed;
    console.log("netAmount", netAmount);
    let transfer;
    if (netAmount > 0) {
      let stripeamount = Math.round(netAmount * 100);
      // console.log(payoutdata);
      let stripe_account = payoutdata["stripe_account"];
      console.log(originalAmount, stripeamount, stripe_account);
      if (stripe_account == null) {
        await userModel.updateOne(
          { _id: user },
          { $inc: { walletPending: originalAmount } }
        );
        return res.status(500).json({
          response: "Stripe account not found",
          status: false,
        });
      }
      var response = await functions.getSettings();
      const stripe = require("stripe")(response["stripeSecretKey"]);
      const batchId = new mongoose.Types.ObjectId().toString();
      const idempotencyKey = `manual_${user}_${batchId}`;
      transfer = await stripe.transfers.create({
        amount: stripeamount,
        currency: "usd",
        destination: stripe_account,
      }, { idempotencyKey });
      console.log(transfer);
      if (transfer?.status == false) {
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
        })
        return res.status(500).json({
          response: transfer?.message,
          status: false,
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
      })
    }
    //update wallet balance
    await userModel.updateOne({ _id: user }, { $inc: { wallet: originalAmount } })

    //end email to user
    const placeholders = {
      name: payoutdata?.userName,
      amount: "$" + originalAmount.toFixed(2)
    };
    console.log(placeholders);

    // await sendEmail(placeholders, payoutdata.email, "payment_available");

    // mark transaction as paid
    // console.log(ids)
    await transactionModel.updateMany(
      { _id: { $in: ids } },
      { $set: { paid_out: true, transferId: transfer?.id } }
    );

    //create a transfer record

    return res.status(200).json({
      response: "Transfer successful",
      status: true,
    })
  } catch (err) {
    console.log(err);
    await userModel.updateOne(
      { _id: user },
      { $inc: { walletPending: originalAmount } }
    )
    return {
      message: err.message,
      status: false,
    };
  }
};

exports.stripePayoutPayments = async (req, res) => {
  console.log(req.body);
  let payoutdata = await userModel.findById(req.params.userId);
  let stripe_account = payoutdata["stripe_account"];
  console.log(stripe_account);
  // return res.json({ banks: [], status: false });
  if (stripe_account == null) {
    return res.json({ banks: [], status: false });
  }
  const amount = Number(req.body.amount) || 0;
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);
  const account = await stripe.accounts.retrieve(stripe_account);
  // console.log(account);
  try {
    let banks = account["external_accounts"]["data"];
    console.log(banks);

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
        dashboard_url: "https://iconaapp.com",
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
    year, countryCode, applying, create_address, iban = null, url = 'https://iconaapp.com', mcc = '5999'
  } = req.body;
  console.log(req.body);
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

    tos_acceptance: {
      date: Math.floor(Date.now() / 1000),
      ip: req.ip,
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
  console.log(account);
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
    console.log(req.body);

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
  // try {
  let { limit = 10, page = 1, datefrom, dateto } = req.query;
  let filter = {
    type: "payout"
  };
  if (datefrom && dateto) {
    filter.date = { $gte: new Date(datefrom), $lte: new Date(dateto) };
  }

  let totalDocuments = await transactionModel.countDocuments(filter);
  let totalPages = Math.ceil(totalDocuments / limit);
  let transactions = await transactionModel.find(filter).limit(limit).skip((page - 1) * limit).sort({ date: -1 });
  res.status(200).json({
    transactions,
    totalDocuments,
    totalPages,
    currentPage: page
  });

  // } catch (err) {
  //   console.error(err);
  //   res.status(500).json({ error: err.message });
  // }
};




exports.payoutTransactions = async (req, res) => {
  try {
    var response = await functions.getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);
    let user = await userModel.findById(req.params.userId);
    if (!user?.stripe_account) {
      return res.status(404).json({ error: "User not found" });
    }
    console.log(user?.stripe_account);
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
