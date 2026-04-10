const auctionModel = require("../../models/auction");
const productModel = require("../../models/product");
const bidModel = require("../../models/bid");
const roomsModel = require("../../models/room");
const { getAuctionPopulateOptions, startRunningTimer } = require("../../shared/functions");
const { startRecording } = require("../../shared/livekit");

async function startAuction(io, socket, data) {
    const { roomId, auction, increaseBidBy } = data;
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
