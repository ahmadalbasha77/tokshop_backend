const userModel = require("../models/user");
const jwt = require("jsonwebtoken");
require("dotenv").config({ path: `${__dirname}/../../.env` });
const functions = require("../shared/functions");
const withdrawModel = require("../models/withdraw");
const transactionModel = require("../models/transaction");
const axios = require("axios");
const reportModel = require("../models/report");
const utils = require("../../utils");
var orderModel = require("../models/order");
var offerModel = require("../models/offer");
const roomsModel = require("../models/room");
var productModel = require("../models/product");
var paymentmethodModel = require("../models/payment_methods");
var payouthodModel = require("../models/payout_methods");
var reviewModel = require("../models/userreview");
var mongoose = require("mongoose");
const bank = require("../models/bank");
const { createTestStripeToken } = require("./stripe");
const { sendEmail } = require("../shared/email");
const ReferralLog = require("../models/referral_log");
// const allusersMakethemsellers = async () => {
//   await userModel.updateMany({ applied_seller: false }, { applied_seller: true });
// }
// // allusersMakethemsellers();
// const initDemoPaymentMethodsForNonSellers = async () => {
//   const settings = await functions.getSettings();
//   if (!settings.demoMode) {
//     console.log("Demo mode disabled — skipping demo payment method init");
//     return {
//       processed: 0,
//       created: 0,
//       skipped: 0,
//     };
//   }

//   let processed = 0;
//   let created = 0;
//   let skipped = 0;
//   let errors = [];

//   const cursor = userModel.find({
//     seller: false,
//     // email: "githumbi3fred@gmail.com"
//   }).cursor(); 

//   for await (const user of cursor) {
//     processed++;

//     if (user.defaultpaymentmethod) {
//       skipped++;
//       continue;
//     }

//     try {
//       await createTestStripeToken(
//         {
//           body: {
//             email: user.email,
//             name: `${user.firstName} ${user.lastName}`,
//             userid: user._id,
//           },
//         },
//         {
//           status: () => ({ json: () => {} }),
//         }
//       ); 
//       console.log(user.userName);

//       await sendEmail({name: user.userName}, user.email,'seller_approval');
//       await sendEmail({name: user.userName}, user.email,'promotion', "Check Out Tokshop All Features");

//       created++;
//     } catch (err) {
//       console.error(
//         `Stripe demo token failed for user ${user._id}:`,
//         err.message
//       );

//       errors.push({
//         userId: user._id,
//         email: user.email,
//         error: err.message, 
//       });
//     }

//     // Throttle Stripe
//     if (processed % 50 === 0) {
//       await new Promise((r) => setTimeout(r, 300));
//     }
//   }

//   return {
//     processed,
//     created,
//     skipped,
//     errorsCount: errors.length,
//     errors,
//   };
// };

// // initDemoPaymentMethodsForNonSellers();
exports.userExists = async (req, res) => {
  let { email } = req.query;
  let respo = await userModel.findOne({ email });
  if (respo) {
    return res.json({ success: true });
  } else {
    res.json({ success: false });
  }
};
exports.publicProfile = async (req, res) => {
  let { id } = req.params;
  let respo = await userModel.findOne({ _id: id }).select("userName profilePhoto ");
  if (respo) {
    return res.json({ success: true, user: respo });
  } else {
    res.json({ success: false });
  }
}
exports.referalStats = async (req, res) => {
  const { userId } = req.params;

  const stats = await ReferralLog.aggregate([
    {
      $match: {
        referrerId: new mongoose.Types.ObjectId(userId)
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "referredUserId",
        foreignField: "_id",
        as: "referredUser"
      }
    },
    { $unwind: "$referredUser" },
    {
      $match: {
        "referredUser.awarded_referal_credit": true
      }
    },
    {
      $count: "count"
    }
  ]);

  return res.json({ count: stats[0]?.count || 0 });
};

