const cron = require("node-cron");
const moment = require("moment");
const roomsModel = require("../models/room"); 
var mongoose = require("mongoose");
const functions = require("../shared/functions");
const products = require("../models/product");
const auction = require("../models/auction");
const bidModel = require("../models/bid");
const userModel = require("../models/user");
const giveaway = require("../models/giveaway");
const socketEmitter = require("../shared/socketEmitter");
const orderModel = require("../models/order");
const webhookController = require("../controllers/webhookController");
const { releaseEligibleOrderPayments } = require("./orderPaymentRelease");

// Function to recreate repeating rooms
async function recreateRepeatingRooms() {
  try {
    // const userIds = await userModel.distinct("_id");
    console.log("🔄 Running repeating rooms job...");
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    // Find all rooms that have repeat set to "daily", "weekly", or "monthly"
    const repeatingRooms = await roomsModel
      .find({
        repeat: { $in: ["daily", "weekly", "monthly", "hourly"] },
        date: {
          $gte: fiveDaysAgo, // not older than 5 days
          $lt: new Date(), // less than now
        },
        ended: true,
      })
      .populate("owner");
    if (repeatingRooms.length == 0) {
      return;
    }

    for (const room of repeatingRooms) {
      let newDate;

      // Calculate new date based on repeat type
      if (room.repeat === "daily") {
        newDate = moment(new Date()).add(1, "days").toDate();
      } else if (room.repeat === "weekly") {
        newDate = moment(new Date()).add(1, "weeks").toDate();
      } else if (room.repeat === "monthly") {
        newDate = moment(new Date()).add(1, "months").toDate();
      } else if (room.repeat === "hourly") {
        newDate = moment(new Date()).add(1, "hours").toDate();
      }
      await roomsModel.findByIdAndUpdate(room._id, {
        $set: {
          repeat: "none",
        },
      });

      // Create a new room with updated date
      const newRoomId = new mongoose.Types.ObjectId();
      // update products with the old room to the new room id
      const newRoom = new roomsModel({
        ...room.toObject(), // Copy existing room data
        _id: newRoomId, // Remove existing ID to create a new one
        date: newDate, 
        ended: false,
        auctions: [],
        activeauction: null,
        viewers: [],
        started: false,
        createdAt: new Date(), // Update timestamp
      });

      await newRoom.save();
      //THIS IS FOR DEMO PURPOSE ONLY
      var response = await functions.getSettings();
      if (response['demoMode'] == true) {
        await products.updateMany(
          { tokshow: room._id },
          { $set: { tokshow: newRoomId } }
        );
        await auction.updateMany(
          { tokshow: room._id },
          { $set: { tokshow: newRoomId } }
        );
        await giveaway.updateMany(
          { tokshow: room._id },
          { $set: { tokshow: newRoomId } }
        );
      }
      console.log(
        `✅ Room ${room._id} recreated for ${room.repeat} at ${newDate}`
      );
    }
  } catch (error) {
    console.error("❌ Error recreating repeating rooms:", error);
  }
}

cron.schedule("* * * * *", async () => {
  var response = await functions.getSettings();
  if (response['demoMode'] == true) {
    await recreateRepeatingRooms();
    console.log("🔄 Scheduled job executed at midnight.");
  }
  await runScheduledAuctionDraw();
});
cron.schedule("* * * * *", async () => {
  await closeScheduledAuction();
});

// closeScheduledAuction()

const MS_PER_DAY = 24 * 60 * 60 * 1000;

async function closeScheduledAuction() {
  try {
    const now = Date.now();

    // Find auctions to end
    const auctionsToClose = await auction.find({
      end_time_date: { $lte: now },
      ended: false,
      type: 'scheduled'
    }).populate(await functions.getAuctionPopulateOptions());
    // console.log("auctionsToClose ",auctionsToClose)

    for (const auc of auctionsToClose) {

      // ✅ Get highest bidder
      const highestBid = await bidModel
        .findOne({ auction: auc._id })
        .sort({ amount: -1 })
        .populate("user");

      if (!highestBid) {
        await auction.findByIdAndUpdate(auc._id, { ended: true });
        continue;
      }

      // ✅ Mark auction winner & close
      await auction.findByIdAndUpdate(auc._id, {
        $set: {
          higestbid: highestBid.amount,
          winner: highestBid.user._id,
          winning: highestBid.user._id,
          ended: true,
        }
      });
 
      // ✅ Charge winner
      const chargeResult = await functions.createAuctionCharge(auc);
      if (!chargeResult?.success) continue;

      // ✅ Check product stock
      const product = await products.findById(auc.product);
      if (!product || product.quantity < 1) {
        console.log("⛔ No more quantity. Auction stops.");
        continue;
      }

      // ✅ Create NEW auction for next day, same time
      const nextStart = new Date(auc.start_time_date + MS_PER_DAY);
      const nextEnd = new Date(auc.end_time_date + MS_PER_DAY);

      const newAuction = await auction.create({
        product: auc.product,
        baseprice: auc?.product?.default_startprice,
        increaseBidBy: auc.increaseBidBy,
        quantity: 1,
        start_time_date: nextStart.getTime(),
        end_time_date: nextEnd.getTime(),
        started: false,
        ended: false,
        type: auc?.type
      });
      await products.findByIdAndUpdate(auc.product, {
        $set: { auction: newAuction._id }
      });

      console.log("✅ New auction created for next day");
      socketEmitter.emit("scheduled-auction-created", {
        roomId: auc.tokshow,   // auction belongs to a room
        auction: newAuction     // send to client
      });

    } 

  } catch (err) {
    console.error("Auction Cron Error:", err);
  }
};


