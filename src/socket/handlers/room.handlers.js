const roomsModel = require("../../models/room");
const category = require("../../models/category");
const { stopEgress } = require("../../shared/livekit");
const { populateRoomOptions, sendNotification } = require("../../shared/functions");
const { sendShowAnalyticsEmail } = require("../../shared/sendShowAnalyticsEmail");
const ThemeSettings = require("../../models/themes")
const userModel = require("../../models/user");
const {
    checkSellerProfileComplete,
    checkSellerStripeActive,
    incompleteProfileResponse,
    stripeRestrictionResponse
} = require("../../shared/sellerProfile");

async function syncRoomViewers(io, roomId) {
    const roomKey = roomId?.toString();
    if (!roomKey) return [];

    const room = await roomsModel.findById(roomId).select("owner");
    if (!room) return [];

    const ownerId = room.owner?.toString();
    const connectedSockets = await io.in(roomKey).fetchSockets();
    const uniqueViewerIds = [...new Set(
        connectedSockets
            .filter((connectedSocket) => connectedSocket.data.liveRoomId === roomKey)
            .map((connectedSocket) => connectedSocket.data.liveUserId)
            .filter((userId) => userId && userId !== ownerId)
    )];

    await roomsModel.findByIdAndUpdate(roomId, {
        $set: {
            viewers: uniqueViewerIds,
            viewersCount: uniqueViewerIds.length,
        }
    });

    io.to(roomKey).emit("viewers-updated", {
        roomId: roomKey,
        viewers: uniqueViewerIds,
        viewersCount: uniqueViewerIds.length,
    });

    return uniqueViewerIds;
}

async function leaveLiveRoom(io, socket) {
    const roomId = socket.data.liveRoomId;
    const userId = socket.data.liveUserId;
    const userName = socket.data.liveUserName;
    if (!roomId || !userId) return;

    socket.leave(roomId);
    socket.data.liveRoomId = null;
    socket.data.liveUserId = null;
    socket.data.liveUserName = null;

    const remainingSockets = await io.in(roomId).fetchSockets();
    const hasAnotherSocket = remainingSockets.some(
        (connectedSocket) =>
            connectedSocket.data.liveRoomId === roomId &&
            connectedSocket.data.liveUserId === userId
    );

    if (!hasAnotherSocket) {
        await roomsModel.findByIdAndUpdate(roomId, {
            $pull: { viewers: userId }
        });
        io.to(roomId).emit("left-room", { roomId, userId, userName });
    }

    await syncRoomViewers(io, roomId);
}

