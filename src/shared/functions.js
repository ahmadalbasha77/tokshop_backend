const activitiesModel = require("../models/activity");
const userModel = require("../models/user");
const utils = require("../../utils");
const transactionModel = require("../models/transaction");
const appSettings = require("../models/settings");
const { Shippo } = require("shippo");
const axios = require("axios");
const bidModel = require("../models/bid");
const auctionModel = require("../models/auction");
const paymentmethodModel = require("../models/payment_methods");
const addressModel = require("../models/address");
const productModel = require("../models/product");
const itemModel = require("../models/item");
const orderModel = require("../models/order");
const mongoose = require("mongoose");
const roomsModel = require("../models/room");
const bank = require("../models/bank");
const category = require("../models/category");
const socketEmitter = require("./socketEmitter");
const logsModel = require("../models/activity_logs");

const { stopEgress } = require("./livekit");
const { sendPushNotification } = require("./send_notification");
const emailTemplates = require("../models/templates");
function getOrderPopulates() {
  return [
    {
      path: "customer",
      select:
        "firstName lastName userName email phonenumber profilePhoto address fcmToken",
      populate: "address",
    },
    { path: "tokshow", select: "title" },
    { path: "dispute" },
    {
      path: "seller",
      select: [
        "firstName",
        "lastName",
        "userName",
        "email",
        "phonenumber",
        "profilePhoto", "fcmToken"
      ],
      populate: "address",
    },
    {
      path: "giveawayId",
      populate: [
        { path: "shipping_profile" },
        { path: "category" },
        { path: "tokshow", select: "title" },
        {
          path: "winner",
          select:
            "firstName lastName userName email phonenumber profilePhoto",
        },
      ],
    },
    {
      path: "giveaway",
      populate: [
        { path: "shipping_profile" },
        { path: "category" },
        { path: "tokshow", select: "title" },
        {
          path: "winner",
          select:
            "firstName lastName userName email phonenumber profilePhoto",
        },
      ],
    },
    {
      path: "items",
      populate: [{
        path: "productId",
        select: "name images",
        populate: { path: "category", select: "name" },
      }, {
        path: "giveawayId",
        populate: [
          { path: "shipping_profile" },
          { path: "category" },
          { path: "tokshow", select: "title" },
          {
            path: "winner",
            select:
              "firstName lastName userName email phonenumber profilePhoto",
          },
        ],
      },],
    },
    {
      path: "items",
      populate: {
        path: "customer",
        select: "userName",
      },
    },
    {
      path: "items",
      populate: {
        path: "seller",
        select: "userName",
      },
    },
  ];
}
wcOrder = async (payload, id) => {
  let user = await userModel.findOne({ _id: id });
  axios
    .post(user?.wcUrl + "/wp-json/wc-api/v1/create-order", payload, {
      auth: {
        username: user?.wcConsumerKey,
        password: user?.wcSecretKey,
      },
    })
    .then((response) => console.log(response.data))
    .catch((error) => console.error(error));
};

async function getCommission(categoryId, productId) {
  //check if category has commission and is enabled
  const response = await getSettings();
  let commission = response["commission"];
  if (!categoryId) {
    let product = await productModel.findById(productId).populate("category");
    if (!product) {
      return commission;
    }
    if (!product.category) {
      return commission;
    }
    commission = product?.category?.commission_enabled
      ? product.category.commission
      : commission;
    return commission;
  } else if (categoryId) {
    let response = await category.findById(categoryId);
    if (!response) {
      return commission;
    }
    commission = response.commission_enabled ? response.commission : commission;
    return commission;
  }
  return commission;
}
async function createOrder({
  buyer,
  product,
  quantity,
  color,
  size,
  subtotal,
  seller,
  tax = 0,
  tokshow,
  shippingFee,
  rate_id,
  ordertype,
  bidTotal = 0,
  servicelevel,
  totalWeightOz,
  bundleId,
  seller_shipping_fee_pay,
  carrierAccount,
  egressId,
  carrier = null,
  flash_sale = false,
  shipping = null,
  referredBy = null,
  referralDiscount = 0,
  allow_referal_discount = false
}) {
  const orderId = new mongoose.Types.ObjectId();
  const itemId = new mongoose.Types.ObjectId();

  // ================= SETTINGS & FEES =================
  const response = await getSettings();
  let commission = await getCommission(null, product);
  console.log(commission)
  const serviceFee = (subtotal * ((commission ?? 10) / 100)).toFixed(2);
  console.log("allow_referal_discount", allow_referal_discount)
  if (allow_referal_discount == true) {
    referralDiscount = response.referral_credit;
  }
  const stripe_fee =
    (parseFloat(response["stripe_fee"]) / 100) *
    (subtotal + parseFloat(tax) + parseFloat(shippingFee));

  const extra_charges = parseFloat(response["extra_charges"]);
  const totalMinusDeductions =
    subtotal - serviceFee - tax - extra_charges - stripe_fee;

  const earnings = Number(totalMinusDeductions.toFixed(2));
  const totalStripeCharges = extra_charges + stripe_fee;

  // ================= ADDRESS =================
  const address = await addressModel
    .findOne({ userId: buyer })
    .populate("userId")
    .sort({ primary: -1, createdAt: 1 });

  if (!address) throw new Error("No address");

  // ================= PAYMENT METHOD =================
  const paymentmethod = await paymentmethodModel.findOne({
    userid: buyer,
    primary: true,
    customerid: { $ne: null },
    status: { $ne: "blocked" }
  });

  if (!paymentmethod) throw new Error("No valid payment method");

  // ================= PRODUCT =================
  const productres = await productModel
    .findById(product)
    .populate("shipping_profile");

  if (!productres || productres.quantity <= 0) {
    return { success: false, error: "product out of stock" };
  }

  // ================= CREATE ORDER (ONCE) =================
  const totalShippingCost =
    parseFloat(shippingFee || 0) + parseFloat(seller_shipping_fee_pay || 0)
  let orderDifftype = productres?.tokshow == null ? "marketplace" : "tokshow"


  // ================= CREATE ITEM (ONCE) =================
  let itemtotal = flash_sale ? productres.flash_sale_price : productres.price;


  // ================= ATTEMPT PAYMENT =================
  const { charge, balanceTx, success, error } =
    await chargeStripePaymentMethod(
      subtotal,
      paymentmethod,
      orderId,
      seller,
      serviceFee,
      shippingFee,
      tax,
      referralDiscount,
      buyer
    );


  const payload = {
    _id: orderId,
    customer: buyer,
    seller,
    paymentMethod: paymentmethod._id,
    invoice: Math.floor(Math.random() * 1_000_000),
    date: Date.now(),
    tokshow,
    earnings,
    rate_id,
    items: [],
    shipping_fee: shippingFee,
    service_fee: serviceFee,
    stripe_fees: totalStripeCharges,
    subtotal,
    carrier,
    tax: parseFloat(tax),
    ordertype: orderDifftype,
    servicelevel,
    weight: totalWeightOz,
    height: productres?.shipping_profile?.height,
    scale: 'oz',
    length: productres?.shipping_profile?.length,
    width: productres?.shipping_profile?.width,
    bundleId: bundleId?.toString(),
    seller_shipping_fee_pay,
    total_shipping_cost: totalShippingCost, carrierAccount,
    discount: referralDiscount
  };


  if (ordertype == "offer") {
    itemtotal = subtotal;
  }
  if (ordertype == "auction") {
    itemtotal = bidTotal;
  }
  var orderItem = {
    _id: itemId,
    productId: product,
    customer: buyer,
    earnings,
    seller,
    tokshow,
    order_reference: `#${productres.order_reference_counter}`,
    quantity,
    chargeId: charge?.id,
    price: itemtotal,
    ordertype,
    weight: productres?.shipping_profile?.weight,
    stripe_fees: totalStripeCharges,
    service_fee: serviceFee,
    height: productres?.shipping_profile?.height,
    scale: productres?.shipping_profile?.scale,
    length: productres?.shipping_profile?.length,
    width: productres?.shipping_profile?.width,
    shipping_fee: shippingFee,
    seller_shipping_fee_pay,
    egressId
  };

  // ================= PAYMENT FAILED =================
  if (!success) {
    console.log(ordertype);
    if (ordertype == "auction" || ordertype == "offer" || flash_sale == true) {
      const failedOrder = await orderModel.create({
        ...payload,
        items: [itemId],
        status: "payment_failed",
        payment_status: "failed",
        retry_count: 1,
        last_payment_error: error?.error,
        weight: productres?.shipping_profile?.weight,
        need_label: false
      });
      await itemModel.create({
        ...orderItem,
        orderId: failedOrder._id,
        status: "payment_failed"
      });

      // ---------- LOGS ----------
      saveLogs({
        userId: address.userId?._id,
        log_data: JSON.stringify({
          error,
          success: false,
          buyerUserName: address.userId?.userName
        })
      });

      // ---------- ACTIVITY ----------
      saveActivity(
        "order",
        address.userId?.userName,
        "order",
        seller,
        address.userId?.profilePhoto,
        seller,
        "Order Payment Failed for Item: " +
        productres.name +
        " #" +
        productres.order_reference_counter,
        buyer
      );

      // ---------- NOTIFICATIONS ----------
      const sellerfcm = await userModel.findById(seller);

      sendNotification(
        [sellerfcm?.fcmToken],
        `Order ${productres?.name}#${productres?.order_reference_counter} Failed`,
        "Order Payment Failed for Item: " +
        productres.name +
        " #" +
        productres.order_reference_counter,
        {
          id: failedOrder._id?.toString(),
          screen: "OrderScreen",
        }
      );


      // ---------- ORDER REF COUNTER ----------
      await productModel.findByIdAndUpdate(
        product,
        { $inc: { order_reference_counter: 1 } },
        { runValidators: true, new: true }
      );
      sendNotification(
        [address.userId?.fcmToken],
        `Order ${productres?.name}#${productres?.order_reference_counter} Failed`,
        "Order Payment Failed for Item: " +
        productres?.name +
        " #" +
        productres?.order_reference_counter,
        {
          id: failedOrder?._id?.toString(),
          screen: "OrderScreen",
        }
      );
    }

    return { success: false, retryable: true, orderId: orderId, message: error?.error, error: error?.error };
  }

  let newOrder = await orderModel.findOne({
    status: "processing",
    bundleId: bundleId,
    customer: buyer,
    tokshow
  });
  // console.log("orderItem ",orderItem)
  const newItem = await itemModel.create({
    ...orderItem,
    status: "processing",
    orderId: newOrder ? newOrder._id : orderId,
  });
  const isNewBundle = !newOrder;

  if (newOrder) {
    console.log("new orderfound ", totalWeightOz)
    newOrder.items.push(itemId);
    newOrder.weight = totalWeightOz;
    newOrder.shipping_fee = parseFloat(shippingFee) + newOrder?.shipping_fee;
    newOrder.order_reference = `#${productres.order_reference_counter}`,
      newOrder.createdAt = new Date();
    newOrder.carrier = carrier;
    newOrder.stripe_fees = totalStripeCharges + newOrder?.stripe_fees,
      newOrder.service_fee = parseFloat(serviceFee) + newOrder?.service_fee,
      newOrder.rate_id = rate_id;
    newOrder.updatedAt = new Date();
    newOrder.tax = parseFloat(tax + newOrder?.tax);
    newOrder.earnings = earnings + newOrder?.earnings;
    newOrder.ordertype = orderDifftype;
    newOrder.carrierAccount = carrierAccount;
    newOrder.discount = newOrder?.discount + (referralDiscount || 0);
    newOrder.seller_shipping_fee_pay = seller_shipping_fee_pay + newOrder?.seller_shipping_fee_pay;
    newOrder.total_shipping_cost = totalShippingCost + newOrder?.total_shipping_cost;
    await newOrder.save();
  } else {
    // console.log("payload ",payload)
    payload.items.push(itemId);
    newOrder = await orderModel.create({
      ...payload,
      status: "processing",
    });
  }

  // ================= PAYMENT SUCCESS → FINALIZE =================
  return await finalizeOrder({
    order: newOrder,
    item: newItem,
    productres,
    charge,
    balanceTx,
    earnings,
    subtotal,
    shippingFee,
    serviceFee,
    tax,
    isNewBundle,
    shipping,
    stripe_fee
  });
}
async function retryOrderPayment(orderId) {
  const order = await orderModel.findById(orderId);
  console.log(order)

  if (!order || order.payment_status !== "failed") {
    return {
      success: false,
      retryable: false,
      error: "Order not found"
    }
  }

  // 🔒 Retry limit
  if ((order.retry_count || 0) >= 3) {
    return {
      success: false,
      retryable: false,
      error: "Retry limit exceeded"
    };
  }
  // 4️⃣ Get payment method

  // 1️⃣ Recalculate bundle + shipping
  const { shipping } = await recalcBundleForRetry(order);
  console.log(shipping)
  const paymentmethod = await paymentmethodModel.findOne({
    userid: order.customer,
    primary: true,
    status: { $ne: "blocked" }
  });

  if (!paymentmethod) {
    return {
      success: false,
      retryable: false,
      error: "Your payment method cannot complete the payment"
    }
  }

  // 2️⃣ If shipping cost increased → STOP
  if (Number(shipping.amount) > Number(order.shipping_fee)) {
    return {
      success: false,
      retryable: false,
      require_confirmation: true,
      reason: "Shipping changed ",
      new_shipping: shipping
    };
  }

  // 3️⃣ Update order with recalculated bundle data
  await orderModel.findByIdAndUpdate(order._id, {
    bundleId: shipping.bundleId,
    weight: shipping.totalWeightOz,
    shipping_fee: shipping.amount,
    seller_shipping_fee_pay: shipping.seller_shipping_fee_pay,
    total_shipping_cost: shipping.totalAmount
  });


  // 5️⃣ Retry Stripe charge
  const { charge, balanceTx, success, error } =
    await chargeStripePaymentMethod(
      order.subtotal,
      paymentmethod,
      order._id,
      order.seller,
      order.service_fee,
      shipping.amount,
      order.tax,
      order.referralDiscount,
      order?.customer
    );

  // 6️⃣ Retry failed again
  if (!success) {
    await orderModel.findByIdAndUpdate(order._id, {
      status: "payment_failed",
      payment_status: "failed",
      last_payment_error: error?.error,
      $inc: { retry_count: 1 }
    });

    return { success: false, retryable: true, error: error?.error };
  }

  // 7️⃣ Finalize order
  const item = await itemModel.findOne({ orderId: order._id }).populate("productId");
  return await finalizeOrder({
    order,
    item,
    productres: item.productId,
    charge,
    balanceTx,
    earnings: order.earnings,
    stripe_fee: order.stripe_fees,
    extra_charges: 0,
    subtotal: order.subtotal,
    serviceFee: order.service_fee,
    tax: order.tax,
    total_shipping_cost: order.total_shipping_cost,
    shipping,
    retry: true
  });
}