exports.getReferalLogs = async (req, res) => {
  let { userId, page = 1, limit = 10, username } = req.query;
  let filter = {};
  if (userId) {
    filter = { referrerId: userId };
  }
  if (username) {
    // filter user by username text like
    let userIds = await userModel.find({ userName: { $regex: username, $options: "i" } });
    filter.$or = [{ referrerId: { $in: userIds.map(u => u._id) } }, { referredUserId: { $in: userIds.map(u => u._id) } }]
  }
  const skip = (page - 1) * limit;
  console.log(filter);
  const logs = await ReferralLog.find(filter)
    .populate("referrerId", "userName")
    .populate("referredUserId", "userName awarded_referal_credit")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const count = await ReferralLog.countDocuments(filter);
  return res.json({ logs, currentPage: page, totalPages: Math.ceil(count / limit), totalRecords: count });


}
exports.pendingUserPayouts = async (req, res) => {

  const todayStart = new Date("2026-02-26T00:00:00.000Z").getTime(); // today UTC start

  const total = await transactionModel.aggregate([
    {
      $match: {
        payment_available: true,
        paid_out: false,
        type: "order",
        status: "Completed",
        itemId: { $exists: true },
        chargeId: { $exists: true },
        availableOn: { $gte: todayStart }   // ✅ today and future
      }
    },
    {
      $group: {
        _id: "$to",                 // seller/user id
        total: { $sum: "$amount" },
        count: { $sum: 1 },
        transactions: {
          $push: {
            _id: "$_id",
            amount: "$amount",
            orderId: "$orderId",
            itemId: "$itemId",
            availableOn: "$availableOn",
            chargeId: "$chargeId",
            transferId: "$transferId",
            status: "$status",
            type: "$type"
          }
        }
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user"
      }
    },
    { $unwind: "$user" },
    {
      $project: {
        _id: 0,
        userId: "$user._id",
        email: "$user.email",
        userName: "$user.userName",
        total: 1,
        count: 1,
        transactions: 1        // ✅ include raw transactions
      }
    },
    { $sort: { total: -1 } }
  ]);

  res.json({ total });
};

exports.approveSeller = async (req, res) => {
  let { action } = req.body;
  let response = await userModel.findByIdAndUpdate(
    req.params.id,
    {
      $set: { seller: action == "reject" ? false : true },
    },
    { new: true, runValidators: true }
  );

  var data = await functions.getSettings();
  if (data["stripeSecretKey"] !== "") {
    const stripe = require("stripe")(data["stripeSecretKey"]);
    await stripe.accounts.update(response.stripe_account, {
      settings: {
        payouts: {
          schedule: { interval: "manual" }
        }
      }
    });
  }
  if (response) {
    functions.sendNotification(
      [response.fcmToken],
      action == "reject" ? "Rejected!" : "Approved!",
      action == "reject" ? `You have been rejected to start selling` : `Congratulations! you have been approved to start selling`,
      {
        screen: "approved",
      }
    );
  }
  res.json({ success: true });

};
exports.getProfileSummary = async (req, res) => {
  var ObjectID = require("mongodb").ObjectID;

  const totalSales = await orderModel.aggregate([
    {
      $match: {
        $or: [{ shopId: { $eq: new ObjectID(req.params.shopid) } }],
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$totalCost" },
        count: {
          $sum: 1,
        },
      },
    },
  ]);

  const rooms = await roomsModel.aggregate([
    {
      $match: {
        $or: [{ shopId: { $eq: new ObjectID(req.params.shopid) } }],
      },
    },
    {
      $group: {
        _id: null,
        count: {
          $sum: 1,
        },
      },
    },
  ]);
  const products = await productModel.aggregate([
    {
      $match: {
        $or: [
          {
            deleted: { $eq: false },
          },
        ],
      },
    },
    {
      $group: {
        _id: null,
        count: {
          $sum: 1,
        },
      },
    },
  ]);

  res.send({
    totalSales: totalSales.length === 0 ? 0 : totalSales[0],
    rooms: rooms.length === 0 ? 0 : rooms[0]["count"],
    products: products.length === 0 ? 0 : products[0]["count"],
  });
};

exports.createPayoutMethod = async (req, res, next) => {
  let response = await payouthodModel.find({ userid: req.body.userid });
  if (response.length > 0) {
    await payouthodModel.findByIdAndDelete(response[0]._id);
  }
  await payouthodModel
    .create(req.body)
    .then(
      async (reponse) => {
        res.json(reponse);
      },
      (err) => {
        res.status(422).setHeader("Content-Type", "application/json").json(err);
      }
    )
    .catch((e) => {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.json(e);
    });
};

exports.getPayoutmethodByUserId = async (req, res, next) => {
  let response = await payouthodModel.find({ userid: req.params.id });
  res.json(response);
};

exports.deletePayoutmethod = async (req, res, next) => {
  let cardresponse = await payouthodModel
    .findByIdAndDelete(req.params.id);
  res.json({ success: true });
};

