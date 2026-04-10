require("dotenv/config");
const {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  AccessToken,
  GCPUpload,
  RoomServiceClient
} = require("livekit-server-sdk");
let egress;

const appSettings = require("../models/settings");
(async () => {
  try {
    const { livekit_url, livekit_api_key, livekit_api_secret } = await getSettings();
    egress = new EgressClient(livekit_url, livekit_api_key, livekit_api_secret);

    roomService = new RoomServiceClient(
      livekit_url,
      livekit_api_key,
      livekit_api_secret
    );
    console.log("✅ LiveKit Egress client initialized");
  } catch (err) {
    console.error("❌ Failed to initialize LiveKit Egress client:", err.message);
  }
})();
async function getSettings() {
  var response = await appSettings.find();
  return response[0];
}
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');
ffmpeg.setFfprobePath('/usr/bin/ffprobe');

// Initialize GCS
const storage = new Storage({
  keyFilename: path.join(__dirname, '../../service_account.json')
});


async function mintDynamicToken(room, identity, canPublish) {
  const { getSettings } = require("./functions");
  const { AccessToken, TrackSource } = require("livekit-server-sdk");
  const {
    livekit_api_key,
    livekit_api_secret,
  } = await getSettings();

  const at = new AccessToken(
    livekit_api_key,
    livekit_api_secret,
    {
      identity,      // ✅ userId:sessionId
      ttl: "2h",
    }
  );
  console.log('canPublish', canPublish);
  at.addGrant({
    roomJoin: true,
    room,
    canPublish,     // ✅ decided by backend
    canSubscribe: true,
    canPublishSources: canPublish
      ? [
        TrackSource.CAMERA,
        TrackSource.MICROPHONE,
        TrackSource.SCREEN_SHARE,
      ]
      : [],
  });

  return at.toJwt();
}

async function removeCoHost(roomId, userId) {

  const participant = await roomService.getParticipant(roomId, userId);

  for (const pub of participant.tracks) {
    if (pub.kind === 'audio') {
      await roomService.mutePublishedTrack(roomId, userId, pub.sid, true);
    }

    // 🎥 STOP video publishing (this is the critical part)
    if (pub.kind === 'video') {
      await roomService.unpublishTrack(roomId, userId, pub.sid);
    }

    await roomService.mutePublishedTrack(
      roomId,
      userId,
      pub.sid,
      true // ✅ mute
    );
  }

  console.log(`⬇️ Co-host demoted (tracks muted): ${userId}`);
}

/**
 * Start recording a room (full auction recording)
 */
async function startRecording(roomName) {
  if (!roomName) return;

  const credentialsPath = path.join(__dirname, '../../service_account.json');
  console.log(credentialsPath)
  const credentialsContent = fs.readFileSync(credentialsPath, 'utf8');
  const { firebase_storage_bucket } = await getSettings();
  console.log("firebase_storage_bucket ", firebase_storage_bucket)
  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `recordings/${roomName}-${Date.now()}.mp4`,
    output: {
      case: 'gcp',
      value: new GCPUpload({
        credentials: credentialsContent,
        bucket: firebase_storage_bucket
      }),
    },
  });

  const info = await egress.startRoomCompositeEgress(
    roomName,
    fileOutput,
    {
      layout: "speaker"
    }
  );

  console.log(`🎥 Recording started: ${info.egressId}`);
  return info;
}

/**
 * Stop an egress session
 */
async function stopEgress(id) {
  try {
    await egress.stopEgress(id);
    console.log(`✅ Stopped ${id}`);
    return true;
  } catch (error) {
    if (error.message.includes('EGRESS_COMPLETE')) {
      console.log(`✅ ${id} already completed`);
      return true;
    }
    console.log(`❌ Failed to stop ${id}:`, error.message);
  }
}

/**
 * Extract the last N seconds from a video file for winner clip
 */
