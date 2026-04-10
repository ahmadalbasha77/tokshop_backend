const express = require("express");
const { WebhookReceiver } = require('livekit-server-sdk');
const { mintToken, startRecording, stopEgress, mintDynamicToken } = require("../shared/livekit");
const { getSettings } = require("../shared/functions");
const crypto = require("crypto");
const auctionModel = require("../models/auction");
const itemModel = require("../models/item");
const router = express.Router();
const fs = require("fs");
const roomModel = require("../models/room");
const path = require("path");
const recordingsDir = path.join(__dirname, "../recordings");
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}
const uploadDir = path.join(__dirname, "../recordings");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
// Handle LiveKit HTTP file uploads
router.put(
  "/upload",
  async (req, res) => {
    try {
      const auth = req.get("Authorization");
      const expected = process.env.HTTP_UPLOAD_AUTH || "Bearer supersecrettoken";
      if (auth !== expected) return res.status(403).json({ error: "Unauthorized" });

      const filename = `recording-${Date.now()}.mp4`;
      const filepath = path.join(uploadDir, filename);

      const fileStream = fs.createWriteStream(filepath);
      req.pipe(fileStream);

      fileStream.on("finish", () => {
        console.log(`✅ File saved: ${filepath}`);
        res.status(200).json({ success: true, path: filepath });
      });

      fileStream.on("error", (err) => {
        console.error("❌ Upload failed:", err);
        res.status(500).json({ error: err.message });
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// Get a LiveKit token for host or viewer
router.post("/token/dynamic", async (req, res) => {
  const { room, userId, uuid } = req.body;
  console.log(req.body);
  try {
    let { livekit_url } = await getSettings();
    let canPublish = false;
    
    let show = await roomModel.findById(room);
    if (show?.owner?.toString() === userId) {
      if ((show.activeCameraSessionId == "" || !show.activeCameraSessionId) && show?.owner?.toString() === userId) {
        console.log("🎉 Setting activeCameraSessionId for show:", show._id);
        show.activeCameraSessionId = uuid;
        sessionId = show.activeCameraSessionId;
        canPublish = true;
        await show.save();
      }else{
        canPublish = show.activeCameraSessionId === uuid;
      }
    }else if (userId === show?.co_host?.toString()) {
      canPublish = true;
    }

    const token = await mintDynamicToken(
      room,
      `${userId}:${uuid}`, // 🔑 UNIQUE IDENTITY
      canPublish, userId
    );

    const piptoken = await mintDynamicToken(
      room,
      `${userId}:${uuid}:pip`,
      false, userId
    );
    res.json({ url: livekit_url, token, piptoken, canPublish, sessionId: uuid, publishingSession: show.activeCameraSessionId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
router.get("/test-ffmpeg", (req, res) => {
  const ffmpeg = require('fluent-ffmpeg');

  ffmpeg.getAvailableFormats((err, formats) => {
    if (err) {
      return res.json({
        error: err.message,
        ffmpegPath: ffmpeg._ffmpegPath,
        ffprobePath: ffmpeg._ffprobePath
      });
    }
    res.json({
      success: true,
      message: 'FFmpeg is working!',
      formatCount: Object.keys(formats).length
    });
  });
});
router.post("/start/record", async (req, res) => {
  const { room } = req.body;
  if (!room) return res.status(400).json({ error: "Missing room name" });

  try {
    const info = await startRecording(room);
    console.log(`🎥 Recording started for room: ${room}`, info.egressId);
    res.json({
      room,
      egressId: info.egressId,
      file: info.file,
      startedAt: new Date(),
    });
  } catch (err) {
    console.error("❌ Failed to start recording:", err);
    res.status(500).json({ error: err.message });
  }
});

// Stop a recording
router.post("/stop/record", async (req, res) => {
  const { egressId } = req.body;
  if (!egressId) return res.status(400).json({ error: "Missing egressId" });

  try {
    const stopped = await stopEgress(egressId);
    console.log(`🛑 Recording stopped for egress: ${egressId}`);
    res.json({ egressId, stopped, stoppedAt: new Date() });
  } catch (err) {
    console.error("❌ Failed to stop egress:", err);
    res.status(500).json({ error: err.message });
  }
});

// router.post("/webhook", express.raw({ type: "application/webhook+json" }), async (req, res) => {
//   try {
//     let { livekit_api_key,livekit_api_secret } = await getSettings();
//     const receiver = new WebhookReceiver(livekit_api_key, livekit_api_secret);
//     const event = await receiver.receive(req.body, req.get('Authorization'));

//     console.log(event.event);

//     if (event.event === 'participant_left') {
//       console.log('participant_left');
//       const participantIdentity = event.participant?.identity;
//       console.log('participantIdentity', participantIdentity);
//       if (participantIdentity && participantIdentity.includes(':')) {
//         const [userId, sessionId] = participantIdentity.split(':');
//         console.log('userId', userId, 'sessionId', sessionId);
//         const roomName = event.room?.name;
//         console.log('roomName', roomName);

//         if (roomName) {
//           const show = await roomModel.findOne({ _id: roomName });
//           console.log('show', show);
//           if (show && show.activeCameraSessionId === sessionId) {
//             show.activeCameraSessionId = '';
//             await show.save();
//             console.log('🧹 Cleared activeCameraSessionId for room:', roomName);
//           }
//         }
//       }
//     }


//     if (event.event === 'egress_ended') {
//       const { egressInfo } = event;
//       const fileResult = egressInfo.fileResults?.[0];

//       if (fileResult) {
//         const filename = fileResult.filename;
//         const duration = fileResult.duration;
//         const size = fileResult.size;
//         console.log("egressInfo.egressId ",egressInfo.egressId)

//         const durationSeconds = duration ? Number(duration) / 1_000_000_000 : 0;
//         const sizeBytes = size ? Number(size) : 0;

//         console.log(`🎬 Recording finished: ${filename}`);
//         console.log(`   Duration: ${durationSeconds.toFixed(2)}s`);
//         console.log(`   Size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);

//         // INITIATE CLIP CREATION HERE
//         createWinnerClip(filename, 15)
//           .then(async (clip) => {
//             console.log(`✅ Winner clip ready: ${clip.clipUrl}`);
//             let item = await itemModel.findOne({egressId: egressInfo.egressId});
//             if(item){
//               item.videoReceipt = clip.clipUrl;
//               item.save();
//             }else{
//               await auctionModel.findOneAndUpdate({
//                 egressId: egressInfo.egressId
//               }, {
//                 videoReceipt: clip.clipUrl,
//               });
//             }
//           })
//           .catch(err => {
//             console.error('❌ Failed to create winner clip:', err);
//           });
//       }
//     }

//     res.sendStatus(200);

//   } catch (err) {
//     console.error('Webhook error:', err);
//     res.status(500).json({ error: String(err) });
//   }
// });
module.exports = router;
