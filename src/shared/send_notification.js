const admin = require("firebase-admin");
const serviceAccount = require("../../service_account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

admin.firestore().settings({ ignoreUndefinedProperties: true });

exports.sendPushNotification = async function (tokens, title, body, data = {}) {
  const message = {
    notification: {
      title: title,
      body: body,
    },
    apns: {
      payload: {
        aps: {
          alert: {
            title: title,        // Use the actual title parameter
            body: body          // Use the actual body parameter  
          },
          sound: "default",
          badge: 1
        }
      }
    },
    android: {
      notification: {
        title: title,        // Add title for Android
        body: body,          // Add body for Android  
        sound: "default",
        channelId: "default_channel"  // Add channel ID
      }
    },
    tokens,
    data,
  };
  console.log(message)

  admin
    .messaging()
    .sendEachForMulticast(message)
    .then((response) => {
      console.log(response)
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.error(`Token at index ${idx} failed:`, resp.error);
        }
      });
    })
    .catch((error) => {
      console.error("Error sending multicast notification:", error);
    });
};
exports.sendNotificationToAll = async function (title, body, data = {}) {
  const message = {
    notification: { title, body },
    data,
    topic: "all",
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("🚀 Notification sent to all successfully:", response);
  } catch (error) {
    console.error("❌ Error sending notification:", error);
  }
};

// Example usage:
