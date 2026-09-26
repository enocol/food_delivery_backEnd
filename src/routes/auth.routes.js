const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const pool = require("../config/db");
const { getFirebaseAuth } = require("../config/firebaseAdmin");

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

// DELETE /api/auth/account
// Closes the authenticated user's own account in Neon, then deletes the
// Firebase Auth user. Neon is handled first (inside a transaction) so any
// failure there leaves everything untouched and reports a clean error,
// instead of deleting the Firebase account and then getting stuck unable
// to finish on the Neon side, which would lock the person out with no way
// to ever retry the cleanup.
//
// A user with no order history is hard-deleted (cart/likes cascade away).
// A user WITH order history can't be hard-deleted — orders.firebase_uid is
// ON DELETE RESTRICT so order records survive account closure — so instead
// their row is anonymized in place (name/email/phone scrubbed, is_admin
// cleared) and marked with deleted_at. requireAuth's upsert refuses to
// touch a deleted_at row, so a still-valid cached ID token can't undo the
// anonymization or keep using the account.
router.delete("/account", requireAuth, async (req, res, next) => {
  const firebaseUid = req.auth.userId;

  const client = await pool.connect();
  let outcome;

  try {
    await client.query("BEGIN");

    await client.query(
      "DELETE FROM user_push_tokens WHERE firebase_uid = $1",
      [firebaseUid],
    );

    const hasOrdersResult = await client.query(
      "SELECT EXISTS (SELECT 1 FROM orders WHERE firebase_uid = $1) AS has_orders",
      [firebaseUid],
    );

    if (hasOrdersResult.rows[0].has_orders) {
      // Drop what we can cleanly remove; the users row itself has to stay
      // for the FK, so scrub it instead of deleting it.
      await client.query("DELETE FROM carts WHERE firebase_uid = $1", [
        firebaseUid,
      ]);
      await client.query("DELETE FROM likes WHERE firebase_uid = $1", [
        firebaseUid,
      ]);

      const anonymizedEmail = `deleted-${firebaseUid}@deleted.invalid`;
      const anonymizeResult = await client.query(
        `
        UPDATE users
        SET
          name = 'Deleted User',
          email = $2,
          phone = NULL,
          password_hash = NULL,
          is_admin = FALSE,
          deleted_at = NOW()
        WHERE firebase_uid = $1
        RETURNING firebase_uid
        `,
        [firebaseUid, anonymizedEmail],
      );

      if (anonymizeResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "User not found" });
      }

      outcome = "anonymized";
    } else {
      const deleteResult = await client.query(
        `
        DELETE FROM users
        WHERE firebase_uid = $1
        RETURNING firebase_uid
        `,
        [firebaseUid],
      );

      if (deleteResult.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "User not found" });
      }

      outcome = "deleted";
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23503") {
      // Rare race: an order was placed between the has_orders check and
      // the delete attempt. Ask the caller to retry rather than building
      // out savepoint-based fallback logic for a near-impossible window.
      return res.status(409).json({
        message: "Could not close this account right now. Please try again.",
      });
    }

    return next(error);
  } finally {
    client.release();
  }

  try {
    await getFirebaseAuth().deleteUser(firebaseUid);
  } catch (error) {
    console.error(
      `${outcome === "anonymized" ? "Anonymized" : "Deleted"} Neon user ${firebaseUid} but failed to delete the Firebase Auth account:`,
      error.message,
    );
    return res.status(502).json({
      message:
        "Account data was closed, but the Firebase login could not be removed. Contact support to finish closing this account.",
      outcome,
      // "deleted": the Neon row is gone, so a retry re-runs cleanly.
      // "anonymized": the row is marked deleted_at, so requireAuth will
      // reject any further request from this account (including a
      // retry of this same call) with 403 — only support/an admin can
      // finish removing the Firebase account from here.
      retryable: outcome === "deleted",
    });
  }

  return res.status(200).json({
    message:
      outcome === "anonymized"
        ? "Account closed. Your order history is retained but no longer linked to your personal details."
        : "Account deleted",
    outcome,
  });
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
