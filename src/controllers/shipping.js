const shipping = require("../models/shipping");
const userModel = require("../models/user");
const ShippinProfile = require("../models/shipping_profile");
const { Shippo } = require("shippo");
const orderModel = require("../models/order");
const transactionModel = require("../models/transaction");
const itemModel = require("../models/item");
const roomsModel = require("../models/room");
const functions = require("../shared/functions");
const { default: mongoose } = require("mongoose");
const addressModel = require("../models/address");
exports.getShipping = async (req, res) => {
  const data = await shipping.find();
  res.status(200).json(data);
};

exports.addShipping = async (req, res) => {
  const data = await shipping.create(req.body);
  res.status(200).json(data);
};

exports.updateUserShipping = async (req, res) => {
  try {
    let id = req.params.id;
    let user = await userModel.findByIdAndUpdate(
      id,
      { shipping: req.body.shipping },
      { runValidators: true, new: true, upsert: false }
    );
    res.json(user);
  } catch (error) {
    console.log(error);
    res.statusCode = 400;
    res.json({ success: false });
  }
};
exports.updateShipping = async (req, res) => {
  const data = await shipping.findByIdAndUpdate(req.params.id, req.body);
  res.status(200).json(data);
};

exports.getShippingById = async (req, res) => {
  const data = await shipping.findById(req.params.id);
  res.status(200).json(data);
};

exports.deleteShipping = async (req, res) => {
  const data = await shipping.findByIdAndDelete(req.params.id);
  res.status(200).json(data);
};

exports.getUserShipping = async (req, res) => {
  try {
    let id = req.params.id;
    let user = await userModel.findOne({ _id: id }).populate("shipping");
    res.json(user?.shipping);
  } catch (error) {
    console.log(error);
    res.statusCode = 400;
    res.json({ success: false });
  }
};
exports.createGeneralShippigProfile = async (req, res) => {
  req.body.default = true;
  const data = await ShippinProfile.create(req.body);
  res.status(200).json(data);
};

exports.createShippigProfile = async (req, res) => {
  let id = req.params.id;
  req.body.user = new mongoose.Types.ObjectId(id);
  const data = await ShippinProfile.create(req.body);
  res.status(200).json(data);
};
exports.getGeneralShippigProfile = async (req, res) => {
  const data = await ShippinProfile.find({ type: "general" });
  res.status(200).json(data);
}
exports.getShippingProfile = async (req, res) => {
  const id = req.params.id;

  const data = await ShippinProfile.find({
    $or: [
      { user: id },
      { type: "general" }
    ]
  });

  res.status(200).json(data);
};
exports.getUserShippingProfile = async (req, res) => {
  const id = req.params.id;
  const data = await ShippinProfile.find({ user: id });

  res.status(200).json(data);
};

exports.deleteShippingProfile = async (req, res) => {
  const data = await ShippinProfile.findByIdAndDelete(req.params.id);
  res.status(200).json(data);
};
exports.updateShippingProfile = async (req, res) => {
  console.log(req.body, req.params.id);
  const data = await ShippinProfile.findByIdAndUpdate(req.params.id, req.body);
  res.status(200).json(data);
};
exports.refundLabel = async (req, res) => {
  let { shipment_id, seller, tokshow } = req.body;
  let order = await orderModel.findOne({ shipment_id }).populate("buyer");
  if (!order) {
    return res
      .status(400)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, error: "Order not found" });
  }
  const { shippo_api_key } = await functions.getSettings();
  const shippo = new Shippo({
    apiKeyHeader: shippo_api_key,
  });
  const transaction = await shippo.refunds.create({
    transaction: shipment_id,
  });
  console.log(transaction)
  let { seller_shipping_fee_pay } = order;
  //update order 
  let updateData = {
    status: "processing",
    label: "",
    need_label: true,
    shipment_id: null,
    tracking_number: null,
    tracking_url: null,
    shipping_surge: 0,
    shipment_date: null,
    seller_shipping_fee_pay: seller_shipping_fee_pay - parseFloat(order?.shipping_surge),
  }

  await itemModel.updateMany({ orderId: order?._id, status: { $in: ['ready_to_ship'] } }, { $set: { status: "processing" } });
  await orderModel.updateMany({ _id: order?._id }, { $set: updateData });
  if (seller_shipping_fee_pay > 0 && order?.seller) {
    await userModel.findByIdAndUpdate(
      order.seller,
      { $inc: { wallet: +parseFloat(seller_shipping_fee_pay) } }
    );


    await transactionModel.findOneAndUpdate(
      {
        orderId: order._id,
        type: "shipping_deduction",
        deducting: true,
      },
      { status: "Refunded" }
    );
  }
  res.json(transaction);
};


