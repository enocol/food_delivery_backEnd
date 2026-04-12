const express = require("express");
const { randomUUID } = require("crypto");
const pool = require("../config/db");

const router = express.Router();

function mapMenuItem(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    isAvailable: row.is_available,
  };
}

router.post("/", async (req, res) => {
  const payload = req.body || {};
  const restaurantId = payload.restaurant_id || payload.restaurantId;
  const name = payload.name || payload.menuName;
  const description = payload.description || null;
  const price = Number(payload.price);
  const isAvailable = payload.is_available ?? payload.isAvailable ?? true;

  if (!restaurantId || !restaurantId.trim()) {
    return res.status(400).json({
      message: "restaurant_id is required",
    });
  }

  if (!name || !name.trim()) {
    return res.status(400).json({
      message: "name (or menuName) is required",
    });
  }

  if (!Number.isFinite(price)) {
    return res.status(400).json({
      message: "price must be a valid number",
    });
  }

  const restaurantCheck = await pool.query(
    `SELECT id FROM restaurants WHERE id = $1`,
    [restaurantId],
  );

  if (restaurantCheck.rowCount === 0) {
    return res.status(404).json({
      message: "Restaurant not found",
    });
  }

  const menuItemId = `m_${randomUUID()}`;

  try {
    const result = await pool.query(
      `
      INSERT INTO menu_items (id, restaurant_id, name, description, price, is_available)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, restaurant_id, name, description, price, is_available
      `,
      [menuItemId, restaurantId, name.trim(), description, price, isAvailable],
    );

    return res.status(201).json({
      message: "Menu item created",
      item: mapMenuItem(result.rows[0]),
    });
  } catch (error) {
    console.error("Menu item creation error:", error);
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

router.get("/items/:itemId", async (req, res) => {
  const itemResult = await pool.query(
    `
    SELECT id, restaurant_id, name, description, price, is_available
    FROM menu_items
    WHERE id = $1
    `,
    [req.params.itemId],
  );
  const item = itemResult.rows[0];

  if (!item) {
    return res.status(404).json({
      message: "Menu item not found",
    });
  }

  const restaurantResult = await pool.query(
    `
    SELECT id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open
    FROM restaurants
    WHERE id = $1
    `,
    [item.restaurant_id],
  );
  const restaurant = restaurantResult.rows[0] || null;

  return res.status(200).json({
    item: {
      id: item.id,
      restaurantId: item.restaurant_id,
      name: item.name,
      description: item.description,
      price: Number(item.price),
      isAvailable: item.is_available,
    },
    restaurant: restaurant
      ? {
          id: restaurant.id,
          name: restaurant.name,
          imageUrl: restaurant.image_url,
          cuisine: restaurant.cuisine,
          rating: Number(restaurant.rating),
          deliveryFee: Number(restaurant.delivery_fee),
          deliveryTimeMinutes: restaurant.delivery_time_minutes,
          isOpen: restaurant.is_open,
        }
      : null,
  });
});

module.exports = router;
