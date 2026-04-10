const roomsModel = require("../models/room");
const userModel = require("../models/user");
var auctionModel = require("../models/auction");

const functions = require("../shared/functions");
require("dotenv").config({ path: ".env" });

var mongoose = require("mongoose");
const products = require("../models/product");
const Category = require("../models/category");
const { sendNotificationToAll } = require("../shared/send_notification");

exports.getRoomAnalytics = async (req, res) => {
  try {
    let roomId = req.params.roomId;

    let room = await roomsModel.findById(roomId).populate("owner", ["email"]);

    if (!room) {
      return res
        .status(404)
        .setHeader("Content-Type", "application/json")
        .json({ message: "Room not found" });
    }

    let analytics = {
      itemsSold: room.salesCount || 0,
      giveaways: room.giveawayCount || 0,
      shipments: room.shipmentsCount || 0,
      totalSales: room.salesTotal || 0,
      tipsReceived: room.tipsTotal || 0,
      viewers: room.viewers ? room.viewers.length : 0,
      newFollowers: room.followersCount || 0,
      appUrl: "seller.iconaapp.com",
      hostEmail: room.ownerId ? room.ownerId.email : "N/A",
    };

    return res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ analytics });
  } catch (error) {
    console.log("Error fetching analytics " + error);
    return res
      .status(500)
      .setHeader("Content-Type", "application/json")
      .json({ message: "Internal server error" });
  }
}

exports.bulkUpdate = async (req, res) => {
  // try {
    let { thumbnail, preview_videos, ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No IDs provided" });
    }

    // Build the update object dynamically
    let updateData = {};
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    if (preview_videos !== undefined) updateData.preview_videos = preview_videos;

    const result = await roomsModel.updateMany(
      { _id: { $in: ids } },
      { $set: updateData }
    );

    return res.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  // } catch (err) {
  //   console.error("Bulk update error:", err);
  //   return res.status(500).json({ success: false, error: err.message });
  // }
};

exports.createShow = async (req, res) => {
  try {
    console.log("createShow ", req.body);

    // 1️⃣ Generate first room ID
    const mainId = new mongoose.Types.ObjectId();

    let newObj = {
      _id: mainId,
      owner: new mongoose.Types.ObjectId(req.body.userId),
      hosts: req.params.hosts ? req.params.hosts : [],
      title: req.body.title,
      category: req.body.category,
      event: req.body.event,
      eventDate: req.body.eventDate,
      roomType: req.body.roomType,
      description: req.body.description,
      allowrecording: req.body.allowrecording,
      activeTime: req.body.activeTime,
      date: req.body.date,
      repeat: req.body.repeat,
      preview_videos: req.body.preview_videos,
      shipping_settings: req.body.shipping_settings,
      explicit_content: req.body.explicit_content,
      moderators: req.body.moderators,
      co_hosts: req.body.co_hosts
    };

    // 2️⃣ Generate future IDs before inserting
    let ids = [mainId.toString()];
    let baseDate = new Date(req.body.date);

    if (req.body.repeat !== "none" && req.body.repeat_count > 0) {
      for (let i = 0; i < req.body.repeat_count; i++) {
        const repeatId = new mongoose.Types.ObjectId();
        ids.push(repeatId.toString());
      }
    }

    // 3️⃣ Create the first room synchronously (important)
    const mainRoom = await roomsModel.create(newObj);

    // 4️⃣ Start background creation of repeated rooms
    if (ids.length > 1) {
      Promise.all(
        ids.slice(1).map((id, i) => {
          let nextDate = new Date(baseDate);

          if (req.body.repeat === "daily") nextDate.setDate(baseDate.getDate() + (i + 1));
          if (req.body.repeat === "weekly") nextDate.setDate(baseDate.getDate() + 7 * (i + 1));
          if (req.body.repeat === "monthly") nextDate.setMonth(baseDate.getMonth() + (i + 1));

          let repeatedObj = { ...newObj, _id: id, date: nextDate };
          return roomsModel.create(repeatedObj).catch(err =>
            console.error("Failed to create repeated room:", err)
          );
        })
      );
    }

    // 5️⃣ Populate the first
    let populatedRoom = await roomsModel
      .findById(mainId)
      .populate(await functions.populateRoomOptions());

    // 6️⃣ Respond immediately with all IDs
    return res.status(200).json({
      room: populatedRoom,
      ids,          // includes all created + future repeats
    });

  } catch (error) {
    console.error(error);
    return res.status(422).json(error.message);
  }
};



//to be removed after updating with shops removed
exports.getShows = async (req, res) => {
  // try {
    //do not use curretuserId this one for anything else apart from private room filters
    const {
      title,
      page,
      limit,
      status = "",
      live = "",
      currentUserId,
      userid,
      featured,
      category,
      ownerUsername = ""
    } = req.query;
      console.log(req.query);

    // Base privacy filter
    let privacyFilter = {};
    if(currentUserId){
      privacyFilter ={
        $or:[
          {roomType:"public"},
          {roomType:"private", owner: currentUserId},
        ]
      }
    }
    console.log(privacyFilter);

    const queryObject = { $and: [privacyFilter], owner: { $exists: true } };

    if (userid) {
      queryObject.$and.push({ owner: userid });
    }
    if (currentUserId) {
      const blockedMe = await userModel
        .find({ blocked: currentUserId })
        .select("_id");

      const blockedOwnerIds = blockedMe.map(u => u._id);

      if (blockedOwnerIds.length > 0) {
        queryObject.$and.push({
          owner: { $nin: blockedOwnerIds }
        });
      }
    }

    if (category && category != "all") {
      const categoryDoc = await Category.findById(category).select("_id subCategories");
      if (categoryDoc) {
        const ids = [categoryDoc._id, ...categoryDoc.subCategories];
        queryObject.$and.push({ category: { $in: ids } });
      } else {
        queryObject.$and.push({ category: category });
      }
    }

    if (title) {
      queryObject.$and.push({ title: { $regex: `${title}`, $options: "i" } });
    }

    let sort = {};
    if (status == "active") {
      queryObject.$and.push({
        $or: [
          { ended: false, started: true },
          { ended: false } 
        ]
      });
      sort = { started: -1, date: 1, createdAt: 1 };
    }
 
    if (status == "inactive") {
      queryObject.$and.push({ ended: true });
      sort = { date: -1 };
    }

    if (status == "") {
      sort = { started: -1, ended: 1, date: 1 };
    }

    let pages = Number(page);
    const limits = Number(limit);
    const skip = (pages - 1) * limits;
    if(live == "true"){
      queryObject.$and.push({ started: true , ended: false });
    }
   if (featured === "true") {
  queryObject.$and.push({
    $or: [
      // Type 1: time-based featured
      { featured_until: { $exists: true, $gte: Date.now() } },

      // Type 2: featured=true and featured_until missing
      { featured: true, featured_until: { $exists: false } },

      // Type 3: featured=true and featured_until null
      { featured: true, featured_until: null }
    ]
  });
}


    if(ownerUsername){
      const owners = await userModel
        .find({
          userName: {
            $regex: ownerUsername,
            $options: "i"
          }
        })
        .select("_id");

      const ownerIds = owners.map(o => o._id);

      queryObject.$and.push({
        owner: { $in: ownerIds }
      });
    } 
    try {
      console.log(queryObject);
      const totalDoc = await roomsModel.countDocuments({
        ...queryObject,
      });
      let populateOptions = await functions.populateRoomOptions();
      const rooms = await roomsModel
        .find({
          ...queryObject,
        })
        .sort(sort)
        .populate(populateOptions)
        .skip(skip)
        .limit(limits);

      res.send({
        rooms,
        totalDoc,
        limits,
        pages: totalDoc > 0 ? Math.ceil(totalDoc / limits) : 1,
      });
    } catch (err) {
      res.status(500).send({
        message: err.message,
      });
    }
  // } catch (error) {
  //   console.log(error + " ");
  //   res.statusCode = 422;
  //   res.setHeader("Content-Type", "application/json");
  //   res.json(error);
  // }
};

exports.sendRoomNotifications = async (req, res) => {

  const { app_name } = await functions.getSettings();
  if (req.body.type == "liveposted") {
    sendNotificationToAll(
      "Live "+app_name,
      ` ${req.body.user.firstName} is live on!. Join now!`,
      { screen: "RoomScreen", id: req.body.room._id }
    );
  }
};

