const giveAway = require("../models/giveaway");
const userModel = require("../models/user");
const mongoose = require("mongoose");
const { ObjectId } = mongoose.Types;

const createGiveaway = async (req, res) => {
  try {
    console.log(req.body);
    let { quantity } = req.body;
    let giveawayids = [];
    for (let i = 0; i < quantity; i++) {
      req.body.quantity = 1;
      req.body.name = req.body.name;
      req.body.reference = i+1;
      let gaw = await giveAway.create(req.body);
      giveawayids.push(gaw._id);
    }
    console.log(giveawayids);

    res.status(200).json({ data: giveawayids, success: true });
  } catch (error) {
    console.log(error); 
    res.status(400).json({ error: error.message });
  } 
};  
const getGiveawayById = async (req, res) => {
  try {
    const { giveawayId } = req.params;
    const giveaway = await giveAway
      .findById(giveawayId)
      .populate("category")
      .populate("user")
      .populate("participants")
      .populate("shipping_profile")
      .populate("tokshow", "title");
    res.status(200).json(giveaway);
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
};
const getGiveaways = async (req, res) => {
  let { page, limit, room, status = "", type ="seller" } = req.query;
  console.log(req.query);
  let filter = {};
  if(status){
    filter.status = status;
  }
  if(type){
    filter.type = type;
  }
  if(room){
    filter.tokshow = room;
  }
  page = parseInt(page) || 1;
  limit = parseInt(limit) || 10;
  const totalDocuments = await giveAway.countDocuments(filter);
  const totalPages = Math.ceil(totalDocuments / limit);
  const giveaways = await giveAway
    .find(filter)
    .populate("category")
    .populate("user")
    .populate("participants")
    .populate("shipping_profile")
    .populate("tokshow", "title")
    .populate("winner", "userName profilePhoto")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
  res.status(200).json({
    giveaways,
    totalDocuments,
    totalPages,
  });
};
const joinGiveaway = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    const giveaway = await giveAway.findById(id);
    if (!giveaway) {
      return res.status(404).json({ error: "Giveaway not found" });
    }
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    //remove if exists
    if(giveaway.participants.includes(userId)){
      giveaway.participants.pull(new ObjectId(userId));
    }else{
      giveaway.participants.push(new ObjectId(userId));
    }
    await giveaway.save();
    res.status(200).json(giveaway);
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
};
const bookmarkGiveaway = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    console.log(id, userId);
    // if user exists in bookmarks, remove userId from bookmarks
    const giveaway = await giveAway.findById(id);
    if (!giveaway) {
      return res.status(404).json({ error: "Giveaway not found" });
    }
    if (giveaway.bookmarks.includes(userId)) {
      giveaway.bookmarks.pull(userId);
    } else {
      giveaway.bookmarks.push(userId);
    }
    await giveaway.save();
    res.status(200).json(giveaway);


  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
}
const endGiveaway = async (req, res) => {
  try {
    const { giveawayId } = req.params;
    const giveaway = await giveAway.findById(giveawayId);
    if (!giveaway) {
      return res.status(404).json({ error: "Giveaway not found" });
    }
    giveaway.status = "ended";
    await giveaway.save();
    res.status(200).json(giveaway);
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
};
const updateGiveaway = async (req, res) => {
  try {
    const data = req.body;
    const { id } = req.params;
    const giveaway = await giveAway.findOneAndUpdate(
      { _id: id },
      { $set: data },
      { new: true }
    );
    res.status(200).json({ data: giveaway, success: true });
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
};
const bulkUpdateGiveaway = async (req, res) => {
  let { ids, updates } = req.body;

  try {
    let response = await giveAway.updateMany(
      { _id: { $in: ids } },   // filter
      { $set: updates }               // update
    );
    res
      .status(200)
      .json(response); 
  } catch (error) {
    console.log(error);
    res
      .status(422)
      .json({ error: error.message });
  }
};
const deleteGiveaway = async (req, res) => {
  try {
    const { id } = req.params;
    const giveaway = await giveAway.findByIdAndDelete(id);
    res.status(200).json(giveaway);
  } catch (error) {
    console.log(error);
    res.status(400).json({ error: error.message });
  }
};
module.exports = {
  createGiveaway,
  getGiveaways,
  joinGiveaway,
  endGiveaway,
  updateGiveaway,
  deleteGiveaway,
  getGiveawayById,bulkUpdateGiveaway,bookmarkGiveaway
};
