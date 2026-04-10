var mongoose = require("mongoose");
var productModel = require("../models/product");
const reviewModel = require("../models/reviews");
const auctionModel = require("../models/auction");
const roomsModel = require("../models/room");
const userModel = require("../models/user");
const socketEmitter = require("../shared/socketEmitter");

exports.searchAll = async (req, res) => {
  try {
    const { q, page = 1, limit = 10, type, started, ended, reducedShipping, freeShipping } = req.query;

    if (!q) {
      return res.status(400).json({ message: "Search query is required" });
    }
    console.log(req.query)

    const skip = (page - 1) * limit;
    const regexQuery = { $regex: q, $options: "i" };

    // Base pagination object
    const pagination = { page: Number(page), limit: Number(limit) };

    let results = {};

    // --- PRODUCTS ---
    if (!type || type === "products") {
      const [products, totalProducts] = await Promise.all([
        productModel
          .find({
            name: regexQuery,
            deleted: false,
            listing_type: "buy_now",
            quantity: { $gt: 0 },
            featured: true
          })
          .populate("ownerId", "userName profilePhoto")
          .populate("category")
          .skip(skip)
          .limit(Number(limit)),

        productModel.countDocuments({
          name: regexQuery,
          deleted: false,
          listing_type: "buy_now",
          quantity: { $gt: 0 },
          featured: true
        }),
      ]);

      results.products = {
        total: totalProducts,
        pages: Math.ceil(totalProducts / limit),
        data: products,
      };
    }

    // --- SHOWS / ROOMS ---
    if (!type || type === "shows") {
      // Build dynamic filter for rooms
      const roomFilter = {
        title: regexQuery,
      };

      // Handle started/ended filters
      if (started === "true") roomFilter.started = true;
      if (started === "false") roomFilter.started = false;
      roomFilter.ended = false;
      roomFilter.roomType = "public"
      // Shipping filters (applied if provided)
      if (reducedShipping === "true") {
        roomFilter["shipping_settings.reducedShippingCapAmount"] = { $gt: 0 };
      }
      if (freeShipping === "true") {
        roomFilter["shipping_settings.shippingCostMode"] = "seller_pays";
      }
      console.log(roomFilter)

      const [rooms, totalRooms] = await Promise.all([
        roomsModel
          .find(roomFilter)
          .populate("owner", "userName profilePhoto")
          .populate("category")
          .skip(skip)
          .limit(Number(limit)),

        roomsModel.countDocuments(roomFilter),
      ]);

      results.shows = {
        total: totalRooms,
        pages: Math.ceil(totalRooms / limit),
        data: rooms,
      };
    }

    // --- USERS ---
    if (!type || type === "users") {
      const [users, totalUsers] = await Promise.all([
        userModel
          .find({
            $or: [
              { firstName: regexQuery },
              { lastName: regexQuery },
              { userName: regexQuery },
            ],
            system_blocked: false,
          })
          .skip(skip)
          .limit(Number(limit)),

        userModel.countDocuments({
          $or: [
            { firstName: regexQuery },
            { lastName: regexQuery },
            { userName: regexQuery },
          ],
          system_blocked: false,
        }),
      ]);

      results.users = {
        total: totalUsers,
        pages: Math.ceil(totalUsers / limit),
        data: users,
      };
    }

    // --- RESPONSE ---
    res.status(200).json({
      query: q,
      pagination,
      results,
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ message: "Server error during search" });
  }
};