async function recalcBundleForRetry(order) {
  // 1. Load items of this failed order
  const items = await itemModel.find({ orderId: order._id });

  if (!items.length) {
    throw new Error("No items found for order");
  }

  // // 2. Find CURRENT processing orders (paid only)
  // const processingOrders = await orderModel.find({
  //   seller: order.seller,
  //   customer: order.customer,
  //   tokshow: order.tokshow,
  //   status: "processing",
  //   payment_status: "paid",
  // });
  // console.log(processingOrders)

  // // 3. Calculate existing bundle weight
  // const existingWeight = processingOrders.reduce(
  //   (sum, o) => sum + (parseFloat(o.weight) || 0),
  //   0
  // );
  // console.log(existingWeight)

  // 4. Calculate retry order weight
  const retryWeight = items.reduce(
    (sum, i) => sum + (parseFloat(i.weight) * i.quantity),
    0
  );
  console.log(retryWeight)

  // 5. Recalculate shipping using CURRENT reality
  const shipping = await getCheapestUSPSRate({
    weight: retryWeight,
    owner: order.seller,
    customer: order.customer,
    tokshow: order.tokshow,
    items: items.map(i => ({
      weight: i.weight,
      quantity: i.quantity,
      name: i?.name || "Item",
      price: i.price,
      hsCode: i?.hsCode || "950440"
    }))
  });

  return {
    shipping,
    retryWeight,
    // existingWeight
  };
}


