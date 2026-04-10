const roomsModel = require("../models/room");
const bidModel = require("../models/bid");
const product = require("../models/product");
var auctionModel = require("../models/auction");
const { getAuctionPopulateOptions, bid } = require("../shared/functions");

exports.getAuctions = async (req, res, next) => {
  let { tokshow, status, page = 1, limit = 15 } = req.query;
  let filter = {};
  if (tokshow) {
    filter = { tokshow };
  }
  if (status == "active") {
    filter.ended = false;
  }
  const pages = Number(page);
  const limits = Number(limit);
  const skip = (pages - 1) * limits;
  // pgination
  const totalDoc = await auctionModel.countDocuments(filter);
  const populateOptions = await getAuctionPopulateOptions();
  let auctions = await auctionModel
    .find(filter)
    .populate(populateOptions)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limits);
  res.send({
    auctions,
    totalDoc,
    limits,
    pages,
  });
};

exports.createAuction = async (req, res, next) => {
  let auctionresponse = await auctionModel.create(req.body);
  await roomsModel.findByIdAndUpdate(
    req.body.tokshow,
    { $addToSet: { auctions: auctionresponse?.id } },
    { runValidators: true, new: true }
  );
  await product.findByIdAndUpdate(
    req.body.product,
    { $set: { auction: auctionresponse?.id } },
    { runValidators: true, new: true }
  );
  const populateOptions = await getAuctionPopulateOptions();
  let auction = await auctionModel
    .findById(auctionresponse?.id)
    .populate(populateOptions);
  res.json(auction);
};

exports.updateAuction = async (req, res, next) => {
  console.log(req.body, req.params.id);
  if (req.body?.pinned == true) {
    await roomsModel.findByIdAndUpdate(
      req.body.tokshow,
      { $set: { activeauction: req.params.id } },
      { runValidators: true, new: true }
    );
  }
  const populateOptions = await getAuctionPopulateOptions();
  let auction = await auctionModel
    .findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { runValidators: true, new: true }
    )
    .populate(populateOptions);

  res.json(auction);
};

exports.getAuctionsByRoom = async (req, res, next) => {
  const populateOptions = await getAuctionPopulateOptions();
  let auctions = await auctionModel
    .find({ tokshow: req.params.roomid })
    .populate(populateOptions);
  res.json(auctions);
};

exports.getActiveAuctionByRoom = async (req, res, next) => {
  const populateOptions = await getAuctionPopulateOptions();
  let auctions = await auctionModel
    .findOne({ tokshow: req.params.roomid, ended: false })
    .populate(populateOptions);
  res.json(auctions);
};

exports.bid = async (req, res, next) => {
  try {
    let { user, auction, amount, custom_bid =false } = req.body;

    const query = { user, auction };
    const update = { $set: { amount, auction, user,custom_bid } };
    const options = { upsert: true, new: true };

    let newPrice = amount + 1;

    let response = await bid(query, update, options, auction, amount);
    console.log(response)
    if (!response) return res.status(400).json({ error: "Bid failed" });

    response.newbaseprice = newPrice;
    await response.save();

    return res.json(response);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to place bid" });
  }
};
exports.getAuction = async (req, res, next) => {
  console.log(req.params.id);
  let auction = await auctionModel
    .findById(req.params.id)
    .populate("product")
    .populate("bids");
  res.json(auction);
};
exports.updateBid = async (req, res, next) => {
  let data = req.body;
  console.log(data);
  let { amount, user, autobid, autobidamount, auction } = data;
  
  if(autobid){
    data.amount = 0;
  }
  let response = await bidModel.findOneAndUpdate(
    { auction: req.params.id, user: req.body.user },
    { $set: data },
    { upsert: true, new: true }
  );
  await auctionModel.findByIdAndUpdate(
    req.params.id,
    {
      $addToSet: {
        bids: response._id,
      },
    },
    { runValidators: true, new: true }
  );
  console.log(response);
  res.json({ bid: true });
};

exports.deleteAuction = async (req, res, next) => {
  await auctionModel.findByIdAndDelete(req.params.id).then((auction) => {
    res.json(auction);
  });
};
