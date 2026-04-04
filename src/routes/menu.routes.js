const express = require("express");
const pool = require("../config/db");

const router = express.Router();

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
