/**
 * READ-ONLY diagnostic script. Does not write/modify any data.
 *
 * Run locally (or anywhere with network access to the database) with the
 * real Mongo connection string loaded, e.g. by copying MONGO_URI from your
 * hosting provider's environment variables panel into a local .env:
 *
 *   node scripts/diagnose-orders.js
 *
 * Optional env vars to drill into one specific seller/customer pair:
 *   SELLER_EMAIL=taraflive2026@gmail.com
 *   CUSTOMER_EMAIL=rama.irshaid2020@gmail.com
 */

require("dotenv").config({ path: ".env" });
const mongoose = require("mongoose");
const path = require("path");

const orderModel = require(path.join(process.cwd(), "src/models/order"));
const userModel = require(path.join(process.cwd(), "src/models/user"));

function section(title) {
  console.log("\n========================================");
  console.log(title);
  console.log("========================================");
}

// Mirrors the customer/seller scoping logic in
// src/controllers/orders.js exports.getAllOrders exactly.
function buildGetAllOrdersQuery({ customer, userId }) {
  const queryObject = {
    $and: [
      { customer: { $exists: true, $ne: null } },
      { seller: { $exists: true, $ne: null } },
    ],
  };
  if (customer && userId && customer.toString() === userId.toString()) {
    queryObject.$or = [{ customer }, { seller: userId }];
  } else {
    if (customer) queryObject.customer = customer;
    if (userId) queryObject.seller = userId;
  }
  return queryObject;
}

async function checkOverallDataHealth() {
  section("1. OVERALL ORDER DATA HEALTH");

  const totalOrders = await orderModel.countDocuments({});
  const missingCustomer = await orderModel.countDocuments({
    $or: [{ customer: { $exists: false } }, { customer: null }],
  });
  const missingSeller = await orderModel.countDocuments({
    $or: [{ seller: { $exists: false } }, { seller: null }],
  });

  console.log("Total orders in DB:", totalOrders);
  console.log("Orders missing 'customer' field:", missingCustomer);
  console.log("Orders missing 'seller' field:", missingSeller);
  console.log(
    "These two fields must BOTH exist and be non-null for an order to ever",
    "appear in GET /orders (every dashboard/app list uses that filter)."
  );

  // Are recently-created orders disproportionately broken? This is the
  // smoking gun for "even new orders don't show for anyone".
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentTotal = await orderModel.countDocuments({ createdAt: { $gte: since } });
  const recentMissingCustomer = await orderModel.countDocuments({
    createdAt: { $gte: since },
    $or: [{ customer: { $exists: false } }, { customer: null }],
  });
  const recentMissingSeller = await orderModel.countDocuments({
    createdAt: { $gte: since },
    $or: [{ seller: { $exists: false } }, { seller: null }],
  });
  console.log("\nLast 7 days: total orders =", recentTotal);
  console.log("Last 7 days: missing customer =", recentMissingCustomer);
  console.log("Last 7 days: missing seller =", recentMissingSeller);

  // Orphaned references: field is present, but points to a user that
  // no longer exists (deleted account, bad id, etc). These pass the
  // $exists/$ne-null filter but populate() will silently return null
  // for that field on the frontend.
  const customerIds = await orderModel.distinct("customer", { customer: { $ne: null } });
  const sellerIds = await orderModel.distinct("seller", { seller: { $ne: null } });
  const allIds = [...new Set([...customerIds, ...sellerIds].map(String))];
  const existingUsers = await userModel
    .find({ _id: { $in: allIds } })
    .select("_id")
    .lean();
  const existingIdSet = new Set(existingUsers.map((u) => String(u._id)));
  const orphanedCustomerIds = customerIds.filter((id) => !existingIdSet.has(String(id)));
  const orphanedSellerIds = sellerIds.filter((id) => !existingIdSet.has(String(id)));
  console.log("\nDistinct customer ids referenced by orders:", customerIds.length);
  console.log("Distinct seller ids referenced by orders:", sellerIds.length);
  console.log("Customer ids that don't match any user document (orphaned):", orphanedCustomerIds.length, orphanedCustomerIds.slice(0, 10));
  console.log("Seller ids that don't match any user document (orphaned):", orphanedSellerIds.length, orphanedSellerIds.slice(0, 10));
}