exports.createPaymentMethod = async (req, res, next) => {
  var response = await functions.getSettings();
  const stripe = require("stripe")(response["stripeSecretKey"]);

  if (req.body.customerid == null) {
    const customerdata = await stripe.customers.create({
      description: "Tokshop",
    });
    req.body.customerid = customerdata.id;
  }
  await stripe.customers.update(req.body.customerid, {
    source: req.body.token,
  });
  let cardresponse = await paymentmethodModel
    .create(req.body)
    .then(
      async (reponse) => {
        console.log("reponse ", reponse);
        let user = await userModel.findByIdAndUpdate(
          reponse.userid,
          {
            $set: { defaultpaymentmethod: reponse._id },
          },
          { new: true, runValidators: true }
        );

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.json({ reponse, success: true });
      },
      (err) => {
        res.status(422).setHeader("Content-Type", "application/json").json(err);
      }
    )
    .catch((e) => {
      console.log(e);
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.json(e);
    });
};

exports.getPaymentmethodByUserId = async (req, res, next) => {
  let cardresponse = await paymentmethodModel
    .find({ userid: req.params.id })
    .sort({ createdAt: -1 });
  res.json(cardresponse);
};
exports.updatePaymentmethod = async (req, res, next) => {
  let cardresponse = await paymentmethodModel
    .findByIdAndUpdate(req.params.id, req.body);
  res.json({ success: true, cardresponse });
}

exports.deletePaymentmethod = async (req, res, next) => {
  let cardresponse = await paymentmethodModel
    .findByIdAndDelete(req.params.id);
  res.json({ success: true });
};

exports.getUsers = async (req, res, next) => {
  const { title, page, limit, currentUserId, status, type } = req.query;

  const queryObject = {};

  if (title) {
    queryObject.$or = [{ userName: { $regex: `${title}`, $options: "i" } }, { firstName: { $regex: `${title}`, $options: "i" } }, { lastName: { $regex: `${title}`, $options: "i" } }, { email: { $regex: `${title}`, $options: "i" } }];
  }
  if (status == "pending") {
    queryObject.applied_seller = true;
    queryObject.seller = false;
  }
  if (status == "suspended") {
    queryObject.suspended = true;
  }
  if (type == "seller") {
    queryObject.seller = true;
  }
  if (type == "customer") {
    queryObject.seller = false;
  }

  const pages = Number(page);
  const limits = Number(limit);
  const skip = (pages - 1) * limits;

  try {
    const blockedOwners = await userModel
      .find({ blocked: currentUserId })
      .select("_id");
    const blockedOwnerIds = blockedOwners.map(u => u._id);

    if (blockedOwnerIds.length > 0) {
      queryObject._id = { $nin: blockedOwnerIds };
    }

    const totalDoc = await userModel.countDocuments(queryObject);
    const users = await userModel
      .find(queryObject)
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
      .limit(limits);

    res.send({
      users,
      totalDoc,
      limits,
      pages,
    });
  } catch (err) {
    res.status(500).send({
      message: err.message,
    });
  }
};

exports.getUserById = async (req, res) => {

  try {
    const user = await userModel
      .findById(req.params.userId)
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
      .populate("defaultpaymentmethod")
      .populate("address");

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    var response = await functions.getSettings();
    let demoMode = false;
    if (response) {
      demoMode = response["demoMode"];
    }
    if (!user.defaultpaymentmethod && demoMode === true) {
      try {
        await createTestStripeToken({
          body: {
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
            userid: user._id,
          }
        }, res);
      } catch (err) {
        console.error("Stripe token creation failed:", err);
      }
    }
    //if address is missing a name use the username
    if (user?.address && user?.address.name === "") {
      user.address.name = user.firstName + " " + user.lastName || user.userName;
    }

    return res.status(200).json(user);
  } catch (err) {
    console.error("getUserById error:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

exports.updateShipingSettings = async function (req, res) {
  try {
    const userId = req.params.id;
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Extract settings from body
    const {
      priorityMailEnabled,
      groundAdvantageEnabled,
      shippingCostMode,
      reducedShippingCapAmount
    } = req.body;

    // Validate mode if provided
    const validModes = ["seller_pays_all", "buyer_pays_up_to", "buyer_pays_all"];
    if (shippingCostMode && !validModes.includes(shippingCostMode)) {
      return res.status(400).json({ message: "Invalid shippingCostMode value" });
    }

    // Build update object dynamically
    const updateData = {};
    if (priorityMailEnabled !== undefined)
      updateData["shipping_settings.priorityMailEnabled"] = priorityMailEnabled;
    if (groundAdvantageEnabled !== undefined)
      updateData["shipping_settings.groundAdvantageEnabled"] = groundAdvantageEnabled;
    if (shippingCostMode)
      updateData["shipping_settings.shippingCostMode"] = shippingCostMode;
    if (reducedShippingCapAmount !== undefined)
      updateData["shipping_settings.reducedShippingCapAmount"] = Number(reducedShippingCapAmount);

    // Optional legacy compatibility
    if (shippingCostMode === "seller_pays_all") {
      updateData["shipping_settings.buyer_pays"] = false;
      updateData["shipping_settings.seller_pays"] = true;
    } else {
      updateData["shipping_settings.buyer_pays"] = true;
      updateData["shipping_settings.seller_pays"] = false;
    }

    console.log(updateData)
    // Perform update
    const updatedUser = await userModel.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    ).select("shipping_settings");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      message: "Shipping settings updated successfully",
      shipping_settings: updatedUser.shipping_settings,
    });
  } catch (error) {
    console.error("Error updating shipping settings:", error);
    res.status(500).json({
      message: "Failed to update shipping settings",
      error: error.message,
    });
  }
};


