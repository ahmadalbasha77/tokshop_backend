const giveAway = require("../../models/giveaway");
const { createGiveawaOrder } = require("../../shared/functions");

async function joinGiveaway(io, socket, { giveawayId, userId, showId }) {
    const giveaway = await giveAway.findByIdAndUpdate(
        giveawayId,
        { $addToSet: { participants: userId } },
        { new: true }
    );

    io.to(showId).emit("joined-giveaway", giveaway);
}

async function startGiveaway(io, socket, { giveawayId, showId }) {
    const giveaway = await giveAway.findById(giveawayId);
    giveaway.status = "started";
    await giveaway.save();

    io.to(showId).emit("started-giveaway", giveaway);
}

module.exports = { joinGiveaway, startGiveaway };