async function finalizeOrder({
  order,
  item,
  productres,
  charge,
  balanceTx,
  earnings,
  subtotal,
  serviceFee,
  tax,
  isNewBundle,
  shipping,
  stripe_fee,
  retry = false,
}) {
  console.log("finalizing order ", shipping, earnings, order)
  if (order.payment_status === "paid" && retry == true) return order;

  // ---------- INVENTORY ----------
  await productModel.findByIdAndUpdate(
    productres._id,
    {
      $inc: {
        quantity: -item.quantity,
        salesCount: item.quantity,
        order_reference_counter: 1
      }
    }
  );

  // ---------- FLASH SALE ----------
  if (productres?.flash_sale && productres?.quantity === 0) {
    await roomsModel.findByIdAndUpdate(productres?.tokshow, {
      $set: { pinned: null }
    });

  }

  socketEmitter.emitTo(
    productres?.tokshow?.toString(),
    "flash-sale-product-update",
    productres
  );

  // ---------- SELLER WALLET ----------
  let seller = await userModel.findByIdAndUpdate(order.seller, {
    $inc: { walletPending: earnings }
  }, { new: true });
  console.log("shipping ", shipping)
  let {
    carrierAccount,
    amount,
    totalWeightOz,
    bundleId,
    seller_shipping_fee_pay,
    provider: carrier,
    rate_id
  } = shipping;

  if (retry == true) {
    let newOrder = await orderModel.findOne({
      status: "processing",
      bundleId: bundleId,
    });

    if (newOrder) {
      await itemModel.findByIdAndUpdate(
        item?._id,
        { $set: { orderId: newOrder._id, status: "processing" } }
      );
      let orderDifftype = productres?.tokshow == null ? "marketplace" : "tokshow"
      newOrder.items.push(item);
      newOrder.weight = totalWeightOz;
      newOrder.shipping_fee = parseFloat(amount) + newOrder?.shipping_fee;
      newOrder.order_reference = `#${productres.order_reference_counter}`,
        newOrder.createdAt = new Date();
      newOrder.carrier = carrier;
      newOrder.stripe_fees = parseFloat(stripe_fee) + newOrder?.stripe_fees,
        newOrder.service_fee = parseFloat(serviceFee) + newOrder?.service_fee,
        newOrder.rate_id = rate_id;
      newOrder.updatedAt = new Date();
      newOrder.tax = parseFloat(tax + newOrder?.tax);
      newOrder.earnings = earnings + newOrder?.earnings;
      newOrder.ordertype = orderDifftype;
      newOrder.carrierAccount = carrierAccount;
      newOrder.seller_shipping_fee_pay = seller_shipping_fee_pay + newOrder?.seller_shipping_fee_pay;
      newOrder.total_shipping_cost = parseFloat(amount) + newOrder?.total_shipping_cost;
      await newOrder.save();
      await orderModel.findByIdAndDelete(order._id);
      order = newOrder;
    } else {
      await itemModel.findByIdAndUpdate(
        item?._id,
        { $set: { status: "processing" } }
      );
      // ---------- ORDER ----------
      await orderModel.findByIdAndUpdate(order._id, {
        status: "processing",
        payment_status: "paid",
        updatedAt: new Date()
      });
    }
  }

  // ---------- TRANSACTION ----------
  await transactionModel.create({
    from: order.customer,
    to: order.seller,
    chargeId: charge?.id,
    balanceTransactionId: charge?.balance_transaction?.id,
    availableOn: (balanceTx?.available_on ?? Date.now()) * 1000,
    amount: earnings,
    total: subtotal,
    shippingFee: amount,
    serviceFee,
    tax, deducting: false,
    reason: `Purchase of product order #${order?.invoice}`,
    status: "Pending",
    type: "order",
    orderId: order._id,
    itemId: item._id,
    date: Date.now(),
    stripe_fee: order?.stripe_fees,
    extra_charges: order?.extra_charges,
    new_pending_balance: seller?.walletPending
  });

  // creating service fee transaction waiting stripe to clear
  await transactionModel.create({
    reason: `System Service Fee from order${order?.invoice}`,
    amount: parseFloat(serviceFee),
    status: "Pending",
    type: "service_fee",
    deducting: true,
    orderId: order._id,
    date: Date.now(),
    availableOn: (balanceTx?.available_on ?? Date.now()) * 1000,
  });

  if (productres?.tokshow) {
    const roomUpdate = {
      $addToSet: { soldProducts: productres._id },
      $inc: { salesTotal: subtotal, salesCount: item.quantity }
    };

    // ✅ Increment shipmentsCount ONLY if a new bundle was created
    if (isNewBundle) {
      roomUpdate.$inc.shipmentsCount = 1;
    }

    await roomsModel.findByIdAndUpdate(
      productres?.tokshow,
      roomUpdate,
      { runValidators: true, new: true }
    );
  }

  return { success: true, orderId: order._id, message: "Order completed", newOrder: order, newItem: item, seller: order.seller, buyer: order.customer, productres };
}

async function chargeStripePaymentMethod(
  orderTotal,
  paymentmethod,
  orderId,
  seller,
  serviceFee,
  shippingFee,
  tax,
  referralDiscount,
  buyer
) {
  let sellerdata = await userModel.findById(seller)
  try {
    var response = await getSettings();
    const stripe = require("stripe")(response["stripeSecretKey"]);

    const toCents = num => Math.round(Number(num) * 100);
    console.log('orderTotal ', orderTotal)
    const amountCents = toCents(orderTotal);
    const shippingCents = toCents(shippingFee ?? 0);
    // const appFeeCents = toCents(serviceFee);
    const taxCents = toCents(tax);
    const referralDiscountCents = toCents(referralDiscount);

    const totalChargeCents = amountCents + shippingCents + taxCents - referralDiscountCents;
    let payload = {
      amount: totalChargeCents,
      currency: "usd",
      customer: paymentmethod?.customerid,
      payment_method: paymentmethod?.paymentMethodId,
      off_session: true,
      confirm: true,
      transfer_group: `order_${orderId}`,
      metadata: { sellerId: sellerdata?._id.toString(), orderId: orderId?.toString() },
      on_behalf_of: sellerdata?.stripe_account,
    }
    const paymentIntent = await stripe.paymentIntents.create(payload);
    await new Promise((r) => setTimeout(r, 5000));
    const refreshedPI = await stripe.paymentIntents.retrieve(paymentIntent.id, {
      expand: ["latest_charge.balance_transaction"],
    });
    if (shippingFee > 0) {
      await transactionModel.create({
        reason: `Buyer Shipping cost from order #${orderId}`,
        amount: parseFloat(shippingFee),
        status: "Pending",
        type: "shipping_deduction",
        deducting: true,
        orderId: orderId,
        date: Date.now(),
        availableOn: (refreshedPI?.latest_charge?.balance_transaction?.available_on ?? Date.now()) * 1000
      });
    }
    if (referralDiscountCents > 0 && paymentmethod?.userid) {
      await userModel.findOneAndUpdate({ _id: paymentmethod?.userid }, { $set: { awarded_referal_credit: true } });
      await transactionModel.create({
        from: seller,
        to: paymentmethod?.userid,
        amount: referralDiscount,
        status: "Completed",
        type: "referral_credit",
        reason: `Referral discount from order #${orderId}`,
        date: Date.now(),
        deducting: true
      })
    }
    return {
      paymentIntent: refreshedPI,
      charge: refreshedPI.latest_charge,
      balanceTx: refreshedPI?.latest_charge?.balance_transaction,
      success: true
    };
  } catch (err) {
    console.log(err);
    let response = {
      paymentIntent: err.raw.payment_intent?.id,
      charge: err.raw.charge,
      balanceTx: null,
      error: {
        ok: false,
        error: err.message || 'Payment failed',
        code: err.code,
        decline_code: err.decline_code,
        requestId: err.requestId || (err.raw && err.raw.requestId)
      },
      success: false
    };
    saveLogs({
      user: seller,
      log_data: JSON.stringify(response),
    })
    // await paymentmethodModel.findOneAndUpdate({ paymentMethodId: paymentmethod?.paymentMethodId }, { status: 'blocked', description: err.code })
    return response;
  }
}

// async function createOrder({
//   buyer,
//   product,
//   quantity,
//   color,
//   size,
//   subtotal,
//   seller,
//   tax = 0,
//   tokshow,
//   shippingFee,
//   rate_id,
//   ordertype,
//   bidTotal = 0,
//   servicelevel,
//   totalWeightOz,
//   bundleId,
//   seller_shipping_fee_pay,
//   carrierAccount,
//   egressId, 
//   carrier = null,flash_sale = false
// }) {

//   // Round up total
//   var total = subtotal
//   // Get global settings (serviceFee, etc.)
//   const response = await getSettings();

//   // Create new IDs for order & item
//   const orderId = new mongoose.Types.ObjectId();
//   const itemId = new mongoose.Types.ObjectId();
//   console.log("shippingFee ",shippingFee)
//   console.log("total ",total)
//   console.log("commission ",response['commission'])
//   // Calculate service fee
//   let commission = await getCommission(null,product);
//   console.log("commission ",commission)
//   const serviceFee = (total * ((commission ?? 10) / 100)).toFixed(2);
//   console.log("serviceFee ",serviceFee)

//   var stripe_fee = (parseFloat(response["stripe_fee"]) / 100) * (total + parseFloat(tax) + parseFloat(shippingFee));
//   console.log("stripe_fee ",response["stripe_fee"])
//   console.log("stripe_fee calc",stripe_fee)
//   var extra_charges = parseFloat(response['extra_charges']);
//   console.log("extra_charges", extra_charges)
//   console.log("tax", tax)
//   console.log("total charges ", (extra_charges + stripe_fee + serviceFee + tax))

//   console.log(total, serviceFee, shippingFee, tax, extra_charges, stripe_fee)
//   const totalMinusDeductions = total - serviceFee - tax - extra_charges - stripe_fee;
//   // console.log("after deductions ", totalMinusDeductions)
//   var totalStripeCharges = extra_charges + stripe_fee;
//   // Check address
//   const address = await addressModel
//     .findOne({
//       userId: buyer,
//     })
//     .populate("userId")
//     .sort({ primary: -1, createdAt: 1 });
//   if (!address) {
//     throw new Error("No address");
//   }

//   // Check payment method
//   let paymentmethod = await paymentmethodModel.findOne({
//     userid: buyer,
//     primary: true,
//     customerid: {
//       $ne: null,
//     },
//   });

//   let prores = await productModel.findById(product);
//     if (prores?.quantity <=0) {
//       return {error: {error:"product out of stock"}, success:false,};
//     }
//   // Charge Stripe
//   const { charge, balanceTx , success, error} = await chargeStripePaymentMethod(
//     total,
//     paymentmethod,
//     orderId,
//     seller,
//     serviceFee,
//     shippingFee,
//     tax
//   );
//   if (success == false) {
//     saveLogs({
//       userId: address.userId?._id,
//       log_data: JSON.stringify({error, success:false, buyerUserName: address.userId?.userName})
//     })

