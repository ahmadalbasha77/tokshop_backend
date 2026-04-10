const roomsModel = require("../../models/room");
const category = require("../../models/category");
const { stopEgress } = require("../../shared/livekit");
const { populateRoomOptions, sendNotification } = require("../../shared/functions");
const { sendShowAnalyticsEmail } = require("../../shared/sendShowAnalyticsEmail");
const ThemeSettings = require("../../models/themes")

module.exports = (io, socket) => {

    socket.on("start-room", async (data) => {
        console.log("start-room", data);
        let { roomId, userId } = data;
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
            socket.join(roomId);
            console.log(`Socket ${socket.id} joined room ${roomId}`);

            socket.to(roomId).emit("user-connected", { roomId, userId, userName });
            io.to(roomId).emit("current-user-joined", { roomId, userId, userName });
            let room = await roomsModel.findByIdAndUpdate(
                roomId,
                {
                    $set: { activeTime: Date.now() },
                    $addToSet: { viewers: userId },
                },
                { new: true }
            ).populate("pinned");
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
    socket.on("leave-room", (data) => {
        let { roomId, userId, userName } = data;
        console.log("leave-room", data);
        io.to(roomId).emit("left-room", { roomId, userId, userName });
        socket.leave(roomId);
        // remove viewer from room
        roomsModel.findByIdAndUpdate(
            roomId,
            { $pull: { viewers: userId } },
            { runValidators: true, new: true }
        );
    });
};
