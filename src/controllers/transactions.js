const transactionModel = require("../models/transaction");
const mongoose = require("mongoose");
const userModel = require("../models/user");

exports.getUserTransactionsByUserId = async (req, res) => {
  try {
    let transactions = await transactionModel
      .find({
        $or: [{ to: req.params.userId }],
      })
      .sort({ date: -1 })
      .limit(20)
      .populate("from", ["firstName", "lastName", "bio", "userName", "email"])
      .populate("to", ["firstName", "lastName", "bio", "userName", "email"]);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json(transactions);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.getUserTransactions = async (req, res) => {
  let { userId, page, limit, status, username } = req.query;

  const usertype = (req.query.usertype || "").toLowerCase();
  const isAdmin = usertype === "admin";
  try {
    page = parseInt(page) || 1;
    limit = parseInt(limit) || 10;
    let filter = {};
    if (userId) {
      filter = {
        $or: [
          { from: new mongoose.Types.ObjectId(userId) },
          { to: new mongoose.Types.ObjectId(userId) },
        ],
      };
    }

    if (status) {
      filter.status = status;
    }

    if (username) {
      // filter user by username text like
      let userIds = await userModel.find({ userName: { $regex: username, $options: "i" } });
      filter.$or = [{ from: { $in: userIds.map(u => u._id) } }, { to: { $in: userIds.map(u => u._id) } }]
    }

    const totalDocuments = await transactionModel.countDocuments(filter);
    const totalPages = Math.ceil(totalDocuments / limit);
    console.log(" filter ", filter, isAdmin);

    const matchStage = isAdmin
      ? {
        $match: {
          ...filter,
          $or: [
            { type: { $in: ["shipping_deduction", "service_fee"]} }, // exempt for admin
            {
              $and: [
                { from: { $exists: true, $ne: null } },
                { to: { $exists: true, $ne: null } },
              ],
            },
          ],
        },
      }
      : {
        $match: {
          ...filter,
          $and: [
            { from: { $exists: true, $ne: null } },
            { to: { $exists: true, $ne: null } },
          ],
        },
      };

    // Aggregation pipeline 
    const transactions = await transactionModel.aggregate([
      matchStage,
      { $sort: { date: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "from",
          foreignField: "_id",
          as: "from",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "to",
          foreignField: "_id",
          as: "to",
        },
      },
      {
        $lookup: {
          from: "orders", // collection name in MongoDB
          localField: "orderId",
          foreignField: "_id",
          as: "order",
        },
      },
      { $unwind: { path: "$from", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$to", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$order", preserveNullAndEmptyArrays: true } }, // optional if not every transaction has an order
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    // Set response headers and send data
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.status(200).json({
      data: transactions,
      totalPages,
      currentPage: page,
      totalDocuments,
    });
  } catch (error) {
    console.error(error);
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.json({ error: error.message });
  }
};

exports.createTransaction = async (req, res) => {
  let newTransaction = {
    from: req.body.from,
    to: req.body.to,
    reason: req.body.reason,
    amount: req.body.amount,
    type: req.body.type,
    deducting: req.body.deducting,
    status: req.body.status,
    shopId: req.body.shopId,
    stripeBankAccount: req.body.stripeBankAccount ?? "",
    date: Date.now(),
  };
  try {
    if (newTransaction.type === "purchase") {
      await userModel.findByIdAndUpdate(req.params.userId, {
        $inc: { wallet: -newTransaction.amount },
      });
    }

    let transaction = await transactionModel.create(newTransaction);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json(transaction);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.getTransactionById = async (req, res) => {
  try {
    let trans = await transactionModel
      .findById(req.params.transId)
      .populate("from", ["firstName", "lastName", "bio", "userName", "email"])
      .populate("to", ["firstName", "lastName", "bio", "userName", "email"])
      .populate("shopId");
    res.status(200).setHeader("Content-Type", "application/json").json(trans);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};


exports.updateTransactionById = async (req, res) => {
  try {
    let transaction = await transactionModel.findByIdAndUpdate(
      req.params.transId,
      { $set: req.body },
      { runValidators: true, new: true }
    );
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: transaction });
  } catch (error) {
    console.log(error + " ");
    res
      .status(422)
      .setHeader("Content-Type", "Application/json")
      .json({ success: true, message: error.message + " " });
  }
};
