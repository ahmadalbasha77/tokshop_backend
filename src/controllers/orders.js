var orderModel = require("../models/order");
const userModel = require("../models/user");
const transactionModel = require("../models/transaction");
var productModel = require("../models/product");
var paymentmethodModel = require("../models/payment_methods");
const dispute = require("../models/dispute");
const moment = require("moment");
const { createTestStripeToken } = require("./stripe");
const itemModel = require("../models/item");
const socketEmitter = require("../shared/socketEmitter");

var mongoose = require("mongoose");
const axios = require("axios");
const functions = require("../shared/functions");
exports.getDisputes = async (req, res) => {
  try {
    const disputes = await dispute
      .find()
      .populate("userId", "userName")
      .populate({
        path: "orderId",
        select: "price shipping_fee tax customer seller items",
        populate: [
          {
            path: "items",
            select: "price productId",
            populate: {
              path: "productId",
              select: "name"
            }
          },
          {
            path: "customer",
            model: "user",
            select: "userName"
          },
          {
            path: "seller",
            model: "user",
            select: "userName"
          }
        ]
      })
      .sort({ createdAt: 1 });
    console.log(disputes);
    return res.json(disputes);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: err.message });
  }
};

exports.bundleOrders = async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!orderIds || orderIds.length < 2) {
      return res.status(400).json({ message: "Select at least two orders to bundle." });
    }

    // 1️⃣ Fetch all orders
    const orders = await orderModel.find({ _id: { $in: orderIds }, status: "processing" }).populate({
      path: "items",
      select: "price productId weight quantity",
      populate: {
        path: "productId",
        select: "name",
        populate: {
          path: "category",
          select: "name hs_code",
        },
      },
    });
    if (!orders.length) {
      return res.status(404).json({ message: "No valid orders found." });
    }

    // 2️⃣ Check that all orders have the same buyer
    const buyerIds = new Set(orders.map((o) => o.customer.toString()));
    if (buyerIds.size > 1) {
      return res.status(400).json({ message: "All bundled orders must be from the same buyer." });
    }
    console.log(orders)
    // 3️⃣ Ensure all orders are from the same source type (marketplace or show)
    const orderTypes = new Set(orders.map((o) => o.ordertype));
    if (orderTypes.size > 1) {
      return res.status(400).json({
        message: "You can bundle orders from either the marketplace or a show, but not both together.",
      });
    }

    // 4️⃣ Prevent bundling orders that already have labels
    const hasLabel = orders.some((o) => o.label);
    if (hasLabel) {
      return res.status(400).json({
        message: "You cannot bundle orders that already have a shipping label.",
      });
    }

    // ✅ All validation passed
    const baseOrder = orders[0];
    const allItems = orders.flatMap((o) => o.items.map((i) => i._id ? i._id : i));
    const totalWeight = orders.reduce((sum, order) => {
      return (
        sum +
        order.items.reduce(
          (itemSum, item) => itemSum + parseFloat(item.weight || 0),
          0
        )
      );
    }, 0);
    //tally  stripe_fees_total from items
    const stripe_fees_total = orders.reduce((sum, order) => {
      return sum + order.items.reduce(
        (itemSum, item) => itemSum + Number(item.stripe_fees || 0),
        0
      );
    }, 0);

    const earnings_total = orders.reduce((sum, order) => {
      return sum + order.items.reduce(
        (itemSum, item) => itemSum + Number(item.earnings || 0),
        0
      );
    }, 0);

    const service_fee_total = orders.reduce((sum, order) => {
      return sum + order.items.reduce(
        (itemSum, item) => itemSum + Number(item.service_fee || 0),
        0
      );
    }, 0);

    const tax_total = orders.reduce((sum, order) => {
      return sum + order.items.reduce(
        (itemSum, item) => itemSum + Number(item.tax || 0),
        0
      );
    }, 0);

    const customsItems = orders.flatMap(o =>
      o.items.map(i => ({
        name: i.productId?.name,
        quantity: i.quantity,
        weight: i.weight,
        price: i.price,
        hsCode: i.productId?.category?.hs_code ?? "950440",
      }))
    );
    // 5️⃣ Calculate shipping rate for the combined package
    const { amount: shippingFee, seller_shipping_fee_pay, servicelevel, rate_id, totalWeightOz } =
      await functions.getCheapestUSPSRate({
        weight: totalWeight,
        unit: "oz",
        owner: baseOrder.seller,
        customer: baseOrder.customer,
        tokshow: baseOrder.tokshow,
        smartBundle: false,
        buying_label: true,
        items: customsItems
      });

    // 6️⃣ Generate a new bundle ID
    const bundleId = new mongoose.Types.ObjectId().toString();

    // 7️⃣ Create new combined order
    const newOrder = new orderModel({
      customer: baseOrder.customer,
      seller: baseOrder.seller,
      bundleId,
      invoice: Math.floor(Math.random() * 1_000_000),
      status: "processing",
      items: allItems,
      rate_id,
      tokshow: baseOrder?.tokshow ?? null,
      carrierAccount: baseOrder?.carrierAccount ?? null,
      servicelevel: servicelevel?.name,
      weight: totalWeightOz,
      height: baseOrder.height,
      width: baseOrder.width,
      length: baseOrder.length,
      scale: baseOrder.scale,
      total_shipping_cost: parseFloat(shippingFee),
      shipping_fee: parseFloat(shippingFee) - parseFloat(seller_shipping_fee_pay),
      seller_shipping_fee_pay,
      stripe_fees: stripe_fees_total,
      tax: tax_total,
      earnings: earnings_total,
      payment_status: "paid",
      ordertype: baseOrder.ordertype,
      service_fee: service_fee_total,
      date: Date.now(),
    });

    const savedBundle = await newOrder.save();

    // 8️⃣ Update items to reference new order
    await itemModel.updateMany(
      { _id: { $in: allItems } },
      { $set: { orderId: savedBundle._id } }
    );

    // 9️⃣ Delete old orders
    await orderModel.deleteMany({ _id: { $in: orderIds } });

    res.json({
      message: `✅ Combined ${orders.length} orders into one bundle.`,
      bundleId,
      newOrder: savedBundle,
    });
  } catch (err) {
    console.error("❌ bundleOrders error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getItems = async (req, res) => {
  try {
    let { page = 1, limit = 10, tokshow, seller, customer, search } = req.query;

    page = Number(page);
    limit = Math.min(Number(limit), 100);
    const skip = (page - 1) * limit;

    /* ===================== BASE MATCH ===================== */
    const match = {};
    if (tokshow) match.tokshow = new mongoose.Types.ObjectId(tokshow);
    if (seller) match.seller = new mongoose.Types.ObjectId(seller);
    if (customer) match.customer = new mongoose.Types.ObjectId(customer);

    /* ===================== STEP 1: PAGINATE IDS ONLY ===================== */
    const pagedIds = await itemModel.aggregate([
      { $match: match },
      { $sort: { _id: -1 } },     // stable
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 1 } }
    ]);

    const itemIds = pagedIds.map(i => i._id);

    if (!itemIds.length) {
      return res.json({
        items: [],
        page,
        totalPages: 0,
        totalDocuments: 0
      });
    }

    /* ===================== STEP 2: FETCH FULL DOCUMENTS ===================== */
    const items = await itemModel.aggregate([
      { $match: { _id: { $in: itemIds } } },

      {
        $addFields: {
          giveawayObjectId: {
            $convert: {
              input: "$giveawayId",
              to: "objectId",
              onError: null,
              onNull: null
            }
          }
        }
      },

      /* CUSTOMER */
      {
        $lookup: {
          from: "users",
          localField: "customer",
          foreignField: "_id",
          pipeline: [{ $project: { userName: 1, profilePhoto: 1 } }],
          as: "customer"
        }
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },

      /* SELLER */
      {
        $lookup: {
          from: "users",
          localField: "seller",
          foreignField: "_id",
          pipeline: [{ $project: { userName: 1, profilePhoto: 1, email: 1 } }],
          as: "seller"
        }
      },
      { $unwind: { path: "$seller", preserveNullAndEmptyArrays: true } },

      /* PRODUCT */
      {
        $lookup: {
          from: "products",
          localField: "productId",
          foreignField: "_id",
          pipeline: [
            {
              $lookup: {
                from: "categories",
                localField: "category",
                foreignField: "_id",
                pipeline: [{ $project: { name: 1, hs_code: 1 } }],
                as: "category"
              }
            },
            { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
            { $project: { name: 1, category: 1 } }
          ],
          as: "productId"
        }
      },
      { $unwind: { path: "$productId", preserveNullAndEmptyArrays: true } },

      /* SEARCH */
      ...(search ? [{
        $match: {
          $or: [
            { "customer.userName": { $regex: search, $options: "i" } },
            { "seller.email": { $regex: search, $options: "i" } },
            { "productId.name": { $regex: search, $options: "i" } }
          ]
        }
      }] : []),

      /* ORDER */
      {
        $lookup: {
          from: "orders",
          localField: "orderId",
          foreignField: "_id",
          pipeline: [{ $project: { payment_status: 1, ordertype: 1 } }],
          as: "order"
        }
      },
      { $unwind: { path: "$order", preserveNullAndEmptyArrays: true } },

      /* GIVEAWAY */
      {
        $lookup: {
          from: "giveaways",
          localField: "giveawayObjectId",
          foreignField: "_id",
          as: "giveaway"
        }
      },
      { $unwind: { path: "$giveaway", preserveNullAndEmptyArrays: true } },

      /* RESTORE ORDER */
      { $sort: { _id: -1 } }
    ]);

    /* ===================== COUNT ===================== */
    const totalDocuments = await itemModel.countDocuments(match);

    res.status(200).json({
      items,
      page,
      totalPages: Math.ceil(totalDocuments / limit),
      totalDocuments
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};



exports.unbundleOrders = async (req, res) => {
  try {
    const { itemIds, orderId } = req.body;         // items being removed
    console.log(req.body)

    const parentOrder = await orderModel.findById(orderId).populate({
      path: "items",
      select: "price quantity weight productId",
      populate: {
        path: "productId",
        select: "name category",
        populate: {
          path: "category",
          select: "hs_code",
        },
      },
    });
    if (!parentOrder) return res.status(404).json({ message: "Bundle not found" });

    // 1️⃣ Separate selected and remaining items
    const unbundledItems = parentOrder.items.filter(i => itemIds.includes(i._id.toString()));
    const remainingItems = parentOrder.items.filter(i => !itemIds.includes(i._id.toString()));

    // 2️⃣ Create new order(s) for unbundled items
    let weight = unbundledItems.reduce((total, item) => total + parseFloat(item.weight || 0), 0);
    const newOrders = [];
    let new_order_id = new mongoose.Types.ObjectId();
    let new_rate = null;
    for (const item of unbundledItems) {
      const rate = await functions.getCheapestUSPSRate({
        weight,
        unit: "oz",
        owner: parentOrder.seller,
        customer: parentOrder.customer,
        tokshow: parentOrder.tokshow,
        smartBundle: false,
        buying_label: true,
        items: [{ name: item.productId?.name, quantity: item.quantity, weight: item.weight, price: item.price, hsCode: item.productId?.category?.hs_code ?? "950440" }]
      });
      new_rate = rate;
      // update item’s order reference
      await itemModel.findByIdAndUpdate(item._id, { orderId: new_order_id });
    }
    const newBundleId = new mongoose.Types.ObjectId().toString();
    const newOrder = await orderModel.create({
      _id: new_order_id,
      customer: parentOrder.customer,
      seller: parentOrder.seller,
      bundleId: newBundleId,
      invoice: Math.floor(Math.random() * 1_000_000),
      items: unbundledItems,
      weight,
      rate_id: new_rate.rate_id,
      servicelevel: new_rate.servicelevel.name,
      total_shipping_cost: parseFloat(new_rate.amount),
      shipping_fee: parseFloat(new_rate.amount) - parseFloat(new_rate.seller_shipping_fee_pay),
      seller_shipping_fee_pay: new_rate.seller_shipping_fee_pay,
      payment_status: "paid",
      ordertype: parentOrder?.ordertype,
      status: "processing",
    });
    newOrders.push(newOrder);

    // 3️⃣ Update bundle (remaining items)
    if (remainingItems.length > 0) {
      const totalWeight = remainingItems.reduce((total, item) => total + parseFloat(item.weight || 0), 0);

      const rate = await functions.getCheapestUSPSRate({
        weight: totalWeight,
        unit: "oz",
        owner: parentOrder.seller,
        customer: parentOrder.customer,
        tokshow: parentOrder.tokshow,
        buying_label: true,
        items: remainingItems.map(i => (
          { name: i.productId?.name, quantity: i.quantity, weight: i.weight, price: i.price, hsCode: i.productId?.category?.hs_code ?? "950440" }
        ))
      });
      parentOrder.items = remainingItems.map(i => i._id);
      parentOrder.weight = totalWeight;
      parentOrder.total_shipping_cost = parseFloat(rate.amount),
        parentOrder.shipping_fee = parseFloat(rate.amount) - parseFloat(rate.seller_shipping_fee_pay),
        parentOrder.seller_shipping_fee_pay = rate.seller_shipping_fee_pay,
        parentOrder.rate_id = rate.rate_id;
      parentOrder.servicelevel = rate.servicelevel.name;
      await parentOrder.save();
    } else {
      // If bundle now empty, delete it
      await orderModel.findByIdAndDelete(orderId);
    }
    res.json({
      message: `Unbundled ${unbundledItems.length} item(s), updated remaining bundle.`,
      newOrders,
      updatedBundle: remainingItems.length ? parentOrder : null,
    });
  } catch (err) {
    console.error("❌ unbundleOrders error:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.closeDispute = async (req, res) => {
  let { favored, final_comments } = req.body;
  console.log(req.body);
  let id = req.params.id;
  let response = await dispute.findByIdAndUpdate(id, {
    status: "resolved",
    favored: favored?._id,
    final_comments
  }, { new: true, runValidators: true }).populate("userId", 'userName').populate({
    path: "orderId",
    select: "price shipping_fee tax customer seller earnings",
    populate: {
      path: "items",
      select: "price",
      populate: {
        path: "productId",
        select: "name"
      }
    },
  });
  try {
    console.log(response);
    if (favored == null) {
      await orderModel.findByIdAndUpdate(orderId, { status: "processing", dispute: null })
      return res.json({ success: true, message: "case closed" })
    }
    if (favored?._id == response?.orderId?.customer) {
      let transaction = await transactionModel.findOne({ orderId: response?.orderId?._id });
      console.log(transaction);
      let earnings = 0
      if (transaction?.chargeId) {
        const { stripeSecretKey } = await functions.getSettings();
        const stripe = require("stripe")(stripeSecretKey, {
          apiVersion: "2022-08-01",
        });
        const refund = await stripe.refunds.create({
          charge: transaction.chargeId,
          metadata: { orderId: response?.orderId?._id.toString() },
        });
        console.log(refund);

        await transactionModel.findByIdAndUpdate(transaction._id, {
          $set: { refundId: refund.id, status: "cancelled" },
        });
        earnings = response?.orderId?.earnings || 0;
        const newTransaction1 = {
          from: response?.orderId?.customer,
          to: response?.orderId?.seller,
          reason: "Cancelled Processing",
          amount: earnings,
          status: "Pending",
          type: "refund",
          deducting: false,
          orderId: response?.orderId?._id,
          refundId: refund.id,
          date: Date.now(),
        };
        await transactionModel.create(newTransaction1);
      }
      if (transaction?.status == "Completed") {
        await userModel.findByIdAndUpdate(response?.orderId?.seller, {
          $inc: { wallet: -earnings },
        });
      } else {
        await userModel.findByIdAndUpdate(response?.orderId?.seller, {
          $inc: { walletPending: -earnings },
        });
      }


    }
    return res.json({ success: true, message: "case closed" })
  } catch (e) {
    console.log(e)
    return res.json({ success: false, message: e });
  }
}

exports.refundOrder = async (req, res) => {
  let id = req.params.id;
  let { type, itemId, amount, orderId, fromDispute } = req.body;
  console.log(req.body);
  let transaction;
  let deduuctingSellerWalletTotal = 0
  if (itemId) {
    transaction = await transactionModel.findOne({ itemId: itemId });
  } else if (type == "order") {
    transaction = await transactionModel.findOne({ orderId: orderId });
  }
  if (!transaction) {
    return res
      .status(400)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, error: "Transaction not found" });
  }
  console.log(transaction);
  try {
    let refunded = false;

    if (transaction?.chargeId) {
      const { stripeSecretKey } = await functions.getSettings();
      const stripe = require("stripe")(stripeSecretKey, {
        apiVersion: "2022-08-01",
      });
      let refund = null;

      if (amount) {
        deduuctingSellerWalletTotal = amount
        amount = (amount * 100).toFixed(0);
        try {
          refund = await stripe.refunds.create({
            charge: transaction.chargeId,
            amount: amount,
            metadata: { orderId: itemId ? itemId.toString() : orderId.toString() },
          });
        } catch (error) {
          console.log("error ", error);
        }
        if (refund?.status == "succeeded") {
          refunded = true;
        } else {
          return res.json({ success: false, message: "Refund failed" })
        }
      } else {
        console.log(transaction);
        deduuctingSellerWalletTotal = parseFloat(transaction?.amount) + parseFloat(transaction?.tax || 0.0) + parseFloat(transaction?.shippingFee || 0.0);
        console.log(deduuctingSellerWalletTotal);
        refund = await stripe.refunds.create({
          charge: transaction.chargeId,
          metadata: { orderId: itemId ? itemId.toString() : orderId.toString() },
        });
        console.log("refund ", refund);
        if (refund?.status == "succeeded") {
          refunded = true;
        } else {
          return res.json({ success: false, message: "Refund failed" })
        }

      }
      if (refunded = true && transaction) {

        await transactionModel.findByIdAndUpdate(transaction._id, {
          $set: { refundId: refund.id, status: "Refunded" },
        });
        // deduct seller wallet
        await userModel.findByIdAndUpdate(transaction?.to, {
          $inc: { walletPending: -deduuctingSellerWalletTotal },
        });
        if (itemId) {
          let item = await itemModel.findByIdAndUpdate(new mongoose.Types.ObjectId(itemId), {
            $set: { status: "Refunded" },
          })
          console.log(item);

          //if this was the only item in the order, set order status to refunded
          let order = await orderModel.findOne({ _id: item?.orderId}).populate(functions.getOrderPopulates());
          let cancelleditems = order?.items?.filter((item) => item.status == 'Refunded' || item.status == 'Cancelled' || item.status == 'refunded');
          if (order?.items?.length == cancelleditems?.length) {
            await orderModel.findByIdAndUpdate(order._id, {
              $set: { status: "Refunded" },
            })
          }


        } else if (orderId) {
          await orderModel.findByIdAndUpdate(orderId, {
            $set: { status: "Refunded" },
          })
        }
      }

      // if (fromDispute ==true){

      // }
    }
  } catch (e) {
    console.log(e)
    return res.json({ success: false, message: e });
  }

  return res.json({ success: true, message: "refunded" })

}

exports.disputeOrder = async (req, res) => {
  const { orderId, userId, reason, details } = req.body;
  const newDispute = await dispute.create({
    orderId,
    userId,
    reason,
    details,
  });
  let order = await orderModel.findByIdAndUpdate(orderId, { status: "disputed", dispute: newDispute._id }).populate(functions.getOrderPopulates());
  console.log(order)
  //send notification to seller
  functions.sendNotification(
    [order?.seller?.fcmToken],
    "Order Dispute!",
    order?.customer?.userName + " has raised an issue with order #" + order?.invoice,
    {
      id: orderId,
      screen: "OrderScreen",
    }
  );

  res.json(order);
}
exports.updateOrderDispute = async (req, res) => {
  const { orderId } = req.params;
  let response = await dispute.findOneAndUpdate({ orderId }, req.body, { new: true, runValidators: true }).populate("userId", 'userName').populate({
    path: "orderId",
    select: "price shipping_fee tax",
    populate: {
      path: "items",
      select: "price",
      populate: {
        path: "productId",
        select: "name"
      }
    },
  });
  res.json(response);
}
exports.getOrderDispute = async (req, res) => {
  const { orderId } = req.params;
  const respose = await dispute.findOne({ orderId }).populate("userId", 'userName').populate({
    path: "orderId",
    select: "price shipping_fee tax customer seller items",
    populate: [
      {
        path: "items",
        select: "price productId order_reference status",
        populate: {
          path: "productId",
          select: "name"
        }
      },
      {
        path: "customer",
        model: "user",
        select: "userName"
      },
      {
        path: "seller",
        model: "user",
        select: "userName"
      }
    ]

  });
  res.json(respose);
}
exports.getAllOrders = async (req, res) => {
  try {
    const { invoice, status, page, limit, day, customer, userId, tokshow, marketplace = "false", startDate,
      endDate, platform_order = "false", search, searchBy = "customer" } =
      req.query;

    console.log(req.query)

    const today = new Date();
    const queryObject = {
      $and: [{ customer: { $exists: true, $ne: null } }, { seller: { $exists: true, $ne: null } }],
    };
    if (invoice) queryObject.invoice = parseInt(invoice);
    if (customer) queryObject.customer = customer;
    if (userId) queryObject.seller = userId;
    if (day) queryObject.createdAt = { $gte: date, $lte: today };
    if (tokshow) queryObject.tokshow = tokshow;
    if (platform_order == "true") queryObject.platform_order = true;
    // if(platform_order == "false") queryObject.platform_order = false;
    if (marketplace == "true") queryObject.ordertype = "marketplace";

    if (startDate || endDate) {
      const dateFilter = {};

      if (startDate) dateFilter.$gte = new Date(startDate);

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.$lte = end;
      }

      queryObject.createdAt = dateFilter;
    }

    // Priority 2: fallback to "day" filter
    else if (day) {
      const today = new Date();
      const from = new Date();
      from.setDate(from.getDate() - Number(day));

      queryObject.createdAt = { $gte: from, $lte: today };
    }

    if (status == "unfulfilled") {
      queryObject.$and = [
        { status: "ready_to_ship" },
        // {_id: {$in: [new mongoose.Types.ObjectId("695adff3b21b4f78b63de294"), new mongoose.Types.ObjectId("695adfa1b21b4f78b63de21b"),, new mongoose.Types.ObjectId("695ac009f5720bbcc78ef198"), new mongoose.Types.ObjectId("695abc469b07f6c9024047ee")]}},
      ]
    } else {
      if (status) queryObject.status = status;
    }

    let pages = Number(page) || 1;
    const limits = Number(limit) || 8;
    const skip = (pages - 1) * limits;

    console.log(queryObject)
    // 🔍 SEARCH BY CUSTOMER USERNAME (search users first)
    if (search) {
      const matchedUsers = await userModel.find(
        {
          $or: [
            { userName: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } }
          ]
        },
        { _id: 1 }
      );

      if (matchedUsers.length === 0) {
        return res.send({
          orders: [],
          limits,
          pages: 0,
          total: 0,
        });
      }


      // merge with existing customer filter if present
      if (searchBy == "customer") {
        const customerIds = matchedUsers.map(u => u._id);
        if (queryObject.customer) {
          queryObject.customer = {
            $in: customerIds.filter(id => id.toString() === queryObject.customer.toString())
          };
        } else {
          queryObject.customer = { $in: customerIds };
        }
      }
      if (searchBy == "seller") {
        const sellerIds = matchedUsers.map(u => u._id);
        queryObject.seller = { $in: sellerIds };
      }
    }

    var totaldoc = await orderModel.countDocuments(queryObject);
    // fetch orders
    const rawOrders = await orderModel
      .find(queryObject)
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limits)
      .populate(functions.getOrderPopulates());
    // if (customer) {
    pages = Math.ceil(totaldoc / limits);
    return res.send({
      orders: rawOrders,
      limits,
      pages,
      total: totaldoc,
    });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.bestSellerProductChart = async (req, res) => {
  try {
    const queryObject = {};
    const { userid } = req.query;
    if (userid) {
      queryObject.customer = { $eq: userid };
    }
    const totalDoc = await orderModel.countDocuments(queryObject);
    const bestSellingProduct = await orderModel.aggregate([
      {
        $group: {
          _id: "$product", // grouping by product ID
          count: { $sum: "$quantity" },
        },
      },
      {
        $sort: { count: -1 }, // sort best sellers first
      },
      {
        $lookup: {
          from: "products", // Name of your products collection
          localField: "_id",
          foreignField: "_id",
          as: "productDetails",
        },
      },
      { $unwind: "$productDetails" }, // Simplify the productDetails array
      {
        $project: {
          _id: 1,
          count: 1,
          productName: "$productDetails.name", // include product name
        },
      },
    ]);

    res.send({
      totalDoc,
      bestSellingProduct,
    });
  } catch (err) {
    res.status(500).send({
      message: err.message,
    });
  }
};

exports.getDashboardOrdersAdmin = async (req, res) => {
  const { page, limit } = req.query;

  const pages = Number(page) || 1;
  const limits = Number(limit) || 8;
  const skip = (pages - 1) * limits;

  let week = new Date();
  week.setDate(week.getDate() - 10);

  //   const start = new Date();
  var start = moment().startOf("day");

  try {
    const totalDoc = await orderModel.countDocuments({});

    // query for orders
    const orders = await orderModel
      .find({})
      .sort({ _id: -1 })
      .skip(skip)

      .populate("customer", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
      ])

      .populate("shippingId")
      .limit(limits);

    const totalAmount = await orderModel.aggregate([
      {
        $group: {
          _id: null,
          tAmount: {
            $sum: "$total",
          },
        },
      },
    ]);

    // total order amount
    const todayOrder = await orderModel.find({ createdAt: { $gte: start } });

    // this month order amount
    const totalAmountOfThisMonth = await orderModel.aggregate([
      {
        $group: {
          _id: {
            year: {
              $year: "$createdAt",
            },
            month: {
              $month: "$createdAt",
            },
          },
          total: {
            $sum: "$total",
          },
        },
      },
      {
        $sort: { _id: -1 },
      },
      {
        $limit: 1,
      },
    ]);

    // total padding order count
    const totalPendingOrder = await orderModel.aggregate([
      {
        $match: {
          status: "progress",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          count: {
            $sum: 1,
          },
        },
      },
    ]);

    // total delivered order count
    const totalDeliveredOrder = await orderModel.aggregate([
      {
        $match: {
          status: "completed",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          count: {
            $sum: 1,
          },
        },
      },
    ]);

    //weekly sale report
    // filter order data
    const weeklySaleReport = await orderModel.find({
      // $or: [{ status: { $regex: `completed`, $options: "i" } }],
      createdAt: {
        $gte: week,
      },
    });

    res.send({
      totalOrder: totalDoc,
      totalAmount:
        totalAmount.length === 0
          ? 0
          : parseFloat(totalAmount[0].tAmount).toFixed(2),
      todayOrder: todayOrder,
      totalAmountOfThisMonth:
        totalAmountOfThisMonth.length === 0
          ? 0
          : parseFloat(totalAmountOfThisMonth[0].total).toFixed(2),
      totalPendingOrder:
        totalPendingOrder.length === 0 ? 0 : totalPendingOrder[0],
      totalDeliveredOrder:
        totalDeliveredOrder.length === 0 ? 0 : totalDeliveredOrder[0].count,
      orders,
      weeklySaleReport,
    });
  } catch (err) {
    res.status(500).send({
      message: err.message,
    });
  }
};

exports.getAllOrdersByUserId = async (req, res) => {
  try {
    let orders = await orderModel
      .find({
        customerId: req.params.userId,
      })
      .populate("customerId", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
      ])

      .populate({
        path: "itemId",
        populate: {
          path: "productId",
          populate: {
            path: "interest",
          },
        },
      })
      .populate({
        path: "itemId",
        populate: {
          path: "productId",
          populate: {
            path: "reviews",
          },
        },
      })
      .populate({
        path: "itemId",
        populate: {
          path: "productId",
          populate: {
            path: "ownerId",

            populate: {
              path: "shopId",
            },
          },
        },
      })

      .populate("shippingId")
      .limit(10)
      .sort({ date: -1 });

    res.status(200).setHeader("Content-Type", "application/json").json(orders);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.getOrderByProductId = async (req, res) => {
  try {
    let orders = await orderModel
      .find({ productIds: req.params.productId })
      .populate("productId")
      .populate("reviews");
    res.status(200).setHeader("Content-Type", "application/json").json(orders);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.addOrder = async (req, res) => {
  const {
    buyer,
    product,
    status,
    quantity,
    color,
    size,
    total,
    seller,
    subtotal,
    tax,
    tokshow,
    shippingFee,
    rate_id,
    servicelevel,
    totalWeightOz,
    bundleId, seller_shipping_fee_pay,
    carrierAccount,
    carrier,
    flash_sale = false,
    referredBy = null,
    referralDiscount= 0
  } = req.body;
  console.log("req.body ", req.body)
  try {
    // Extract data from req.body
    const { error, success, newOrder, newItem, seller: se, buyer: by } = await functions.createOrder({
      shipping: {
        carrierAccount,
        amount: shippingFee,
        totalWeightOz,
        bundleId,
        seller_shipping_fee_pay,
        provider: carrier,
        rate_id
      },
      buyer,
      product,
      quantity,
      color,
      size,
      subtotal,
      seller,
      tax,
      tokshow,
      shippingFee,
      rate_id,
      ordertype: 'marketplace',
      servicelevel,
      totalWeightOz,
      bundleId,
      seller_shipping_fee_pay,
      carrierAccount,
      carrier,
      flash_sale,
      referralDiscount, referredBy
    });
    if (success == false) {
      console.log("error ", error, {
        success,
        error: error
      })
      return res.status(400).json({
        success,
        error: error
      });
    }
    // Save activity for seller
    functions.saveActivity(
      newOrder?._id,
      "New order",
      "OrderScreen",
      false,
      null,
      seller,
      "You just got an order",
      buyer
    );

    // Save activity for buyer
    functions.saveActivity(
      newOrder?._id,
      "New order",
      "OrderScreen",
      false,
      null,
      buyer,
      "You ordered a product from " + (se?.userName || "Unknown Seller"),
      seller
    );
    functions.sendNotification(
      [by?.fcmToken],
      "New order",
      "You ordered a product from " + se?.userName,
      {
        id: newOrder?._id.toString(),
        screen: "OrderScreen",
      }
    );

    let message = by?.userName + " has purchased your Trending Item";
    if (tokshow) {
      message = "You have a new order from " + by?.userName;
      console.log("sending emissiont to ", tokshow)
      socketEmitter.emitTo(tokshow?.toString(), "marketplace_order", { msg: message });
    }
    if (se?.notification_settings?.notify_on_order == true) {
      functions.sendNotification(
        [se?.fcmToken],
        "New order",
        message,
        {
          id: newOrder?._id.toString(),
          screen: "OrderScreen",
        }
      );
    }

    // If successful, return JSON
    return res.status(200).json({
      success,
      newOrder,
      newItem,
    });
  } catch (error) {
    console.log(error);

    var response = await functions.getSettings();
    if (response["demoMode"] === false) {
      return res.status(422).json({
        success: false,
        error: error.message,
      });
    }
    let buyerresponse = await userModel.findOne({ _id: buyer });
    if (buyerresponse) {
      const paymentmethod = await paymentmethodModel.findOne({
        userid: buyer,
        primary: true,
      });
      if (paymentmethod?.customerid == null) {
        req.body = {
          name: buyerresponse?.firstName,
          userid: buyer,
          email: buyerresponse?.email,
        };
        await createTestStripeToken(req, res);
      }
    }

    return res.status(422).json({
      success: false,
      message:
        "This is demo, some functionality are slower, try again after 1 minute",
    });
  }
};
async function updateWoocomerceOrder(orderId, data, shopId) {
  let shop = await shopModel.findById(shopId);

  var wooData = await axios.post(
    `${shop.wcUrl}orders/${orderId}?consumer_key=${shop.wcConsumerKey}&consumer_secret=${shop.wcSecretKey}`,
    data
  );
  return wooData;
}
exports.rejectOrderCancellation = async (req, res) => {
  try {
    const { orderId, type } = req.body;
    console.log(req.body)
    if (type == "order") {
      await orderModel.findByIdAndUpdate
        (orderId, {
          $set: { status: 'processing', reject_cancel_reason: req.body.reason },
        });
      return res.status(200).json({
        success: true,
        message: "Order cancellation rejected successfully"
      });
    }
    if (type == "item") {
      await itemModel.findByIdAndUpdate
        (new mongoose.Types.ObjectId(orderId), {
          $set: { status: 'processing', reject_cancel_reason: req.body.reason },
        });
      return res.status(200).json({
        success: true,
        message: "Order cancellation rejected successfully"
      });
    }
  } catch (error) {
    console.error("Reject order cancellation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reject order cancellation",
      error: error.message,
    });
  }
};



exports.cancelOrder = async (req, res) => {
  console.log(req.body)
  // try {
    const { relist, order, initiator, type, description, action } = req.body;
    const cancelledDate = Date.now();

    // This is buyer actions, to se orders pending cancellation
    if (initiator == "buyer") {
      if (type == "item") {
        const orderItem = await itemModel.findById(order).populate("seller", ['fcmToken']).populate("customer", ['fcmToken', 'userName']);
        if (!orderItem) {
          return res.status(404).json({ message: "Order item not found" });
        }
        orderItem.status = "pending_cancellation";
        orderItem.cancellationReason = description || "No reason provided";
        await orderItem.save();


        functions.sendNotification(
          [orderItem?.seller?.fcmToken],
          "Cancellation Request",
          orderItem?.customer?.userName + " has requested to cancel an order",
          {
            id: orderItem?.orderId.toString(),
            screen: "OrderScreen",
          }
        );

        return res.status(200).json({
          success: true,
          message: "Order cancellation request initiated successfully",
          orderItem,
        });
      }
      if (type == "order") {
        const orderData = await orderModel.findById(order).populate("items").populate("seller", ['fcmToken']).populate("customer", ['fcmToken', 'userName']);
        if (!orderData) {
          return res.status(404).json({ message: "Order not found" });
        }
        orderData.status = "pending_cancellation";
        orderData.cancellationReason = description || "No reason provided";
        await orderData.save();

        functions.sendNotification(
          [orderData?.seller?.fcmToken],
          "Cancellation Request",
          orderData?.customer?.userName + " has requested to cancel an order",
          {
            id: orderData?._id.toString(),
            screen: "OrderScreen",
          }
        );
        return res.status(200).json({
          success: true,
          message: "Order cancellation request initiated successfully",
          orderData,
        });
      }
    }

    // this is seller actio to set order back to processing if rejected
    if (action == "reject") {
      if (type == "item") {
        let orderItem = await itemModel.findByIdAndUpdate(order, {
          $set: { status: 'processing' },
        }).populate("seller", ['fcmToken']).populate("customer", ['userName']);

        functions.sendNotification(
          [orderItem?.customer?.fcmToken],
          "Cancellation Request Rejected",
          "Your order cancellation request has been rejected",
          {
            id: orderItem?.orderId.toString(),
            screen: "OrderScreen",
          }
        );
        return res.status(200).json({
          success: true,
          message: "Order cancellation rejected successfully"
        });
      }
      if (type == "order") {
        await orderModel.findByIdAndUpdate(order, {
          $set: { status: 'processing' },
        });
        return res.status(200).json({
          success: true,
          message: "Order cancellation rejected successfully"
        });
      }
    }

    var totalSellerToDeduct = 0;
    var seller = 0;
    var productId = null;
    var quantity = 0;
    var seller_shipping_fee_pay = 0;
    var transaction = null;
    // This is seller action to cancel the order
    if (type == "order") {
      const orderData = await orderModel.findById(new mongoose.Types.ObjectId(order)).populate("items").populate("seller", ['fcmToken']).populate("customer", ['fcmToken', 'userName']);
      console.log(orderData)
      if (!orderData) {
        return res.status(404).json({ message: "Order not found" });
      }
      orderData.status = "cancelled";
      orderData.cancelledDate = cancelledDate;
      await orderData.save();
      totalSellerToDeduct = orderData.earnings;
      seller = orderData.seller;
      buyer = orderData?.customer;
      productId = orderData.items[0]?.productId;
      if (relist == true || relist == "true") {
        orderData.items?.forEach(async (i) => {
          await productModel.findByIdAndUpdate(i?.productId, {
            $inc: { quantity: i.quantity },
          });
        })
      }
      // if(orderData?.status == "completed" || orderData?.status == "delivered" || orderData?.status == "shipped" || orderData?.status == "Completed"){
      //   totalSellerToDeduct = orderData.seller_shipping_fee_pay || 0;
      // }
      seller_shipping_fee_pay = orderData.seller_shipping_fee_pay || 0;
      transaction = await transactionModel.findOne({ orderId: order });
      await itemModel.updateMany({ orderId: order }, { $set: { status: "cancelled" } });


      functions.sendNotification(
        [orderData?.customer?.fcmToken],
        "Order Cancelled",
        "Your order has been cancelled",
        {
          id: orderData?._id.toString(),
          screen: "OrderScreen",
        }
      );
    }
    let orderItem;
    if (type == "item") {
      // 🔎 Find the specific order item
      orderItem = await itemModel.findById(order).populate("seller", ['fcmToken']).populate("customer", ['fcmToken', 'userName']).populate("orderId", 'earnings');
      if (!orderItem) {
        return res.status(404).json({ message: "Order item not found" });
      }
      seller = orderItem.seller;
      buyer = orderItem?.buyer;
      orderItem.status = "cancelled";
      orderItem.cancelledDate = cancelledDate;
      await orderItem.save();
      productId = orderItem.productId;

      // Calculate order amount for this item
      totalSellerToDeduct = orderItem?.orderId?.earnings;
      quantity = orderItem.quantity;
      seller_shipping_fee_pay = orderItem.seller_shipping_fee_pay || 0;
      transaction = await transactionModel.findOne({ itemId: orderItem?._id });
      if (relist == true || relist == "true") {
        await productModel.findByIdAndUpdate(productId, {
          $inc: { quantity: quantity },
        });
      }
      //remove item from order if this this not the only order
      const parentOrder = await orderModel.findById(orderItem.orderId).populate("items");
      console.log("items ", parentOrder.items.length)
      if (parentOrder.items.length > 1) {
        parentOrder.items = parentOrder.items.filter(
          (item) => item._id.toString() !== orderItem._id.toString()
        );
        console.log("items remainining ", parentOrder.items.length)
        await parentOrder.save();
      } else if (parentOrder.items.length == 1) {
        parentOrder.status = "cancelled";
        parentOrder.cancelledDate = cancelledDate;
        await parentOrder.save();
        transaction = await transactionModel.findOne({ orderId: parentOrder?._id });
      }

      // else {
      //   // if only item, cancel whole order
      //   parentOrder.status = "cancelled";
      //   parentOrder.cancelledDate = cancelledDate;
      //   await parentOrder.save();
      // }

      functions.sendNotification(
        [orderItem?.customer?.fcmToken],
        "Order Cancelled",
        "Your order has been cancelled",
        {
          id: orderItem?.orderId.toString(),
          screen: "OrderScreen",
        }
      );
    }
    try {
      if (transaction?.chargeId) {

        // 🔐 Initialize Stripe
        const { stripeSecretKey } = await functions.getSettings();
        const stripe = require("stripe")(stripeSecretKey, {
          apiVersion: "2022-08-01",
        });
        const refund = await stripe.refunds.create({
          charge: transaction.chargeId,
        });

        await transactionModel.findByIdAndUpdate(transaction._id, {
          $set: { refundId: refund.id, status: "cancelled" },
        });

        await transactionModel.create({
          from: buyer,
          to: seller,
          reason: "Cancelled Processing",
          amount: totalSellerToDeduct,
          status: "Pending",
          type: "refund",
          deducting: false,
          itemId: order,
          refundId: refund.id,
          date: Date.now(),
        });
      }
    } catch (e) {
      console.log("Refund error:", e);
    }
    // await userModel.findByIdAndUpdate(seller, {
    //   $inc: { walletPending: +seller_shipping_fee_pay },
    // });

    //deduct from seller wallet
    await userModel.findByIdAndUpdate(seller, {
      $inc: { walletPending: -totalSellerToDeduct },
    });

    // ♻️ Relist product if requested
    if (relist == true || relist == "true") {
      await productModel.findByIdAndUpdate(productId, {
        $inc: { quantity: quantity },
      });
    }
    console.log("orderItem ", orderItem)
    return res.status(200).json({
      success: true,
      message: "Order item cancelled successfully",
      orderItem
    });


  // } catch (error) {
  //   console.error("Cancel order error:", error);
  //   return res.status(500).json({
  //     success: false,
  //     message: "Failed to cancel order item",
  //     error: error.message,
  //   });
  // }
};


exports.updateOrderById = async (req, res) => {
  try {
    const { status, relist, bundleId } = req.body;
    console.log(req.body)

    // add timestamps based on status
    if (status === "shipped") {
      req.body.shippeddate = Date.now();
    }

    let orders = [];

    if (bundleId) {
      // fetch all orders in the bundle
      orders = await orderModel.find({ bundleId }).populate("items");
      if (!orders.length) {
        return res.status(404).json({ error: "No orders found for bundleId" });
      }
      // update them all with req.body
      await orderModel.updateMany(
        { bundleId },
        { $set: req.body },
        { runValidators: true }
      );
    } else {
      // single order update
      const order = await orderModel
        .findByIdAndUpdate(
          req.params.orderId,
          { $set: req.body },
          { runValidators: true, new: true }
        )
        .populate("items");
      if (!order) return res.status(404).json({ error: "Order not found" });
      orders = [order];
    }

    // respond with updated orders
    return res.status(200).json(bundleId ? orders : orders[0]);
  } catch (error) {
    console.log(error);
    if (error.raw) {
      return res.status(422).json({ error: error.raw.message });
    }
    return res.status(422).json({ error: error.message });
  }
};



exports.getOrderById = async (req, res) => {
  try {
    let order = await orderModel
      .findById(req.params.orderId)
      .populate(functions.getOrderPopulates())
      .sort({ createdAt: -1 });
    res.status(200).json(order);
  } catch (error) {
    res
      .status(422)

      .json(error.message);
  }
};

exports.deleteProductById = async (req, res) => {
  try {
    let deleted = await orderModel.findByIdAndDelete(req.params.orderId);
    res.status(200).setHeader("Content-Type", "application/json").json(deleted);
  } catch (e) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(e.message);
  }
};




exports.getShipmentMetrics = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log(req.query, userId);
    let dateFilter = {};

    if (req.query.startDate) {
      dateFilter.$gte = new Date(req.query.startDate);
    }

    if (req.query.endDate) {
      const end = new Date(req.query.endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }

    let filter = {
      seller: new mongoose.Types.ObjectId(userId),
      status: { $nin: ["cancelled", "refunded"] },
      ...(Object.keys(dateFilter).length && { createdAt: dateFilter })
    };
    if (req.query.tokshow) {
      filter.tokshow = new mongoose.Types.ObjectId(req.query.tokshow);
    }
    console.log("filter ", filter);

    const metrics = await orderModel.aggregate([
      {
        $match: filter
      },

      {
        $lookup: {
          from: "items",
          localField: "items",
          foreignField: "_id",
          as: "itemDetails"
        }
      },

      { $unwind: "$itemDetails" },

      // First grouping: totals at order level
      {
        $group: {
          _id: "$_id",
          status: { $first: "$status" },
          seller_shipping_fee_pay: { $first: "$seller_shipping_fee_pay" },
          tax: { $first: "$tax" },
          service_fee: { $first: "$service_fee" },
          stripe_fees: { $first: "$stripe_fees" },

          itemValue: {
            $sum: {
              $multiply: ["$itemDetails.price", "$itemDetails.quantity"]
            }
          },
          itemsSold: { $sum: "$itemDetails.quantity" },
          count: { $sum: 1 }
        }
      },

      // Second grouping: grand totals
      {
        $group: {
          _id: null,
          totalShippingSpend: { $sum: "$seller_shipping_fee_pay" },
          totalTax: { $sum: "$tax" },
          totalItemValue: { $sum: "$itemValue" },
          itemsSold: { $sum: "$itemsSold" },
          count: { $sum: "$count" },
          totalServiceFees: { $sum: "$service_fee" },
          totalStripeFees: { $sum: "$stripe_fees" },
          totalDelivered: {
            $sum: {
              $cond: [
                { $in: ["$status", ["delivered", "completed"]] },
                1,
                0
              ]
            }
          },
          pendingDelivery: {
            $sum: {
              $cond: [
                { $in: ["$status", ["shipped", "shipping"]] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const result = metrics[0] || {
      totalShippingSpend: 0,
      totalTax: 0,
      totalItemValue: 0,
      itemsSold: 0,
      totalServiceFees: 0,
      totalStripeFees: 0,
      totalDelivered: 0,
      pendingDelivery: 0,
      count: 0
    };

    const totalSold = result.totalItemValue;// + result.totalTax;

    const totalEarned =
      totalSold -
      result.totalShippingSpend -
      result.totalServiceFees -
      result.totalStripeFees;

    res.status(200).json({
      totalSold: totalSold.toFixed(2),
      totalEarned: totalEarned.toFixed(2),
      totalShippingSpend: result.totalShippingSpend.toFixed(2),
      totalServiceFees: result.totalServiceFees.toFixed(2),
      totalStripeFees: result.totalStripeFees.toFixed(2),
      itemsSold: result.itemsSold,
      totalDelivered: result.totalDelivered,
      pendingDelivery: result.pendingDelivery,
      count: result.count
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.getOrderMetrics = async (req, res) => {
  try {
    const { userId } = req.params;

    const metrics = await orderModel.aggregate([
      // Match orders for this seller
      { $match: { seller: new mongoose.Types.ObjectId(userId) } },

      // Lookup items
      {
        $lookup: {
          from: "items",
          localField: "items",
          foreignField: "_id",
          as: "itemDetails"
        }
      },

      // Calculate metrics
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: {
            $sum: {
              $add: [
                { $sum: "$itemDetails.price" },
                "$tax",
                "$shipping_fee"
              ]
            }
          },
          processingCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "processing"] }, 1, 0]
            }
          },
          shippingCount: {
            $sum: {
              $cond: [{ $eq: ["$status", "shipped"] }, 1, 0]
            }
          },
          deliveredCount: {
            $sum: {
              $cond: [
                { $in: ["$status", ["delivered", "completed", "ended"]] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const result = metrics[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      processingCount: 0,
      shippingCount: 0,
      deliveredCount: 0
    };

    res.status(200).json(result);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
exports.retryPayment = async (req, res) => {
  try {
    const { orderid } = req.params;
    const orders = await functions.retryOrderPayment(orderid);
    console.log(orders)
    res.status(200).json(orders);
  } catch (error) {
    console.log(error)
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.orderStats = async (req, res) => {
  try {
    // total orders, orders total value, shipped, delivered
    let total = await orderModel.countDocuments({})
    let shipped = await orderModel.countDocuments({ status: "shipped" })
    let delivered = await orderModel.countDocuments({ status: "delivered" })
    let ordersValue = await itemModel.aggregate([
      {
        $group: {
          _id: null,
          totalValue: { $sum: "$price" }
        }
      }
    ])
    res.status(200).setHeader("Content-Type", "application/json").json({ total, shipped, delivered, ordersValue: ordersValue[0].totalValue })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};