const express = require("express");
const pool = require("../config/db");

const router = express.Router();

function mapRestaurant(row) {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    cuisine: row.cuisine,
    rating: Number(row.rating),
    deliveryFee: Number(row.delivery_fee),
    deliveryTimeMinutes: row.delivery_time_minutes,
    isOpen: row.is_open,
  };
}

router.get("/", async (req, res) => {
  const { search, cuisine } = req.query;

  const params = [];
  const where = [];

  if (search) {
    params.push(`%${String(search)}%`);
    where.push(`name ILIKE $${params.length}`);
  }

  if (cuisine) {
    params.push(`%${String(cuisine)}%`);
    where.push(`cuisine ILIKE $${params.length}`);
  }

  const result = await pool.query(
    `
    SELECT id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open
    FROM restaurants
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY name ASC
    `,
    params,
  );
  const restaurants = result.rows.map(mapRestaurant);

  res.status(200).json({
    count: restaurants.length,
    restaurants,
  });
});

router.get("/:restaurantId", async (req, res) => {
  const restaurantResult = await pool.query(
    `
    SELECT id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open
    FROM restaurants
    WHERE id = $1
    `,
    [req.params.restaurantId],
  );
  const restaurant = restaurantResult.rows[0];

  if (!restaurant) {
    return res.status(404).json({
      message: "Restaurant not found",
    });
  }

  return res.status(200).json({
    restaurant: mapRestaurant(restaurant),
  });
});

router.get("/:restaurantId/menu", async (req, res) => {
  const restaurantResult = await pool.query(
    `
    SELECT id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open
    FROM restaurants
    WHERE id = $1
    `,
    [req.params.restaurantId],
  );
  const restaurant = restaurantResult.rows[0];

  if (!restaurant) {
    return res.status(404).json({
      message: "Restaurant not found",
    });
  }

  const menuResult = await pool.query(
    `
    SELECT id, restaurant_id, name, description, price, is_available
    FROM menu_items
    WHERE restaurant_id = $1
    ORDER BY name ASC
    `,
    [req.params.restaurantId],
  );
  const menu = menuResult.rows.map((item) => ({
    id: item.id,
    restaurantId: item.restaurant_id,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    isAvailable: item.is_available,
  }));

  return res.status(200).json({
    restaurant: mapRestaurant(restaurant),
    count: menu.length,
    menu,
  });
});

module.exports = router;