exports.buyLabel = async (req, res) => {
  const results = [];
  try {
    const { rates } = req.body;
    console.log(req.body)

    if (!Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ error: "rates array is required" });
    }

    for (const rateData of rates) {
      const { rate_id, label_file_type = "PDF", order: orderId, estimate_data } = rateData;
      if (!rate_id) continue;
      const orderData = await orderModel.findOne({ bundleId: orderId, status: { $in: ['processing', "pending_cancellation"] } }).populate("seller customer");


      // console.log(orderData);
      if (!orderData) {
        results.push({ orderId, error: "Order not found", success: false });
        continue;
      }
      const response = await functions.getSettings();
      const shippo = new Shippo({
        apiKeyHeader: response["shippo_api_key"],
      });
      console.log("estimate_data", estimate_data)
      const transaction = await shippo.transactions.create({
        rate: rate_id,
        label_file_type,
        async: false,
      });
      console.log(transaction)

      if (!transaction.labelUrl || transaction.status == "ERROR") {
        results.push({
          orderId,
          error: transaction.messages?.[0]?.text || "Label purchase failed",
        });
        return res.status(400).json({ error: transaction.messages?.[0]?.text || "Label purchase failed" });
      }
      // console.log(transaction)
      let updateData = {
        label: transaction.labelUrl,
        status: "ready_to_ship",
        rate_id,
        need_label: false,
        shipment_id: transaction.objectId,
        tracking_number: transaction.trackingNumber,
        tracking_url: transaction.trackingUrlProvider,
        shipment_date: transaction.objectCreated,
      }
      let shipping_surge = 0;
      if (estimate_data) {
        console.log(orderData)
        const { price, weight, length, width, height, weight_unit } = estimate_data;
        shipping_surge = parseFloat(price) - (parseFloat(orderData?.shipping_fee) + parseFloat(orderData?.seller_shipping_fee_pay));
        updateData.weight = weight;
        updateData.shipping_surge = shipping_surge < 0 ? 0 : (shipping_surge || 0).toFixed(2);
        updateData.height = height;
        updateData.seller_shipping_fee_pay = parseFloat(orderData?.seller_shipping_fee_pay) + shipping_surge;
        updateData.scale = weight_unit;
        updateData.length = length;
        updateData.width = width;
      }

      // Update the order(s)
      await itemModel.updateMany({ orderId: orderData?._id, status: { $in: ['processing', "pending_cancellation"] } }, { $set: { status: "ready_to_ship" } });
      await orderModel.updateMany({ _id: orderData?._id }, { $set: updateData });
      let updatedOrders = await orderModel.find({ _id: orderData?._id });

      const orderdetails = updatedOrders[0];
      const { seller_shipping_fee_pay, shipping_fee, total_shipping_cost } = orderdetails;
      // Deduct from seller wallet if applicable
      if (seller_shipping_fee_pay > 0 && orderdetails?.seller) {
        //deduct from wallet the seller_shipping_fee_pay because the seller is the one paying for this
          await userModel.findByIdAndUpdate(
            orderdetails.seller._id || orderdetails.seller,
            { $inc: { wallet: -seller_shipping_fee_pay } }
          );

          const orderItems = await itemModel.find({ orderId: orderdetails._id }).select("_id");

          const lastAvail = await transactionModel.findOne({
            type: "order",
            itemId: { $in: orderItems.map(i => i._id) },
          })
            .sort({ availableOn: -1 })
            .select("availableOn");

          const shippingAvailableOn = lastAvail?.availableOn || Date.now();

          await transactionModel.create({
            from: orderdetails.seller,
            to: orderdetails.customer,
            reason: `Seller extra Shipping cost for ${orderdetails.invoice || orderdetails._id}`,
            amount: seller_shipping_fee_pay,
            status: "Pending",
            type: "shipping_deduction",
            deducting: true,
            orderId: orderdetails._id,
            date: Date.now(),
            availableOn: shippingAvailableOn,
            payment_available: false,
            paid_out: false,
          });
        
      }

      // Append to results
      results.push({
        orderId: orderdetails._id,
        seller: orderdetails.seller,
        label: transaction.labelUrl,
        tracking_number: transaction.trackingNumber,
        tracking_url: transaction.trackingUrlProvider,
        total_shipping_cost,
        seller_shipping_fee_pay,
        buyer_shipping_fee: shipping_fee,
        success: false
      });
    }
    console.log({
      success: true,
      count: results.length,
      results,
    });
    // ✅ Return results for all orders/bundles
    return res.json({
      success: true,
      count: results.length,
      results,
    });
  } catch (err) {
    console.error("Shippo multi-label error:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    //process payments 
    // processpayments(results);
  }
};