//     saveActivity(
//       "order",
//       address.userId?.userName,
//       "order",
//       seller,
//       address.userId?.profilePhoto,
//       seller,
//       "Order Payment Failed for Item: " + prores.name + " #" + prores.order_reference_counter,
//       buyer);

//     let sellerfcm = await userModel.findById(seller); 
//     sendNotification(
//       [sellerfcm?.fcmToken],
//       `Order ${prores?.name}#${prores?.order_reference_counter} Failed`,
//       "Order Payment Failed for Item: " + prores.name + " #" + prores.order_reference_counter,
//       {

//       }
//     ); 
//     sendNotification(
//       [address.userId?.fcmToken],
//       `Order ${prores?.name}#${prores?.order_reference_counter} Failed`,
//       "Order Payment Failed for Item: " + prores?.name + " #" + prores?.order_reference_counter,
//       {

//       }
//     ); 
//     //increase the order_reference_counter so that same item reference is not ordered again
//     await productModel
//     .findByIdAndUpdate(
//       product,
//       { $inc: { order_reference_counter: 1 } },
//       { runValidators: true, new: true }
//     );
//     if (ordertype === "auction") {
//       return {error, success:false, buyerUserName: address.userId?.userName};
//     } else { 
//       return {error, success:false};
//     }
//   }  

//   // Decrement product quantity
//   let productres = await productModel
//     .findByIdAndUpdate(
//       product,
//       { $inc: { quantity: parseInt(quantity) * -1, salesCount: quantity, order_reference_counter: 1 } },//, 
//       { runValidators: true, new: true }
//     )
//     .populate("shipping_profile");
//     if(productres?.flash_sale == true){
//       console.log("sending flash sale ",productres?.tokshow)
//       if(productres?.quantity == 0){
//         await roomsModel
//         .findByIdAndUpdate(
//           productres?.tokshow,
//           {$set:{pinned: null}},
//         );
//       }
//       socketEmitter.emitTo(productres?.tokshow?.toString(), "flash-sale-product-update", productres);
//     }
//   let orderDifftype = productres?.tokshow == null ? "marketplace": "tokshow"
//   const totalShippingCost =
//       parseFloat(shippingFee || 0) + parseFloat(seller_shipping_fee_pay || 0);
//   // Build the order payload
//   const earnings = Number(totalMinusDeductions.toFixed(2));


//   const payload = {
//     _id: orderId,
//     customer: buyer,
//     seller,
//     paymentMethod: paymentmethod._id,
//     invoice: Math.floor(Math.random() * 1_000_000),
//     date: Date.now(),
//     tokshow,
//     earnings,
//     rate_id,
//     items: [],
//     shipping_fee: shippingFee,
//     service_fee: serviceFee,
//     stripe_fees : totalStripeCharges,
//     carrier,
//     tax: parseFloat(tax),
//     ordertype:orderDifftype,
//     servicelevel,
//     payment_status: success == false ? "failed" : "paid",
//     status: success == false ? "cancelled" : "processing",
//     weight: totalWeightOz,
//     height: productres?.shipping_profile?.height,
//     scale: productres?.shipping_profile?.scale,
//     length: productres?.shipping_profile?.length,
//     width: productres?.shipping_profile?.width,
//     bundleId: bundleId.toString(),
//     seller_shipping_fee_pay,
//     total_shipping_cost: totalShippingCost,carrierAccount
//   };
//   console.log(payload)
//   if (productres?.wcid) {
//     let data = {
//       customer: {
//         first_name: address.userId.firstName,
//         last_name: address.userId.lastName,
//         email: address.userId.email,
//         phone: address.userId.phone,
//       },
//       billing_address: {
//         address_1: address.addrress1,
//         address_2: address.addrress1,
//         city: address.city,
//         country: address.countryCode,
//       },
//       shipping_address: {
//         address_1: address.addrress1,
//         address_2: address.addrress1,
//         city: address.city,
//         country: address.countryCode,
//       },
//       items: [{ product_id: productres.wcid, quantity: quantity }],
//     };
//     wcOrder(data, address.userId._id);
//   }
//   // Increment seller's pending wallet
//   const sellerData = await userModel.findByIdAndUpdate(
//     seller,
//     { $inc: { walletPending: earnings } },
//     { runValidators: true, new: true }
//   );


//   let newOrder = await orderModel.findOne({
//     status: "processing",
//     bundleId: bundleId,
//     customer: buyer,
//     tokshow 
//   });
//   var itemtotal = flash_sale == true ? productres?.flash_sale_price : productres?.price;
//   if(ordertype == "offer"){
//     itemtotal = subtotal;
//   }
//   if(ordertype == "auction"){
//     itemtotal = bidTotal;
//   }
//   var orderItem = {
//     _id: itemId,
//     productId: product,
//     customer: buyer,
//     earnings,
//     seller,
//     tokshow,
//     order_reference: `#${prores.order_reference_counter}`,
//     quantity,
//     chargeId: charge?.id,
//     orderId: newOrder ? newOrder._id : orderId,
//     price: itemtotal,
//     ordertype,
//     weight: productres?.shipping_profile?.weight,
//     stripe_fees: totalStripeCharges,
//     service_fee: serviceFee,
//     height: productres?.shipping_profile?.height,
//     scale: productres?.shipping_profile?.scale,
//     length: productres?.shipping_profile?.length,
//     width: productres?.shipping_profile?.width,
//     shipping_fee: shippingFee,
//     seller_shipping_fee_pay,
//     egressId
//   };
//   // console.log("orderItem ",orderItem)
//   let newItem = await itemModel.create(orderItem); 
//   const isNewBundle = !newOrder;

//   if (newOrder) {
//     console.log("new orderfound ",totalWeightOz)
//     newOrder.items.push(itemId);
//     newOrder.weight = totalWeightOz;
//     newOrder.shipping_fee = parseFloat(shippingFee) + newOrder?.shipping_fee;
//     newOrder.order_reference = `#${prores.order_reference_counter}`,
//     newOrder.createdAt = new Date();
//     newOrder.carrier = carrier;
//     newOrder.stripe_fees = totalStripeCharges + newOrder?.stripe_fees,
//     newOrder.service_fee = parseFloat(serviceFee) + newOrder?.service_fee,
//     newOrder.rate_id = rate_id;
//     newOrder.updatedAt = new Date();
//     newOrder.tax = parseFloat(tax + newOrder?.tax);
//     newOrder.earnings = earnings + newOrder?.earnings; 
//     newOrder.ordertype = orderDifftype;
//     newOrder.carrierAccount = carrierAccount;
//     newOrder.seller_shipping_fee_pay = seller_shipping_fee_pay + newOrder?.seller_shipping_fee_pay;
//     newOrder.total_shipping_cost = totalShippingCost + newOrder?.total_shipping_cost;
//     await newOrder.save();
//   } else {
//     // console.log("payload ",payload)
//     payload.items.push(itemId);
//     newOrder = await orderModel.create(payload);
//   }

//   const newTransaction1 = {
//     from: buyer,stripe_fee: stripe_fee.toFixed(2),extra_charges,
//     to: seller,
//     chargeId: charge?.id,
//     balanceTransactionId: charge?.balance_transaction?.id,
//     availableOn: success ==true ? (balanceTx?.available_on ?? new Date()) * 1000 : 0,
//     reason: utils.Transactionreasons.PURCHASE,
//     amount: totalMinusDeductions,
//     shippingFee,serviceFee,
//     total: total, 
//     status: "Pending",
//     type: "order",
//     deducting: false,
//     orderId,itemId,
//     date: Date.now(),
//     order_channel: ordertype,
//   };
//   // console.log(newTransaction1)
//   await transactionModel.create(newTransaction1);
//   if (product) {
//     const roomUpdate = {
//       $addToSet: { soldProducts: product },
//       $inc: { salesTotal: total, salesCount: 1 }
//     };

//     // Add bundle shipment ONLY if this is a new bundle
//     if (isNewBundle) {
//       roomUpdate.$inc.shipmentsCount = 1;
//     }

//     await roomsModel.findByIdAndUpdate(
//       tokshow,
//       roomUpdate,
//       { runValidators: true, new: true, upsert: false }
//     );
//   }
//   return { newOrder, newItem, success: true, seller:sellerData, buyer: address.userId, productres};
// }
// async function chargeStripePaymentMethod(
//   orderTotal,
//   paymentmethod,
//   orderId,
//   seller,
//   serviceFee,
//   shippingFee,
//   tax
// ) {
//   let sellerdata = await userModel.findById(seller)
//   try {
//     var response = await getSettings();
//     const stripe = require("stripe")(response["stripeSecretKey"]);

//     const toCents = num => Math.round(Number(num) * 100);
//     console.log('orderTotal ',orderTotal)
//     const amountCents = toCents(orderTotal);
//     const shippingCents = toCents(shippingFee ?? 0);
//     const appFeeCents = toCents(serviceFee);
//     const taxCents = toCents(tax);

