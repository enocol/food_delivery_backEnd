const express = require("express");
const { randomUUID } = require("crypto");
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
    address: row.address || null,
  };
}

function mapMenuItem(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    price: Number(row.price),
    isAvailable: row.is_available,
  };
}

router.post("/", async (req, res) => {
  const payload = req.body || {};
  const restaurantPayload =
    payload.restaurant || payload.restaurantPayload || payload;
  const menuItemsPayload = Array.isArray(payload.menuItems)
    ? payload.menuItems
    : [];

  const name =
    restaurantPayload.restaurant_name || restaurantPayload.restaurantName;
  const imageUrl =
    restaurantPayload.imageUrl || restaurantPayload.image_url || null;
  const cuisine = restaurantPayload.cuisine;
  const rating = restaurantPayload.rating ?? 0;
  const deliveryFee =
    restaurantPayload.deliveryFee ?? restaurantPayload.delivery_fee ?? 0;
  const deliveryTimeMinutes =
    restaurantPayload.deliveryTimeMinutes ??
    restaurantPayload.delivery_time_minutes ??
    30;
  const isOpen = restaurantPayload.isOpen ?? restaurantPayload.is_open ?? true;
  const address = restaurantPayload.address || null;

  if (!name || !cuisine) {
    return res.status(400).json({
      message: "name and cuisine are required",
    });
  }

  if (!Array.isArray(menuItemsPayload)) {
    return res.status(400).json({
      message: "menuItems must be an array",
    });
  }

  for (const item of menuItemsPayload) {
    if (
      !item ||
      (!item.name && !item.menuName) ||
      !Number.isFinite(Number(item.price))
    ) {
      return res.status(400).json({
        message: "Each menu item must include name and numeric price",
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if restaurant already exists by name and cuisine
    const existingRestaurant = await client.query(
      `
      SELECT id FROM restaurants WHERE LOWER(name) = LOWER($1) AND LOWER(cuisine) = LOWER($2)
      `,
      [name, cuisine],
    );

    let restaurantId;
    let restaurantResult;

    if (existingRestaurant.rows.length > 0) {
      // Update existing restaurant
      restaurantId = existingRestaurant.rows[0].id;
      restaurantResult = await client.query(
        `
        UPDATE restaurants
        SET
          image_url = $1,
          rating = $2,
          delivery_fee = $3,
          delivery_time_minutes = $4,
          is_open = $5,
          address = $6
        WHERE id = $7
        RETURNING id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open, address
        `,
        [
          imageUrl,
          rating,
          deliveryFee,
          deliveryTimeMinutes,
          isOpen,
          address,
          restaurantId,
        ],
      );
    } else {
      // Create new restaurant with explicit ID or provided ID
      restaurantId =
        restaurantPayload.id ||
        restaurantPayload.restaurantId ||
        payload.restaurantId ||
        `r_${randomUUID()}`;

      restaurantResult = await client.query(
        `
        INSERT INTO restaurants (
          id,
          name,
          image_url,
          cuisine,
          rating,
          delivery_fee,
          delivery_time_minutes,
          is_open,
          address
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open, address
        `,
        [
          restaurantId,
          name,
          imageUrl,
          cuisine,
          rating,
          deliveryFee,
          deliveryTimeMinutes,
          isOpen,
          address,
        ],
      );
    }

    await client.query("DELETE FROM menu_items WHERE restaurant_id = $1", [
      restaurantId,
    ]);

    const createdMenuItems = [];
    for (const menuItem of menuItemsPayload) {
      const menuItemId = menuItem.id || `m_${randomUUID()}`;
      const menuInsertResult = await client.query(
        `
        INSERT INTO menu_items (
          id,
          restaurant_id,
          name,
          description,
          image_url,
          price,
          is_available
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, restaurant_id, name, description, image_url, price, is_available
        `,
        [
          menuItemId,
          restaurantId,
          menuItem.name || menuItem.menuName,
          menuItem.description || null,
          menuItem.imageUrl || menuItem.image_url || null,
          Number(menuItem.price),
          menuItem.isAvailable ?? menuItem.is_available ?? true,
        ],
      );

      createdMenuItems.push(mapMenuItem(menuInsertResult.rows[0]));
    }

    await client.query("COMMIT");

    return res.status(201).json({
      restaurant: mapRestaurant(restaurantResult.rows[0]),
      count: createdMenuItems.length,
      menu: createdMenuItems,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

router.get("/with-menus", async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      r.id,
      r.name,
      r.image_url,
      r.cuisine,
      r.rating,
      r.delivery_fee,
      r.delivery_time_minutes,
      r.is_open,
      r.address,
      m.id AS menu_id,
      m.name AS menu_name,
      m.description,
      m.image_url AS menu_image_url,
      m.price,
      m.is_available
    FROM restaurants r
    LEFT JOIN menu_items m ON r.id = m.restaurant_id
    ORDER BY r.name ASC, m.name ASC
    `,
  );

  const restaurantsMap = {};
  result.rows.forEach((row) => {
    if (!restaurantsMap[row.id]) {
      restaurantsMap[row.id] = {
        id: row.id,
        name: row.name,
        imageUrl: row.image_url,
        cuisine: row.cuisine,
        rating: Number(row.rating),
        deliveryFee: Number(row.delivery_fee),
        deliveryTimeMinutes: row.delivery_time_minutes,
        isOpen: row.is_open,
        address: row.address || null,
        menus: [],
      };
    }

    if (row.menu_id) {
      restaurantsMap[row.id].menus.push({
        id: row.menu_id,
        restaurantId: row.id,
        name: row.menu_name,
        description: row.description,
        imageUrl: row.menu_image_url,
        price: Number(row.price),
        isAvailable: row.is_available,
      });
    }
  });

  const restaurants = Object.values(restaurantsMap);

  return res.status(200).json({
    count: restaurants.length,
    restaurants,
  });
});

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
    SELECT id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open, address
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
    SELECT id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open, address
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
    SELECT id, name, image_url, cuisine, rating, delivery_fee, delivery_time_minutes, is_open, address
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
    SELECT id, restaurant_id, name, description, image_url, price, is_available
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
    imageUrl: item.image_url,
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
