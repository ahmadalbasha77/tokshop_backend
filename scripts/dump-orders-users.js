/**
 * READ-ONLY script. Does not write/modify any order or user data.
 * Dumps every order, grouped by seller, with the customer on each order
 * resolved to a name/email -- so you can visually check, per seller,
 * whether orders from different customers exist in the DB but aren't
 * showing in the app, or whether they genuinely don't exist.
 *
 * Run on the server (uses the real .env already there):
 *   node scripts/dump-orders-users.js
 *
 * Also writes full raw JSON dumps to:
 *   orders-dump.json
 *   users-dump.json
 */

require("dotenv").config({ path: ".env" });
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");

const orderModel = require(path.join(process.cwd(), "src/models/order"));
const userModel = require(path.join(process.cwd(), "src/models/user"));

function label(user) {
  if (!user) return "(deleted/unknown user)";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.userName || "(no name)";
  return `${name} <${user.email || "no-email"}> [${user._id}]`;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log("Connected to MongoDB.\n");

  const users = await userModel
    .find({})
    .select("_id userName firstName lastName email seller")
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const orders = await orderModel
    .find({})
    .select("_id customer seller status invoice createdAt")
    .sort({ createdAt: -1 })
    .lean();

  fs.writeFileSync("orders-dump.json", JSON.stringify(orders, null, 2));
  fs.writeFileSync("users-dump.json", JSON.stringify(users, null, 2));

  console.log(`Total users: ${users.length}`);
  console.log(`Total orders: ${orders.length}`);
  console.log("Full raw dumps written to orders-dump.json and users-dump.json\n");

  // Group orders by seller
  const bySeller = new Map();
  for (const o of orders) {
    const key = o.seller ? String(o.seller) : "(no seller)";
    if (!bySeller.has(key)) bySeller.set(key, []);
    bySeller.get(key).push(o);
  }

  console.log("========================================");
  console.log("ORDERS GROUPED BY SELLER");
  console.log("========================================\n");

  // Sort sellers by order count, descending
  const sellerEntries = [...bySeller.entries()].sort((a, b) => b[1].length - a[1].length);

  const singleCustomerSellers = [];
  const multiCustomerSellers = [];

  for (const [sellerId, sellerOrders] of sellerEntries) {
    const sellerUser = userById.get(sellerId);
    const distinctCustomers = new Set(sellerOrders.map((o) => String(o.customer)));

    console.log(`SELLER: ${label(sellerUser)}`);
    console.log(`  total orders: ${sellerOrders.length}, distinct customers: ${distinctCustomers.size}`);
    for (const o of sellerOrders) {
      const customerUser = userById.get(String(o.customer));
      console.log(
        `   - ${o.createdAt.toISOString()} | invoice ${o.invoice} | status ${o.status} | customer: ${label(customerUser)}`
      );
    }
    console.log("");

    if (distinctCustomers.size <= 1) {
      singleCustomerSellers.push({ sellerId, label: label(sellerUser), totalOrders: sellerOrders.length });
    } else {
      multiCustomerSellers.push({ sellerId, label: label(sellerUser), totalOrders: sellerOrders.length, distinctCustomers: distinctCustomers.size });
    }
  }

  console.log("========================================");
  console.log("SUMMARY");
  console.log("========================================");
  console.log(`Sellers whose orders ALL come from a single customer (${singleCustomerSellers.length}):`);
  for (const s of singleCustomerSellers) console.log(`  - ${s.label} (${s.totalOrders} orders)`);

  console.log(`\nSellers with orders from MULTIPLE different customers (${multiCustomerSellers.length}):`);
  for (const s of multiCustomerSellers) console.log(`  - ${s.label} (${s.totalOrders} orders, ${s.distinctCustomers} customers)`);

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Script error:", err);
  process.exit(1);
});