//     const totalChargeCents = amountCents + shippingCents + taxCents;
//     let payload = {  
//       amount: totalChargeCents,
//       currency: "usd",
//       customer: paymentmethod?.customerid,
//       payment_method: paymentmethod?.paymentMethodId,
//       off_session: true,
//       confirm: true,
//       transfer_group: `order_${orderId}`,
//       metadata: { sellerId: sellerdata?._id.toString()},
//       // application_fee_amount: appFeeCents,
//       on_behalf_of: sellerdata?.stripe_account,
//       // transfer_data: {
//       //   destination: sellerdata?.stripe_account
//       // }
//     }
//     const paymentIntent = await stripe.paymentIntents.create(payload);
//     await new Promise((r) => setTimeout(r, 5000));
//     if (shippingCents > 0 && response["stripe_connect_account"]) {
//       await stripe.transfers.create({
//         amount: shippingCents,
//         currency: "usd",
//         destination: response["stripe_connect_account"],
//         transfer_group: `order_${orderId}`
//       });
//     }
//     const refreshedPI = await stripe.paymentIntents.retrieve(paymentIntent.id, {
//       expand: ["latest_charge.balance_transaction"],
//     });
//     return {
//       paymentIntent: refreshedPI,
//       charge: refreshedPI.latest_charge,
//       balanceTx: refreshedPI?.latest_charge?.balance_transaction,
//       success: true
//     };
//   } catch (err) {
//     console.log(err);
//     let response =  {
//       error:{ ok: false,
//       error: err.message || 'Payment failed',
//       code: err.code,
//       decline_code: err.decline_code,
//       requestId: err.requestId || (err.raw && err.raw.requestId)},
//       success: false
//     };
//     saveLogs({
//       user: seller,
//       log_data: JSON.stringify(response),
//     })
//     await paymentmethodModel.findOneAndUpdate({paymentMethodId: paymentmethod?.paymentMethodId}, {status: 'blocked', description: err.code})
//     return response;
//   }
// }
async function saveLogs(data) {
  try {
    const log = new logsModel(data);
    await log.save();
  } catch (error) {
  }
  return 1;
}
async function saveActivity(
  actionKey,
  fromFullName,
  type,
  actioned,
  fromImageUrl,
  toId,
  message,
  fromId
) {
  try {
    var data = {
      imageurl: fromImageUrl,
      name: fromFullName,
      type: type,
      actionkey: actionKey,
      actioned: actioned,
      to: toId,
      from: fromId,
      message: message,
      time: Date.now(),
    };

    const activity = new activitiesModel(data);
    await activity.save();
  } catch (error) {
  }
  return 1;
}

/**
 * Send notificatio with One signal
 * @param {String} userTokenList the list of user tokens.
 * @param {String} title The title of the notification.
 * @param {String} msg The message.
 * @param {String} screenA The screen to go to when you click.
 * @param {String} id The id of what to go to.
 */

async function sendNotification(userTokenList, title, msg, data) {
  sendPushNotification(userTokenList, title, msg, data);
}

async function getSettings() {
  var response = await appSettings.find();
  return response[0];
}

