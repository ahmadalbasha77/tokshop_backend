const bidModel = require("../../models/bid");
const { bid, processAutobids } = require("../../shared/functions");

async function placeBid(io, socket, data) {
    const { user, auction, amount, roomId } = data;

    const query = { user, auction };
    const update = { $set: { amount, user, auction } };
    const options = { upsert: true, new: true };

    await bid(query, update, options, auction, amount, async (err, res) => {
        if (err) return socket.emit("bid-error", err);

        const response = await processAutobids(res, user);
        io.to(roomId).emit("bid-updated", response);
    });
}

module.exports = { placeBid };
