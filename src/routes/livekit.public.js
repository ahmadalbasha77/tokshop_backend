const express = require("express");
const router = express.Router();
const { WebhookReceiver } = require("livekit-server-sdk");
const { getSettings } = require("../shared/functions");
const { createWinnerClip } = require("../shared/livekit");
const auctionModel = require("../models/auction");
const itemModel = require("../models/item");
const roomModel = require("../models/room");

router.post(
  "/webhook",
  express.raw({ type: "application/webhook+json" }),
  async (req, res) => {
    try {
      const { livekit_api_key, livekit_api_secret } = await getSettings();

      const receiver = new WebhookReceiver(
        livekit_api_key,
        livekit_api_secret
      );

      const event = await receiver.receive(
        req.body,
        req.get("Authorization")
      );


      if (event.event === 'participant_left') {
            const participantIdentity = event.participant?.identity;
            if (participantIdentity && participantIdentity.includes(':')) {
              const [userId, sessionId] = participantIdentity.split(':');
              const roomName = event.room?.name;
              
              if (roomName) {
                const show = await roomModel.findByIdAndUpdate(roomName, {$pull: { viewers: userId }});
                // console.log('show', show);
                if (show && show.activeCameraSessionId === sessionId) {
                  show.activeCameraSessionId = '';
                  await show.save();
                  console.log('🧹 Cleared activeCameraSessionId for room:', roomName);
                }
              }
            }
          }

      if (event.event === "egress_ended") {
        const fileResult = event.egressInfo.fileResults?.[0];

        if (fileResult) {
          const clip = await createWinnerClip(fileResult.filename, 15);

          let item = await itemModel.findOne({
            egressId: event.egressInfo.egressId,
          });

          if (item) {
            item.videoReceipt = clip.clipUrl;
            await item.save();
          } else {
            await auctionModel.findOneAndUpdate(
              { egressId: event.egressInfo.egressId },
              { videoReceipt: clip.clipUrl }
            );
          }
        }
      }

      res.sendStatus(200);
    } catch (err) {
      // console.error("Webhook error:", err);
      res.status(401).json({ error: "Invalid webhook signature" });
    }
  }
);

module.exports = router;