exports.getProducts = async (req, res) => {
  try {
    const {
      title,
      status,
      price,
      page = 1,
      limit = 10,
      userid,
      featured,
      roomid,
      category,
      saletype, type, out_of_stock
    } = req.query;

    const pages = Number(page);
    const limits = Number(limit);
    const skip = (pages - 1) * limits;

    let sortPrice;
    if (price === "Low") sortPrice = 1;
    else if (price === "High") sortPrice = -1;

    // -----------------------
    // Base match query
    // -----------------------
    const baseMatch = {
      deleted: { $ne: true },
      ownerId: { $ne: null },
      ...(title && { name: { $regex: title, $options: "i" } }),
      ...(category && { category: new mongoose.Types.ObjectId(category) }),
      ...(userid && { ownerId: new mongoose.Types.ObjectId(userid) }),
      ...(featured === 'true' && { featured: true }),
      ...(saletype && { listing_type: saletype }),
      ...(roomid && { tokshow: new mongoose.Types.ObjectId(roomid) }),
      // $or: [
      //   ...(type !== "inventory" ? { reserved: "public" } : []),
      //   { reserved: { $exists: false } },
      //   ...(roomid
      //     ? [{ reserved: "private", tokshow: new mongoose.Types.ObjectId(roomid) }]
      //     : []),
      // ],
      ...(type == "inventory" && { featured: { $in: [true, false] } }),
    };
    if (status === "out_of_stock") {
      baseMatch.quantity = { $eq: 0 };
    } else if (status === "inactive") {
      baseMatch.$or = [
        { status: "inactive" },
        { quantity: { $eq: 0 } },
      ];
    } else if (status === "active") {
      baseMatch.status = "active";
      baseMatch.quantity = { $gt: 0 };
    }
    if (saletype == 'buy_now' && roomid) {
      baseMatch.quantity = { $gt: 0 };
    }

    console.log(baseMatch)

    // -----------------------
    // Pipeline for data
    // -----------------------
    const pipeline = [
      { $match: baseMatch },
      {
        $lookup: {
          from: "auctions",
          localField: "auction",
          foreignField: "_id",
          as: "auction",
        },
      },
      { $unwind: { path: "$auction", preserveNullAndEmptyArrays: true } },
      ...(roomid
        ? [{
          $match: {
            $or: [
              { "auction.type": { $ne: "scheduled" } },
              { auction: null }
            ]
          }
        }]
        : []),
      ...(saletype === "auction" && type != "scheduled"
        ? [
          {
            $match: {
              quantity: { $gt: 0 }
            },
          },
        ]
        : []),
      ...(saletype === "auction" && type === "scheduled"
        ? [
          {
            $match: {
              auction: { $ne: null },
              "auction.ended": false,
              $or: [
                { "auction.start_time_date": { $gt: 0 } },
                { "auction.end_time_date": { $gt: 0 } },
              ],
              quantity: { $gt: 0 },
            },
          },
        ]
        : []),
      // 👇 Lookup bids for each auction
      {
        $lookup: {
          from: "bids",
          localField: "auction._id",
          foreignField: "auction",
          as: "auction.bids",
        },
      },

      // 👇 Populate user inside each bid (only _id and userName)
      {
        $lookup: {
          from: "users",
          let: { userIds: "$auction.bids.user" },
          pipeline: [
            { $match: { $expr: { $in: ["$_id", "$$userIds"] } } },
            { $project: { _id: 1, userName: 1 } },
          ],
          as: "bidUsers",
        },
      },

      // 👇 Merge user info into each bid
      {
        $addFields: {
          "auction.bids": {
            $map: {
              input: "$auction.bids",
              as: "bid",
              in: {
                $mergeObjects: [
                  "$$bid",
                  {
                    user: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$bidUsers",
                            as: "bu",
                            cond: { $eq: ["$$bu._id", "$$bid.user"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
      // 👇 Lookup the winning user by auction.winner (store in winningUser)
      {
        $lookup: {
          from: "users",
          localField: "auction.winner",
          foreignField: "_id",
          as: "auction.winning",
        },
      },
      {
        $addFields: {
          "auction.winning": {
            $let: {
              vars: { w: { $arrayElemAt: ["$auction.winning", 0] } },
              in: {
                $cond: [
                  { $ifNull: ["$$w", false] }, // if winner exists
                  { _id: "$$w._id", userName: "$$w.userName" },
                  null // else return null
                ]
              }
            }
          }
        }
      },

      { $sort: price ? { price: sortPrice } : { _id: -1 } },
      { $skip: skip },
      { $limit: limits },
      // populate alternatives for aggregation
      {
        $lookup: {
          from: "users",
          localField: "ownerId",
          foreignField: "_id",
          as: "ownerId",
        },
      },
      { $unwind: "$ownerId" },
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "shipping_profiles", // Note: adjust collection name if different
          localField: "shipping_profile",
          foreignField: "_id",
          as: "shipping_profile",
        },
      },
      { $unwind: { path: "$shipping_profile", preserveNullAndEmptyArrays: true } },
    ];

    // -----------------------
    // Pipeline for total count
    // -----------------------
    const countPipeline = [
      { $match: baseMatch },
      {
        $lookup: {
          from: "auctions",
          localField: "auction",
          foreignField: "_id",
          as: "auction",
        },
      },
      { $unwind: { path: "$auction", preserveNullAndEmptyArrays: true } },
      ...(roomid
        ? [{
          $match: {
            $or: [
              { "auction.type": { $ne: "scheduled" } },
              { auction: null }
            ]
          }
        }]
        : []),
      ...(saletype === "auction" && type !== "scheduled"
        ? [{ $match: { quantity: { $gt: 0 } } }]
        : []),

      ...(saletype === "auction" && type === "scheduled"
        ? [{
          $match: {
            auction: { $ne: null },
            "auction.ended": false,
            $or: [
              { "auction.start_time_date": { $gt: 0 } },
              { "auction.end_time_date": { $gt: 0 } },
            ],
            quantity: { $gt: 0 },
          }
        }]
        : []),

      { $count: "totalDoc" },
    ];

    // -----------------------
    // Run both queries
    // -----------------------
    const [products, countResult] = await Promise.all([
      productModel.aggregate(pipeline),
      productModel.aggregate(countPipeline),
    ]);

    const totalDoc = countResult.length > 0 ? countResult[0].totalDoc : 0;

    res.json({
      products,
      totalDoc,
      limits,
      pages,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.productQtyCheck = async (req, res) => {
  let product = await productModel.findById(req.body.productId);
  if (product.quantity < req.body.quantity) {
    return res.send({ status: false, qty: product.quantity });
  }
  return res.send({ status: true, qty: product.quantity });
};
exports.deleteProductReviewsById = async (req, res) => {
  try {
    let deleted = await reviewModel.findOneAndRemove(req.params.id);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: deleted });
  } catch (error) {
    console.log(error);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.getProductReviewsByUserId = async (req, res) => {
  try {
    let reviewresponse = await reviewModel
      .find({ userId: req.params.userId, product: req.params.id })
      .populate({
        path: "product",
      })
      .populate({
        path: "userId",
      })
      .populate("reviews");
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: reviewresponse });
  } catch (error) {
    console.log(error);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.getProductReviews = async (req, res) => {
  try {
    let reviewresponse = await reviewModel
      .find({ product: req.params.id })
      .populate({
        path: "product",
      })
      .populate({
        path: "userId",
      })
      .populate("reviews");
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: reviewresponse });
  } catch (error) {
    console.log(error);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.addProductReview = async (req, res) => {
  const review = {
    product: req.params.id,
    userId: req.body.userId,
    review: req.body.review,
    rating: req.body.rating,
  };

  try {
    let reviewresponse = await reviewModel.find({
      userId: req.body.userId,
      product: req.params.id,
    });
    if (reviewresponse.length > 0) {
      res.status(200).setHeader("Content-Type", "application/json").json({
        success: false,
        message: "You have already left a review for this product",
      });
    } else {
      let response = await reviewModel.create(review);
      let data = await reviewModel
        .findById(response._id)
        .populate("reviews")
        .populate({
          path: "userId",
        });
      await productModel.findByIdAndUpdate(
        req.params.id,
        {
          $addToSet: { reviews: response._id },
        },
        { runValidators: true, new: true, upsert: false }
      );
      res
        .status(200)
        .setHeader("Content-Type", "application/json")
        .json({ success: true, data });
    }
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.bulkAddProduct = async (req, res) => {
  let { products } = req.body;
  try {
    let response = await productModel.insertMany(products);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json(response);
  } catch (error) {
    console.log(error)
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.bulkUpdateProduct = async (req, res) => {
  let { productIds, updates } = req.body;

  try {
    let response = await productModel.updateMany(
      { _id: { $in: productIds } },   // filter
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
exports.addProduct = async (req, res) => {
  try {
    const {
      name,
      price,
      start_time_date,
      end_time_date,
      images,
      userId,
      description,
      category,
      discountedPrice,
      startingPrice,
      duration,
      sudden,
      colors,
      sizes,
      listing_type,
      tokshow,
      shipping_profile,
      featured,
      offer,
      flash_sale,
      flash_sale_discount_type,
      flash_sale_discount_value,
      flash_sale_buy_limit,
      flash_live_reserved,
      quantity,
      list_individually,
      started = false
    } = req.body;

    const baseProduct = {
      name,
      price,
      start_time_date,
      end_time_date,
      images,
      ownerId: userId,
      description,
      category: new mongoose.Types.ObjectId(category),
      discountedPrice,
      default_startprice: startingPrice,
      default_duration: duration,
      default_sudden: sudden,
      colors,
      sizes,
      listing_type,
      tokshow: tokshow || null,
      shipping_profile,
      featured,
      offer,
      order_reference_counter: 1,
      flash_sale,
      flash_sale_discount_type,
      flash_sale_discount_value,
      flash_sale_buy_limit,
      flash_live_reserved,
      flash_sale_duration: duration
    };

    /**
     * Helper: create product + auction (always product first)
     */
    const createProductWithAuction = async (productId) => {
      const product = await productModel.create({
        ...baseProduct,
        _id: productId,
        quantity: list_individually ? 1 : quantity
      });

      if (listing_type === "auction") {
        const auction = await auctionModel.create({
          baseprice: startingPrice,
          newbaseprice: startingPrice,
          duration,
          started,
          sudden,
          product: product._id,
          tokshow: tokshow || null,
          quantity: 1,
          start_time_date,
          end_time_date,
          type: featured ? "scheduled" : "show"
        });

        product.auction = auction._id;
        await product.save();
      }

      return product;
    };

    /**
     * CASE 1: NOT auction OR auction but NOT listed individually
     */
    if (listing_type !== "auction" || list_individually !== true) {
      const productId = new mongoose.Types.ObjectId();
      let product = await createProductWithAuction(productId);

      product = await product.populate([
        { path: "reviews" },
        {
          path: "ownerId",
          populate: [{ path: "payoutmethod" }, { path: "shipping" }]
        },
        { path: "shipping_profile" },
        {
          path: "auction",
          populate: [
            { path: "bids", populate: { path: "user", select: "firstName lastName" } },
            { path: "winner", select: "firstName lastName userName" },
            { path: "winning", select: "firstName lastName userName" }
          ]
        },
        { path: "category" }
      ]);

      return res.status(200).json({
        success: true,
        data: [productId],
        product
      });
    }

    /**
     * CASE 2: AUCTION + LIST INDIVIDUALLY
     */
    const ids = Array.from({ length: quantity }, () => new mongoose.Types.ObjectId());

    // Create FIRST product immediately (for UI)
    let product = await createProductWithAuction(ids[0]);

    product = await product.populate([
      { path: "reviews" },
      {
        path: "ownerId",
        populate: [{ path: "payoutmethod" }, { path: "shipping" }]
      },
      { path: "shipping_profile" },
      {
        path: "auction",
        populate: [
          { path: "bids", populate: { path: "user", select: "firstName lastName" } },
          { path: "winner", select: "firstName lastName userName" },
          { path: "winning", select: "firstName lastName userName" }
        ]
      },
      { path: "category" }
    ]);

    // Remove first ID (already created)
    const remainingIds = ids.slice(1);

    // Respond immediately
    res.status(200).json({
      success: true,
      data: remainingIds,
      product
    });

    /**
     * Background creation (safe, sequential, logged)
     */
    (async () => {
      for (const id of remainingIds) {
        try {
          const bgProduct = await createProductWithAuction(id);

          if (tokshow) {
            socketEmitter.emitTo(tokshow, "fetch_offers", bgProduct);
          }
        } catch (err) {
          console.error("Background product creation failed:", id, err);
        }
      }
    })();

  } catch (error) {
    console.error(error);
    return res.status(422).json({ success: false, message: error.message });
  }
};


exports.getProductById = async (req, res) => {
  try {
    let product = await productModel
      .findById(req.params.productId)
      .populate({
        path: "offers",
        match: { status: { $nin: ["rejected"] } },
        populate: [
          { path: "buyer", select: "userName profilePhoto" },
          { path: "seller", select: "userName profilePhoto" },
          { path: "product", select: "name images price" }
        ],
      })
      .populate("reviews")
      .populate({
        path: "ownerId",
        populate: {
          path: "payoutmethod",
        },
      })
      .populate("shipping_profile")
      .populate({
        path: "auction",
        populate: [
          {
            path: "bids",
            populate: {
              path: "user",
              select: "firstName lastName",
            },
          },
          {
            path: "winner",
            select: "firstName lastName userName",
          },
          {
            path: "winning",
            select: "firstName lastName userName",
          }
        ],
      })

      .populate({
        path: "ownerId",
        populate: {
          path: "shipping",
        },
      })
      .populate({
        path: "category",
      });
    res.status(200).setHeader("Content-Type", "application/json").json(product);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.createFavorite = async (req, res) => {
  try {
    await productModel.findByIdAndUpdate(req.body.productId, {
      $inc: { favoriteCount: 1 },
      $addToSet: { favorited: req.params.userId },
    });
    res.status(200).json({
      success: true,
      message: "Favorite created successfully.",
    });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.getFavorites = async (req, res) => {
  try {
    let product = await productModel
      .find({ favorited: req.params.userId })
      .populate("category")
      .populate("ownerId", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
      ])
      .populate("reviews");
    res.status(200).setHeader("Content-Type", "application/json").json(product);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.removeFavorite = async (req, res) => {
  try {
    await productModel.findByIdAndUpdate(req.body.productId, {
      $inc: { favoriteCount: -1 },
      $pull: { favorited: req.params.userId },
    });
    res.status(200).json({
      success: true,
      message: "Favorite removed successfully.",
    });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.updateProductById = async (req, res) => {
  if (req.body.variations) {
    req.body.variations = req.body.variations.split(",");
  }
  let newObj = req.body;
  newObj.tokshow = newObj.tokshow == "" ? null : newObj?.tokshow;
  const { started = false } = req.body;
  try {
    if (newObj?.listing_type == "auction") {
      newObj.default_startprice = newObj.startingPrice;
      newObj.price = newObj.startingPrice;
      await auctionModel.findByIdAndUpdate(
        newObj.auction,
        {
          $set: {
            baseprice: newObj.startingPrice,
            newbaseprice: newObj.startingPrice,
            start_time_date: req.body.start_time_date,
            end_time_date: req.body.end_time_date,
            type: req.body.featured == true ? "scheduled" : "show",
            duration: newObj.duration,
            sudden: newObj.sudden,
            quantity: newObj.quantity,
            tokshow: newObj.tokshow == "" ? null : req.body.tokshow,
            started: started
          },
        },
        { runValidators: true, new: true }
      );
      if (newObj.tokshow) {
        await roomsModel
          .findOneAndUpdate({ pinned: req.params.productId }, {
            $set: { pinned: null },
          })
        socketEmitter.emitTo(newObj.tokshow, "updated-pinned-product", null);
      }
    } else {
      if (newObj.tokshow) {
        await roomsModel
          .findOneAndUpdate({ activeauction: req.params.productId }, {
            $set: { activeauction: null },
          })
        // socketEmitter.emitTo(newObj.tokshow, "updated-pinned-product", { msg: message});
      }
    }
    console.log("newObj ", newObj, req.params.productId);
    let newProduct = await productModel
      .findByIdAndUpdate(
        new mongoose.Types.ObjectId(req.params.productId),
        {
          $set: newObj,
        },
        { new: true, runValidators: true }
      ).populate([
        { path: "reviews" },
        {
          path: "ownerId",
          populate: [
            { path: "payoutmethod" },
            { path: "shipping" }
          ]
        },
        { path: "shipping_profile" },
        {
          path: "auction",
          populate: [
            {
              path: "bids",
              populate: { path: "user", select: "firstName lastName" }
            },
            { path: "winner", select: "firstName lastName userName" },
            { path: "winning", select: "firstName lastName userName" }
          ]
        },
        { path: "category" },
      ])

    if (req.body.deleted == true && newProduct.type == "WC") {
      // await shopModel.findByIdAndUpdate(
      //   newProduct.shopId._id,
      //   {
      //     $pullAll: { wcIDs: [newProduct.wcid] },
      //   },
      //   { new: true, runValidators: true }
      // );
    }

    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: newProduct });
  } catch (error) {
    console.log(error);
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};

exports.updateProductImages = async (req, res) => {
  let newObj = {
    images: req.body.images,
  };
  try {
    let newProduct = await productModel
      .findByIdAndUpdate(
        req.params.productId,
        { $set: newObj },
        { runValidators: true, new: true }
      )
      .populate("shopId", [
        "name",
        "email",
        "location",
        "phoneNumber",
        "image",
        "description",
        "open",
        "ownerId",
        "paymentOptions",
        "shippingMethods",
      ])
      .populate("interest")
      .populate("reviews")
      .populate("ownerId", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "stripeAccountId",
        "fw_subacoount",
        "fw_id",
      ]);

    //     newProduct.shopId = null;
    //     newProduct.ownerId = null;

    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, data: newProduct });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, message: error + " " });
  }
};
exports.deleteManyProductByIds = async (req, res) => {
  let { ids } = req.body;
  console.log("deleteManyProductByIds ", ids);
  let deleted = await productModel.deleteMany({
    _id: { $in: ids },
  });
  res
    .status(200)
    .setHeader("Content-Type", "application/json")
    .json({ success: true });
};
exports.deleteProductById = async (req, res) => {
  console.log(req.params.productId);
  try {
    let deleted = await productModel.findByIdAndDelete(mongoose.mongo.ObjectId(req.params.productId));
    res.status(200).setHeader("Content-Type", "application/json").json(deleted);
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json(error.message);
  }
};
exports.updateManyProducts = async (req, res) => {
  let { ids, payload } = req.body;
  console.log("payload ", payload, ids);
  await Promise.all(
    ids.map(async (id) => {
      let auctionId = new mongoose.Types.ObjectId();
      payload.auction = auctionId;
      let product = await productModel.findByIdAndUpdate(id, {
        $set: payload,
      }, { runValidators: true, new: true });
      await auctionModel.create({
        _id: auctionId,
        baseprice: product.price,
        duration: 15,
        sudden: false,
        product: product._id,
        quantity: 1,
        increaseBidBy: 7,
        tokshow: payload.tokshow,
      });
    })
  );
  // await productModel.updateMany(
  //   { _id: { $in: ids } },
  //   {
  //     $set: payload,
  //   }
  // );
  res.json({ success: true });
};
