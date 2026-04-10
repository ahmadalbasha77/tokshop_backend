const express = require("express");
const recordingRouter = express.Router();
const recordingController = require("../controllers/recordings");


recordingRouter.route("/user/:userId")
    .get(recordingController.getRecordingsByUserId);

recordingRouter.route("/room/:roomId")
    .get(recordingController.getRecordingRoomId);

recordingRouter.route("/id/:recordingId")
    .get(recordingController.getRecordingById);


recordingRouter.route("/:recordingId")
    .delete(recordingController.deleteRecording);


module.exports = recordingRouter;