async function createWinnerClip(sourceFilename, clipDuration = 15) {
  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const tempInputPath = path.join(tempDir, `input-${Date.now()}.mp4`);
  const tempOutputPath = path.join(tempDir, `output-${Date.now()}.mp4`);
  const clipFilename = sourceFilename.replace('.mp4', '-winner-clip.mp4');

  try {
    console.log(`📥 Downloading ${sourceFilename} from GCS...`);
    const { firebase_storage_bucket } = await getSettings();
    const bucket = storage.bucket(firebase_storage_bucket);
    const file = bucket.file(sourceFilename)
    await file.download({ destination: tempInputPath });

    // Get video duration
    const getVideoDuration = () => {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempInputPath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata.format.duration);
        });
      });
    };

    const totalDuration = await getVideoDuration();

    // FIXED: Use the minimum of clipDuration or totalDuration
    const actualClipDuration = Math.min(clipDuration, totalDuration);
    const startTime = Math.max(0, totalDuration - actualClipDuration);

    console.log(`✂️ Creating ${actualClipDuration}s clip...`);
    console.log(`Video duration: ${totalDuration}s, extracting from ${startTime}s to end`);

    // If video is very short (less than 5 seconds), just use the whole thing
    if (totalDuration < 5) {
      console.log('⚠️ Video is very short, using entire video');
      // Just copy the entire file
      fs.copyFileSync(tempInputPath, tempOutputPath);
    } else {
      // Extract the last N seconds
      await new Promise((resolve, reject) => {
        ffmpeg(tempInputPath)
          .setStartTime(startTime)
          .setDuration(actualClipDuration)
          .output(tempOutputPath)
          .videoCodec('copy')
          .audioCodec('copy')
          .on('start', (cmd) => console.log('FFmpeg command:', cmd))
          .on('progress', (progress) => console.log(`Processing: ${progress.percent}% done`))
          .on('end', () => {
            console.log('✅ Clip created successfully');
            resolve();
          })
          .on('error', (err) => {
            console.error('❌ FFmpeg error:', err);
            reject(err);
          })
          .run();
      });
    }

    console.log(`📤 Uploading clip to GCS as ${clipFilename}...`);

    // Upload the clip back to GCS
    await bucket.upload(tempOutputPath, {
      destination: clipFilename,
      metadata: {
        contentType: 'video/mp4',
      },
    });
    await bucket.file(clipFilename).makePublic();

    // Clean up temp files
    fs.unlinkSync(tempInputPath);
    fs.unlinkSync(tempOutputPath);

    const clipUrl = `https://storage.googleapis.com/${firebase_storage_bucket}/${clipFilename}`;
    console.log(`✅ Winner clip created: ${clipUrl} (${actualClipDuration}s)`);

    return {
      clipUrl,
      clipFilename,
      duration: actualClipDuration
    };

  } catch (error) {
    // console.error('Error creating winner clip:', error);

    // Clean up temp files on error
    if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
    if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);

    throw error;
  }
}
/**
 * Delete a recording from GCS
 */
async function deleteRecording(filename) {
  try {
    const { firebase_storage_bucket } = await getSettings();
    const bucket = storage.bucket(firebase_storage_bucket);
    await bucket.file(filename).delete();
    console.log(`🗑️ Deleted recording: ${filename}`);
    return true;
  } catch (error) {
    console.error('Error deleting recording:', error);
    return false;
  }
}

/**
 * Cleanup old/failed egress sessions
 */
async function cleanupOldEgress() {
  try {
    const allEgresses = await egress.listEgress();
    console.log(`Found ${allEgresses.length} egress sessions`);

    for (const egressInfo of allEgresses) {
      // Stop FAILED or COMPLETE sessions only
      if (egressInfo.status === 4 || egressInfo.status === 3) {
        console.log(`Stopping egress ${egressInfo.egressId} (status: ${egressInfo.status})`);
        try {
          await egress.stopEgress(egressInfo.egressId);
          console.log(`✅ Stopped ${egressInfo.egressId}`);
        } catch (error) {
          console.log(`❌ Failed to stop ${egressInfo.egressId}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up egress:', error);
  }
}

/**
 * Check current egress status
 */
async function checkCurrentStatus() {
  try {
    const allEgresses = await egress.listEgress();
    console.log('\n=== Current Egress Status ===');

    const active = allEgresses.filter(e => e.status === 1);
    const starting = allEgresses.filter(e => e.status === 0);

    console.log(`Active sessions: ${active.length}`);
    console.log(`Starting sessions: ${starting.length}`);

    if (active.length > 0) {
      console.log('Active sessions:');
      active.forEach(e => console.log(`  ${e.egressId}: ${e.roomName}`));
    }

    if (starting.length > 0) {
      console.log('Starting sessions:');
      starting.forEach(e => console.log(`  ${e.egressId}: ${e.roomName}`));
    }

    console.log(`\nTotal concurrent: ${active.length + starting.length}`);

  } catch (error) {
    console.error('Error checking status:', error);
  }
}

// Only run checkCurrentStatus if this file is executed directly
if (require.main === module) {
  checkCurrentStatus();
}

module.exports = {
  startRecording,
  stopEgress,
  createWinnerClip,
  deleteRecording,
  cleanupOldEgress, mintDynamicToken, removeCoHost
};