async function processpayments(order) {
  // const stripe = require("stripe")(
  //   (await functions.getSettings())["stripeSecretKey"]
  // );

  // const sellerId = order.seller?._id;
  // const seller = await userModel.findById(sellerId);
  // if (!seller?.stripe_account) return;
  let orderItems = await itemModel.find({ orderId: order._id });
  await transactionModel.updateMany(
    { itemId: { $in: orderItems.map((i) => i._id) }, type: "order", paid_out: false },
    { $set: { order_fulfilled: true } }
  );
  console.log("transactions shippo", orderItems);
  // const transactions = await transactionModel.find({
  //   itemId: { $in: orderItems.map((i) => i._id) },
  //   paid_out: false,
  //   type: "order",
  //   payment_available: true
  // }).select("_id amount");
  // console.log("transactions shippo", transactions);

  // if (!transactions.length) return;

  // const totalAmount = transactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);
  // if (totalAmount <= 0) return;

  // // ✅ get latest wallet for accurate netting
  // const fresh = await userModel.findById(sellerId).select("wallet");
  // const owed = Math.min(0, fresh?.wallet || 0);
  // console.log("owed", owed);

  // const netAmount = totalAmount + owed;
  // if (netAmount <= 0) return;

  // const transfer = await stripe.transfers.create({
  //   amount: Math.round(netAmount * 100),
  //   currency: "usd",
  //   destination: seller.stripe_account,
  //   transfer_group: `order_${order._id}`,
  // });

  // const roundedNetAmount = Math.round(netAmount * 100) / 100;

  // let newuserdata = await userModel.findByIdAndUpdate(sellerId, {
  //   $inc: { wallet: roundedNetAmount, walletPending: -totalAmount },
  //   $set: {
  //     last_stripe_transfer: new Date(),
  //   }
  // }, { new: true });

  // await transactionModel.updateMany(
  //   { _id: { $in: transactions.map(t => t._id) } },
  //   { $set: { paid_out: true, transferId: transfer.id } }
  // );
  // await transactionModel.create({
  //   from: null,
  //   to: sellerId,
  //   reason: "Transfer Initiated",
  //   type: "transfer",
  //   amount: roundedNetAmount,
  //   status: "Completed",
  //   deducting: false,
  //   transferId: transfer.id,
  //   date: Date.now(),
  //   new_pending_balance: newuserdata.walletPending
  // });

  // if (seller?.fcmToken) {
  //   functions.sendNotification(
  //     [seller.fcmToken],
  //     "Payment Received",
  //     "You have received a payment of $" + roundedNetAmount,
  //     { id: seller._id.toString(), screen: "WalletScreen" }
  //   );
  // }
}