exports.userFollowersFollowing = async function (req, res) {
  try {
    let { currentUserId } = req.query
    let query = {
      $and: [
        { following: req.params.userId },
        { followers: req.params.userId },
        { accountDisabled: { $ne: true } },
      ],
    };

    if (currentUserId) {
      const blockedMe = await userModel
        .find({ blocked: currentUserId })
        .select("_id");
      const blockedMeIds = blockedMe.map(u => u._id);
      if (blockedMeIds.length > 0) {
        query._id = { $nin: blockedMeIds };
      }
    }

    const users = await userModel.find(query);

    res.json(users);
  } catch (error) {
    console.log(error + " ");
    res.status(404).send(error);
  }
};

exports.userFollowers = async function (req, res) {
  try {
    let { page = 1, limit = 10 } = req.query
    let id = req.params.userId;
    const user = await userModel.findById(id).select("followers");
    let total = user?.followers?.length || 0;
    const users = await userModel
      .find({ _id: { $in: user.followers } }).select("_id firstName lastName profilePhoto userName")
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      users,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.log(error + " ");
    res.status(404).send(error);
  }
};

exports.userByUsername = async function (req, res) {
  try {
    const users = await userModel.find({
      $and: [
        { accountDisabled: { $ne: true } },
        { userName: req.params.userName },
      ],
    });

    res.json(users.length);
  } catch (error) {
    console.log(error + " ");
    res.status(404).send(error);
  }
};

exports.userFollowing = async function (req, res) {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const userId = req.params.userId;

    const user = await userModel.findById(userId).select("following");
    if (!user) return res.status(404).json({ message: "User not found" });

    const total = user.following.length;

    const users = await userModel.aggregate([
      { $match: { _id: { $in: user.following } } },
      {
        $addFields: {
          order: { $indexOfArray: [user.following, "$_id"] },
        },
      },
      { $sort: { order: -1 } }, // latest followed first
      { $skip: (page - 1) * limit },
      { $limit: limit },
      {
        $project: {
          _id: 1,
          firstName: 1,
          lastName: 1,
          profilePhoto: 1,
          userName: 1,
        },
      },
    ]);

    res.json({
      users,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
};


exports.searchForUserFriends = async function (req, res) {
  try {
    const users = await userModel
      .find({
        $and: [
          {
            $expr: {
              $regexMatch: {
                input: {
                  $concat: ["$firstName", " ", "$lastName"],
                },
                regex: req.params.name,
                options: "i",
              },
            },
          },
          { accountDisabled: { $ne: true } },
          { following: req.params.userId },
          { followers: req.params.userId },
          { blocked: "62e66023ccdb405316d17185" },
        ],
      })
      .populate("channel")
      .populate("interest")
      .limit(20);

    res.json(users);
  } catch (error) {
    res.status(404).send(error);
  }
};

exports.addUser = (req, res) => {
  const newUser = {
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    department: req.body.department,
    title: req.body.title,
    email: req.body.email,
    type: req.body.type,
    password: req.body.password,
    profilePhoto: req.body.profilePhoto,
  };
  if (req.body.type == "apple") {
  }

  userModel
    .create(newUser)
    .then(
      (savedUser) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.json(savedUser);
      },
      (err) => {
        res.status(422).setHeader("Content-Type", "application/json").json(err);
      }
    )
    .catch((e) => {
      console.log(e + " ");
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.json(e + " ");
    });
};

exports.getAllWithdraws = async (req, res) => {
  withdrawModel
    .find({})
    .populate("userId", [
      "firstName",
      "lastName",
      "bio",
      "userName",
      "email",
      "profilePhoto",
      "_id",
    ])
    .populate("channel")
    .populate("interest")
    .then(
      (workers) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.json(workers);
      },
      (e) => {
        console.log(e + " ");
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.json(e + " ");
      }
    )
    .catch((e) => {
      console.log(e + " ");
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.json(e + " ");
    });
};

