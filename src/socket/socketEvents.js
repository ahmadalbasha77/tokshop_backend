/***************************************************
 * src/socket/socketEvents.js
 ***************************************************/
const roomsModel = require("../models/room");
const auctionModel = require("../models/auction");
const productModel = require("../models/product");
const giveAway = require("../models/giveaway");
const bidModel = require("../models/bid");
const socketEmitter = require("../shared/socketEmitter");
const {
  bid,
  startRunningTimer,
  getAuctionPopulateOptions,
  processAutobids,
  populateRoomOptions,
  auctionTimers,createGiveawaOrder
} = require("../shared/functions");
const { startRecording } = require("../shared/livekit");


const registerUserHandlers = require("./handlers/user.handlers");
const registerRoomHandlers = require("./handlers/room.handlers");
  const flashSaleTimers = new Map();

module.exports = (io) => { 
  // This function is called once from socketHandler.js
  // Now set up connection + events 
  socketEmitter.on("auction-created", ({ roomId, auction }) => {
    console.log("⚡ socket: auction-created -> broadcasting");
    io.to(roomId).emit("scheduled-auction-started", auction);
  }); 

  socketEmitter.on("auction-ended", ({ roomId, auctionId }) => {
    console.log("⚡ socket: auction-ended -> broadcasting");
    io.to(roomId).emit("scheduled-auction-ended", auctionId);
  });
  io.on("connection", (socket) => { 
    console.log("A user connected: ", socket.id);
    registerUserHandlers(io, socket);
    registerRoomHandlers(io, socket);


 
    socket.on('join-scheduled-auction', async (data) => { 
      console.log("join-scheduled-auction", data);
      let { auction, userId, userName} = data;
      socket.join(auction);
      
      const updated = await auctionModel.findOneAndUpdate(
        { _id: auction },
        [
          {
            $set: {
              schedule_viewers: { $ifNull: ["$schedule_viewers", []] }
            }
          },
          {
            $set: {
              isNewViewer: {
                $not: { $in: [userId, "$schedule_viewers"] }
              }
            }
          },
          {
            $set: {
              watchers: {
                $cond: [
                  "$isNewViewer",
                  { $add: ["$watchers", 1] },
                  "$watchers"
                ]
              },
              schedule_viewers: {
                $cond: [
                  "$isNewViewer",
                  { $concatArrays: ["$schedule_viewers", [userId]] },
                  "$schedule_viewers"
                ]
              }
            }
          },
          { $unset: "isNewViewer" }
        ],
        { new: true }
      );


      const payload = {
        auction,
        userId,
        userName,
        watchers: updated.watchers, // real DB count
      };
      console.log(payload)
      
      io.to(auction).emit("joined-schedule-auction", payload);

    })
    socket.on("leave-scheduled-auction", async (data) => {
      try {
        console.log("leave-scheduled-auction", data);
        let { auction, userId, userName } = data;
        const auctionRoom = auction.toString();

        // decrement watchers (but ensure it doesn't go negative)
        const updated = await auctionModel.findByIdAndUpdate(
          auctionRoom,
          { $inc: { watchers: -1 } },
          { new: true }
        );

        // guard against negative watchers in DB
        if (updated && updated.watchers < 0) {
          updated.watchers = 0;
          await auctionModel.findByIdAndUpdate(auctionRoom, { $set: { watchers: 0 } });
        }

        const payload = {
          auction: auctionRoom,
          userId,
          userName,
          watchers: updated ? Math.max(0, updated.watchers) : 0,
        };
        console.log(payload)

        io.to(auctionRoom).emit("left-schedule-auction", payload);

        // remove socket from room and our set
        socket.leave(auctionRoom);
      } catch (err) {
        console.error("leave-scheduled-auction error:", err);
      }
    });

    // Join Room

    // Real-time chat
    socket.on("message", (data) => {
      io.to(data.roomId).emit("createMessage", data.message, data.userName);
    });


    socket.on("update-pinned-product", async (data) => { 
      const { roomId ,product} = data;
      let res = await productModel
        .findOne(
          { tokshow: roomId, _id: product, quantity: {$gt: 0} }
      );
      io.to(roomId).emit("updated-pinned-product", res);
      if (!res) { 
        await roomsModel.findByIdAndUpdate(roomId, {
          $set: {
            pinned: null
          }
        })
          await productModel
            .findByIdAndUpdate(
              { _id: product },
              { $set: { pinned: false} }
            )
      }
    })

    socket.on("start-auction", async (data) => {
      try {
        let { roomId, auction,increaseBidBy } = data;
        console.log("Received start-auction:", {
          roomId,
          auction,
        });
        let { baseprice,product,tokshow } = auction;
        const populateOptions = await getAuctionPopulateOptions();
        const duration = auction.duration || 60; 
        const endTime = Date.now() + duration * 1000; 
        let res = await auctionModel  
          .findOneAndUpdate(
            {
              _id: auction?._id,
              $or: [
                { started: false },
                { $and: [{ started: true }, { bids: { $size: 0 } }] } // <--- simpler than $expr
              ]
            },
            {
              $set: {
                startedTime: Date.now(),
                started: true,
                endTime: new Date(endTime),
                ended: false,
                increaseBidBy,
                sudden: auction?.sudden,
                newbaseprice: baseprice,
                baseprice,
                duration: auction?.duration
              },
            },
            { runValidators: true, new: true }
          )
          .populate(populateOptions);
        if (!res) {
          res = await auctionModel.create({
            startedTime: Date.now(),
            started: true,
            endTime: new Date(endTime),
            product: product,
            tokshow: tokshow,
            ended: false,
            increaseBidBy,
            sudden: auction?.sudden,
            newbaseprice: baseprice,
            baseprice,
            duration: auction?.duration
          });
          // Optional populate after creation
          res = await auctionModel.populate(res, populateOptions);
          await productModel.findByIdAndUpdate(
            product,
            { $set: { auction: res?._id } },
            { runValidators: true, new: true }
          )
        }
        auction = res;
        console.log(res.product?.prebids);
        if (res.product?.prebids?.length) {
          const prebids = res.product.prebids
            .map(p => ({
              userId: p.user._id,
              user: p.user,
              max: p.amount
            }))
            .sort((a, b) => b.max - a.max);
            console.log(prebids);

          const highest = prebids[0];
          const secondHighest = prebids[1];

          let startBidAmount = res.baseprice;
          console.log(startBidAmount);

          if (secondHighest) {
            startBidAmount = secondHighest.max;
          }

          // create ONLY ONE bid (leader)
          const bid = await bidModel.create({
            user: highest.userId,
            auction: res._id,
            amount: startBidAmount,
            autobid: true,
            autobidamount: highest.max,
          });
          bid.user = highest.user;
          res.bids = [bid];
          res.baseprice = startBidAmount;
          res.newbaseprice = startBidAmount + 1;

          await res.save();

          // clear prebids
          await productModel.findByIdAndUpdate(res.product._id, {
            $set: { prebids: [] }
          });

          io.to(roomId).emit("bid-updated", res);
        }

        const serverTime = Date.now();
        io.to(roomId).emit("auction-started", {
          ...res.toObject(),
          endTime,                                         // millis
          serverTime,                                      // millis
        });


        // if(res?.bids?.length > 0){
        //   let response = await processAutobids(res, null); 
        //   response.newbaseprice = res.product.price + 1;
        //   io.to(roomId).emit("bid-updated", response);
        // }
        
        startRunningTimer(res, async (err, result) => {
          if (err) {
            io.to(roomId).emit("auction-error", {
              code: err?.error?.code,
              message: err?.buyerUserName+" payment failed",
              error: err?.error?.error
            });
          } else {
            if (result.updateQty == true) {
              io.to(roomId).emit("auction-update", result?.response);
            } else {
              io.to(roomId).emit("auction-ended", result);
            }
          }
          if (err) {
            console.error("Error:", err);
          }
        });
        try{
          const info = await startRecording(roomId)
          await auctionModel.findByIdAndUpdate(
            res?._id,
            { $set: { egressId: info.egressId } },
            { runValidators: true, new: true }
          )
        }catch(e){
          console.log("record error ", e)
        }
        await roomsModel.findByIdAndUpdate(
          roomId,
          { $set: { activeauction: auction._id, pinned: null } },
          { runValidators: true, new: true }
        )
      } catch (error) {
        console.error(error);
        socket.emit("auction-error", "Failed to start auction");
      }
    });
    socket.on("pin-product", async (data) => {
      try {
        console.log("Received pin-product:", {
          data,
        });
        const { tokshow, product, pinned } = data;
        const populateOptions = await populateRoomOptions();
        let room;
        if (pinned == false) {
          room = await roomsModel
            .findOneAndUpdate(
              { _id: tokshow },
              { $set: { pinned: null } },
              { runValidators: true, new: true }
            )
            .populate(populateOptions);
        } else {
          await productModel.updateMany(
            { flash_sale_started: true },
            { $set: { flash_sale_started: false, flash_sale_ended: true } }
          );

          room = await roomsModel
            .findByIdAndUpdate(
              { _id: tokshow },
              { $set: { pinned: product, activeauction: null } },
              { runValidators: true, new: true }
            )
            .populate(populateOptions);
        }
        io.to(tokshow).emit("product-pinned", room);
          await productModel
            .findByIdAndUpdate(
              { _id: product },
              { $set: { pinned: true} }
            )
      } catch (error) {
        console.error(error);
        socket.emit("product-error", "Failed to pin product");
      }
    });

    socket.on("pin-auction", async (data) => {
      try {
        console.log("Received pin-auction:", {
          data,
        });
        const { tokshow, auction } = data;
        const populateOptions = await getAuctionPopulateOptions();
        await roomsModel.findOneAndUpdate(
          { _id: tokshow },
          { $set: { activeauction: auction, pinned: null } },
          { runValidators: true, new: true }
        );
        let auctionres = await auctionModel
          .findById(auction)
          .populate(populateOptions);
        console.log(tokshow);
        io.to(tokshow).emit("auction-pinned", auctionres);
      } catch (error) {
        console.error(error);
        socket.emit("auction-error", "Failed to pin auction");
      }
    });
    socket.on("update-bid", async (data) => {
      console.log("update-bid:", {
          data,
      });
      let { user, auction, autobidamount,autobid,roomId } = data;
      const query = { user, auction };
      const update = {
          $set: { autobidamount, autobid},
        };
      const options = { upsert: true, new: true };
      let bidresponse = await bidModel.findOneAndUpdate(query, update, options).populate({
          path: "user",
          select: ["firstName", "lastName", "bio", "userName", "email", "profilePhoto"],
          populate: {
            path: "address",
          },
        });
      io.to(roomId).emit("user-bid-updated", bidresponse);
    });
   socket.on("place-prebid", async ({ productId, user, amount,room }) => {
    console.log("place-prebid", { productId, user, amount,room });

    // 1️⃣ remove old prebid
    await productModel.updateOne(
      { _id: productId },
      { $pull: { prebids: { user } } }
    );

    // 2️⃣ add new prebid
    let product = await productModel.findByIdAndUpdate(
      productId,
      { $push: { prebids: { user, amount } } },
      { new: true ,}
    );

    // 3️⃣ emit prebid event
    io.to(room).emit("prebid", product);

  });

    // Auction Bidding Example
    socket.on("place-bid", async (data) => {
      try {
        console.log("Received place-bid:", {
          data,
        });
        let {
          user,
          auction,
          amount,
          increaseBidBy,
          roomId,
          autobidamount,
          autobid,
          type = "show",
          custom_bid = false,
        } = data;
        const query = { user, auction };
        const update = {
          $set: { amount, auction, user, autobid, autobidamount,custom_bid },
        };
        const options = { upsert: true, new: true };
        let newPrice = amount + 1;
        await bid(
          query,
          update,
          options,
          auction,
          amount,
          async (err, res) => {
            if (err) {
              console.error("Error:", err);
            } 
            if (res) {
              let response = await processAutobids(res, user);

              const highestBid = Math.max(
                ...response.bids.map(b => Number(b.amount))
              );
              if (type == "show") {
                increaseBidBy = response.increaseBidBy;
                if (response?.endTime instanceof Date) {
                  const remaining = response.endTime.getTime() - Date.now();
                  if (remaining <= 10_000 && response?.sudden == false) {
                    response.endTime = new Date(
                      response.endTime.getTime() + increaseBidBy * 1000
                    );
                    const timer = auctionTimers.get(response._id.toString());
                    if (timer) {
                      timer.endTime = response.endTime;
                    }
                    io.to(roomId).emit("auction-time-extended", {
                      auctionId: response._id,
                      newEndTime: response.endTime.getTime(),
                      added: increaseBidBy,
                      serverTime: Date.now(),
                    });
                  }
                }
              }
              response.baseprice = highestBid;
              // response.newbaseprice = highestBid + 1;
              response.newbaseprice = newPrice; 
              await response.save();
              if (type == "scheduled") { 
                roomId = auction;
              }
              console.log(roomId)
              io.to(roomId).emit("bid-updated", response);
            }
            
          }
        );
      } catch (error) {
        console.error(error);
        socket.emit("bid-error", "Failed to place bid");
      }
    });

    // Handle disconnection
    socket.on("disconnect", () => {
      socket.leaveAll();
      console.log("User disconnected: ", socket.id);
    });

    //GIVEAWAYS
    socket.on("join-giveaway", async (data) => {
      try {
        const { giveawayId, userId, showId } = data;
        const giveaway = await giveAway
          .findByIdAndUpdate(
            giveawayId,
            { $addToSet: { participants: userId } }, // prevents duplicates
            { new: true }
          )
          .populate("category")
          .populate("user")
          .populate("participants")
          .populate("tokshow", "title")
          .populate("shipping_profile");

          io.to(showId).emit("joined-giveaway", giveaway);

      } catch (error) {
        console.error(error);
        socket.emit("giveaway-error", "Failed to join giveaway");
      }
    });
    socket.on("pin-giveaway", async (data) => {
      console.log("Received pin-giveaway:", {
        data,
      });
      try {
        const { giveawayId, showId } = data;
        const giveaway = await giveAway.findById(giveawayId);
        if (!giveaway) {
          return socket.emit("giveaway-error", "Giveaway not found");
        }
        giveaway.status = "pinned";
        await giveaway.save();
        await roomsModel.findOneAndUpdate(
          { _id: giveaway.tokshow },
          { $set: { pinned_giveaway: giveaway._id } },
          { runValidators: true, new: true }
        );
        io.to(showId).emit("pinned-giveaway", giveaway);
      } catch (error) {
        console.error(error);
        socket.emit("giveaway-error", "Failed to pin giveaway");
      }
    });

    socket.on("leave-giveaway", async (data) => {
      try {
        const { giveawayId, userId, showId } = data;
        const giveaway = await giveAway.findById(giveawayId);
        if (!giveaway) {
          return socket.emit("giveaway-error", "Giveaway not found");
        }
        giveaway.participants = giveaway.participants.filter(
          (participant) => participant.toString() !== userId
        );
        await giveaway.save();
        io.to(showId).emit("left-giveaway", giveaway);
      } catch (error) {
        console.error(error);
        socket.emit("giveaway-error", "Failed to leave giveaway");
      }
    });

    socket.on("draw-giveaway", async (data) => {
      try {
        const { giveawayId, showId } = data;
        const giveaway = await giveAway
          .findById(giveawayId)
          .populate("category")
          .populate("user")
          .populate("participants")
          .populate("tokshow", "title")
          .populate("winner", "firstName lastName bio userName email")
          .populate("shipping_profile");
        if (!giveaway) {
          return socket.emit("giveaway-error", "Giveaway not found");
        }
        const winner =
          giveaway.participants[
            Math.floor(Math.random() * giveaway.participants.length)
          ];
        giveaway.winner = winner;
        giveaway.status = "ended";
        await giveaway.save();
        if(winner){
          await createGiveawaOrder(giveaway);
        }

        io.to(showId).emit("ended-giveaway", giveaway);
      } catch (error) {
        console.error(error);
        socket.emit("giveaway-error", "Failed to draw giveaway");
      }
    });
    
    socket.on("start-giveaway", async (data) => {
      console.log("Received start-giveaway:", {
        data,
      });
      try {
        const { giveawayId, showId } = data;
        const giveaway = await giveAway
          .findById(giveawayId)
          .populate("category")
          .populate("user")
          .populate("participants")
          .populate("tokshow", "title")
          .populate("shipping_profile");
        if (!giveaway) {
          return socket.emit("giveaway-error", "Giveaway not found");
        }
        giveaway.status = "started";
        giveaway.startedtime = Date.now();
        await giveaway.save();
        await roomsModel.findOneAndUpdate(
          { _id: giveaway.tokshow },
          { $set: { pinned_giveaway: giveaway._id } },
          { $inc: { giveawayCount: 1 } },
          { runValidators: true, new: true }
        );
        io.to(showId).emit("started-giveaway", giveaway);
        // start timer
        const timer = setInterval(async () => {
          giveaway.duration -= 1;
          // console.log(giveaway.duration);
          if (giveaway.duration === 0) {
            // console.log(giveaway.duration);
            clearInterval(timer);
            let newgetaway = await giveAway
              .findByIdAndUpdate(
                giveaway._id,
                {
                  $set: {
                    status: "ended",
                    endedtime: Date.now(),
                    duration: 0,
                  },
                },
                {
                  new: true,
                  runValidators: true,
                }
              )
              .populate("category")
              .populate("user")
              .populate("tokshow", "title")
              .populate("participants")
              .populate("winner", "firstName lastName bio userName email fcmToken")
              .populate("shipping_profile");
            // draw winner
            const winner =
              newgetaway.participants[
                Math.floor(Math.random() * newgetaway.participants.length)
              ];
            newgetaway.winner = winner;
            await newgetaway.save();
            if (winner) {
              await createGiveawaOrder(newgetaway);
            }

            await roomsModel.findOneAndUpdate(
              { _id: giveaway.tokshow },
              { $set: { pinned_giveaway: null } },
              { runValidators: true, new: true }
            );

            io.to(showId).emit("ended-giveaway", newgetaway);
          }
        }, 1000);
      } catch (error) {
        console.error(error);
        socket.emit("giveaway-error", "Failed to start giveaway");
      }
    });

   socket.on("start-flash-sale", async ({
      productId,
      roomId,
      discountType,
      discountValue,
      duration,
      buyLimit,originalPrice
    }) => {
      const endTime = Date.now() + duration * 1000;
      console.log({
      productId,
      roomId,
      discountType,
      discountValue,
      duration,
      buyLimit,originalPrice
    })
      const flash_sale_price = discountType === "percentage" ? originalPrice - ((discountValue / 100) * originalPrice) : discountValue < originalPrice ? discountValue : originalPrice;
      // 1️⃣ Persist latest flash configuration
      let response = await productModel.updateOne(
        { _id: productId },
        {
          $set: {
            flash_sale_discount_type: discountType,
            flash_sale_discount_value: discountValue,
            flash_sale_buy_limit: buyLimit,
            flash_sale_duration: duration,
            flash_sale_end_time: new Date(endTime),
            flash_sale_price
          },
        }
      );

      // 2️⃣ Notify room (authoritative time)
      io.to(roomId).emit("flash-sale-started", {
        productId,
        endTime,
        discountType,
        discountValue,
        buyLimit,
        serverTime: Date.now(),
        flash_sale_price,originalPrice
      }); 

      // 3️⃣ Timer ONLY for notification
      if (flashSaleTimers.has(productId)) {
        clearTimeout(flashSaleTimers.get(productId));
      }

      flashSaleTimers.set(
        productId,
        setTimeout(() => {
          io.to(roomId).emit("flash-sale-expired", {
            productId,
            serverTime: Date.now(),
          });

          flashSaleTimers.delete(productId);
        }, duration * 1000)
      );
    });




  });
};
 