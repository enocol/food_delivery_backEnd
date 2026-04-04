const pool = require("../config/db");

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authorization header with Bearer token is required",
    });
  }

  const token = authHeader.slice(7).trim();
  const sessionResult = await pool.query(
    `
    SELECT token, user_id, created_at, expires_at
    FROM sessions
    WHERE token = $1
    `,
    [token],
  );

  const session = sessionResult.rows[0];

  if (!session) {
    return res.status(401).json({
      message: "Invalid or expired session token",
    });
  }

  const userResult = await pool.query(
    `
    SELECT id, name, email, phone
    FROM users
    WHERE id = $1
    `,
    [session.user_id],
  );

  const user = userResult.rows[0];

  if (!user) {
    return res.status(401).json({
      message: "Session user not found",
    });
  }

  req.auth = {
    token,
    session,
    user,
    userId: user.id,
  };

  return next();
}

module.exports = requireAuth;