exports.getWithdrawById = async (req, res) => {
  withdrawModel
    .findById(req.params.withdrawId)
    .populate("userId", [
      "firstName",
      "lastName",
      "bio",
      "userName",
      "email",
      "profilePhoto",
      "_id",
    ])
    .populate("channel")
    .populate("interest")
    .then(
      (workers) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.json(workers);
      },
      (e) => {
        console.log(e + " ");
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.json(e + " ");
      }
    )
    .catch((e) => {
      console.log(e + " ");
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.json(e + " ");
    });
};

exports.deleteWithdraw = async (req, res) => {
  withdrawModel
    .findByIdAndDelete(req.params.withdrawId)
    .then(
      (workers) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.json(workers);
      },
      (e) => {
        console.log(e + " ");
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json");
        res.json(e + " ");
      }
    )
    .catch((e) => {
      console.log(e + " ");
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.json(e + " ");
    });
};

exports.sendTip = async (req, res) => {
  const { from, to, reason, amount, tokshow } = req.body;
  const paymentmethod = await paymentmethodModel.findOne({
    userid: new mongoose.Types.ObjectId(from),
    primary: true,
  });
  if (!paymentmethod) {
    return res.json({ status: false, message: "No payment method found" });
  }
  var settingsresponse = await functions.getSettings();
  const serviceFee = (parseFloat(settingsresponse['tip_processing']) / 100) * amount;
  // Charge Stripe
  const { charge, balanceTx, success, error } = await functions.chargeStripePaymentMethod(
    amount,
    paymentmethod,
    null,
    to,
    serviceFee, 0, 0
  );

  if (success == false) {
    return res.json({ success: success, message: error?.error });
  }
  const touser = await userModel.findByIdAndUpdate(
    to,
    { $inc: { walletPending: parseInt(amount) * 1 } },
    { runValidators: true, new: true }
  );



  let newTransaction1 = {
    from: from,
    to: to,
    reason: utils.Transactionreasons.RECEIVEDTIP,
    amount: amount,
    type: "tip",
    deducting: false,
    date: Date.now(),
    status: "Pending",
    paid_out: false,
    payment_available: false,
    chargeId: charge.id,
    balanceTransactionId: charge.balance_transaction?.id,
    availableOn: balanceTx?.available_on * 1000,
  };

  let t1 = new transactionModel(newTransaction1);
  await t1.save();

  const fromuser = await userModel.findByIdAndUpdate(from, {
    runValidators: true,
    new: true,
  });
  functions.saveActivity(
    from,
    "Received a Tip!",
    "WalletScreen",
    false,
    fromuser.profilePhoto,
    to,
    "You have been tipped $" + amount + " by " + fromuser.firstName,
    from
  );

  functions.saveActivity(
    fromuser._id,
    "Sent a Tip!",
    "WalletScreen",
    false,
    touser.profilePhoto,
    fromuser._id,
    "You have sent a tip of $" + amount + " to " + touser.firstName,
    touser._id
  );

  functions.sendNotification(
    [touser.fcmToken],
    "You have received a tip of $" + amount + " from " + fromuser.firstName,
    "👋👋👋👋",
    { screen: "ProfileScreen", id: touser._id?.toString() }
  );
  functions.sendNotification(
    [fromuser.fcmToken],
    "You have sent a tip of $" + amount + " to " + touser.firstName,
    "👋👋👋👋",
    { screen: "ProfileScreen", id: fromuser._id?.toString() }
  );


  //update room with total tipps
  if (tokshow) {
    await roomsModel.findByIdAndUpdate(
      tokshow,
      { $inc: { tipsTotal: parseInt(amount) * 1 } },
      { runValidators: true, new: true }
    );
  }

  res.statusCode = 200;
  res.json({ touser, success: success, message: "tip successfully sent" });
};

