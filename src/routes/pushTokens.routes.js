const express = require("express");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const requireAuth = require("../middleware/requireAuth");
const { toRfc3339Utc } = require("../utils/time");

const router = express.Router();

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeOptionalString(value) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function toPublicPushToken(row) {
  return {
    id: row.id,
    firebaseUid: row.firebase_uid,
    platform: row.platform,
    deviceId: row.device_id,
    appVersion: row.app_version,
    locale: row.locale,
    isActive: Boolean(row.is_active),
    lastSeenAt: toRfc3339Utc(row.last_seen_at),
    createdAt: toRfc3339Utc(row.created_at),
    updatedAt: toRfc3339Utc(row.updated_at),
  };
}

router.post("/", requireAuth, async (req, res, next) => {
  const { token, platform, deviceId, appVersion, locale } = req.body || {};
  const firebaseUid = req.auth.user.firebase_uid;

  if (!isNonEmptyString(token)) {
    return res.status(400).json({
      message: "token is required",
    });
  }

  if (!isNonEmptyString(platform)) {
    return res.status(400).json({
      message: "platform is required",
    });
  }

  const normalizedPlatform = platform.trim().toLowerCase();
  if (!["android", "ios", "web"].includes(normalizedPlatform)) {
    return res.status(400).json({
      message: "platform must be one of: android, ios, web",
    });
  }

  const normalizedDeviceId = normalizeOptionalString(deviceId);
  if (normalizedDeviceId === undefined) {
    return res.status(400).json({
      message: "deviceId must be a string when provided",
    });
  }

  const normalizedAppVersion = normalizeOptionalString(appVersion);
  if (normalizedAppVersion === undefined) {
    return res.status(400).json({
      message: "appVersion must be a string when provided",
    });
  }

  const normalizedLocale = normalizeOptionalString(locale);
  if (normalizedLocale === undefined) {
    return res.status(400).json({
      message: "locale must be a string when provided",
    });
  }

  const normalizedToken = token.trim();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let existingResult;

    if (normalizedDeviceId) {
      existingResult = await client.query(
        `
        SELECT *
        FROM user_push_tokens
        WHERE firebase_uid = $1 AND device_id = $2
        LIMIT 1
        FOR UPDATE
        `,
        [firebaseUid, normalizedDeviceId],
      );
    } else {
      existingResult = await client.query(
        `
        SELECT *
        FROM user_push_tokens
        WHERE firebase_uid = $1 AND fcm_token = $2
        LIMIT 1
        FOR UPDATE
        `,
        [firebaseUid, normalizedToken],
      );
    }

    let pushTokenRecord;

    if (existingResult.rowCount > 0) {
      const existing = existingResult.rows[0];
      const updateResult = await client.query(
        `
        UPDATE user_push_tokens
        SET
          fcm_token = $2,
          platform = $3,
          device_id = $4,
          app_version = $5,
          locale = $6,
          is_active = TRUE,
          last_seen_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
        `,
        [
          existing.id,
          normalizedToken,
          normalizedPlatform,
          normalizedDeviceId,
          normalizedAppVersion,
          normalizedLocale,
        ],
      );
      pushTokenRecord = updateResult.rows[0];
    } else {
      const tokenConflictResult = await client.query(
        `
        SELECT id, firebase_uid
        FROM user_push_tokens
        WHERE fcm_token = $1
        LIMIT 1
        FOR UPDATE
        `,
        [normalizedToken],
      );

      if (
        tokenConflictResult.rowCount > 0 &&
        tokenConflictResult.rows[0].firebase_uid !== firebaseUid
      ) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          message: "token is already registered to another user",
        });
      }

      if (tokenConflictResult.rowCount > 0) {
        const updateResult = await client.query(
          `
          UPDATE user_push_tokens
          SET
            platform = $2,
            device_id = $3,
            app_version = $4,
            locale = $5,
            is_active = TRUE,
            last_seen_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
          `,
          [
            tokenConflictResult.rows[0].id,
            normalizedPlatform,
            normalizedDeviceId,
            normalizedAppVersion,
            normalizedLocale,
          ],
        );
        pushTokenRecord = updateResult.rows[0];
      } else {
        const insertResult = await client.query(
          `
          INSERT INTO user_push_tokens (
            id,
            firebase_uid,
            fcm_token,
            platform,
            device_id,
            app_version,
            locale,
            is_active,
            last_seen_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW(), NOW(), NOW())
          RETURNING *
          `,
          [
            `pt_${randomUUID()}`,
            firebaseUid,
            normalizedToken,
            normalizedPlatform,
            normalizedDeviceId,
            normalizedAppVersion,
            normalizedLocale,
          ],
        );
        pushTokenRecord = insertResult.rows[0];
      }
    }

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Push token registered",
      pushToken: toPublicPushToken(pushTokenRecord),
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23503") {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
