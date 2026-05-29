const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

// POST /api/restaurants/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const result = await pool.query(
    `
    SELECT
      ru.id,
      ru.email,
      ru.password_hash,
      ru.role,
      ru.restaurant_id,
      r.name AS restaurant_name
    FROM restaurant_users ru
    JOIN restaurants r ON r.id = ru.restaurant_id
    WHERE LOWER(ru.email) = LOWER($1)
    LIMIT 1
    `,
    [email],
  );

  // Use a generic message to avoid revealing whether the email exists
  if (result.rowCount === 0) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const restaurantUser = result.rows[0];

  const passwordMatch = await bcrypt.compare(
    password,
    restaurantUser.password_hash,
  );
  if (!passwordMatch) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const token = jwt.sign(
    {
      restaurant_user_id: restaurantUser.id,
      restaurant_id: restaurantUser.restaurant_id,
      role: restaurantUser.role,
    },
    JWT_SECRET,
    { expiresIn: "12h" },
  );

  return res.status(200).json({
    token,
    restaurantId: restaurantUser.restaurant_id,
    restaurantName: restaurantUser.restaurant_name,
    role: restaurantUser.role,
  });
});

module.exports = router;