cron.schedule("* * * * *", async () => {
  await closeScheduledGiveaways();
  await unsuspendUsers();
});
async function unsuspendUsers() {
  try {
    let ids = await userModel.find({ suspended: true }).select("_id fcmToken");
    if (ids.length == 0) {
      return;
    }
    await user.updateMany({ _id: { $in: ids } }, { $set: { suspended: false } });
    //send notification
    let tokens = ids.map((user) => user.fcmToken);
    await functions.sendNotification( tokens,
            "Account Activated",
            "Your account has been activated.",
            {
              screen: "ProfileScreen",
              id: null
            });
    
    console.log("✅ Unsuspended users");
  } catch (err) {
    console.error("Unsuspend Users Cron Error:", err);
  }
}
async function closeScheduledGiveaways() {
  try {
    const giveaways = await giveaway.find({
      status: "active",
      startedtime: { $ne: null },
      duration: { $gt: 0 },
      type: "icona",
      $expr: {
        $lte: [
          { $add: ["$startedtime", { $multiply: ["$duration", 1000] }] },
          new Date()
        ]
      }
    }).populate("participants").populate("winner","firstName lastName bio userName email fcmToken").populate("shipping_profile");
    // console.log("giveaways ", giveaways)

    for (const g of giveaways) {
      let winner = null;
      console.log(g.participants);
      // 🎯 Pick random winner if participants exist
      if (g.participants.length > 0) {
        const index = Math.floor(Math.random() * g.participants.length);
        console.log(index);
        // what if the random index is greater than participants length
        if(index >= g.participants.length){
          winner = g.participants[g.participants.length - 1]._id;
        }
        winner = g.participants[index]._id;
      }
      console.log(`🎉 Winner: ${winner}`);

      // ✅ Mark giveaway as ended
      let give = await giveaway.findByIdAndUpdate(g._id, {
        $set: {
          status: "ended",
          endedtime: new Date(),
          winner: winner 
        }
      }, { new: true }).populate("participants").populate("winner","firstName lastName bio userName email fcmToken").populate("shipping_profile");

      console.log(`🎁 Giveaway ended: ${give}`);
      if(!give.winner) continue; 
      give.platform_order = true; 
      await functions.createGiveawaOrder(give);
    }
  } catch (err) {
    console.error("Giveaway Cron Error:", err);
  }
}

// 1. One-Time Database Repair for Corrupted Timestamps
async function repairOldTransactions() {
  try {
    const transactionModel = require("../models/transaction");
    const futureThreshold = Date.parse("2030-01-01");
    
    const stuckTxs = await transactionModel.find({
      status: "Pending",
      availableOn: { $gt: futureThreshold },
      type: { $in: ["order", "tip"] }
    });
    
    if (stuckTxs.length > 0) {
      console.log(`🔧 Found ${stuckTxs.length} stuck transactions with year 58498 timestamps. Repairing...`);
      for (const tx of stuckTxs) {
        const createdAtTime = tx.createdAt ? new Date(tx.createdAt).getTime() : tx.date;
        const baseTime = (createdAtTime && createdAtTime > 0) ? createdAtTime : (Date.now() - 7 * 24 * 60 * 60 * 1000);
        const estimatedAvailable = baseTime + 7 * 24 * 60 * 60 * 1000;
        
        tx.availableOn = Math.min(estimatedAvailable, Date.now());
        await tx.save();
      }
      console.log("✅ Successfully repaired all corrupted transaction timestamps.");
    }
  } catch (error) {
    console.error("❌ Error repairing old transactions:", error);
  }
}
// Execute repair routine on server boot
repairOldTransactions();

// 2. Fallback Payout Cron Job (Runs every 10 minutes)
cron.schedule("*/10 * * * *", async () => {
  try {
    console.log("⏰ Running fallback cleared transactions job...");
    const settings = await functions.getSettings();
    if (!settings?.stripeSecretKey) return;
    const stripe = require("stripe")(settings.stripeSecretKey);
    const webhookController = require("../controllers/webhookController");
    const transactionModel = require("../models/transaction");
    const { releaseEligibleOrderPayments } = require("./orderPaymentRelease");
    
    await webhookController.processClearedTransactions(stripe);
    
    const eligibleTxs = await transactionModel.find({
      type: "order",
      status: "Completed",
      order_fulfilled: true,
      payment_available: true,
      paid_out: false,
      to: { $ne: null }
    });
    
    if (eligibleTxs.length > 0) {
      const orderIds = [...new Set(eligibleTxs.map(tx => tx.orderId.toString()))];
      await releaseEligibleOrderPayments({
        orderIds,
        stripeClient: stripe,
        requireDelivered: true
      });
    }
  } catch (error) {
    console.error("❌ Fallback payout job error:", error);
  }
});

module.exports = { recreateRepeatingRooms };