const stripeConnect = async (
  payload,
  userId,
  first_name = "John",
  last_name = "Doe",
  email = "john@gmail.com",
  applying
) => {
  var response = await getSettings();
  if (response["demoMode"] === true) {
    payload = {
      country: "US",
      type: "custom",
      business_type: "individual",
      email: email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_profile: {
        url: "https://pointifypos.com",
        mcc: "5734",
      },
      tos_acceptance: {
        date: Math.floor(Date.now() / 1000),
        ip: "127.0.0.1",
      },
      individual: {
        first_name: first_name || "John",
        last_name: last_name || "Doe",
        email: email,
        phone: "+17297409480",
        dob: { day: 10, month: 10, year: 1985 },
        ssn_last_4: "0000",
        address: {
          line1: "123 Main St",
          city: "San Francisco",
          state: "CA",
          postal_code: "94117",
          country: "US",
        },
      },
      external_account: {
        object: "bank_account",
        country: "US",
        currency: "usd",
        account_holder_type: "individual",
        routing_number: "110000000",
        account_number: "000123456789",
      },
    };
  }

  var response = await getSettings();
  if (response["stripeSecretKey"] === "") {
    return { error: "Stripe secret key not found in the admin setings", success: false };
  }
  const stripe = require("stripe")(response["stripeSecretKey"]);
  try {
    const account = await stripe.accounts.create(payload);
    console.log(payload)
    if (account["external_accounts"]) {
      let data = account["external_accounts"]["data"];
      await bank.deleteMany({ userid: userId });
      var response = await getSettings();
      await userModel.findByIdAndUpdate(userId, {
        $set: { stripe_account: account["id"], applied_seller: true, }
      });
      return { success: true, bank: data[0] };
    } else {
      return { error: "error creating stripe account", success: false };
    }
  } catch (error) {
    return { error: error?.raw?.message, success: false };
  }
};
const createGiveawaOrder = async (giveaway) => {
  let { shipping_profile, winner, user, quantity, tokshow } = giveaway;
  let { weight } = shipping_profile;
  const seller = user._id ?? user;
  const customerId = winner._id;
  let { carrierAccount: carrierAccountId, amount: shipping, objectId: rate_id, servicelevel, totalWeightOz: orderWeight, bundleId: OrderbundleId, seller_shipping_fee_pay: seller_fee, provider: carrier } = await getCheapestUSPSRate({
    weight: weight,
    owner: seller,
    customer: customerId,
    tokshow,
    items: [{ weight: weight, quantity: quantity, name: giveaway.name, price: 0, hsCode: giveaway?.category?.hs_code ?? '950440' }]
  });


  let tax = 0; //calculation?.amount;
  let orderTotal = parseFloat(shipping) + 0; //auctionTotal + parseFloat(shipping) + parseFloat(tax);

  const existingOrder = await orderModel.findOne({
    status: "processing",
    seller,
    customer: customerId,
    tokshow,
    bundleId: OrderbundleId
  });

  const payload = {
    customer: customerId,
    seller: seller,
    subTotal: 0,
    giveaway: giveaway._id,
    platform_order: giveaway?.platform_order ?? false,
    invoice: Math.floor(Math.random() * 1_000_000),
    date: Date.now(),
    tokshow: tokshow,
    seller_shipping_fee_pay: parseFloat(shipping),
    total_shipping_cost: parseFloat(shipping),
    total: orderTotal,
    status: "processing",
    carrierAccount: carrierAccountId,
    carrier,
    tax: tax,
    rate_id,
    items: [],
    servicelevel: servicelevel.name,
    ordertype: "giveaway",
    weight: orderWeight,
    bundleId: OrderbundleId
  };
  console.log(payload)
  let order;

  if (existingOrder) {
    // ♻️ Reuse existing unfinished order
    order = existingOrder;
    order.seller_shipping_fee_pay = parseFloat(shipping);
    order.total_shipping_cost = existingOrder.total_shipping_cost + parseFloat(shipping);
    order.weight = orderWeight;
    await order.save();
  } else {
    // 🆕 Create new giveaway order
    order = await orderModel.create({
      ...payload,
      bundleId: OrderbundleId
    });
  }

  const giveawayItem = await itemModel.create({
    orderId: order._id,
    customer: customerId,
    seller,
    quantity,
    price: 0,
    earnings: 0,
    tokshow,
    giveawayId: giveaway._id,
    ordertype: "giveaway",
    weight: shipping_profile.weight,
    height: shipping_profile.height,
    length: shipping_profile.length,
    width: shipping_profile.width,
    seller_shipping_fee_pay: parseFloat(shipping),
    scale: shipping_profile.scale,
    order_reference: `${giveaway?.name} #${giveaway?.reference}`,
  });
  order.items.push(giveawayItem._id);
  await order.save();

  console.log(order)
  console.log(`🎉 Winner: ${winner?.fcmToken}`);
  sendNotification(
    [winner?.fcmToken],
    "Won Giveaway!",
    "You won a giveaway! Click to see details.",
    {
      id: order?._id.toString(),
      screen: "OrderScreen",
    }
  );
};
const createAuctionCharge = async (auction) => {
  console.log("createAuctionCharge ")
  // try {
  let highestBid = 0;
  let highestBidder = null;
  if (auction.bids.length == 0) {
    return null;
  }
  auction.bids.forEach((bid) => {
    if (bid.amount > highestBid) {
      highestBid = bid.amount;
      highestBidder = bid.user;
    }
  });
  let shippingCost = 0;
  let rate_id = null
  let servicelevelName = ''
  let totalWeightOz = 0;
  let bundleId = '';
  let carrierAccount = null;
  let seller_shipping_fee_pay = 0
  let carrier = null
  let shipping_response = null
  if (auction?.product?.shipping_profile) {
    shipping_response = await getCheapestUSPSRate({
      weight: auction?.product?.shipping_profile?.weight,
      unit: auction?.product?.shipping_profile?.scale,
      customer: highestBidder?._id,
      owner: auction?.product?.ownerId,
      tokshow: auction?.tokshow,
      items: [{ weight: auction?.product?.shipping_profile?.weight, quantity: 1, name: auction?.product?.name, price: highestBid, hsCode: auction?.product?.category?.hs_code ?? '950440' }]
    });
    let { carrierAccount: carrierAccountId, amount: shipping, objectId, servicelevel, totalWeightOz: orderWeight, bundleId: OrderbundleId, seller_shipping_fee_pay: seller_fee, provider: carrier } = shipping_response

    carrierAccount = carrierAccountId;
    carrier = carrier
    shippingCost = shipping;
    rate_id = objectId
    servicelevelName = servicelevel?.name;
    totalWeightOz = orderWeight;
    bundleId = OrderbundleId?.toString()
    seller_shipping_fee_pay = seller_fee;
  }
  console.log("shippingCost ", shippingCost)
  let auctionTotal = highestBid;
  // const calculation = await estimateTax(
  //   {
  //     line1: highestBidder?.address?.addrress1,
  //     city: highestBidder?.address?.city,
  //     state: highestBidder?.address?.state,
  //     postal_code: highestBidder?.address?.zipcode,
  //     country: highestBidder?.address?.countryCode,
  //   },
  //   [
  //     {
  //       amount: auctionTotal,
  //       reference: auction.product?._id.toString(),
  //       tax_code: auction.product?.category?.tax_code == '' || auction.product?.category?.tax_code == null ? "txcd_99999999" : auction.product?.category?.tax_code,
  //       quantity: 1,
  //     },
  //   ],
  //   auction?.product?.ownerId
  // );
  let tax = 0;//getCheapestUSPSRatecalculation?.amount;
  let orderTotal = auctionTotal;
  const seller = auction.product.ownerId;
  console.log("highestBidder ", highestBidder)
  let allow_referal_discount = false
  if (highestBidder?.awarded_referal_credit == false && highestBidder?.referredBy) {
    allow_referal_discount = true
  }
  const resultres = await createOrder({
    buyer: highestBidder._id,
    product: auction.product,
    quantity: 1,
    color: "",
    size: "",
    subtotal: orderTotal,
    seller,
    tax,
    tokshow: auction.tokshow,
    shippingFee: parseFloat(shippingCost),
    rate_id,
    ordertype: "auction",
    bidTotal: highestBid,
    servicelevel: servicelevelName,
    totalWeightOz,
    bundleId,
    seller_shipping_fee_pay,
    carrierAccount,
    egressId: auction?.egressId,
    carrier,
    shipping: shipping_response,
    allow_referal_discount
  });

  let aucres = await auctionModel.findByIdAndUpdate(auction?._id, { winner: highestBidder }, { new: true }).populate(await getAuctionPopulateOptions());
  //update order item with video receipt
  if (aucres?.videoReceipt) {
    await itemModel.findByIdAndUpdate(resultres?.newItem?._id, { videoReceipt: aucres?.videoReceipt })
  }
  const aucresObj = aucres?.toObject ? aucres.toObject() : aucres;
  return { ...aucresObj, success: resultres?.success };
  // } catch (error) {
  //   return null;
  // }
};
async function populateRoomOptions() {
  return [
    {
      path: "pinned", populate: {
        path: "shipping_profile",
      }
    },
    {
      path: "owner",
      select: [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "followersCount",
        "followingCount",
        "followers",
        "following",
        "roomuid",
        "agorauid",
        "muted",
        "shipping",
      ]
    },
    { path: "category" },
    {
      path: "owner",
      populate: {
        path: "shipping",
      },
    },
    {
      path: "moderators",
      select: [
        "firstName",
        "lastName",
        "bio",
        "userName",
      ],
    },

    {
      path: "hosts",
      select: [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "followersCount",
        "followingCount",
        "followers",
        "following",
        "roomuid",
        "agorauid",
        "muted",
        "shipping",
      ],
    },
    {
      path: "viewers",
      select: [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "followersCount",
        "followingCount",
        "followers",
        "following",
        "roomuid",
        "agorauid",
        "muted",
        "shipping",
      ],
    },
    {
      path: "activeauction",
      populate: {
        path: "bids",
        populate: {
          path: "user",
          select: ["firstName", "lastName", "bio", "userName", "email"],
        },
      },
    },
    {
      path: "activeauction",
      populate: {
        path: "product",
        select: [
          "_id",
          "name",
          "description",
          "images",
          "category",
          "price",
          "quantity",
          "listing_type",
        ],
        populate: {
          path: "shipping_profile",
        }
      },
    },
    {
      path: "activeauction",
      populate: {
        path: "product",
        populate: {
          path: "category",
        },
      },
    },
    {
      path: "activeauction",
      populate: [
        {
          path: "winner",
          select: "userName profilePhoto",
        },
        {
          path: "winning",
          select: "userName profilePhoto",
        },
        {
          path: "owner",
        },
        {
          path: "bids",
          populate: {
            path: "user",
            select: "userName profilePhoto",
          }

        }
      ],
    },

    {
      path: "pinned_giveaway",
      populate: [
        { path: "shipping_profile" },
        { path: "category" },
        { path: "participants" },
        { path: "tokshow", select: ["title"] },
        {
          path: "winner",
          select: ["firstName", "lastName", "bio", "userName", "email"],
        },
      ],
    },
  ];
}
async function getAuctionPopulateOptions() {
  return [
    { path: "winner" },
    { path: "winning" },
    { path: "ownerId", select: ["address"] },
    {
      path: "bids",
      populate: {
        path: "user",
        select: ["firstName", "lastName", "bio", "userName", "email", "profilePhoto", "fcmToken", "awarded_referal_credit", "referredBy"],
        populate: {
          path: "address",
        },
      },
    },
    {
      path: "product",
      populate: [
        { path: "category" },
        { path: "reviews" },
        {
          path: "owner",
          select: ["firstName", "lastName", "bio", "userName", "email", "fcmToken", "profilePhoto"],
          populate: {
            path: "address",
          },
        },
        {
          path: "prebids.user",
          select: "userName firstName lastName profilePhoto"
        },
        { path: "shipping_profile" },
      ],
    },
  ];
}
async function processAutobids(auction, user) {
  let bids = auction.bids;
  let highestBid = auction.baseprice || 0;;
  if (bids.length == 0) {
    return auction;
  }
  bids.forEach((bid) => {
    if (bid.amount > highestBid) {
      highestBid = bid.amount;
    }
  });
  let minBidIncrement = 1; // Auction's bid increment rule

  // Step 1: Find all autobidders who can still place a bid
  let autobid = bids.filter(
    (bid) => bid.autobidamount > highestBid && bid.user?._id != user && bid.autobid == true
  );
  if (autobid.length === 0) {
    return auction;
  }

  // Step 2: Determine which autobidders can still place a valid bid
  let validAutobids = autobid.filter(
    (bid) => bid.autobidamount >= highestBid + minBidIncrement
  );
  if (validAutobids.length === 0) return auction;

  // Step 3: Professional sequential processing (only save winning bids)
  let currentAuction = auction;
  let currentHighest = highestBid;

  // Sort autobidders by maximum amount (highest first)
  validAutobids.sort((a, b) => b.autobidamount - a.autobidamount);

  // Process each autobidder sequentially
  for (const autobidder of validAutobids) {
    let nextBidAmount;

    // If no real bids yet, bid the base price
    // if (currentHighest === auction.baseprice) {
    //   nextBidAmount = auction.baseprice; // First bidder gets base price
    // } else {
    //   nextBidAmount = currentHighest + minBidIncrement; // Increment for competition
    // }
    nextBidAmount = currentHighest + minBidIncrement;


    // Check if this autobidder can still afford to bid
    if (nextBidAmount <= autobidder.autobidamount) {
      const query = { user: autobidder.user, auction: auction._id };
      const update = {
        $set: {
          amount: nextBidAmount,
          auction: auction._id,
          user: autobidder.user,
          autobid: autobidder.autobid,
          autobidamount: autobidder.autobidamount
        }
      };
      const options = { upsert: true, new: true };

      currentAuction = await _bid(query, update, options, auction._id, nextBidAmount);
      currentHighest = nextBidAmount;
    }
  }

  return currentAuction;
}
const _bid = async (query, update, options, auction, increaseBidBy) => {
  let bidresponse = await bidModel.findOneAndUpdate(query, update, options);
  const populateOptions = await getAuctionPopulateOptions();
  return await auctionModel
    .findByIdAndUpdate(
      auction,
      {
        $addToSet: {
          bids: bidresponse._id,
        },
        $set: { baseprice: increaseBidBy },
      },
      { runValidators: true, new: true }
    )
    .populate(populateOptions);
};
const bid = async (
  query,
  update,
  options,
  auction,
  baseprice,
  callback
) => {
  console.log(query, update, options, auction)
  let bidresponse = await bidModel.findOneAndUpdate(query, update, options);
  const populateOptions = await getAuctionPopulateOptions();
  let response = await auctionModel
    .findByIdAndUpdate(
      auction,
      {
        $addToSet: {
          bids: bidresponse._id,
        },
        $set: { baseprice },
      },
      { runValidators: true, new: true }
    )
    .populate(populateOptions);
  // console.log("bid response ",response)
  if (callback) { callback(null, response); } else { return response }
};
const auctionTimers = new Map(); // store timers in memory

