const express = require("express");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
  };
}

function createSession(userId) {
  return {
    token: randomUUID(),
    userId,
  };
}

router.post("/register", async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({
      message: "name, email and password are required",
    });
  }

  const existing = await pool.query(
    "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
    [email],
  );
  if (existing.rowCount > 0) {
    return res.status(409).json({
      message: "Email already exists",
    });
  }

  const newUser = {
    id: `u_${randomUUID()}`,
    name,
    email,
    password_hash: password,
    phone: phone || null,
  };

  await pool.query(
    `
    INSERT INTO users (id, name, email, password_hash, phone, auth_provider)
    VALUES ($1, $2, $3, $4, $5, 'local')
    `,
    [
      newUser.id,
      newUser.name,
      newUser.email,
      newUser.password_hash,
      newUser.phone,
    ],
  );

  return res.status(201).json({
    message: "User registered",
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone,
    },
  });
});

router.post("/emailjs-login", async (req, res) => {
  const { email, name, phone } = req.body;

  if (!email || !name) {
    return res.status(400).json({
      message: "email and name are required",
    });
  }

  const userResult = await pool.query(
    `
    SELECT id, name, email, phone
    FROM users
    WHERE LOWER(email) = LOWER($1)
    `,
    [email],
  );
  let user = userResult.rows[0];

  if (!user) {
    const newUser = {
      id: `u_${randomUUID()}`,
      name,
      email,
      phone: phone || null,
    };

    await pool.query(
      `
      INSERT INTO users (id, name, email, password_hash, phone, auth_provider)
      VALUES ($1, $2, $3, NULL, $4, 'emailjs')
      `,
      [newUser.id, newUser.name, newUser.email, newUser.phone],
    );

    user = newUser;
  } else {
    await pool.query(
      `
      UPDATE users
      SET
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        auth_provider = 'emailjs'
      WHERE id = $3
      `,
      [name || null, phone || null, user.id],
    );

    user = {
      ...user,
      name: name || user.name,
      phone: phone || user.phone,
    };
  }

  const session = createSession(user.id);
  await pool.query(
    `
    INSERT INTO sessions (token, user_id)
    VALUES ($1, $2)
    `,
    [session.token, session.userId],
  );

  return res.status(200).json({
    message: "EmailJS login successful",
    token: session.token,
    user,
  });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      message: "email and password are required",
    });
  }

  const userResult = await pool.query(
    `
    SELECT id, name, email, phone, password_hash
    FROM users
    WHERE LOWER(email) = LOWER($1)
    `,
    [email],
  );
  const user = userResult.rows[0];

  if (!user || user.password_hash !== password) {
    return res.status(401).json({
      message: "Invalid credentials",
    });
  }

  const session = createSession(user.id);
  await pool.query(
    `
    INSERT INTO sessions (token, user_id)
    VALUES ($1, $2)
    `,
    [session.token, session.userId],
  );

  return res.status(200).json({
    message: "Login successful",
    token: session.token,
    user: toPublicUser(user),
  });
});

router.get("/me", requireAuth, (req, res) => {
  return res.status(200).json({
    user: toPublicUser(req.auth.user),
  });
});

router.post("/logout", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token = $1", [req.auth.token]);

  return res.status(200).json({
    message: "Logged out successfully",
  });
});

module.exports = router;
