const userModel = require("../../models/user");
const roomsModel = require("../../models/room");
const crypto = require("crypto");
const { mintDynamicToken, removeCoHost } = require("../../shared/livekit");
const { getSettings } = require("../../shared/functions");
module.exports = (io, socket) => {

    socket.on("follow-user", async (data) => {
        try {
            const { userId, showId, toFollowUserId } = data;
            console.log("Received follow-user:", {
                userId,
                showId,
                toFollowUserId,
            });
            // update both user lists, make it same for follow and unfollow if already following
            const user = await userModel.findById(userId);
            const toFollowUser = await userModel.findById(toFollowUserId);
            if (!user || !toFollowUser) {
                return socket.emit("user-error", "User not found");
            }

            //uppdate room with the followers count
            await roomsModel.findByIdAndUpdate(
                showId,
                { $inc: { followersCount: !user.following.includes(toFollowUserId) ? 1 : -1 } },
                { runValidators: true, new: true }
            );

            if (!user.following.includes(toFollowUserId)) {
                user.following.push(toFollowUserId);
                toFollowUser.followers.push(userId);
                toFollowUser.followersCount += 1;
            } else {
                user.following = user.following.filter(
                    (id) => id.toString() !== toFollowUserId
                );
                toFollowUser.followers = toFollowUser.followers.filter(
                    (id) => id.toString() !== userId
                );
                toFollowUser.followersCount -= 1;
            }
            await user.save();
            await toFollowUser.save();

            io.to(showId).emit("followed-user", { userId, toFollowUser });
        } catch (error) {
            console.error(error);
            socket.emit("user-error", "Failed to follow user");
        }
    });

    socket.on("invite-cohost", async (data) => {
        try {
            const { user, roomId } = data;
            console.log("Received invite-cohost:", {
                roomId,
                user,
            });

            console.log("invited-cohost")
            io.to(roomId).emit("invited-cohost", { user });
        } catch (error) {
            console.error(error);
            socket.emit("user-error", "Failed to invite cohost");
        }
    });
    socket.on("accept-cohost", async (data) => {
        try {
            const { userId, roomId, room } = data;
            console.log("Received accept-cohost:", {
                roomId,
                userId,
            });
            const sessionId = crypto.randomUUID();
            let co_host_identity = `${userId}:${sessionId}`;
            let show = await roomsModel.findByIdAndUpdate(roomId, { $set: { co_host: userId, co_host_identity } }, { new: true })
            console.log("accept-cohost")
            const token = await mintDynamicToken(
                roomId,
                `${co_host_identity}`, // 🔑 UNIQUE IDENTITY
                true
            );
            const piptoken = await mintDynamicToken(
                roomId,
                `${co_host_identity}:pip`,
                false
            );
            let { livekit_url } = await getSettings();

            io.to(roomId).emit("accepted-cohost", { url: livekit_url, token, piptoken, canPublish: true, publishingSession: show.activeCameraSessionId, user: userId });
        } catch (error) {
            console.error(error);
            socket.emit("user-error", "Failed to accept cohost");
        }
    })
    socket.on("remove-cohost", async (data) => {
        try {
            const { roomId } = data;
            console.log("Received remove-cohost:", data);
            let room = await roomsModel.findByIdAndUpdate(roomId, { $set: { co_host: null } }, { new: true })
            // console.log(room?.co_host_identity)
            await removeCoHost(roomId, room?.co_host_identity);
            io.to(roomId.toString()).emit("removed-cohost", { user: data['cohost'] });
        } catch (error) {
            console.error(error);
            socket.emit("user-error", "Failed to remove cohost");
        }
    })
    socket.on("allow-moderator", async (data) => {
        try {
            const { roomId, userId } = data;

            const room = await roomsModel.findById(roomId).select("moderators");

            if (!room) {
                return socket.emit("user-error", "Room not found");
            }

            const isModerator = room.moderators.includes(userId);

            const update = isModerator
                ? { $pull: { moderators: userId } }
                : { $addToSet: { moderators: userId } };

            const updatedRoom = await roomsModel.findByIdAndUpdate(
                roomId,
                update,
                { new: true }
            ).populate("moderators", "userName profilePhoto");

            io.to(roomId).emit("allowed-moderator", {
                moderators: updatedRoom.moderators,
                action: isModerator ? "removed" : "added",
                userId,
            });

        } catch (error) {
            console.error(error);
            socket.emit("user-error", "Failed to update moderator");
        }
    });
    socket?.on("remove-user", async (data) => {
        try {
            const { roomId, userId } = data;

             await roomsModel.findByIdAndUpdate(
                roomId,
                 { $pull: { viewers: userId }, $addToSet: { banned: userId } },
                { new: true }
            );

            io.to(roomId).emit("removed-user", {
                roomId,
                userId,
            });
        } catch (error) {
            console.error(error);
            socket.emit("user-error", "Failed to remove user");
        }
    });

};