exports.webookShippo = async (req, res) => {
  console.log("SHIPPO WEBHOOK:", req.body);

  const { tracking_number, tracking_status } = req.body.data || req.body;
  if (!tracking_number || !tracking_status) return res.sendStatus(200);

  const status = tracking_status.status;
  const date = tracking_status.status_date;

  // Update order status
  if (status === "TRANSIT" || status === "ACCEPTED") {
    console.log("status", status)
    let order = await orderModel.findOneAndUpdate(
      { tracking_number },
      { status: "shipped", shipped_at: date }
    ).populate("seller", "fcmToken").populate("buyer", "fcmToken");

    if (order) {
      await processpayments(order);
    }

    // let results = [];
    // if (order) {
    //   results.push({
    //     orderId: order._id,
    //     seller: order.seller,
    //   });
    // }
    // if (results.length) {
    //   await processpayments(results);
    // }


    //process transactions of orders with this tracking number


    //send notification 
    functions.sendNotification(
      [order?.seller?.fcmToken],
      "Order Updated",
      "Order #" + order?.invoice + " is on Transit",
      {
        id: order?._id,
        screen: "OrderScreen",
      }
    );
  }
  console.log("status", status)
  if (status === "DELIVERED") {
    // let tracking_number = '9200190396055700394600';
    let order = await orderModel.findOneAndUpdate(
      { tracking_number },
      { status: "delivered", delivered_at: date }
    );
    functions.sendNotification(
      [order?.seller?.fcmToken],
      "Order Updated",
      "Order #" + order?.invoice + " has been delivered",
      {
        id: order?._id,
        screen: "OrderScreen",
      }
    );
  }

  return res.sendStatus(200);
}
exports.getUSPSScanForm = async (req, res) => {
  console.log("SCAN FORM FETCH:", req.query);
  try {
    const { type, tokshow, status } = req.query;

    // Build query based on type
    const orderFilter = {
      status: "ready_to_ship",
      manifest_id: { $exists: true, $ne: null }
    };

    if (type === "tokshow" || tokshow) {
      orderFilter.tokshow = tokshow;
    } else if (type === "marketplace") {
      orderFilter.tokshow = null;
    }
    console.log(orderFilter)

    // 1️⃣ Find all orders that already have SCAN Form manifests
    const orders = await orderModel.find(orderFilter).lean();

    if (!orders.length) {
      return res.status(404).json({
        success: false,
        message: "No SCAN Forms generated yet for this selection"
      });
    }

    // 2️⃣ Group orders by manifest_id
    const manifests = {};
    orders.forEach(o => {
      if (!manifests[o.manifest_id]) manifests[o.manifest_id] = { manifest_id: o.manifest_id, scan_form_url: o.scan_form_url };
    });

    const settings = await functions.getSettings();
    const shippo = new Shippo({ apiKeyHeader: settings["shippo_api_key"] });

    // 3️⃣ For each manifest that does not yet have a scan_form_url saved → fetch from Shippo
    for (const manifestId of Object.keys(manifests)) {
      const form = manifests[manifestId];

      // Already cached → skip API call
      if (form.scan_form_url) continue;

      const manifest = await shippo.manifests.get(manifestId);

      if (
        manifest.status === "SUCCESS" &&
        Array.isArray(manifest.documents) &&
        manifest.documents.length > 0
      ) {
        // Pick first PDF when multiple formats exist
        const pdf = manifest.documents.find(doc => doc.toLowerCase().endsWith(".pdf")) || manifest.documents[0];

        // Save to all orders using this manifest
        await orderModel.updateMany(
          { manifest_id: manifestId },
          { $set: { scan_form_url: pdf } }
        );

        // Update in response object
        manifests[manifestId].scan_form_url = pdf;
      }
    }

    // 4️⃣ Return list of all manifest PDFs for the UI
    return res.json({
      success: true,
      count: Object.keys(manifests).length,
      forms: Object.values(manifests) // [{ manifest_id, scan_form_url }]
    });

  } catch (error) {
    console.error("SCAN FORM ERROR:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};


exports.generateUSPSScanForm = async (req, res) => {
  // try {
  const { tokshow, ownerId, platform_order = "false" } = req.body;
  console.log("SCAN START:", req.body);

  const settings = await functions.getSettings();
  const shippo = new Shippo({ apiKeyHeader: settings["shippo_api_key"] });

  // 1️⃣ Fetch orders that already have labels and are ready to ship
  let filter = {
    status: "ready_to_ship",
    shipment_id: { $exists: true, $ne: "" },
    manifest_id: { $eq: null },
    ...(tokshow ? { tokshow } : { tokshow: null }),
    ...(platform_order == "true" || platform_order == true ? { platform_order: true } : { platform_order: false })
  };
  console.log(filter);
  const orders = await orderModel.find({
    ...filter,
    // carrier: "USPS",
    carrierAccount: { $exists: true, $ne: null }
  }).lean();

  if (!orders.length) {
    return res.status(400).json({
      success: false,
      message: "No USPS labels found for SCAN Form"
    });
  }

  // // 2️⃣ Group orders by shipment_date + carrierAccount (Shippo requirement)
  // const groups = {};
  // for (const order of orders) {
  //   console.log(order.shipment_date)
  //   const dateKey = order.shipment_date;
  //   const accountKey = order.carrierAccount; // saved during label purchase

  //   if (!groups[dateKey]) groups[dateKey] = {};
  //   if (!groups[dateKey][accountKey]) groups[dateKey][accountKey] = [];

  //   groups[dateKey][accountKey].push(order);
  // }
  const groups = {};

  for (const order of orders) {
    // Normalize to USPS day
    const dateKey = new Date(order.shipment_date)
      .toISOString()
      .split("T")[0]; // YYYY-MM-DD

    const carrierAccount = order.carrierAccount;
    if (!carrierAccount) continue;

    if (!groups[dateKey]) groups[dateKey] = {};
    if (!groups[dateKey][carrierAccount]) groups[dateKey][carrierAccount] = [];

    groups[dateKey][carrierAccount].push(order);
  }


  console.log(groups)

  // console.log(orders)
  // 3️⃣ Get the seller's address
  const ownerAddress = await addressModel
    .findOne({ userId: ownerId })
    .sort({ primary: -1, createdAt: 1 });

  if (!ownerAddress) {
    return res.status(400).json({
      success: false,
      message: "Seller shipping address not found"
    });
  }

  const manifests = [];

  // 4️⃣ Create a separate manifest for each (date + carrierAccount) group
  for (const [date, accountGroups] of Object.entries(groups)) {
    console.log("accountGroups", accountGroups)
    for (const [carrierAccount, orderBatch] of Object.entries(accountGroups)) {
      const transactions = orderBatch.map(o => o.shipment_id);

      var manifestpayload = {
        provider: "usps",
        shipmentDate: new Date(orderBatch[0].shipment_date).toISOString(),
        transactions,
        carrierAccount,
        addressFrom: {
          name: ownerAddress?.name,
          street1: ownerAddress?.addrress1,
          city: ownerAddress?.city,
          state: ownerAddress?.state,
          zip: ownerAddress?.zipcode,
          country: ownerAddress?.countryCode ?? "US",
          phone: ownerAddress?.phone,
          email: ownerAddress?.email,
        }
      };
      console.log(manifestpayload)

      const manifest = await shippo.manifests.create(manifestpayload);

      const manifestId = manifest.objectId;
      console.log(manifestId)
      // 5️⃣ Attach manifest_id to all orders in this batch
      await orderModel.updateMany(
        { _id: { $in: orderBatch.map(o => o._id) } },
        { $set: { manifest_id: manifestId, scan_form_url: null } }
      );

      // Poll Shippo for PDF background
      pollManifestForOrders(shippo, manifestId);

      manifests.push({ manifest_id: manifestId });
    }
  }

  // const manifests = [];

  // for (const [key, orderBatch] of Object.entries(groups)) {
  //   const [uspsDay, carrierAccount] = key.split("_");

  //   const transactions = orderBatch.map(o => o.shipment_id);

  //   const manifest = await shippo.manifests.create({
  //     provider: "usps",
  //     shipmentDate: `${uspsDay}T00:00:00Z`,
  //     transactions,
  //     carrierAccount,
  //     addressFrom: {
  //       name: ownerAddress?.name,
  //       street1: ownerAddress?.addrress1,
  //       city: ownerAddress?.city,
  //       state: ownerAddress?.state,
  //       zip: ownerAddress?.zipcode,
  //       country: ownerAddress?.countryCode ?? "US",
  //       phone: ownerAddress?.phone,
  //       email: ownerAddress?.email,
  //     }
  //   });

  //   const manifestId = manifest.objectId;

  //   await orderModel.updateMany(
  //     { _id: { $in: orderBatch.map(o => o._id) } },
  //     { $set: { manifest_id: manifestId, scan_form_url: null } }
  //   );

  //   pollManifestForOrders(shippo, manifestId);

  //   manifests.push({ manifest_id: manifestId });
  // }


  // 6️⃣ Respond immediately to frontend
  return res.json({
    success: true,
    message: "SCAN Form generation started",
    manifests
  });

  // } catch (error) {
  //   console.error("USPS SCAN Error:", error);
  //   return res.status(500).json({ success: false, error: error.message });
  // }
};


async function pollManifestForOrders(shippo, manifestId) {

  try {
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 5000)); // wait 5 seconds

      const manifest = await shippo.manifests.get(manifestId);
      if (
        manifest.status === "SUCCESS" &&
        Array.isArray(manifest.documents) &&
        manifest.documents.length > 0
      ) {
        const pdf = manifest.documents[0];

        await orderModel.updateMany(
          { manifest_id: manifestId },
          { $set: { scan_form_url: pdf } }
        );

        console.log("SCAN READY:", manifestId);
        return;
      }

      if (manifest.status === "ERROR" || manifest.status === "INVALID") {
        console.log("SCAN FAILED:", manifestId);
        return;
      }
    }

    console.log("SCAN timeout:", manifestId);
  } catch (err) {
    console.error("SCAN poll error:", err.message);
  }
}


exports.getEstimatedShipping = async (req, res) => {
  console.log(req.body);
  try {
    const cheapest = await functions.getCheapestUSPSRate(req.body);
    return res.json(cheapest);
  } catch (err) {
    console.error("Shippo error:", err);
    return res.status(500).json({ error: err.message });
  }
};
