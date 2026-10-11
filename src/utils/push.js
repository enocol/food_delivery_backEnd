const pool = require("../config/db");
const { getFirebaseMessaging } = require("../config/firebaseAdmin");

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(token) {
  return (
    /^ExponentPushToken\[[^\]]+\]$/.test(token) ||
    /^ExpoPushToken\[[^\]]+\]$/.test(token)
  );
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

// Sends a push notification to every active token registered for a firebase_uid.
// Handles raw FCM tokens (via Firebase Admin, high priority) and Expo push
// tokens (via the Expo push API), and deactivates tokens the providers report as
// invalid. Shared by the order/customer flows and the driver socket layer.
async function sendPushNotification(firebaseUid, notification, data) {
  const tokensResult = await pool.query(
    `
    SELECT fcm_token
    FROM user_push_tokens
    WHERE firebase_uid = $1
      AND is_active = TRUE
    `,
    [firebaseUid],
  );

  const tokens = tokensResult.rows
    .map((row) => row.fcm_token)
    .filter((token) => typeof token === "string" && token.trim().length > 0);

  if (tokens.length === 0) {
    return;
  }

  const fcmTokens = [];
  const expoTokens = [];

  for (const token of tokens.map((value) => value.trim())) {
    if (isExpoPushToken(token)) {
      expoTokens.push(token);
    } else {
      fcmTokens.push(token);
    }
  }

  const inactiveTokens = [];
  const invalidTokenCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ]);

  if (fcmTokens.length > 0) {
    try {
      const response = await getFirebaseMessaging().sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data,
        android: {
          priority: "high",
        },
        apns: {
          headers: {
            "apns-priority": "10",
            "apns-push-type": "alert",
          },
        },
      });

      response.responses.forEach((result, index) => {
        if (!result.success && invalidTokenCodes.has(result.error?.code)) {
          inactiveTokens.push(fcmTokens[index]);
        }
      });
    } catch (error) {
      console.error(`FCM send failed for user ${firebaseUid}:`, error.message);
    }
  }

  if (expoTokens.length > 0) {
    const expoTokenChunks = chunkArray(expoTokens, 100);

    for (const chunk of expoTokenChunks) {
      try {
        const expoResponse = await fetch(EXPO_PUSH_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(
            chunk.map((token) => ({
              to: token,
              title: notification.title,
              body: notification.body,
              sound: "default",
              data,
            })),
          ),
        });

        if (!expoResponse.ok) {
          console.error(
            `Expo push send failed for user ${firebaseUid}: HTTP ${expoResponse.status}`,
          );
          continue;
        }

        const expoPayload = await expoResponse.json();
        const results = Array.isArray(expoPayload.data) ? expoPayload.data : [];

        results.forEach((result, index) => {
          const detailsError = result?.details?.error;
          if (
            result?.status === "error" &&
            detailsError === "DeviceNotRegistered"
          ) {
            inactiveTokens.push(chunk[index]);
          }
        });
      } catch (error) {
        console.error(
          `Expo push send failed for user ${firebaseUid}:`,
          error.message,
        );
      }
    }
  }

  if (inactiveTokens.length > 0) {
    const uniqueInactiveTokens = Array.from(new Set(inactiveTokens));
    await pool.query(
      `
      UPDATE user_push_tokens
      SET is_active = FALSE, updated_at = NOW()
      WHERE fcm_token = ANY($1::text[])
      `,
      [uniqueInactiveTokens],
    );
  }
}

module.exports = { sendPushNotification };