async function checkRecentOrdersRaw() {
  section("2. LAST 15 ORDERS, RAW (no filters), NEWEST FIRST");
  const docs = await orderModel
    .find({})
    .sort({ createdAt: -1 })
    .limit(15)
    .select("_id customer seller status invoice createdAt")
    .lean();
  for (const d of docs) {
    console.log({
      _id: String(d._id),
      customer: d.customer ? String(d.customer) : d.customer,
      seller: d.seller ? String(d.seller) : d.seller,
      status: d.status,
      invoice: d.invoice,
      createdAt: d.createdAt,
    });
  }
}

async function checkSellerCustomerDiversity() {
  section("3. SELLERS WITH SUSPICIOUSLY LOW CUSTOMER DIVERSITY");
  console.log("(More than 3 orders, but all from a single customer -- could be real, could be a query bug.)");

  const rows = await orderModel.aggregate([
    { $match: { seller: { $ne: null } } },
    {
      $group: {
        _id: "$seller",
        totalOrders: { $sum: 1 },
        distinctCustomers: { $addToSet: "$customer" },
      },
    },
    {
      $project: {
        totalOrders: 1,
        distinctCustomerCount: { $size: "$distinctCustomers" },
      },
    },
    { $match: { totalOrders: { $gt: 3 }, distinctCustomerCount: 1 } },
    { $sort: { totalOrders: -1 } },
    { $limit: 20 },
  ]);

  if (rows.length === 0) {
    console.log("None found -- every seller with >3 orders has orders from more than one customer.");
  } else {
    const sellers = await userModel
      .find({ _id: { $in: rows.map((r) => r._id) } })
      .select("_id userName email")
      .lean();
    const byId = new Map(sellers.map((s) => [String(s._id), s]));
    for (const r of rows) {
      console.log({
        sellerId: String(r._id),
        seller: byId.get(String(r._id)),
        totalOrders: r.totalOrders,
        distinctCustomerCount: r.distinctCustomerCount,
      });
    }
  }
}

async function checkSpecificSellerCustomerPair() {
  if (!process.env.SELLER_EMAIL) {
    section("4. SPECIFIC SELLER/CUSTOMER PAIR");
    console.log("(Skipping -- set SELLER_EMAIL / CUSTOMER_EMAIL env vars to drill into one account.)");
    return;
  }

  section("4. SPECIFIC SELLER/CUSTOMER PAIR: " + process.env.SELLER_EMAIL);

  const seller = await userModel.findOne({ email: process.env.SELLER_EMAIL }).select("_id userName email").lean();
  if (!seller) {
    console.log(`No user found with email=${process.env.SELLER_EMAIL}`);
    return;
  }
  console.log("Resolved seller:", seller);

  const sellerOrders = await orderModel
    .find({ seller: seller._id })
    .select("_id customer status createdAt")
    .lean();
  const distinctCustomers = new Set(sellerOrders.map((o) => String(o.customer)));
  console.log(`Seller has ${sellerOrders.length} orders, spanning ${distinctCustomers.size} distinct customer id(s):`);
  console.log([...distinctCustomers]);

  const myOrdersQuery = buildGetAllOrdersQuery({ customer: seller._id.toString(), userId: seller._id.toString() });
  const myOrdersCount = await orderModel.countDocuments(myOrdersQuery);
  console.log("\n'My orders' query (app sends own id as both customer & userId):");
  console.log(JSON.stringify(myOrdersQuery));
  console.log("-> count:", myOrdersCount, "(expected to equal", sellerOrders.length, "if this works correctly)");

  const sellerOnlyQuery = buildGetAllOrdersQuery({ userId: seller._id.toString() });
  const sellerOnlyCount = await orderModel.countDocuments(sellerOnlyQuery);
  console.log("\nSeller-only query (userId param only, no customer param):");
  console.log(JSON.stringify(sellerOnlyQuery));
  console.log("-> count:", sellerOnlyCount);

  if (process.env.CUSTOMER_EMAIL) {
    const customer = await userModel.findOne({ email: process.env.CUSTOMER_EMAIL }).select("_id userName email").lean();
    if (!customer) {
      console.log(`\nNo user found with email=${process.env.CUSTOMER_EMAIL}`);
    } else {
      console.log("\nResolved customer:", customer);
      console.log(
        "Orders from this customer to this seller:",
        sellerOrders.filter((o) => String(o.customer) === String(customer._id)).length
      );
    }
  }
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set. Load the real connection string (e.g. copy it from your hosting provider's env vars into a local .env) before running this script.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.");

  await checkOverallDataHealth();
  await checkRecentOrdersRaw();
  await checkSellerCustomerDiversity();
  await checkSpecificSellerCustomerPair();

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
