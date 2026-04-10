const productModel = require("../../models/product");

const timers = new Map();

async function startFlashSale(io, data) {
    const { productId, roomId, duration } = data;
    const endTime = Date.now() + duration * 1000;

    await productModel.findByIdAndUpdate(productId, {
        $set: { flash_sale_end_time: new Date(endTime) },
    });

    io.to(roomId).emit("flash-sale-started", {
        productId,
        endTime,
        serverTime: Date.now(),
    });

    if (timers.has(productId)) {
        clearTimeout(timers.get(productId));
    }

    timers.set(
        productId,
        setTimeout(() => {
            io.to(roomId).emit("flash-sale-expired", {
                productId,
                serverTime: Date.now(),
            });
            timers.delete(productId);
        }, duration * 1000)
    );
}

module.exports = { startFlashSale };
