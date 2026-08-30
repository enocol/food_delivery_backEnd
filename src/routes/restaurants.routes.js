const express = require("express");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const requireRestaurantAuth = require("../middleware/requireRestaurantAuth");
const { toCurrencyInt } = require("../utils/currency");

const router = express.Router();

function mapRestaurant(row) {
  const location =
    row.location && typeof row.location === "string"
      ? (() => {
          try {
            return JSON.parse(row.location);
          } catch {
            return row.location;
          }
        })()
      : row.location || null;

  return {
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    cuisine: row.cuisine,
    rating: Number(row.rating),
    deliveryTimeMinutes: row.delivery_time_minutes,
    isOpen: row.is_open,
    location,
  };
}

function mapMenuItem(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    price: toCurrencyInt(row.price) ?? 0,
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
    restaurantPayload.restaurant_name ||
    restaurantPayload.restaurantName ||
    restaurantPayload.name;
  const imageUrl =
    restaurantPayload.imageUrl || restaurantPayload.image_url || null;
  const cuisine = restaurantPayload.cuisine;
  const rating = restaurantPayload.rating ?? 0;
  const deliveryTimeMinutes =
    restaurantPayload.deliveryTimeMinutes ??
    restaurantPayload.delivery_time_minutes ??
    30;
  const isOpen = restaurantPayload.isOpen ?? restaurantPayload.is_open ?? true;
  const latitude = restaurantPayload.latitude;
  const longitude = restaurantPayload.longitude;
  let location = restaurantPayload.location ?? null;

  if (latitude !== undefined || longitude !== undefined) {
    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);

    if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
      return res.status(400).json({
        message: "latitude and longitude must be valid numbers",
      });
    }

    location = {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
    };
  } else if (
    restaurantPayload.location &&
    typeof restaurantPayload.location === "object"
  ) {
    const parsedLatitude = Number(restaurantPayload.location.latitude);
    const parsedLongitude = Number(restaurantPayload.location.longitude);

    if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
      return res.status(400).json({
        message: "location must include numeric latitude and longitude",
      });
    }

    location = {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
    };
  } else if (restaurantPayload.location !== undefined) {
    return res.status(400).json({
      message: "location must be an object with numeric latitude and longitude",
    });
  }

  if (location === null) {
    return res.status(400).json({
      message:
        "location is required and must include numeric latitude and longitude",
    });
  }

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
    const parsedItemPrice = toCurrencyInt(item?.price);
    if (!item || (!item.name && !item.menuName) || parsedItemPrice === null) {
      return res.status(400).json({
        message: "Each menu item must include name and integer price",
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
          delivery_time_minutes = $3,
          is_open = $4,
          location = $5::jsonb
        WHERE id = $6
        RETURNING id, name, image_url, cuisine, rating, delivery_time_minutes, is_open, location
        `,
        [
          imageUrl,
          rating,
          deliveryTimeMinutes,
          isOpen,
          location,
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
          delivery_time_minutes,
          is_open,
          location
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, name, image_url, cuisine, rating, delivery_time_minutes, is_open, location
        `,
        [
          restaurantId,
          name,
          imageUrl,
          cuisine,
          rating,
          deliveryTimeMinutes,
          isOpen,
          location,
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
          toCurrencyInt(menuItem.price),
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

// PATCH /api/restaurants/:restaurantId
// Update restaurant table fields only; does not modify menu items.
router.patch("/:restaurantId", async (req, res) => {
  const { restaurantId } = req.params;

  const payload = req.body || {};
  const restaurantPayload =
    payload.restaurant || payload.restaurantPayload || payload;

  const updates = [];
  const values = [];

  const name =
    restaurantPayload.name ||
    restaurantPayload.restaurantName ||
    restaurantPayload.restaurant_name;
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return res
        .status(400)
        .json({ message: "name must be a non-empty string" });
    }
    values.push(name.trim());
    updates.push(`name = $${values.length}`);
  }

  const imageUrl = restaurantPayload.imageUrl ?? restaurantPayload.image_url;
  if (imageUrl !== undefined) {
    if (imageUrl !== null && typeof imageUrl !== "string") {
      return res
        .status(400)
        .json({ message: "imageUrl must be a string or null" });
    }
    values.push(imageUrl);
    updates.push(`image_url = $${values.length}`);
  }

  if (restaurantPayload.cuisine !== undefined) {
    if (
      typeof restaurantPayload.cuisine !== "string" ||
      !restaurantPayload.cuisine.trim()
    ) {
      return res
        .status(400)
        .json({ message: "cuisine must be a non-empty string" });
    }
    values.push(restaurantPayload.cuisine.trim());
    updates.push(`cuisine = $${values.length}`);
  }

  if (restaurantPayload.rating !== undefined) {
    const rating = Number(restaurantPayload.rating);
    if (!Number.isFinite(rating)) {
      return res.status(400).json({ message: "rating must be a number" });
    }
    values.push(rating);
    updates.push(`rating = $${values.length}`);
  }

  const deliveryTimeMinutes =
    restaurantPayload.deliveryTimeMinutes ??
    restaurantPayload.delivery_time_minutes;
  if (deliveryTimeMinutes !== undefined) {
    const parsedDeliveryTimeMinutes = Number(deliveryTimeMinutes);
    if (!Number.isInteger(parsedDeliveryTimeMinutes)) {
      return res
        .status(400)
        .json({ message: "deliveryTimeMinutes must be an integer" });
    }
    values.push(parsedDeliveryTimeMinutes);
    updates.push(`delivery_time_minutes = $${values.length}`);
  }

  const isOpen = restaurantPayload.isOpen ?? restaurantPayload.is_open;
  if (isOpen !== undefined) {
    if (typeof isOpen !== "boolean") {
      return res.status(400).json({ message: "isOpen must be a boolean" });
    }
    values.push(isOpen);
    updates.push(`is_open = $${values.length}`);
  }

  const latitude = restaurantPayload.latitude;
  const longitude = restaurantPayload.longitude;
  const locationPayload = restaurantPayload.location;

  if (
    latitude !== undefined ||
    longitude !== undefined ||
    locationPayload !== undefined
  ) {
    let location = null;

    if (latitude !== undefined || longitude !== undefined) {
      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);
      if (
        !Number.isFinite(parsedLatitude) ||
        !Number.isFinite(parsedLongitude)
      ) {
        return res.status(400).json({
          message: "latitude and longitude must be valid numbers",
        });
      }
      location = { latitude: parsedLatitude, longitude: parsedLongitude };
    } else if (locationPayload === null) {
      location = null;
    } else if (locationPayload && typeof locationPayload === "object") {
      const parsedLatitude = Number(locationPayload.latitude);
      const parsedLongitude = Number(locationPayload.longitude);
      if (
        !Number.isFinite(parsedLatitude) ||
        !Number.isFinite(parsedLongitude)
      ) {
        return res.status(400).json({
          message: "location must include numeric latitude and longitude",
        });
      }
      location = { latitude: parsedLatitude, longitude: parsedLongitude };
    } else {
      return res.status(400).json({
        message:
          "location must be an object with latitude and longitude or null",
      });
    }

    values.push(location);
    updates.push(`location = $${values.length}::jsonb`);
  }

  if (updates.length === 0) {
    return res.status(400).json({
      message: "At least one restaurant field must be provided to update",
    });
  }

  values.push(restaurantId);

  const result = await pool.query(
    `
    UPDATE restaurants
    SET ${updates.join(", ")}
    WHERE id = $${values.length}
    RETURNING id, name, image_url, cuisine, rating, delivery_time_minutes, is_open, location
    `,
    values,
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ message: "Restaurant not found" });
  }

  return res.status(200).json({
    restaurant: mapRestaurant(result.rows[0]),
  });
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
      r.delivery_time_minutes,
      r.is_open,
      r.location,
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
        deliveryTimeMinutes: row.delivery_time_minutes,
        isOpen: row.is_open,
        location: row.location || null,
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
        price: toCurrencyInt(row.price) ?? 0,
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
    SELECT id, name, image_url, cuisine, rating, delivery_time_minutes, is_open, location
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
    SELECT id, name, image_url, cuisine, rating, delivery_time_minutes, is_open, location
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
    SELECT id, name, image_url, cuisine, rating, delivery_time_minutes, is_open, location
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
    price: toCurrencyInt(item.price) ?? 0,
    isAvailable: item.is_available,
  }));

  return res.status(200).json({
    restaurant: mapRestaurant(restaurant),
    count: menu.length,
    menu,
  });
});

// PATCH /api/restaurants/:restaurantId/status
// Authenticated restaurant toggles their own open/closed status
router.patch(
  "/:restaurantId/status",
  requireRestaurantAuth,
  async (req, res) => {
    const { restaurantId } = req.params;

    if (req.restaurantAuth.restaurantId !== restaurantId) {
      return res
        .status(403)
        .json({ message: "You can only update your own restaurant's status" });
    }

    const { is_open } = req.body;

    if (typeof is_open !== "boolean") {
      return res.status(400).json({ message: "is_open must be a boolean" });
    }

    const result = await pool.query(
      `UPDATE restaurants SET is_open = $1 WHERE id = $2
     RETURNING id, name, is_open`,
      [is_open, restaurantId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    return res.status(200).json({
      restaurantId: result.rows[0].id,
      restaurantName: result.rows[0].name,
      isOpen: result.rows[0].is_open,
    });
  },
);

module.exports = router;