async function startRunningTimer(auction, callback) {
  if (!auction) return;

  // make sure we have an endTime set
  const initialEndTime = auction.endTime
    ? new Date(auction.endTime)
    : new Date(Date.now() + auction.duration * 1000);

  const timer = {
    endTime: initialEndTime,
    interval: null,
    extend: (seconds) => {
      timer.endTime = new Date(timer.endTime.getTime() + seconds * 1000);
    },
  };

  timer.interval = setInterval(async () => {
    const remaining = timer.endTime.getTime() - Date.now();

    if (remaining > 0) return; // still running

    // time is up
    clearInterval(timer.interval);
    auctionTimers.delete(auction._id.toString()); // 🧹 cleanup

    try {
      let newauction = await auctionModel.findOneAndUpdate(
        { _id: auction._id },
        [
          {
            $set: {
              ended: {
                $cond: {
                  if: {
                    $and: [
                      { $gt: [{ $size: "$bids" }, 0] },      // has bids
                      { $lte: ["$endTime", new Date()] }     // or endTime passed
                    ]
                  },
                  then: true,
                  else: "$ended"
                }
              },

              started: {
                $cond: {
                  if: { $gt: [{ $size: "$bids" }, 0] },
                  then: true,
                  else: false
                }
              }
            }
          }
        ],
        { runValidators: true, new: true }
      ).populate(await getAuctionPopulateOptions());

      if (newauction?.egressId) {
        await stopEgress(newauction?.egressId);
      }
      if (newauction) {
        auction = newauction
      }

      createAuctionCharge(auction).then(async (response) => {
        if (response?.success == false) {
          callback(response, response);
        } else {
          //RESET / CREATE NEXT AUCTION HERE
          const initialProductQty = auction.product.quantity;
          const soldQty = auction.quantity;
          const remainingQty = initialProductQty - soldQty;
          console.log("remainingQty ", remainingQty)
          if (remainingQty > 0) {
            const newAuction = await auctionModel.create({
              product: auction.product,
              tokshow: auction.tokshow,

              baseprice: auction.product.default_startprice,
              newbaseprice: auction.product.default_startprice,

              increaseBidBy: auction.increaseBidBy,
              duration: auction.duration,
              sudden: auction.sudden,

              started: false,
              ended: false,
              bids: [],
            });

            await productModel.updateOne(
              { _id: auction.product },
              {
                $set: {
                  auction: newAuction._id,
                  prebids: [],
                },
              }
            );
          }
          // ✅ END RESET LOGIC
          //this is just to make the ui refresh the auctions list to reduce its qty if the auction had more than one qty
          callback(null, { response, updateQty: true });
        }
      })
      callback(null, auction);
    } catch (err) {
      callback(err, null);
    }
  }, 1000);

  // save reference so socket handlers can extend later
  auctionTimers.set(auction._id.toString(), timer);
}
function isSameAddress(a, b) {
  return (
    a.addrress1 === b.addrress1 &&
    a.city === b.city &&
    a.state === b.state &&
    a.zipcode === b.zipcode &&
    a.countryCode === b?.countryCode
  );
}
async function getCheapestUSPSRate(data) {
  let {
    weight,
    owner,
    customer,
    length = 12,
    width = 12,
    height = 12,
    unit = "oz",
    distanceUnit = "in",
    smartBundle = true,
    buying_label = false,
    tokshow = null,
    items = [],
    order_id = null,
  } = data;
  console.log("getCheapestUSPSRate ", data)
  if (!owner) throw new Error("Seller (owner) is required");
  let ownerAddress, customerAddress;
  const settingsResponse = await getSettings();
  const demoMode = settingsResponse?.demoMode === true;

  if (demoMode) {
    console.log("⚙️ Demo mode enabled — using default addresses, skipping database lookups.");
    ownerAddress = {
      name: "Sender Name",
      addrress1: "123 Main St",
      city: "San Francisco",
      state: "CA",
      zipcode: "94117",
      countryCode: "US",
      phone: "1234567890",
      email: "seller@example.com",
    };

    customerAddress = {
      name: "Customer Name",
      addrress1: "1530 Merrett Dr",
      city: "Idaho Falls",
      state: "ID",
      zipcode: "83404-5454",
      countryCode: "US",
      phone: "1234567890",
      email: "buyer@example.com",
    };
  } else {
    ownerAddress = await addressModel
      .findOne({ userId: owner }).populate("userId", "userName")
      .sort({ primary: -1, createdAt: 1 });
    if (!ownerAddress) throw new Error("Seller has no address");

    customerAddress = await addressModel.findOne({ userId: customer }).populate("userId", "userName").sort({ primary: -1, createdAt: 1 });
  }
  // console.log(ownerAddress, customerAddress,customer)
  const sameAddress = isSameAddress(ownerAddress, customerAddress);
  // console.log(' sameAddress ',sameAddress)
  if (sameAddress) {
    // ⚠ They are shipping to the same address
    return {
      success: false,
      address_identical: true,
      message: "Shipping to the same address is not allowed."
    }
  }
  // console.log(ownerAddress,customerAddress)

  // 2️⃣ Seller/Tokshow shipping settings
  let settings;
  if (!tokshow) {
    let seller = await userModel.findById(owner)
    settings = seller?.shipping_settings || {}
  } else {
    let seller = await roomsModel.findById(tokshow)
    if (seller?.shipping_settings) {
      settings = seller?.shipping_settings
    } else {
      let seller = await userModel.findById(owner)
      settings = seller?.shipping_settings || {}
    }
  }
  // console.log(settings)


  let {
    groundAdvantageEnabled = true,
    priorityMailEnabled = true,
    reducedShippingCapAmount = 0,
    buyer_pays = true,
    seller_pays = false,
    freePickupEnabled = false,
    shippingCostMode = "buyer_pays_all",
  } = settings;
  // 3️⃣ Combine weights
  let totalWeightOz = unit === "lb" ? parseFloat(weight) * 16 : parseFloat(weight);
  let totalPreviouslyPaid = 0;
  let totalBuyerPaid = 0;
  let bundledCount = 1;
  let bundleId = new mongoose.Types.ObjectId();
  let unshipped = null;
  console.log(smartBundle, customer, buying_label)
  if (smartBundle && customer && !buying_label) {
    if (tokshow) {
      unshipped = await orderModel.find({ seller: owner, customer, status: "processing", tokshow });
    }
    else {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      unshipped = await orderModel.find({
        seller: owner,
        customer,
        status: "processing",
        createdAt: { $gte: startOfDay, $lte: endOfDay },
      });
    }
    if (unshipped?.length) {
      // 🟢 Identify the active bundle
      const activeBundleId = unshipped[unshipped.length - 1].bundleId;

      // 🟢 Orders belonging ONLY to the current bundle (for weight)
      const activeBundleOrders = unshipped.filter(
        o => String(o.bundleId) === String(activeBundleId)
      );

      // 🟢 Weight is calculated ONLY for orders in the same bundle
      const prevWeight = activeBundleOrders.reduce(
        (sum, o) => sum + (parseFloat(o.weight) || 0),
        0
      );
      console.log("prevWeight ", prevWeight)

      let combinedWeight = prevWeight + totalWeightOz;
      console.log("combinedWeight ", combinedWeight)

      // 🟢 Payments accumulate from ALL unshipped orders
      // totalPreviouslyPaid = unshipped.reduce(
      //   (sum, o) => sum + (parseFloat(o.total_shipping_cost) || 0), //QUESTION BE ANSWERED HERE, IS IT SHIPPING COST OF ALL PROCESSING OR ITS FOR ONLY THIS ORDER/BUNDLE TO BE BUNDLED TOGETHER
      //   0
      // );
      console.log("totalPreviouslyPaid ", totalPreviouslyPaid)

      totalBuyerPaid = unshipped.reduce(
        (sum, o) => sum + (parseFloat(o.shipping_fee) || 0),
        0
      );
      console.log("totalBuyerPaid ", totalBuyerPaid)

      let isNewBundle = false;
      // 🚫 Stop bundling if over 43oz
      if (combinedWeight > 80) {
        isNewBundle = true;
        // New bundle physically
        bundleId = new mongoose.Types.ObjectId();
        bundledCount = 1;
        // Only weight of this new package
        combinedWeight = totalWeightOz;
        totalWeightOz = totalWeightOz;
      } else {
        bundleId = activeBundleId;
        bundledCount = activeBundleOrders.length + 1;
        totalWeightOz = combinedWeight;
      }
      totalPreviouslyPaid = isNewBundle
        ? 0
        : activeBundleOrders.reduce(
          (sum, o) => sum + (parseFloat(o.total_shipping_cost) || 0),
          0
        );
      console.log("totalPreviouslyPaid ", totalPreviouslyPaid)
    }

  }

  // Initialize defaults
  let provider = "Local";
  let servicelevel = { name: "Free Pickup" };
  let totalAmount = 0;
  let objectId = null;
  let carrierAccount = null;
  let finalAmount = 0;
  let seller_shipping_fee_pay = 0;
  let currency = "USD";
  let mode = "pickup";
  let note = "Free pickup enabled — seller covers shipping";

  // 4️⃣ Get USPS rates if needed
  // try {
  // Decide USPS mode automatically
  let useGround = false;
  let usePriority = false;
  // console.log(totalWeightOz)
  // Auto-switch logic
  // if (totalWeightOz <= 16) {
  if (totalWeightOz <= 1120) {
    if (groundAdvantageEnabled) {
      useGround = true;
    } else if (priorityMailEnabled) {
      // fallback: use priority if ground disabled
      usePriority = true;
    }
  } else {
    if (priorityMailEnabled) {
      usePriority = true;
    } else if (groundAdvantageEnabled) {
      // fallback: use ground if priority disabled
      useGround = true;
    }
  }

  if (!useGround && !usePriority) {
    throw new Error("Seller has no USPS services enabled for this weight");
  }

  const targetService = useGround ? "USPS Ground Advantage" : "USPS Priority Mail";

  const shippoKey = (await getSettings())["shippo_api_key"];
  const shippo = new Shippo({ apiKeyHeader: shippoKey });


  let isInternational =
    ownerAddress.countryCode !== customerAddress.countryCode;
  console.log("isInternational ", isInternational)

  let customsItems = [];

  if (isInternational) {
    console.log("items ", items)
    if (items.length == 0) {
      if (order_id) {
        let itemsdata = await itemModel.find({ orderId: order_id }).populate("productId");
        items = itemsdata.map((item) => ({
          name: item.productId?.name,
          quantity: item.quantity,
          weight: item.weight,
          price: item.price
        }))
      } else {
        let product = await productModel.findById(data?.product);
        items = [
          {
            name: product?.name,
            quantity: 1,
            weight: data?.weight,
            price: product?.price
          }
        ]
      }
      // console.log(items)
    }
    if (items.length == 0) {
      isInternational = false
    }
    customsItems = items.map((item) => ({
      description: item.name,
      quantity: item.quantity,
      netWeight: String((item.weight * item.quantity) / 16),
      massUnit: "lb",
      valueAmount: String(item.price),
      valueCurrency: "USD",
      originCountry: ownerAddress?.countryCode || "US",
      tariff_number: item?.hsCode || "950440",
    }));
  }
  console.log("customsItems ", customsItems, isInternational)
  let declation_payload = {
    contentsType: "MERCHANDISE",
    nonDeliveryOption: "RETURN",
    certify: true,
    certifySigner: ownerAddress.name,
    items: customsItems,
    eelPfc: 'NOEEI_30_36'
  };
  // console.log("declation_payload ",declation_payload)

  let payload = {
    addressFrom: {
      name: ownerAddress?.name == "" ? ownerAddress?.userId?.userName : ownerAddress?.name,
      street1: ownerAddress?.addrress1,
      city: ownerAddress?.city,
      state: ownerAddress?.state,
      zip: ownerAddress?.zipcode,
      country: ownerAddress?.countryCode || "US",
      phone: ownerAddress?.phone,
      email: ownerAddress?.email,
    },
    addressTo: {
      name: customerAddress?.name == "" ? customerAddress?.userId?.userName : customerAddress?.name,
      street1: customerAddress?.addrress1,
      city: customerAddress?.city,
      state: customerAddress?.state,
      zip: customerAddress?.zipcode,
      country: customerAddress?.countryCode || "US",
      phone: customerAddress?.phone,
      email: customerAddress?.email,
    },
    parcels: [
      {
        length: String(length),
        width: String(width),
        height: String(height),
        distanceUnit,
        weight: String(totalWeightOz),
        massUnit: "oz",
      },
    ],
    ...(isInternational && {
      customsDeclaration: declation_payload,
    }),
    carrier_accounts: ["USPS"],
    async: false,
  }

  console.log("payload ", payload)
  if (totalWeightOz > 0) {
    const shipment = await shippo.shipments.create(payload);

    const uspsRates = shipment.rates?.filter((r) => r.provider === "USPS") || [];
    if (uspsRates.length) {
      const selected =
        uspsRates.find((r) => r.servicelevel.name.includes(targetService)) ||
        uspsRates.reduce((a, b) =>
          parseFloat(a.amount) < parseFloat(b.amount) ? a : b
        );
      // console.log(selected)
      provider = selected.provider;
      objectId = selected?.objectId;
      carrierAccount = selected?.carrierAccount;
      servicelevel = selected.servicelevel;
      totalAmount = parseFloat(selected.amount);
      currency = selected.currency;
      mode = useGround ? "ground" : "priority";
      note = `USPS ${servicelevel.name}`;

      // 🧮 Calculate final cost
      let prevSellerPaid = unshipped
        ? unshipped.reduce((sum, o) => sum + (parseFloat(o.seller_shipping_fee_pay) || 0), 0)
        : 0;
      console.log("prevSellerPaid ", prevSellerPaid)
      let incrementalAmount = totalAmount - totalPreviouslyPaid;
      if (incrementalAmount < 0) incrementalAmount = 0;
      finalAmount = incrementalAmount;
      console.log("incrementalAmount ", incrementalAmount)
      console.log("totalPreviouslyPaid ", totalPreviouslyPaid)
      console.log("totalAmount ", totalAmount)
      console.log("prevSellerPaid ", prevSellerPaid)
      console.log("finalAmount ", finalAmount)
      console.log("shippingCostMode ", shippingCostMode, tokshow, freePickupEnabled)

      // 💰 Apply cost-sharing logic
      if (freePickupEnabled && !buying_label) {
        // Buyer pays $0, seller pays all
        seller_shipping_fee_pay = 0;
        finalAmount = 0;
        note = "Free pickup enabled — seller covers shipping";
      } else if (shippingCostMode === "buyer_pays_up_to" && tokshow) {
        const buyerAlreadyPaid = totalBuyerPaid; // what buyer has already paid in previous bundles
        console.log("buyerAlreadyPaid ", buyerAlreadyPaid)
        console.log("reducedShippingCapAmount ", reducedShippingCapAmount)
        const remainingCap = Math.max(reducedShippingCapAmount - buyerAlreadyPaid, 0);
        console.log("remainingCap ", remainingCap)
        finalAmount = Math.min(incrementalAmount, remainingCap);
        console.log("finalAmount ", finalAmount)
        if (incrementalAmount > remainingCap)
          seller_shipping_fee_pay = incrementalAmount - remainingCap;
      } else if ((shippingCostMode === "seller_pays_all" || seller_pays) && tokshow) {
        seller_shipping_fee_pay = incrementalAmount;
        finalAmount = 0;
      } else {
        // Buyer pays all
        seller_shipping_fee_pay = 0;
      }
    }
  }
  // ✅ Unified return
  const dataresponse = {
    provider,
    rate_id: provider === "Local" ? "LOCAL_PICKUP" : objectId,
    objectId: provider === "Local" ? "LOCAL_PICKUP" : objectId,
    servicelevel,
    carrierAccount,
    totalAmount: totalAmount.toFixed(2),
    amount: buying_label == true ? totalAmount.toFixed(2) : finalAmount.toFixed(2),
    previouslyPaid: totalPreviouslyPaid.toFixed(2),
    currency,
    totalWeightOz: totalWeightOz.toFixed(2),
    bundledCount,
    bundleId,
    seller_shipping_fee_pay: Number(seller_shipping_fee_pay.toFixed(2)),
    mode,
    note,
    address_identical: false
  };

  console.log(dataresponse);
  return dataresponse;
}

