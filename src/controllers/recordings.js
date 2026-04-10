const recordingsnModel = require("../models/recordings");

exports.getRecordingsByUserId = async (req, res) => {
  try {
    const { title, page, limit, userid } = req.query;
    const limits = Number(limit);
    const pages = Number(page);
    const skip = (pages - 1) * limits;
    const queryObject = {};

    if (req.params.userId) {
      queryObject.$or = [{ userId: { $eq: req.params.userId } }];
    }

    const totalDoc = await recordingsnModel.countDocuments(queryObject);
    let recordings = await recordingsnModel
      .find(queryObject)
      .skip(skip)
      .sort({ date: -1 })
      .limit(limits)
      .populate("roomId", [
        "title",
        "hostIds",
        "userIds",
        "ownerId",
        "description",
        "discount",
      ])
      .populate("userId", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "roomuid",
      ]);

    res.send({
      recordings,
      totalDoc,
      limits,
      pages,
    });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, message: error.message });
  }
};

exports.getRecordingById = async (req, res) => {
  try {
    let recording = await recordingsnModel
      .findById(req.params.recordingId)
      .populate({
        path: "roomId",
        populate: {
          path: "shopId",
        },
      })
      .populate({
        path: "roomId",
        populate: {
          path: "productIds",
          populate: {
            path: "ownerId",

            populate: {
              path: "shopId",
            },
          },
        },
      })
      .populate("userId");

    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, recording: recording });
  } catch (error) {
    console.log(error + " ");
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, message: error.message });
  }
};

exports.getRecordingRoomId = async (req, res) => {
  try {
    let recordings = await recordingsnModel
      .find({ roomId: req.params.roomId })
      .populate("roomId", [
        "title",
        "hostIds",
        "userIds",
        "ownerId",
        "description",
        "discount",
      ])
      .populate("userId", [
        "firstName",
        "lastName",
        "bio",
        "userName",
        "email",
        "profilePhoto",
        "roomuid",
      ]);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true, recording: recordings });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, message: error.message });
  }
};

exports.deleteRecording = async (req, res) => {
  try {
    let del = await recordingsnModel.findByIdAndDelete(req.params.recordingId);
    res
      .status(200)
      .setHeader("Content-Type", "application/json")
      .json({ success: true });
  } catch (error) {
    res
      .status(422)
      .setHeader("Content-Type", "application/json")
      .json({ success: false, message: error });
  }
};
