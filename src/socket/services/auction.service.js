const auctionModel = require("../../models/auction");
const productModel = require("../../models/product");
const bidModel = require("../../models/bid");
const roomsModel = require("../../models/room");
const userModel = require("../../models/user");
const { getAuctionPopulateOptions, startRunningTimer } = require("../../shared/functions");
const { startRecording } = require("../../shared/livekit");
const {
    checkSellerProfileComplete,
    checkSellerStripeActive,
    incompleteProfileResponse,
    stripeRestrictionResponse
} = require("../../shared/sellerProfile");

async function startAuction(io, socket, data) {
    const { roomId, auction, increaseBidBy } = data;
    let ownerId = auction?.product?.ownerId;
    if (!ownerId && auction?.product) {
        const product = await productModel.findById(auction.product).select("ownerId");
        ownerId = product?.ownerId;
    }
    const seller = ownerId
        ? await userModel.findById(ownerId).select("seller seller_application stripe_account")
        : null;
    if (!seller || !seller.seller || (seller?.seller_application?.status && seller.seller_application.status !== "approved")) {
        socket.emit("auction-error", {
            code: "SELLER_NOT_APPROVED",
            message: "Seller approval is required before continuing.",
        });
        return;
    }
    const profileStatus = checkSellerProfileComplete(seller);
    if (!profileStatus.complete) {
        socket.emit("auction-error", incompleteProfileResponse(profileStatus.missing_fields));
        return;
    }
    try {
        const stripeStatus = await checkSellerStripeActive(seller);
        if (!stripeStatus.active) {
            socket.emit("auction-error", stripeRestrictionResponse(stripeStatus));
            return;
        }
    } catch (error) {
        console.error("Unable to verify seller Stripe status before auction", error);
        socket.emit("auction-error", {
            code: "SELLER_STRIPE_STATUS_UNAVAILABLE",
            message: "Unable to verify seller Stripe account status. Please try again."
        });
        return;
    }
    const populateOptions = await getAuctionPopulateOptions();

    const duration = auction.duration || 60;
    const endTime = Date.now() + duration * 1000;

    let res = await auctionModel.findOneAndUpdate(
        { _id: auction._id },
        {
            $set: {
                started: true,
                startedTime: Date.now(),
                endTime: new Date(endTime),
                increaseBidBy,
            },
        },
        { new: true }
    ).populate(populateOptions);

    io.to(roomId).emit("auction-started", {
        ...res.toObject(),
        endTime,
        serverTime: Date.now(),
    });

    startRunningTimer(res, (err, result) => {
        if (err) {
            socket.emit("auction-error", err);
        } else {
            io.to(roomId).emit("auction-ended", result);
        }
    });

    try {
        const info = await startRecording(roomId);
        await auctionModel.findByIdAndUpdate(res._id, {
            $set: { egressId: info.egressId },
        });
    } catch (e) {
        console.error("recording error", e);
    }

    await roomsModel.findByIdAndUpdate(roomId, {
        $set: { activeauction: res._id, pinned: null },
    });
}

module.exports = { startAuction };