async function estimateTax(address, items, owner) {
  // console.log("estimateTax ", address, items);
  var response = await getSettings();
  let ownderData = await userModel.findOne({ _id: owner });
  let connectedAccountId = ownderData?.stripe_account;
  const stripe = require("stripe")(response["stripeSecretKey"]);
  let payload = {
    currency: "usd",
    customer_details: {
      address: address,
      address_source: "shipping",
    },
    line_items: items,
  };
  // console.log(payload)
  const calculation = await stripe.tax.calculations.create(payload, { stripeAccount: connectedAccountId });

  if (calculation?.tax_breakdown?.length > 0) {
    return calculation.tax_breakdown[0];
  }
  return calculation;
}
async function getEmailTemplate(name) {
  let emailtemplate = await emailTemplates.findOne({ slug: name });
  if (!emailtemplate) {
    throw new Error("Email template not found");
  }
  return emailtemplate;
}
async function sendResetPasswordEmail(user) {
  let { email } = user;
  let emailtemplate = await getEmailTemplate("password_reset");
  let htmlContent = emailtemplate.htmlContent;
  await sendEmail({
    to: email,
    subject: "Reset password Request",
    html: htmlContent,
    text: textContent,
  });
}
module.exports = {
  sendResetPasswordEmail,
  estimateTax,
  saveActivity,
  sendNotification,
  getSettings,
  stripeConnect,
  chargeStripePaymentMethod,
  bid,
  getAuctionPopulateOptions,
  startRunningTimer,
  createOrder,
  createAuctionCharge,
  processAutobids,
  populateRoomOptions,
  wcOrder,
  getCheapestUSPSRate,
  auctionTimers, createGiveawaOrder, getOrderPopulates, saveLogs, retryOrderPayment
};