exports.editUserById = async (req, res) => {
  console.log(req.body)
  let { type, password, email, new_email } = req.body;
  if (type == "change_email") {
    try {
      //validate password
      var settingsresponse = await functions.getSettings();
      const FIREBASE_API_KEY = settingsresponse["FIREBASE_API_KEY"];
      const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;

      // Make request to Firebase Auth REST API
      var response = await axios.post(url, {
        email: new_email,
        password: password,
        returnSecureToken: true, // Get Firebase ID token
      });
      console.log(response.data);
      return res.json(response.data);
    } catch (error) {
      console.error("❌ Login error:", error.response?.data || error.message);

      // Handle Firebase Auth errors
      const firebaseError = error.response?.data?.error?.message;
      console.log(firebaseError);

      switch (firebaseError) {
        case "EMAIL_NOT_FOUND":
          return res.status(400).json({
            success: false,
            message: "User not found."
          });

        case "INVALID_PASSWORD":
          return res.status(400).json({
            success: false,
            message: "Incorrect password."
          });

        case "INVALID_LOGIN_CREDENTIALS": // New error type
          return res.json({
            user: {
              success: false,
              message: "Incorrect password."
            }
          });

        case "USER_DISABLED":
          return res.status(400).json({
            success: false,
            message: "Account has been disabled."
          });

        case "TOO_MANY_ATTEMPTS_TRY_LATER":
          return res.status(429).json({
            success: false,
            message: "Too many failed attempts. Please try again later."
          });

        case "INVALID_EMAIL":
          return res.status(400).json({
            success: false,
            message: "Invalid email format."
          });

        default:
          return res.status(500).json({
            success: false,
            message: "An unexpected error occurred.",
            error: firebaseError || error.message,
          });
      }
    }
  }
  userModel
    .findByIdAndUpdate(
      req.params.userId,
      {
        $set: req.body,
      },
      { new: true, runValidators: true }
    )
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
    .populate("defaultpaymentmethod")
    .populate("payoutmethod")
    .populate({
      path: "address",
      populate: {
        path: "userId",
      },
    })
    .populate({
      path: "address",
      populate: {
        path: "userId",
      },
    })

    .then(
      (user) => {
        if (req.body.suspended == true) {
          functions.sendNotification(
            [user.fcmToken],
            "Account Suspended",
            "Your account has been suspended.",
            {
              screen: "ProfileScreen",
              id: user._id?.toString(),
            }
          )
        }
        if (req.body.suspended == false) {
          functions.sendNotification(
            [user.fcmToken],
            "Account Activated",
            "Your account has been activated.",
            {
              screen: "ProfileScreen",
              id: user._id?.toString(),
            }
          )
        }
        if (user) {
          return res.json({ user, success: true });
        }
        const token = jwt.sign(user?.email, process.env.secret_key);

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.json({ user, token, success: true });
      },
      (err) => {
        console.log(err);
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.json({ err, success: false });
      }
    )
    .catch((err) => {
      console.log(err);
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.json({ err, success: false });
    });
};

exports.deleteUserById = (req, res, next) => {
  userModel.findByIdAndDelete(req.params.userId).then((user) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.json(user);
  });
};
exports.userStats = async (req, res) => {
  try {
    // get status of total users, blocked users, total customers,  pending sellers, active sellers
    let totalUsers = await userModel.countDocuments();
    let blockedUsers = await userModel.countDocuments(
      { system_blocked: true }
    );
    let totalCustomers = await userModel.countDocuments(
      { applied_seller: false, seller: false }
    );
    let pendingSellers = await userModel.countDocuments({
      applied_seller: true,
      seller: false
    })
    let activeSellers = await userModel.countDocuments({
      applied_seller: true,
      seller: true
    })
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.json({
      totalUsers,
      blockedUsers,
      totalCustomers,
      pendingSellers,
      activeSellers
    });
  } catch (error) {
    console.log(error);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.json({ err: error, success: false });
  }
}

exports.blockUser = async (req, res) => {
  try {
    let myUid = req.params.myUid;
    let toBlockUid = req.params.toBlockUid;

    let myUpdatedUser = await userModel.findByIdAndUpdate(
      myUid,
      {
        $addToSet: { blocked: toBlockUid },
      },
      { runValidators: true, new: true, upsert: false }
    );
    await userModel.findByIdAndUpdate(
      toBlockUid,
      {
        $addToSet: { blocked_by: myUid },
      },
      { runValidators: true, new: true, upsert: false }
    );

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    myUpdatedUser["success"] = true;
    res.json(myUpdatedUser);
  } catch (error) {
    console.log(error + " ");
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.json({ success: false });
  }
};

exports.followUser = async (req, res) => {
  try {
    let myUid = req.params.myUid;
    let toFollowUid = req.params.toFollowUid;

    // Add me to their followers ✅ and increase THEIR follower count
    let followed = await userModel.findByIdAndUpdate(
      toFollowUid,
      {
        $addToSet: { followers: myUid },
        $inc: { followersCount: 1 },
      },
      { new: true }
    );

    // Add them to my following ✅ and increase MY following count
    let following = await userModel.findByIdAndUpdate(
      myUid,
      {
        $addToSet: { following: toFollowUid },
        $inc: { followingCount: 1 },
      },
      { new: true }
    );

    // Send notification
    if (followed?.notification_settings?.notify_on_follow) {
      functions.sendNotification(
        [followed.fcmToken],
        "New follower 👋",
        `${following.firstName} ${following.lastName} started following you`,
        { screen: "ProfileScreen", id: myUid }
      );
    }

    // ✅ Only become friends if THEY already follow me back
    if (followed?.following?.includes(myUid)) {
      await userModel.updateMany(
        { _id: { $in: [myUid, toFollowUid] } },
        { $addToSet: { friends: toFollowUid } }
      );
    }

    functions.saveActivity(
      toFollowUid,
      "New follower",
      "ProfileScreen",
      false,
      null,
      myUid,
      "You have a new follower",
      toFollowUid
    );

    res.json({ ...following.toObject(), success: true });

  } catch (error) {
    console.log(error);
    res.status(400).json({ success: false });
  }
};



