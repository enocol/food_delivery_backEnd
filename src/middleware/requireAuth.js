const { getFirebaseAuth } = require("../config/firebaseAdmin");
const pool = require("../config/db");

async function upsertUserFromToken(decodedToken) {
  const firebaseUid = decodedToken.uid;
  const hasEmailClaim = Boolean(decodedToken.email);
  const email = decodedToken.email || `${firebaseUid}@firebase.local`;
  const name = decodedToken.name || null;
  const phone = decodedToken.phone_number || null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (hasEmailClaim) {
      const existingByEmailResult = await client.query(
        `
        SELECT firebase_uid
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
        FOR UPDATE
        `,
        [email],
      );

      if (existingByEmailResult.rowCount > 0) {
        const existingByEmail = existingByEmailResult.rows[0];
        if (existingByEmail.firebase_uid !== firebaseUid) {
          const existingByFirebaseUidResult = await client.query(
            `
            SELECT firebase_uid
            FROM users
            WHERE firebase_uid = $1
            LIMIT 1
            FOR UPDATE
            `,
            [firebaseUid],
          );

          if (existingByFirebaseUidResult.rowCount > 0) {
            throw new Error(
              "User reconciliation conflict: firebase_uid already exists for a different user",
            );
          }

          await client.query(
            `
            UPDATE users
            SET
              firebase_uid = $1,
              email = $2,
              name = COALESCE($3, name),
              phone = COALESCE($4, phone),
              auth_provider = 'firebase'
            WHERE firebase_uid = $5
            `,
            [firebaseUid, email, name, phone, existingByEmail.firebase_uid],
          );
        }
      }
    }

    const result = await client.query(
      `
      INSERT INTO users (id, firebase_uid, email, name, phone, auth_provider)
      VALUES ($1, $1, $2, COALESCE($3, $1), $4, 'firebase')
      ON CONFLICT (firebase_uid)
      DO UPDATE SET
        email = CASE WHEN $5 THEN EXCLUDED.email ELSE users.email END,
        name = COALESCE(EXCLUDED.name, users.name),
        phone = COALESCE(EXCLUDED.phone, users.phone),
        auth_provider = 'firebase'
      RETURNING firebase_uid, name, email, phone
      `,
      [firebaseUid, email, name, phone, hasEmailClaim],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authorization header with Bearer token is required",
    });
  }

  const idToken = authHeader.slice(7).trim();
  let decodedToken;

  try {
    decodedToken = await getFirebaseAuth().verifyIdToken(idToken);
  } catch (error) {
    return res.status(401).json({
      message: "Invalid Firebase ID token",
    });
  }

  let user;
  try {
    user = await upsertUserFromToken(decodedToken);
  } catch (error) {
    if (
      error.message &&
      error.message.includes("User reconciliation conflict")
    ) {
      return res.status(409).json({
        message:
          "Account reconciliation conflict detected. Contact support to merge this account.",
      });
    }

    throw error;
  }

  req.auth = {
    token: idToken,
    decodedToken,
    user,
    userId: user.firebase_uid,
    firebaseUid: user.firebase_uid,
  };

  return next();
}

module.exports = requireAuth;