exports.makeRoomFeatured = async (req, res) => {
  try {
    console.log(req.params.roomId);
    let room = await roomsModel.findById(req.params.roomId);
    room.featured = room.featured ? false : true;
    if(req.body.featured_until){
      room.featured_until = req.body.featured_until;
    }
    await room.save();
    res.status(200).setHeader("Content-Type", "application/json").json(room);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
}

exports.updateRoomById = async (req, res) => {
  try {
    let newObj = {
      owner: new mongoose.Types.ObjectId(req.body.userId),
      hosts: req.params.hosts ? req.params.hosts : [],
      title: req.body.title,
      category: req.body.category,
      event: req.body.event,
      eventDate: req.body.eventDate,
      roomType: req.body.roomType,
      description: req.body.description, 
      allowrecording: req.body.allowrecording,
      activeTime: req.body.activeTime,
      date: req.body.date,
      repeat: req.body.repeat,
      preview_videos: req.body.preview_videos,
      shipping_settings: req.body.shipping_settings,
      explicit_content: req.body.explicit_content,
      moderators: req.body.moderators,
      co_hosts: req.body.co_hosts
    };
    if (req.body.category){
      req.body.category = new mongoose.Types.ObjectId(req.body.category)
    }
    let updatedRoom = await roomsModel.findByIdAndUpdate(
      req.params.roomId,
      {
        $set: req.body,
      },
      { new: true, runValidators: true }
    ).populate(await functions.populateRoomOptions());;
    let ids = [updatedRoom?._id.toString()];
    if (req.body.repeat != 'none') { 
      let baseDate = new Date(req.body.date);
      let repeat_count = req.body.repeat_count;
      for (let i = 0; i < repeat_count; i++) {
       let nextDate = new Date(baseDate);

        if (req.body.repeat === "daily") {
          nextDate.setDate(baseDate.getDate() + (i + 1));
        } else if (req.body.repeat === "weekly") {
          nextDate.setDate(baseDate.getDate() + 7 * (i + 1));
        } else if (req.body.repeat === "monthly") {
          nextDate.setMonth(baseDate.getMonth() + (i + 1));
        }

        let repeatedObj = { ...newObj, date: nextDate };
        let rm = await roomsModel.create(repeatedObj)
        ids.push(rm?._id.toString())
      }
    }

    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({updatedRoom, 'ids': ids});
  } catch (error) {
    console.log(error + " ");
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.removeProductFromroom = async (req, res) => {
  try {
    await roomsModel.findByIdAndUpdate(
      req.params.roomid,
      {
        $pullAll: { productIds: [req.body.product] },
      },
      { runValidators: true, new: true, upsert: false }
    );
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true });
  } catch (error) {
    console.log(error + " ");
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.addUserToRoom = async (req, res) => {
  try {
    console.log(req.body);
    const room = await roomsModel.findById(req.params.roomId);

    let user = await userModel.findById(req.body.users[0]);

    if (user.currentRoom != "" && user.currentRoom != req.params.roomId) {
      let userRoom = await roomsModel.findById(user.currentRoom);

      if (userRoom != null && userRoom["ended"] == false) {
        console.log("1");
        if (
          userRoom.hostIds.length < 2 &&
          userRoom.hostIds.includes(req.body.users[0])
        ) {
          await roomsModel.findByIdAndUpdate(user.currentRoom, {
            $set: {
              ended: true,
              endedTime: Date.now(),
              productImages: [],
            },
          });
        } else {
          console.log("2");
          await roomsModel.findByIdAndUpdate(
            user.currentRoom,
            {
              $pullAll: { userIds: [req.body.users] },
              $pullAll: { hostIds: [req.body.users] },
              $pullAll: { speakerIds: [req.body.users] },
            },
            { runValidators: true, new: true, upsert: false }
          );
        }
      }
    }
    await userModel.findByIdAndUpdate(req.body.users[0], {
      $set: { currentRoom: req.params.roomId, muted: true },
    });

    if (
      room.hostIds.includes(req.body.users[0]) ||
      room.speakerIds.includes(req.body.users[0])
    ) {
      console.log("3");
      res.status(200).setHeader("Content-Type", "application/json").json(room);
    } else {
      console.log("4");
      let updatedRoom = await roomsModel.findByIdAndUpdate(
        req.params.roomId,
        {
          $addToSet: { userIds: req.body.users },
          $set: { allUsers: req.body.users },
        },
        { runValidators: true, new: true, upsert: false }
      );
      res
        .status(200)
        .setHeader("Content-Type", "application/json")
        .json(updatedRoom);
    }
  } catch (error) {
    console.log(error.message);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.getRoomById = async (req, res) => {
  try {
    let {currentUserId} = req.query
    //check if am blocked by the owner
    // if(currentUserId){
    //   const blockedMe = await userModel
    //     .find({ blocked: currentUserId })
    //     .select("_id");
    //   const blockedMeIds = blockedMe.map(u => u._id);
    //   if (blockedMeIds.length > 0) {
    //     return res.status(403).json({error:"You are blocked by the owner"});
    //   }
    // }
    let populateOptions = await functions.populateRoomOptions();
    let room = await roomsModel
      .findById(req.params.roomId)
      .populate(populateOptions);

    //check if currentUserId is in the banned list
    if(currentUserId){
      const bannedusers = room.banned;
      if(bannedusers.includes(currentUserId)){
        return res.status(403).json({error:"You are banned from this room"});
      }
    }

    res.status(200).setHeader("Content-Type", "application/json").json(room);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.getDeletedRoomById = async (req, res) => {
  try {
    let room = await roomsModel
      .findById(req.params.roomId)
      .populate("hostIds", [
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
      ])
      .populate("userIds", [
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
      ])
      .populate({
        path: "activeauction",
        populate: {
          path: "bids",
          populate: {
            path: "user",
          },
        },
      })
      .populate({
        path: "activeauction",
        populate: {
          path: "winner",
        },
      })
      .populate("raisedHands", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "roomuid",
        "agorauid",
      ])
      .populate("speakerIds", [
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
      ])
      .populate("invitedIds", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "roomuid",
        "agorauid",
      ])
      .populate({
        path: "productIds",

        populate: {
          path: "ownerId",

          populate: {
            path: "shopId",
          },
        },
      })
      .populate("shopId")
      .populate("ownerId", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "roomuid",
        "agorauid",
      ]);

    if (room == null) {
      res.status(200).setHeader("Content-Type", "application/json").json(null);
    } else {
      if (room["ended"] == false) {
        res
          .status(200)
          .setHeader("Content-Type", "application/json")
          .json(null);
      } else {
        res
          .status(200)
          .setHeader("Content-Type", "application/json")
          .json(room);
      }
    }
  } catch (error) {
    console.log(error);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.deleteRoomById = async (req, res) => {
  let { destroy } = req.query;
  try {
    if (destroy == "true") {
      let updatedRoom = await roomsModel.findByIdAndDelete(req.params.roomId);
      await products.updateMany(
        { tokshow: req.params.roomId },
        { $set: { tokshow: null } }
      );

      res
        .status(200)
        .setHeader("Content-Type", "application/json")
        .json(updatedRoom);
    } else {
      let updatedRoom = await roomsModel.findByIdAndUpdate(
        req.params.roomId,
        {
          $set: {
            ended: true,
            endedTime: Date.now(),
            $pullAll: { viewers: [] },
          },
        },
        { ended: true },
        { new: true }
      );
      
        await products.updateMany(
          { tokshow: req.params.roomId },
          { $set: { tokshow: null } }
        );
      

      if (updatedRoom.activeauction) {
        await auctionModel.findByIdAndUpdate(updatedRoom.activeauction, {
          $set: {
            ended: true,
          },
        });
      }

      res
        .status(200)
        .setHeader("Content-Type", "application/json")
        .json(updatedRoom);
    }
  } catch (error) {
    console.log("Error deleting room " + error);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.roomStats = async (req, res)=>{
  // total shows, live shows, upcoming shows
  let total = await roomsModel.countDocuments({ended: false})
  let live = await roomsModel.countDocuments({ended: false, started: true})
  let upcoming = await roomsModel.countDocuments({ended: false, activeTime: {$lt: Date.now()}})
  let recentshows = await roomsModel.find({ended:false, activeTime: {$lt: Date.now()}}).populate("owner", "userName profilePhoto").sort({date: 1}).limit(5)
  res.status(200).setHeader("Content-Type", "application/json").json({total, live, upcoming,recentshows})

}