exports.deleteBank = async (req, res) => {
  try {
    let id = req.params.id;
    console.log(id);
    let respo = await bank.findOneAndDelete({ userid: id });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.json(respo);
  } catch (error) {
    console.log(error + " ");
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.json([]);
  }
};
exports.deleteUserData = async (req, res) => {
  try {
    let id = req.params.id;
    console.log(id);
    let respo = await userModel.findOneAndDelete({ _id: id });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.json(respo);
  } catch (error) {
    console.log(error + " ");
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.json([]);
  }
}
exports.getbank = async (req, res) => {
  try {
    let id = req.params.id;
    console.log(id);
    let respo = await bank.findOne({ userid: id });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.json(respo);
  } catch (error) {
    console.log(error + " ");
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.json([]);
  }
};

exports.getFriends = async (req, res) => {
  try {
    const { name } = req.query;
    const userId = new mongoose.Types.ObjectId(req.params.id);

    const query = {
      followers: { $in: [userId] },
      following: { $in: [userId] },
    };

    if (name) {
      query.firstName = { $regex: name, $options: "i" };
    }
    console.log(query);

    const friends = await userModel.find(query).select("_id firstName lastName profilePhoto userName");

    return res.status(200).json(friends);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    let myUid = req.params.myUid;
    let toBlockUid = req.params.toBlockUid;

    let myUpdatedUser = await userModel.findByIdAndUpdate(
      myUid,
      {
        $pullAll: { blocked: [toBlockUid] },
      },
      { runValidators: true, new: true, upsert: false }
    );

    await userModel.findByIdAndUpdate(
      toBlockUid,
      {
        $pullAll: { blocked_by: [myUid] },
      },
      { runValidators: true, new: true, upsert: false }
    );

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.json(myUpdatedUser);
  } catch (error) {
    console.log(error);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.json(error);
  }
};

exports.unFollowUser = async (req, res) => {
  try {
    let myUid = req.params.myUid;
    let toFollowUid = req.params.toFollowUid;

    // Remove me from their followers ✅ and decrease THEIR count
    await userModel.findByIdAndUpdate(
      toFollowUid,
      {
        $pull: { followers: myUid },
        $inc: { followersCount: -1 },
      }
    );

    // Remove them from my following ✅ and decrease MY count
    let myUpdatedUser = await userModel.findByIdAndUpdate(
      myUid,
      {
        $pull: { following: toFollowUid },
        $inc: { followingCount: -1 },
      },
      { new: true }
    );

    // If we were friends, remove friend relationship
    if (myUpdatedUser?.friends.includes(toFollowUid)) {
      await userModel.updateMany(
        { _id: { $in: [myUid, toFollowUid] } },
        { $pull: { friends: { $in: [myUid, toFollowUid] } } }
      );
    }

    res.json(myUpdatedUser);

  } catch (error) {
    console.log(error);
    res.status(400).json(error);
  }
};


