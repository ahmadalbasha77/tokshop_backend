const Offer = require("../models/offer");
const Product = require("../models/product");
const mongoose = require("mongoose");
const functions = require("../shared/functions"); 
const socketEmitter = require("../shared/socketEmitter");

/**
 * CREATE OFFER
 */
const addOffer = async (req, res) => {
  console.log(req.body);
  try {
    const { product, subtotal } = req.body;
    // check if product has qty
    const productData = await Product.findById(product);
    if (productData.quantity < req.body.quantity) {
      return res.status(400).json({ error: "Product out of stock", success: false });
    }
    const offer = await Offer.create({...req.body, offeredPrice: subtotal, status: 'pending'});
    console.log(offer);
    if(offer?.tokshow?.toString()){
      socketEmitter.emitTo(offer?.tokshow?.toString(), "fetch_offers", offer);
    }
    let populatedoffer = await offer.populate([
      {
            path: "buyer",
            select: "userName"
          },
      {
            path: "seller",
            select: "fcmToken"
          },
      {
            path: "product",
            select: "name"
          },
    ])
    functions.sendNotification(
      [populatedoffer?.seller?.fcmToken],
      "New offer",
      "You have a new offer from "+populatedoffer?.buyer?.userName,
      {
        id: populatedoffer?.product?._id.toString(),
        screen: "OfferDetails"
      }
    );
    await Product.findByIdAndUpdate(
      product,
      {
        $inc: { offersCount: 1 },
        $addToSet: { offers: offer._id }
      }, 
      { new: true }
    );

    return res.status(201).json({ message: "Offer created", offer, success: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Failed", error: error.message });
  }
};
const offerById = async (req, res) =>{
  const id = req.params.id;
  const offer = await Offer.findById(id).populate("product", "name images price").populate("buyer", "userName profilePhoto fcmToken").populate("seller", "userName profilePhoto fcmToken")
  return res.json(offer);
}
/**
 * COUNTER OFFER
 */
const counterOffer = async (req, res) => {
  try {
    console.log(req.body);
    const { offerId, counterPrice } = req.body;

    const offer = await Offer.findByIdAndUpdate(
      offerId,
      {
        counterPrice,
        status: "countered",
        counteredAt: new Date(),
      },
      { new: true }
    ).populate("product", "name").populate("buyer", "userName profilePhoto fcmToken").populate("seller", "userName profilePhoto fcmToken");
    if(counterPrice == 0) {
      functions.sendNotification(
        [offer?.buyer?.fcmToken],
        "Offer Rejected",
        "Counter offer rejected from "+offer?.seller?.userName,
        "",
        {
          id: offer?._id.toString(),
          screen: "OfferScreen",
          type:"counter_offer"
        }
      );
    }else{
      console.log(offer?.buyer?.fcmToken);
      functions.sendNotification(
        [offer?.buyer?.fcmToken],
        "Counter offer",
        "Counter offer from "+offer?.seller?.userName,
        {
          id: offer?._id.toString(),
          screen: "OfferScreen",
          type:"counter_offer"
        }
      );
    }

    return res.json({ message: "Counter offer added", offer , success: true});
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Failed", error: error.message });
  }
};

/**
 * ACCEPT OFFER
 */
const acceptOffer = async (req, res) => {
  try {
    const { offerId, usertype = "buyer" } = req.body;
    const offer = await Offer.findById(offerId)
      .populate("product")
      .populate("buyer")
      .populate("seller");

    if (!offer) return res.status(404).json({ message: "Offer not found" });

    // If seller countered and buyer accepted, use counterPrice
    if (offer.counterPrice) {
      offer.offeredPrice = offer.counterPrice;
      offer.counterPrice = null;
    }

    offer.status = "accepted";
    offer.acceptedAt = new Date();
    await offer.save();

    /**
     *  🔹 CREATE ORDER HERE
     */
    const {
      success,
      error,
      newOrder,
      newItem,
      seller: se,
      buyer: by,
      productres
    } = await functions.createOrder({
      buyer: offer.buyer._id,
      product: offer.product._id, 
      quantity: 1, // change if your app supports selecting quantity
      subtotal: offer.offeredPrice,
      seller: offer.seller._id,
      tax: offer.tax || 0,
      tokshow: offer.tokshow, // set if from show
      shippingFee: offer.shippingFee || 0,
      rate_id: offer.rate_id,
      servicelevel: offer.servicelevel,
      totalWeightOz: offer.totalWeightOz,
      seller_shipping_fee_pay: offer.seller_shipping_fee_pay,
      bundleId: offer?.bundleId,
      ordertype : "offer"
    });

    if (!success) {
      console.log(error);
      return res.status(400).json({ success, message: error?.error || "Failed to create order" });
    }

    if (success) {
      await Product.findByIdAndUpdate(
        offer.product._id,
        {
          $pull: { offers: offer._id },
          $inc: { offersCount: -1 }
        }
      );
    }

    // Optionally notify both users
    functions.saveActivity(
      newOrder._id,
      "New order from accepted offer",
      "OrderScreen",
      false,
      null,
      offer.seller._id,
      `${offer.buyer.userName} accepted your offer`
    );

    functions.saveActivity(
      newOrder._id,
      "Order created through offer acceptance",
      "OrderScreen",
      false,
      null,
      offer.buyer._id,
      `You purchased ${offer.product.name} from ${offer.seller.userName}`
    );

    if (offer?.tokshow?.toString()) { 
      let message = "You have a new order from " + offer.buyer.userName
      socketEmitter.emitTo(offer?.tokshow?.toString(), "marketplace_order", { msg: message});
      socketEmitter.emitTo(offer?.tokshow?.toString(), "fetch_offers", offer);
    }
    if(usertype == "buyer"){
      functions.sendNotification(
        [offer.seller.fcmToken],
        "Offer Accepted",
        `${offer.buyer.userName} accepted your offer`,
        {
          id: newOrder._id.toString(),
          screen: "OrderScreen",
        }
      );
    }

    if(usertype == "seller"){
      functions.sendNotification(
        [offer.buyer.fcmToken],
        "Offer Accepted",
        `${offer.seller.userName} accepted your offer`,
        {
          id: newOrder._id.toString(),
          screen: "OrderScreen",
        }
      );
    }

    console.log("productres ",productres)

    if(productres?.quantity == 0){
      const rejectedOffers = await Offer.find({
        product: offer.product._id,
        _id: { $ne: offer._id },
        status: { $ne: "rejected" },
      }).populate("buyer", "userName fcmToken");

      await Offer.updateMany(
        {
          product: offer.product._id,
          _id: { $ne: offer._id },
          status: { $ne: "rejected" },
        },
        {
          $set: { status: "rejected", rejectedAt: new Date() }
        }
      );

      rejectedOffers.forEach((o) => {
        if (o?.buyer?.fcmToken) {
          functions.sendNotification(
            [o.buyer.fcmToken],
            "Offer Update",
            `Your offer for ${offer.product.name} was rejected because the item sold out.`,
            {
              id: offer.product._id.toString(),
              screen: "ProductScreen",
            }
          );
        }
      });
    }

    return res.json({
      message: "Offer accepted — order created",
      offer,
      newOrder,
      success: true,
    });

  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Failed", error: error.message });
  }
};


/**
 * REJECT OFFER
 */
const rejectOffer = async (req, res) => {
  console.log("rejectOffer ", req.body)
  // try {
    const { offerId,usertype } = req.body;

   const offer = await Offer.findByIdAndUpdate(
      offerId,
      {
        status: "rejected",
        rejectedAt: new Date()
      },
      { new: true }
    ).populate("product", "name").populate("buyer", "userName profilePhoto fcmToken").populate("seller", "userName profilePhoto fcmToken");
    await Product.findByIdAndUpdate({_id: offer?.product?._id},{$inc: { offersCount: -1 }})
    console.log(offer);
    if(offer?.tokshow?.toString()){
      socketEmitter.emitTo(offer?.tokshow?.toString(), "fetch_offers", offer);
    }

    if(offer?.tokshow?.toString()){
      socketEmitter.emitTo(offer?.tokshow?.toString(), "fetch_offers", offer);
    }
    if(usertype == "buyer"){
      functions.sendNotification(
        [offer.seller.fcmToken],
        "Offer Rejected",
        `${offer.buyer.userName} rejected your offer`,
        {
          id: offer._id.toString(),
          screen: "UserOfferDetails",
          "type":"user_offer"
        }
      );
    }

    if(usertype == "seller"){
      functions.sendNotification(
        [offer.buyer.fcmToken],
        "Offer Rejected",
        `${offer.seller.userName} rejected your offer`,
        {
          id: offer._id.toString(),
          screen: "UserOfferDetails",
        }
      );
    }
 
    return res.json({ message: "Offer rejected", offer });
  // } catch (error) {
  //   console.log(error);
  //   return res.status(500).json({ message: "Failed", error: error.message });
  // }
};
const cancelOffer = async (req, res) => {
  try {
    const { offerId , usertype} = req.body;
    const offer = await Offer.findByIdAndUpdate(offerId, { status: "rejected", cancelledAt: new Date() }, { new: true }).populate("product", "name").populate("buyer", "userName profilePhoto fcmToken").populate("seller", "userName profilePhoto fcmToken");


    if(usertype == "buyer"){
      functions.sendNotification(
        [offer.seller.fcmToken],
        "Offer Rejected",
        `${offer.buyer.userName} rejected your offer`,
        {
          id: offer._id.toString(),
          screen: "OfferScreen",
        }
      );
    }

    if(usertype == "seller"){
      functions.sendNotification(
        [offer.buyer.fcmToken],
        "Offer Rejected",
        `${offer.seller.userName} rejected your offer`,
        {
          id: offer._id.toString(),
          screen: "OfferScreen",
        }
      );
    }

    return res.json({ message: "Offer cancelled", offer, success: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Failed", error: error.message });
  }
};

/**
 * LIST PRODUCTS WITH OFFERS (FILTER BY TOKSHOW)
 */
const listProductsWithOffers = async (req, res) => {
  try {
    let { tokshowId, user, role } = req.query;
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    let skip = (page - 1) * limit;

    if (role === "seller") {
      let filter = {};
      if (tokshowId) filter.tokshow = tokshowId;
      if (user) filter = { ownerId: user, offer: true, offersCount: { $gt: 0 } };

      // total before pagination
      const total = await Product.countDocuments(filter);

      let products = await Product.find(filter)
        .populate({
          path: "offers",
          match: { status: { $nin: ["rejected"] } },
          populate: [
            { path: "buyer", select: "userName profilePhoto" },
            { path: "seller", select: "userName profilePhoto" },
            { path: "product", select: "name images price" }
          ],
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      // ensure only products having offers
      const filtered = products.filter(p => p.offers && p.offers.length > 0);

      return res.json({
        message: "Products with offers fetched",
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        },
        products: filtered
      });

    } else if (role === "buyer") {
      const offerFilter = { buyer: user };
      const total = await Offer.countDocuments(offerFilter);

      const offers = await Offer.find(offerFilter)
        .populate("product", "name images price")
        .populate("seller", "userName profilePhoto")
        .populate("buyer", "userName profilePhoto")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit);

      return res.json({
        message: "Offers fetched",
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        },
        offers
      });

    } else {
      return res.status(400).json({ error: "role must be buyer or seller" });
    }

  } catch (error) {
    return res.status(500).json({
      message: "Failed",
      error: error.message
    });
  }
};





module.exports = {
  addOffer,
  counterOffer,
  acceptOffer,
  rejectOffer,
  listProductsWithOffers,cancelOffer,
  offerById
};
