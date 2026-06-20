const mongoose = require("mongoose");
const Auction = require("../models/auction");
const Giveaway = require("../models/giveaway");
const Product = require("../models/product");
const Room = require("../models/room");
const User = require("../models/user");
const ThemeSettings = require("../models/themes");
const { sanitizeText, shareResponse } = require("../shared/publicShare");

function invalidId(res) {
  return res.status(400).json({ success: false, message: "Invalid ID" });
}

function notFound(res) {
  return res.status(404).json({ success: false, message: "Share item not found" });
}

function validPublicUser(user) {
  return Boolean(
    user &&
      !user.accountDisabled &&
      !user.system_blocked &&
      !user.suspended
  );
}

function validPublicProduct(product) {
  return Boolean(
    product &&
      product.deleted !== true &&
      product.status === "active" &&
      product.available !== false &&
      (!product.reserved || product.reserved === "public")
  );
}

function formatMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return `${amount.toFixed(2)} ${sanitizeText(currency || "USD", 8).toUpperCase()}`;
}

function handler(load) {
  return async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return invalidId(res);

    try {
      const payload = await load(req.params.id);
      if (!payload) return notFound(res);
      return res.status(200).json(payload);
    } catch (error) {
      console.error("Public share endpoint error:", error);
      return res.status(500).json({
        success: false,
        message: "Unable to load share data",
      });
    }
  };
}

exports.live = handler(async (id) => {
  const room = await Room.findById(id)
    .select("_id title description thumbnail status started ended roomType owner")
    .populate("owner", "userName firstName lastName accountDisabled system_blocked suspended")
    .lean();

  if (!room || room.roomType === "private" || room.status === false || !validPublicUser(room.owner)) {
    return null;
  }

  const host =
    room.owner.userName ||
    [room.owner.firstName, room.owner.lastName].filter(Boolean).join(" ");
  const state = room.ended ? "ended" : room.started ? "live" : "upcoming";
  return shareResponse(
    "live",
    room._id,
    room.title || `Live with ${host}`,
    `${host ? `Hosted by ${host}. ` : ""}Status: ${state}. ${room.description || ""}`,
    room.thumbnail
  );
});

exports.product = handler(async (id) => {
  const product = await Product.findById(id)
    .select("_id name description images price discountedPrice status available deleted reserved")
    .lean();

  if (!validPublicProduct(product)) return null;
  const price = product.discountedPrice > 0 ? product.discountedPrice : product.price;
  return shareResponse(
    "product",
    product._id,
    product.name,
    `${formatMoney(price, "USD")}. ${product.description || ""}`,
    product.images
  );
});

exports.profile = handler(async (id) => {
  const user = await User.findById(id)
    .select("_id userName firstName lastName profilePhoto bio accountDisabled system_blocked suspended")
    .lean();

  if (!validPublicUser(user)) return null;
  const name = user.userName || [user.firstName, user.lastName].filter(Boolean).join(" ");
  return shareResponse("profile", user._id, name || "Stealz profile", user.bio, user.profilePhoto);
});

exports.auction = handler(async (id) => {
  const auction = await Auction.findOne({
    $or: [{ _id: id }, { product: id }],
  })
    .select("_id product tokshow higestbid newbaseprice baseprice started ended endTime end_time_date")
    .populate("product", "_id name images status available deleted reserved")
    .populate("tokshow", "_id roomType status")
    .lean();

  if (
    !auction ||
    !validPublicProduct(auction.product) ||
    auction.tokshow?.roomType === "private" ||
    auction.tokshow?.status === false
  ) {
    return null;
  }

  const price = auction.higestbid || auction.newbaseprice || auction.baseprice;
  const state = auction.ended ? "ended" : auction.started ? "live" : "scheduled";
  return shareResponse(
    "auction",
    auction._id,
    auction.product.name,
    `Auction ${state}. ${formatMoney(price, "USD")}`,
    auction.product.images
  );
});

exports.giveaway = handler(async (id) => {
  const giveaway = await Giveaway.findById(id)
    .select("_id name description images status startedtime endedtime tokshow user")
    .populate("tokshow", "_id roomType status")
    .populate("user", "_id accountDisabled system_blocked suspended")
    .lean();

  if (
    !giveaway ||
    ["deleted", "private"].includes(giveaway.status) ||
    giveaway.tokshow?.roomType === "private" ||
    giveaway.tokshow?.status === false ||
    (giveaway.user && !validPublicUser(giveaway.user))
  ) {
    return null;
  }

  const ending = giveaway.endedtime
    ? ` Ends ${new Date(giveaway.endedtime).toISOString()}.`
    : "";
  return shareResponse(
    "giveaway",
    giveaway._id,
    giveaway.name || "Stealz giveaway",
    `${giveaway.status || "active"}.${ending} ${giveaway.description || ""}`,
    giveaway.images
  );
});

exports.invite = handler(async (id) => {
  const inviter = await User.findById(id)
    .select("_id accountDisabled system_blocked suspended")
    .lean();
  if (!validPublicUser(inviter)) return null;

  const theme = await ThemeSettings.findOne({}).select("app_name seo_title app_logo").lean();
  const appName = theme?.app_name || theme?.seo_title || "Stealz";
  return shareResponse(
    "invite",
    inviter._id,
    `Join ${appName}`,
    `Join ${appName} to discover live shopping, auctions, products, and giveaways.`,
    theme?.app_logo
  );
});