exports.updateWallet = async (req, res) => {
  try {
    let amount = req.body.amount;
    let user = req.params.userId;

    await userModel.findByIdAndUpdate(
      user,
      { $inc: { wallet: amount } },
      { runValidators: true, new: true, upsert: false }
    );

    functions.saveActivity(
      process.env.GISTSHOPUSER,
      "Deposited",
      "deposit",
      false,
      null,
      user,
      "You have successfully deposited GP " + amount,
      process.env.GISTSHOPUSER
    );

    let newTransaction = {
      from: process.env.GISTSHOPUSER,
      to: user,
      reason: utils.Transactionreasons.DEPOSIT,
      amount: amount,
      type: "deposit",
      deducting: false,
      date: Date.now(),
    };
    await transactionModel.create(newTransaction);

    let newTransaction2 = {
      to: process.env.GISTSHOPUSER,
      from: user,
      reason: utils.Transactionreasons.DEPOSIT,
      amount: amount,
      type: "deposit",
      deducting: false,
      date: Date.now(),
    };
    await transactionModel.create(newTransaction2);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.json({ Success: true });
  } catch (error) {
    console.log(error);
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.json({ Success: false, message: error + " " });
  }
};
exports.deleteUserReviewsById = async (req, res) => {
  try {
    let deleted = await reviewModel.findOneAndRemove(req.params.id);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: deleted });
  } catch (error) {
    console.log(error);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.checkCanReview = async (req, res) => {
  try {
    let reviewresponse = await orderModel.find({
      customerId: req.params.id,
      shopId: req.body.id,
    });

    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({
        success: true,
        canreview: reviewresponse.length > 0 ? true : false,
      });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.getUserReviews = async (req, res) => {
  try {
    let reviewresponse = await reviewModel
      .find({ to: req.params.id })
      .populate("from", ["firstName", "profilePhoto"])
      .populate("reviews")
      .sort("-_id");
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: reviewresponse });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.addUserReview = async (req, res) => {
  try {
    let exists = await reviewModel.findOne({
      from: req.body.id,
      to: req.params.id,
      reviewType: req.body.reviewType,
      reviewedItem: req.body.reviewedItem,
    });

    if (exists) {
      return res.json({
        success: false,
        message: "You already left a review for this item",
      });
    }

    const review = await reviewModel.create({
      to: req.params.id,
      from: req.body.id,
      review: req.body.review,
      overall: req.body.overall,
      shipping: req.body.shipping,
      packaging: req.body.packaging,
      accuracy: req.body.accuracy,
      reviewedItem: req.body.reviewedItem,
      reviewType: req.body.reviewType,
    });

    // calculate average based on overall rating only
    const reviews = await reviewModel.find({ to: req.params.id });
    const avg =
      reviews.reduce((sum, r) => sum + (r.overall || 0), 0) / reviews.length;

    await userModel.findByIdAndUpdate(req.params.id, {
      averagereviews: avg,
      $addToSet: { reviews: review._id },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(422).json({ success: false, error: error.message });
  }
};

exports.reportUser = async (req, res) => {
  try {
    let response = await reportModel.create(req.body);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: response });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.getreportedcases = async (req, res) => {
  // try {

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  // Calculate skip
  const skip = (page - 1) * limit;

  // Fetch paginated data
  const data = await reportModel.find().populate("reported", "userName system_blocked").populate("reported_by", "userName system_blocked").skip(skip).limit(limit);

  // Get total count
  const total = await reportModel.countDocuments();

  // Response with pagination info
  return res.json({
    success: true,
    currentPage: page,
    totalPages: Math.ceil(total / limit),
    totalRecords: total,
    data,
  });
  // } catch (error) {
  //   return res.status(500).json({ success: false, message: error.message });
  // }
}

exports.accountStatistics = async (req, res) => {
  try {
    const { id } = req.params;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(today.getDate() + 7);

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const [
      ordersCount,
      pendingOffers,
      shows,
      user,
      ordersThisWeek,
    ] = await Promise.all([
      // Orders waiting for label
      orderModel.countDocuments({
        need_label: true,
        seller: id,
      }),

      // Pending offers expiring in next 7 days
      offerModel.find({
        status: "pending",
        seller: id,
        expireAt: { $gte: today, $lte: sevenDaysFromNow },
      }).select("expireAt"),

      // Upcoming shows
      roomsModel
        .find({ owner: id, ended: false })
        .populate("owner", "coverPhoto")
        .sort({ date: 1 })
        .limit(4),

      // Wallet info
      userModel.findById(id).select("wallet walletPending"),

      // 🔥 Orders created in the last 7 days
      orderModel.countDocuments({
        seller: id,
        createdAt: { $gte: sevenDaysAgo },
      }),
    ]);

    // 🔥 Group expiring offers by weekday
    const groupedByDay = {};

    pendingOffers.forEach((offer) => {
      const dayName = dayNames[new Date(offer.expiresAt).getDay()];
      groupedByDay[dayName] = (groupedByDay[dayName] || 0) + 1;
    });

    // Convert to ordered summary (nearest days first)
    const expiringSummary = [];

    for (let i = 0; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const dayName = dayNames[date.getDay()];
      if (groupedByDay[dayName]) {
        expiringSummary.push({
          day: dayName,
          count: groupedByDay[dayName],
          label: `${groupedByDay[dayName]} expiring on ${dayName}`,
        });
      }
    }

    return res.json({
      success: true,
      data: {
        orders_count: ordersCount,
        offers_count: pendingOffers.length,

        // 👇 THIS is what you asked for
        offers_expiring_in_7_days: expiringSummary,

        count_expiring_in_7_days: pendingOffers.length,
        shows_count: shows.length,
        shows,
        wallet: user?.wallet || 0,
        pending_wallet: user?.walletPending || 0,
        orders_this_week: ordersThisWeek,
      },
    });
  } catch (error) {
    console.error("accountStatistics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch account statistics",
    });
  }
};

