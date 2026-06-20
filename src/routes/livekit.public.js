const express = require("express");
const router = express.Router();
const { WebhookReceiver } = require("livekit-server-sdk");
const { getSettings, syncAuctionVideoReceiptToItems } = require("../shared/functions");
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
        console.log("🔥 Webhook egress_ended received!");
        console.log("egressInfo:", JSON.stringify(event.egressInfo, null, 2));
        
        const fileResult = event.egressInfo.fileResults?.[0] || event.egressInfo.file;

        if (fileResult) {
          console.log("🔥 Found fileResult:", fileResult.filename);
          const clip = await createWinnerClip(fileResult.filename, 15);

          // Update any items that have this egressId
          await itemModel.updateMany(
            { egressId: event.egressInfo.egressId },
            { $set: { videoReceipt: clip.clipUrl } }
          );

          const auctions = await auctionModel.find({
            egressId: event.egressInfo.egressId,
          });

          // Update the auction so that future items created get the receipt
          await auctionModel.updateMany(
            { egressId: event.egressInfo.egressId },
            { $set: { videoReceipt: clip.clipUrl } }
          );

          await Promise.all(
            auctions.map((auction) =>
              syncAuctionVideoReceiptToItems(auction, clip.clipUrl)
            )
          );
        } else {
          console.log("❌ No fileResult found in egressInfo!");
        }
      }

      res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      res.status(401).json({ error: "Invalid webhook signature" });
    }
  }
);

module.exports = router;
