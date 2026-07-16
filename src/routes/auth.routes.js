const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const pool = require("../config/db");

const router = express.Router();

function toPublicUser(user) {
  return {
    id: user.firebase_uid,
    name: user.name,
    email: user.email,
    phone: user.phone,
    is_admin: Boolean(user.is_admin),
  };
}

// router.post("/register", (req, res) => {
//   return res.status(410).json({
//     message:
//       "Deprecated endpoint. Create users in Firebase Auth and send Firebase ID token to protected endpoints.",
//   });
// });

// router.post("/emailjs-login", (req, res) => {
//   return res.status(410).json({
//     message:
//       "Deprecated endpoint. Authenticate with Firebase on the client and send Firebase ID token.",
//   });
// });

// router.post("/login", (req, res) => {
//   return res.status(410).json({
//     message:
//       "Deprecated endpoint. Authenticate with Firebase on the client and send Firebase ID token.",
//   });
// });

router.post("/sync", requireAuth, async (req, res, next) => {
  try {
    const firebaseUid = req.auth.user.firebase_uid;
    let user = req.auth.user;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "is_admin")) {
      const { is_admin } = req.body;
      if (typeof is_admin !== "boolean") {
        return res
          .status(400)
          .json({ message: "is_admin must be a boolean value" });
      }

      const updateResult = await pool.query(
        `
        UPDATE users
        SET is_admin = $2
        WHERE firebase_uid = $1
        RETURNING firebase_uid, name, email, phone, is_admin
        `,
        [firebaseUid, is_admin],
      );

      if (updateResult.rowCount > 0) {
        user = updateResult.rows[0];
      }
    }

    return res.status(200).json({
      user: toPublicUser(user),
      message:
        "User data synchronized with Firebase Auth. This endpoint can be used to create or update user records in the database based on Firebase authentication.",
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/auth/is-admin
// Protected endpoint that allows authenticated admins to check a user's admin flag by email.
router.post("/is-admin", requireAuth, async (req, res, next) => {
  try {
    const requesterFirebaseUid = req.auth.user.firebase_uid;
    const { email } = req.body || {};

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "email is required" });
    }

    const requesterResult = await pool.query(
      `
      SELECT is_admin
      FROM users
      WHERE firebase_uid = $1
      LIMIT 1
      `,
      [requesterFirebaseUid],
    );

    if (requesterResult.rowCount === 0) {
      return res.status(403).json({ message: "Authenticated user not found" });
    }

    if (!requesterResult.rows[0].is_admin) {
      return res
        .status(403)
        .json({ message: "Forbidden: admin access required" });
    }

    const userResult = await pool.query(
      `
      SELECT email, is_admin
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      `,
      [email.trim()],
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      email: userResult.rows[0].email,
      is_admin: Boolean(userResult.rows[0].is_admin),
    });
  } catch (error) {
    return next(error);
  }
});

// router.get("/me", requireAuth, (req, res) => {
//   return res.status(200).json({
//     user: toPublicUser(req.auth.user),
//   });
// });

// router.post("/logout", requireAuth, async (req, res) => {
//   return res.status(200).json({
//     message:
//       "Firebase logout is handled client-side by clearing the Firebase session",
//   });
// });

module.exports = router;
