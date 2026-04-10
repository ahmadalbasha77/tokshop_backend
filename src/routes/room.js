const express = require("express");
const roomController = require("../controllers/rooms");
const roomRouter = express.Router();
roomRouter
  .route("/roomnotifications")
  .post(roomController.sendRoomNotifications);

roomRouter
  .route("/")
  .get(roomController.getShows)
  .post(roomController.createShow);

roomRouter
  .route("/:roomId")
  .get(roomController.getRoomById)
  .put(roomController.updateRoomById)
  .delete(roomController.deleteRoomById);


roomRouter.route("/user/add/:roomId").put(roomController.addUserToRoom);
roomRouter.route("/bulkupdate/data").post(roomController.bulkUpdate);
roomRouter.route("/analytics/:roomId").get(roomController.getRoomAnalytics);
roomRouter.route("/features/:roomId").put(roomController.makeRoomFeatured);
roomRouter.route("/stats/all").get(roomController.roomStats);
module.exports = roomRouter;