module.exports = (io, socket) => {

    socket.on("start-room", async (data) => {
        console.log("start-room", data);
        let { roomId, userId } = data;
        const roomOwner = await roomsModel.findById(roomId).select("owner");
        const seller = roomOwner?.owner
            ? await userModel.findById(roomOwner.owner).select("seller seller_application stripe_account")
            : null;
        if (!seller || !seller.seller || (seller?.seller_application?.status && seller.seller_application.status !== "approved")) {
            return socket.emit("room-error", {
                code: "SELLER_NOT_APPROVED",
                message: "Seller approval is required before starting a live show."
            });
        }
        const profileStatus = checkSellerProfileComplete(seller);
        if (!profileStatus.complete) {
            return socket.emit("room-error", incompleteProfileResponse(profileStatus.missing_fields));
        }
        try {
            const stripeStatus = await checkSellerStripeActive(seller);
            if (!stripeStatus.active) {
                return socket.emit("room-error", stripeRestrictionResponse(stripeStatus));
            }
        } catch (error) {
            console.error("Unable to verify seller Stripe status before starting room", error);
            return socket.emit("room-error", {
                code: "SELLER_STRIPE_STATUS_UNAVAILABLE",
                message: "Unable to verify seller Stripe account status. Please try again."
            });
        }
        const populateOptions = await populateRoomOptions();
        let room = await roomsModel
            .findByIdAndUpdate(
                roomId,
                { $set: { started: true, date: new Date(), startedTime: Date.now() } },
                { runValidators: true, new: true }
            )
            .populate(populateOptions)
            .populate({
                path: "owner",
                populate: {
                    path: "followers",
                    select: ["fcmToken", "notification_settings"],
                },
            })
            .populate("invitedhostIds")
            .populate({
                path: "category",
                populate: {
                    path: "followers",
                    select: ["fcmToken"],
                },
            });
        if (room) {
            let userfcmTokens = new Set();
            room?.invitedhostIds?.forEach((invited) => {
                if (invited.fcmToken) {
                    userfcmTokens.add(invited.fcmToken);
                }
            });
            let ids = room?.invitedhostIds?.map((invited) => {
                return invited._id;
            });
            room.invitedhostIds = ids;
            io.to(roomId).emit("room-started", room);
            if (room?.notificationsent == true || room?.roomType == 'private') return;
            let allusers = room.owner.followers;
            allusers.push(room.category?.followers);

            // Add tokens from allusers
            allusers.forEach((user) => {
                if (
                    user?.fcmToken &&
                    user?.notification_settings?.notify_on_live == true
                ) {
                    userfcmTokens.add(user.fcmToken);
                }
            });

            userfcmTokens = Array.from(userfcmTokens);
            if (
                userId == room.owner._id &&
                room?.usersNotified == false &&
                userfcmTokens?.length > 0
            ) {

                const theme_settings = await ThemeSettings.findOne({});
                sendNotification(
                    userfcmTokens,
                    "Live " + theme_settings.app_name,
                    room.owner.userName + " is live on " + theme_settings.app_name + " - " + room.title,
                    { screen: "RoomScreen", id: room._id.toString() }
                );
                await roomsModel.findByIdAndUpdate(
                    room._id,
                    { $set: { notificationsent: true } }
                )
            }
        }
    });

    socket.on("rally", async (data) => {
        console.log("rally", data);
        let { fromRoom, toRoom } = data;
        io.to(fromRoom).emit("rally-in", data);
        //send end of room email
        sendShowAnalyticsEmail(fromRoom).catch(err => {
            console.error('Failed to send analytics email:', err);
        });

    })
    socket.on("end-room", async (data) => {
        let { roomId, userId, userName, egressId } = data;
        console.log("end-room", data);

        await stopEgress(egressId);
        var room = await roomsModel.findByIdAndUpdate(
            { _id: roomId },
            { $set: { ended: true, endedTime: Date.now() } },
            { new: true, runValidators: true }
        );

        sendShowAnalyticsEmail(room?._id).catch(err => {
            console.error('Failed to send analytics email:', err);
        });

        // Emit to ONLY the room that ended, not everyone
        io.to(roomId).emit("room-ended", { roomId });

        // Disconnect AFTER emitting so the host receives the event
        socket.disconnect();
    });
    socket.on("join-room", async (data) => {
        console.log("join-room", data);
        let { roomId, userId, userName } = data;
        try {
            const roomKey = roomId?.toString();
            const viewerId = userId?.toString();
            const roomData = await roomsModel.findById(roomId).select("owner");
            if (!roomData || !roomKey || !viewerId) {
                return socket.emit("error", "Failed to join room");
            }

            const connectedSockets = await io.in(roomKey).fetchSockets();
            const alreadyConnected = connectedSockets.some(
                (connectedSocket) => connectedSocket.data.liveUserId === viewerId
            );
            const isOwner = roomData.owner?.toString() === viewerId;

            socket.data.liveRoomId = roomKey;
            socket.data.liveUserId = viewerId;
            socket.data.liveUserName = userName;
            socket.join(roomKey);
            console.log(`Socket ${socket.id} joined room ${roomKey}`);

            if (!alreadyConnected) {
                socket.to(roomKey).emit("user-connected", { roomId: roomKey, userId: viewerId, userName });
                io.to(roomKey).emit("current-user-joined", { roomId: roomKey, userId: viewerId, userName });
            }
            const viewerUpdate = {
                $set: { activeTime: Date.now() },
            };
            if (!isOwner) {
                viewerUpdate.$addToSet = { viewers: viewerId };
            }
            let room = await roomsModel.findByIdAndUpdate(
                roomId,
                viewerUpdate,
                { new: true }
            ).populate("pinned");
            await syncRoomViewers(io, roomId);
            if (room?.category) {
                await category.findByIdAndUpdate(
                    room.category,
                    {
                        $inc: { viewersCount: 1 },
                    },
                    { new: true }
                );
            }

            if (
                room?.pinned?.flash_sale_started &&
                !room?.pinned?.flash_sale_ended &&
                room?.pinned?.flash_sale_end_time
            ) {
                socket.emit("flash-sale-started", {
                    productId: room.pinned._id,
                    endTime: room.pinned.flash_sale_end_time.getTime(),
                    serverTime: Date.now(),
                });
            }

        } catch (error) {
            console.error("join-room error:", error);
            socket.emit("error", "Failed to join room");
        }
    });
    socket.on("leave-room", async (data) => {
        let { roomId, userId, userName } = data;
        console.log("leave-room", data);
        socket.data.liveRoomId = roomId?.toString();
        socket.data.liveUserId = userId?.toString();
        socket.data.liveUserName = userName;
        try {
            await leaveLiveRoom(io, socket);
        } catch (error) {
            console.error("leave-room error:", error);
        }
    });

    socket.on("disconnect", async () => {
        try {
            await leaveLiveRoom(io, socket);
        } catch (error) {
            console.error("disconnect room cleanup error:", error);
        }
    });
};
