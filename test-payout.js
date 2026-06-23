const mongoose = require("mongoose");
const path = require("path");

// Load model schemas to register them with Mongoose
const orderModel = require("./src/models/order");
const itemModel = require("./src/models/item");
const transactionModel = require("./src/models/transaction");

// Load environment variables for MongoDB connection
require("dotenv").config({ path: ".env" });

const orderId = "YOUR_ORDER_ID_HERE"; // 👈 Replace with your actual order ID

const testPayout = async () => {
  try {
    if (orderId === "YOUR_ORDER_ID_HERE") {
      console.error("❌ Error: Please replace 'YOUR_ORDER_ID_HERE' with a real order ID before running.");
      return;
    }

    if (!process.env.MONGO_URI) {
      console.error("❌ Error: MONGO_URI environment variable is not defined in .env");
      return;
    }

    // Connect to database
    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("🔌 Connected successfully.");
    
    // 1. Update the order status to delivered
    console.log(`⏳ Updating order ${orderId} status to "delivered"...`);
    const updatedOrder = await orderModel.findByIdAndUpdate(
      orderId, 
      { $set: { status: "delivered" } },
      { new: true }
    );
    
    if (!updatedOrder) {
      console.error("❌ Error: Order not found!");
      return;
    }
    console.log(`✅ Order status updated successfully.`);
    
    // 2. Find order items and update their corresponding transactions
    console.log(`⏳ Fetching items for order ${orderId}...`);
    const orderItems = await itemModel.find({ orderId });
    const itemIds = orderItems.map(i => i._id);
    console.log(`ℹ️ Found ${itemIds.length} item(s) in this order.`);
    
    console.log(`⏳ Updating transaction records to clear them...`);
    const updateResult = await transactionModel.updateMany(
      { itemId: { $in: itemIds }, type: "order" },
      { 
        $set: { 
          order_fulfilled: true, 
          status: "Completed", 
          payment_available: true 
        } 
      }
    );
    
    console.log(`✅ Updated ${updateResult.modifiedCount} transaction record(s).`);
    console.log("🎉 Test setup complete. The cron job will pick up and transfer funds to the seller within 10 minutes.");
    
  } catch (error) {
    console.error("❌ Unexpected Error:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB.");
  }
};

testPayout();
