const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const pool = require("../config/db");

const router = express.Router();

// POST /api/drivers/session
// Called when a driver logs in. Upserts the driver row:
//   - Creates the row if the driver is new
//   - Ignores fields that have not changed
//   - Updates any field that has changed (phone, current_location, status, is_online)
router.post("/session", requireAuth, async (req, res, next) => {
  const firebase_uid = req.auth.user.firebase_uid;
  const { phone, current_location, status, is_online } = req.body;

  try {
    const result = await pool.query(
      `
      INSERT INTO drivers (firebase_uid, phone, current_location, status, is_online)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (firebase_uid) DO UPDATE SET
        phone            = COALESCE(EXCLUDED.phone,            drivers.phone),
        current_location = COALESCE(EXCLUDED.current_location, drivers.current_location),
        status           = COALESCE(EXCLUDED.status,           drivers.status),
        is_online        = COALESCE(EXCLUDED.is_online,        drivers.is_online)
      RETURNING id, firebase_uid, phone, current_location, status, is_online
      `,
      [
        firebase_uid,
        phone ?? null,
        current_location ?? null,
        status ?? "Offline",
        is_online ?? false,
      ],
    );

    return res.status(200).json({ driver: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
