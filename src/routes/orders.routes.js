const express = require("express");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const {
  ORDER_STATUSES,
  PAYMENT_METHODS,
  DELIVERY_FEE_PER_MILE,
} = require("../utils/constants");
const {
  buildIdempotencyRequestHash,
  ensureIdempotencyTable,
} = require("../utils/idempotency");
const { toCurrencyInt } = require("../utils/currency");
const {
  parseCoordinateValue,
  toCoordinateStorageValue,
  haversineDistanceMiles,
} = require("../utils/coordinates");
const { withSchemaVersion } = require("../utils/eventPayload");
const { toRfc3339Utc } = require("../utils/time");
const { getFirebaseMessaging } = require("../config/firebaseAdmin");
const requireAuth = require("../middleware/requireAuth");
const requireRestaurantAuth = require("../middleware/requireRestaurantAuth");
const requireVerifiedEmail = require("../middleware/requireVerifiedEmail");

const router = express.Router();

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

function isExpoPushToken(token) {
  return (
    /^ExponentPushToken\[[^\]]+\]$/.test(token) ||
    /^ExpoPushToken\[[^\]]+\]$/.test(token)
  );
}

function chunkArray(values, chunkSize) {
  const chunks = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

function getOrderStatusNotificationContent(orderId, status) {
  if (status === "cancelled") {
    return {
      title: "Order cancelled",
      body: `Your order #${orderId} was cancelled by the restaurant.`,
    };
  }

  return {
    title: "Order confirmed",
    body: `Your order #${orderId} has been confirmed by the restaurant.`,
  };
}

async function sendOrderStatusPush(orderId, customerUid, status) {
  const tokensResult = await pool.query(
    `
    SELECT fcm_token
    FROM user_push_tokens
    WHERE firebase_uid = $1
      AND is_active = TRUE
    `,
    [customerUid],
  );

  const tokens = tokensResult.rows
    .map((row) => row.fcm_token)
    .filter((token) => typeof token === "string" && token.trim().length > 0);

  if (tokens.length === 0) {
    return;
  }

  const fcmTokens = [];
  const expoTokens = [];

  for (const token of tokens.map((value) => value.trim())) {
    if (isExpoPushToken(token)) {
      expoTokens.push(token);
    } else {
      fcmTokens.push(token);
    }
  }

  const notification = getOrderStatusNotificationContent(orderId, status);
  const updatedAt = new Date().toISOString();
  const inactiveTokens = [];
  const invalidTokenCodes = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
  ]);

  if (fcmTokens.length > 0) {
    try {
      const response = await getFirebaseMessaging().sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          type: "order_status_updated",
          orderId: String(orderId),
          status: String(status),
          updatedAt,
        },
      });

      response.responses.forEach((result, index) => {
        if (!result.success && invalidTokenCodes.has(result.error?.code)) {
          inactiveTokens.push(fcmTokens[index]);
        }
      });
    } catch (error) {
      console.error(
        `FCM send failed for order ${orderId} and user ${customerUid}:`,
        error.message,
      );
    }
  }

  if (expoTokens.length > 0) {
    const expoTokenChunks = chunkArray(expoTokens, 100);

    for (const chunk of expoTokenChunks) {
      try {
        const expoResponse = await fetch(EXPO_PUSH_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(
            chunk.map((token) => ({
              to: token,
              title: notification.title,
              body: notification.body,
              sound: "default",
              data: {
                type: "order_status_updated",
                orderId: String(orderId),
                status: String(status),
                updatedAt,
              },
            })),
          ),
        });

        if (!expoResponse.ok) {
          console.error(
            `Expo push send failed for order ${orderId}: HTTP ${expoResponse.status}`,
          );
          continue;
        }

        const expoPayload = await expoResponse.json();
        const results = Array.isArray(expoPayload.data) ? expoPayload.data : [];

        results.forEach((result, index) => {
          const detailsError = result?.details?.error;
          if (
            result?.status === "error" &&
            detailsError === "DeviceNotRegistered"
          ) {
            inactiveTokens.push(chunk[index]);
          }
        });
      } catch (error) {
        console.error(
          `Expo push send failed for order ${orderId} and user ${customerUid}:`,
          error.message,
        );
      }
    }
  }

  if (inactiveTokens.length > 0) {
    const uniqueInactiveTokens = Array.from(new Set(inactiveTokens));
    await pool.query(
      `
      UPDATE user_push_tokens
      SET is_active = FALSE, updated_at = NOW()
      WHERE fcm_token = ANY($1::text[])
      `,
      [uniqueInactiveTokens],
    );
  }
}

function normalizeDeliveryAddress(deliveryAddress) {
  if (deliveryAddress && typeof deliveryAddress === "object") {
    const latitude = Number(deliveryAddress.latitude);
    const longitude = Number(deliveryAddress.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        error: "deliveryAddress must include numeric latitude and longitude",
      };
    }

    return {
      // orders.delivery_address is TEXT; store coordinates as JSON text
      dbValue: toCoordinateStorageValue({ latitude, longitude }),
      payloadValue: { latitude, longitude },
    };
  }

  return {
    error:
      "deliveryAddress is required and must be an object with numeric latitude and longitude, so the delivery fee can be calculated",
  };
}

async function getOrderWithDetails(orderId) {
  const orderResult = await pool.query(
    `
    SELECT
      id,
      firebase_uid,
      subtotal,
      delivery_fee,
      total,
      delivery_address,
      payment_method,
      status,
      payment_status,
      created_at
    FROM orders
    WHERE id = $1
    `,
    [orderId],
  );

  const order = orderResult.rows[0];
  if (!order) {
    return null;
  }

  const itemsResult = await pool.query(
    `
    SELECT menu_item_id, name_snapshot, unit_price, quantity, subtotal
    FROM order_items
    WHERE order_id = $1
    ORDER BY id ASC
    `,
    [orderId],
  );

  const statusResult = await pool.query(
    `
    SELECT status, timestamp
    FROM order_status_history
    WHERE order_id = $1
    ORDER BY timestamp ASC
    `,
    [orderId],
  );

  return {
    id: order.id,
    userId: order.firebase_uid,
    items: itemsResult.rows.map((item) => ({
      menuItemId: item.menu_item_id,
      quantity: item.quantity,
      name: item.name_snapshot,
      unitPrice: toCurrencyInt(item.unit_price) ?? 0,
      subtotal: toCurrencyInt(item.subtotal) ?? 0,
    })),
    subtotal: toCurrencyInt(order.subtotal) ?? 0,
    deliveryFee: toCurrencyInt(order.delivery_fee) ?? 0,
    total: toCurrencyInt(order.total) ?? 0,
    deliveryAddress:
      parseCoordinateValue(order.delivery_address) ?? order.delivery_address,
    paymentMethod: order.payment_method,
    status: order.status,
    paymentStatus: order.payment_status,
    createdAt: toRfc3339Utc(order.created_at),
    statusHistory: statusResult.rows.map((entry) => ({
      status: entry.status,
      timestamp: toRfc3339Utc(entry.timestamp),
    })),
  };
}

async function getOrderRestaurantSummary(orderId) {
  const summaryResult = await pool.query(
    `
    SELECT
      o.id AS order_id,
      o.subtotal,
      o.delivery_fee,
      o.delivery_address,
      o.payment_method,
      u.firebase_uid,
      u.name,
      u.email,
      u.phone
    FROM orders o
    JOIN users u ON u.firebase_uid = o.firebase_uid
    WHERE o.id = $1
    `,
    [orderId],
  );

  const row = summaryResult.rows[0];
  if (!row) {
    return null;
  }

  return {
    orderId: row.order_id,
    subtotal: toCurrencyInt(row.subtotal) ?? 0,
    deliveryFee: toCurrencyInt(row.delivery_fee) ?? 0,
    deliveryAddress:
      parseCoordinateValue(row.delivery_address) ?? row.delivery_address,
    paymentMethod: row.payment_method,
    user: {
      id: row.firebase_uid,
      name: row.name,
      email: row.email,
      phone: row.phone,
    },
  };
}

async function getAllOrdersWithUserSummary() {
  const result = await pool.query(
    `
    SELECT
      o.id AS order_id,
      o.subtotal,
      o.delivery_fee,
      o.delivery_address,
      o.payment_method,
      o.status,
      o.payment_status,
      o.created_at,
      u.firebase_uid,
      u.name,
      u.email,
      u.phone
    FROM orders o
    JOIN users u ON u.firebase_uid = o.firebase_uid
    ORDER BY o.created_at DESC
    `,
  );

  return result.rows.map((row) => ({
    orderId: row.order_id,
    subtotal: toCurrencyInt(row.subtotal) ?? 0,
    deliveryFee: toCurrencyInt(row.delivery_fee) ?? 0,
    deliveryAddress:
      parseCoordinateValue(row.delivery_address) ?? row.delivery_address,
    paymentMethod: row.payment_method,
    status: row.status,
    paymentStatus: row.payment_status,
    createdAt: toRfc3339Utc(row.created_at),
    user: {
      id: row.firebase_uid,
      name: row.name,
      email: row.email,
      phone: row.phone,
    },
  }));
}

async function getAllOrdersWithRestaurants() {
  const result = await pool.query(
    `
    SELECT
      o.id AS order_id,
      o.subtotal,
      o.delivery_fee,
      o.total,
      o.delivery_address,
      o.payment_method,
      o.status,
      o.payment_status,
      o.created_at,
      u.firebase_uid,
      u.name AS user_name,
      u.email AS user_email,
      u.phone AS user_phone,
      oi.restaurant_id,
      oi.menu_item_id,
      oi.name_snapshot,
      oi.unit_price,
      oi.quantity,
      oi.subtotal AS item_subtotal,
      r.name AS restaurant_name,
      r.location AS restaurant_location
    FROM orders o
    JOIN users u ON u.firebase_uid = o.firebase_uid
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN restaurants r ON r.id = oi.restaurant_id
    ORDER BY o.created_at DESC, o.id ASC, oi.restaurant_id ASC, oi.id ASC
    `,
  );

  const ordersById = new Map();

  for (const row of result.rows) {
    if (!ordersById.has(row.order_id)) {
      ordersById.set(row.order_id, {
        orderId: row.order_id,
        subtotal: toCurrencyInt(row.subtotal) ?? 0,
        deliveryFee: toCurrencyInt(row.delivery_fee) ?? 0,
        total: toCurrencyInt(row.total) ?? 0,
        deliveryAddress:
          parseCoordinateValue(row.delivery_address) ?? row.delivery_address,
        paymentMethod: row.payment_method,
        status: row.status,
        paymentStatus: row.payment_status,
        createdAt: toRfc3339Utc(row.created_at),
        user: {
          id: row.firebase_uid,
          name: row.user_name,
          email: row.user_email,
          phone: row.user_phone,
        },
        _restaurantsById: new Map(),
      });
    }

    if (row.restaurant_id == null) {
      continue;
    }

    const order = ordersById.get(row.order_id);
    const restaurantId = String(row.restaurant_id);

    if (!order._restaurantsById.has(restaurantId)) {
      order._restaurantsById.set(restaurantId, {
        id: restaurantId,
        name: row.restaurant_name ?? null,
        location:
          parseCoordinateValue(row.restaurant_location) ??
          row.restaurant_location ??
          null,
        items: [],
      });
    }

    order._restaurantsById.get(restaurantId).items.push({
      menuItemId: row.menu_item_id,
      name: row.name_snapshot,
      unitPrice: toCurrencyInt(row.unit_price) ?? 0,
      quantity: row.quantity,
      subtotal: toCurrencyInt(row.item_subtotal) ?? 0,
    });
  }

  return Array.from(ordersById.values()).map((order) => {
    const { _restaurantsById, ...serializedOrder } = order;
    return {
      ...serializedOrder,
      restaurants: Array.from(_restaurantsById.values()),
    };
  });
}

router.post("/", requireAuth, requireVerifiedEmail, async (req, res) => {
  const { deliveryAddress, paymentMethod } = req.body;
  const userId = req.auth.userId;
  const idempotencyKey = req.get("Idempotency-Key")?.trim() || null;
  const idempotencyScope = "orders.create";
  const requestHash = buildIdempotencyRequestHash({
    deliveryAddress,
    paymentMethod,
  });

  if (deliveryAddress == null || !paymentMethod) {
    return res.status(400).json({
      message: "deliveryAddress and paymentMethod are required",
    });
  }

  const normalizedDeliveryAddress = normalizeDeliveryAddress(deliveryAddress);
  if (normalizedDeliveryAddress.error) {
    return res.status(400).json({ message: normalizedDeliveryAddress.error });
  }

  const deliveryAddressForDb = normalizedDeliveryAddress.dbValue;
  const deliveryAddressForPayload = normalizedDeliveryAddress.payloadValue;

  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({
      message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`,
    });
  }

  const userResult = await pool.query(
    "SELECT firebase_uid, phone FROM users WHERE firebase_uid = $1",
    [userId],
  );
  if (userResult.rowCount === 0) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  const cartItemsResult = await pool.query(
    `
    SELECT ci.menu_item_id, ci.quantity, mi.name, mi.price, mi.restaurant_id
    FROM cart_items ci
    JOIN menu_items mi ON mi.id = ci.menu_item_id
    WHERE ci.firebase_uid = $1
    ORDER BY ci.id ASC
    `,
    [userId],
  );

  const hydrated = {
    items: cartItemsResult.rows.map((item) => ({
      menuItemId: item.menu_item_id,
      restaurantId: item.restaurant_id,
      quantity: item.quantity,
      name: item.name,
      unitPrice: toCurrencyInt(item.price) ?? 0,
      subtotal: (toCurrencyInt(item.price) ?? 0) * item.quantity,
    })),
  };
  hydrated.subtotal = hydrated.items.reduce(
    (acc, item) => acc + item.subtotal,
    0,
  );

  if (hydrated.items.length === 0) {
    return res.status(400).json({
      message: "Cart is empty",
    });
  }

  const restaurantIds = [
    ...new Set(hydrated.items.map((item) => item.restaurantId)),
  ];

  const restaurantsResult = await pool.query(
    `
    SELECT id, name, location
    FROM restaurants
    WHERE id = ANY($1::text[])
    `,
    [restaurantIds],
  );

  const restaurantLookup = new Map(
    restaurantsResult.rows.map((row) => [row.id, row]),
  );

  let farthestDistanceMiles = 0;
  for (const restaurantId of restaurantIds) {
    const restaurant = restaurantLookup.get(restaurantId);
    const restaurantCoordinates = parseCoordinateValue(restaurant?.location);

    if (!restaurantCoordinates) {
      return res.status(400).json({
        message:
          "One or more restaurants in your cart do not have a location set, so the delivery fee cannot be calculated",
      });
    }

    const distanceMiles = haversineDistanceMiles(
      restaurantCoordinates,
      deliveryAddressForPayload,
    );
    farthestDistanceMiles = Math.max(farthestDistanceMiles, distanceMiles);
  }

  const deliveryFee = Math.round(farthestDistanceMiles * DELIVERY_FEE_PER_MILE);
  const total = hydrated.subtotal + deliveryFee;

  const orderId = `o_${randomUUID()}`;

  const client = await pool.connect();
  let responseBody = null;

  try {
    await client.query("BEGIN");

    if (idempotencyKey) {
      await ensureIdempotencyTable(client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${idempotencyScope}:${userId}:${idempotencyKey}`,
      ]);

      const existingRecordResult = await client.query(
        `
        SELECT request_hash, response_status, response_body
        FROM api_idempotency_records
        WHERE idempotency_key = $1
          AND scope = $2
          AND actor_id = $3
        LIMIT 1
        `,
        [idempotencyKey, idempotencyScope, userId],
      );

      if (existingRecordResult.rowCount > 0) {
        const existingRecord = existingRecordResult.rows[0];
        if (existingRecord.request_hash !== requestHash) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message:
              "Idempotency-Key was already used with a different request payload",
          });
        }

        await client.query("ROLLBACK");
        return res
          .status(existingRecord.response_status)
          .json(existingRecord.response_body);
      }
    }

    await client.query(
      `
      INSERT INTO orders (
        id,
        firebase_uid,
        subtotal,
        delivery_fee,
        total,
        delivery_address,
        payment_method,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      `,
      [
        orderId,
        userId,
        hydrated.subtotal,
        deliveryFee,
        total,
        deliveryAddressForDb,
        paymentMethod,
      ],
    );

    for (const item of hydrated.items) {
      await client.query(
        `
        INSERT INTO order_items (
          order_id,
          restaurant_id,
          menu_item_id,
          name_snapshot,
          unit_price,
          quantity,
          subtotal
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          orderId,
          item.restaurantId,
          item.menuItemId,
          item.name,
          item.unitPrice,
          item.quantity,
          item.subtotal,
        ],
      );
    }

    await client.query(
      `
      INSERT INTO order_status_history (order_id, status)
      VALUES ($1, 'pending')
      `,
      [orderId],
    );

    await client.query("DELETE FROM cart_items WHERE firebase_uid = $1", [
      userId,
    ]);

    const order = await getOrderWithDetails(orderId);
    responseBody = {
      message: "Order created",
      order,
    };

    if (idempotencyKey) {
      await client.query(
        `
        INSERT INTO api_idempotency_records (
          idempotency_key,
          scope,
          actor_id,
          request_hash,
          response_status,
          response_body
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [
          idempotencyKey,
          idempotencyScope,
          userId,
          requestHash,
          201,
          JSON.stringify(responseBody),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const order = responseBody.order;

  // Notify each restaurant involved in this order via Socket.io
  const io = req.app.get("io");
  if (io) {
    const createdAt = new Date().toISOString();
    const customerPhone = userResult.rows[0].phone ?? null;
    for (const restaurantId of restaurantIds) {
      const restaurantItems = hydrated.items.filter(
        (item) => item.restaurantId === restaurantId,
      );
      const restaurantSubtotal = Number(
        restaurantItems.reduce((acc, item) => acc + item.subtotal, 0),
      );
      const restaurantTotal = restaurantSubtotal + deliveryFee;
      io.to(`restaurant:${restaurantId}`).emit(
        "new_order",
        withSchemaVersion({
          orderId,
          items: restaurantItems,
          subtotal: restaurantSubtotal,
          deliveryFee,
          total: restaurantTotal,
          deliveryAddress: deliveryAddressForPayload,
          paymentMethod,
          customerPhone,
          createdAt,
        }),
      );
    }

    try {
      const restaurants = restaurantIds.map((restaurantId) => {
        const restaurant = restaurantLookup.get(restaurantId);
        const itemNames = [
          ...new Set(
            hydrated.items
              .filter((item) => item.restaurantId === restaurantId)
              .map((item) => item.name),
          ),
        ];

        return {
          id: restaurantId,
          name: restaurant?.name || null,
          location: restaurant?.location || null,
          itemNames,
        };
      });

      const adminNewOrderPayload = {
        orderId,
        deliveryAddress: deliveryAddressForPayload,
        paymentMethod,
        restaurants,
        createdAt,
      };

      console.log(
        "admin_new_order payload -> admin room:",
        adminNewOrderPayload,
      );
      io.to("admin").emit(
        "admin_new_order",
        withSchemaVersion(adminNewOrderPayload),
      );
    } catch (error) {
      console.error("Failed to emit admin_new_order:", error.message);
    }
  }

  return res.status(201).json(responseBody);
});

router.get("/user/:userId", requireAuth, async (req, res) => {
  if (req.auth.userId !== req.params.userId) {
    return res.status(403).json({
      message: "You can only access your own orders",
    });
  }

  const ordersResult = await pool.query(
    `
    SELECT
      id,
      firebase_uid,
      subtotal,
      delivery_fee,
      total,
      delivery_address,
      payment_method,
      status,
      payment_status,
      created_at
    FROM orders
    WHERE firebase_uid = $1
    ORDER BY created_at DESC
    `,
    [req.params.userId],
  );

  const orders = [];
  for (const orderRow of ordersResult.rows) {
    const itemsResult = await pool.query(
      `
      SELECT oi.menu_item_id, oi.name_snapshot, oi.unit_price, oi.quantity, oi.subtotal, r.name AS restaurant_name
      FROM order_items oi
      LEFT JOIN restaurants r ON oi.restaurant_id = r.id
      WHERE oi.order_id = $1
      ORDER BY oi.id ASC
      `,
      [orderRow.id],
    );

    const items = itemsResult.rows.map((item) => ({
      name: item.name_snapshot,
      qty: item.quantity,
      price: toCurrencyInt(item.unit_price) ?? 0,
      restaurantName: item.restaurant_name,
    }));

    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

    orders.push({
      id: orderRow.id,
      created_at: toRfc3339Utc(orderRow.created_at),
      total: toCurrencyInt(orderRow.total) ?? 0,
      status: orderRow.status,
      paymentStatus: orderRow.payment_status,
      totals: {
        itemCount,
        cartTotal: toCurrencyInt(orderRow.total) ?? 0,
      },
      items,
    });
  }

  return res.status(200).json({
    count: orders.length,
    orders,
  });
});

router.get("/all", requireAuth, async (req, res) => {
  const orders = await getAllOrdersWithUserSummary();

  return res.status(200).json({
    count: orders.length,
    orders,
  });
});

router.get("/all-with-restaurants", requireAuth, async (req, res) => {
  const orders = await getAllOrdersWithRestaurants();

  return res.status(200).json({
    count: orders.length,
    orders,
  });
});

router.get(
  "/restaurant/:restaurantId",
  requireRestaurantAuth,
  async (req, res) => {
    const { restaurantId } = req.params;

    if (req.restaurantAuth.restaurantId !== restaurantId) {
      return res.status(403).json({
        message: "You can only access orders for your own restaurant",
      });
    }

    const result = await pool.query(
      `
    SELECT
      o.id AS order_id,
      o.status,
      o.payment_status,
      o.subtotal,
      o.delivery_fee,
      o.total,
      o.delivery_address,
      o.payment_method,
      o.created_at,
      u.firebase_uid,
      u.name,
      u.email,
      u.phone
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN users u ON u.firebase_uid = o.firebase_uid
    WHERE oi.restaurant_id = $1
    GROUP BY o.id, u.firebase_uid, u.name, u.email, u.phone
    ORDER BY o.created_at DESC
    `,
      [restaurantId],
    );

    const orderIds = result.rows.map((r) => r.order_id);

    let itemsByOrder = {};
    if (orderIds.length > 0) {
      const itemsResult = await pool.query(
        `
      SELECT order_id, menu_item_id, name_snapshot, unit_price, quantity, subtotal
      FROM order_items
      WHERE order_id = ANY($1) AND restaurant_id = $2
      ORDER BY id ASC
      `,
        [orderIds, restaurantId],
      );
      for (const item of itemsResult.rows) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
        itemsByOrder[item.order_id].push({
          menuItemId: item.menu_item_id,
          name: item.name_snapshot,
          unitPrice: toCurrencyInt(item.unit_price) ?? 0,
          quantity: item.quantity,
          subtotal: toCurrencyInt(item.subtotal) ?? 0,
        });
      }
    }

    const orders = result.rows.map((row) => ({
      orderId: row.order_id,
      status: row.status,
      paymentStatus: row.payment_status,
      subtotal: toCurrencyInt(row.subtotal) ?? 0,
      deliveryFee: toCurrencyInt(row.delivery_fee) ?? 0,
      total: toCurrencyInt(row.total) ?? 0,
      deliveryAddress:
        parseCoordinateValue(row.delivery_address) ?? row.delivery_address,
      paymentMethod: row.payment_method,
      createdAt: toRfc3339Utc(row.created_at),
      customer: {
        id: row.firebase_uid,
        name: row.name,
        email: row.email,
        phone: row.phone,
      },
      items: itemsByOrder[row.order_id] || [],
    }));

    return res.status(200).json({
      count: orders.length,
      orders,
    });
  },
);

router.get("/:orderId", requireAuth, async (req, res) => {
  const order = await getOrderWithDetails(req.params.orderId);

  if (!order) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  if (order.userId !== req.auth.userId) {
    return res.status(403).json({
      message: "You can only access your own orders",
    });
  }

  return res.status(200).json({ order });
});

router.delete("/:orderId", requireRestaurantAuth, async (req, res) => {
  const { orderId } = req.params;

  const orderResult = await pool.query(
    `
    SELECT o.status
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.id = $1 AND oi.restaurant_id = $2
    LIMIT 1
    `,
    [orderId, req.restaurantAuth.restaurantId],
  );

  if (orderResult.rowCount === 0) {
    return res.status(404).json({ message: "Order not found" });
  }

  const { status } = orderResult.rows[0];

  if (!["pending", "cancelled"].includes(status)) {
    return res.status(409).json({
      message: "Only pending or cancelled orders can be deleted",
    });
  }

  await pool.query("DELETE FROM orders WHERE id = $1", [orderId]);

  return res.status(200).json({ message: "Order deleted" });
});

router.get("/:orderId/restaurant-summary", async (req, res) => {
  const summary = await getOrderRestaurantSummary(req.params.orderId);

  if (!summary) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  return res.status(200).json({
    order: summary,
  });
});

router.patch("/:orderId/status", requireRestaurantAuth, async (req, res) => {
  const { status } = req.body;
  const idempotencyKey = req.get("Idempotency-Key")?.trim() || null;
  const idempotencyScope = "orders.status.update";
  const actorId = req.restaurantAuth.restaurantUserId;
  const requestHash = buildIdempotencyRequestHash({
    orderId: req.params.orderId,
    status,
  });

  if (!status || !ORDER_STATUSES.includes(status)) {
    return res.status(400).json({
      message: `status must be one of: ${ORDER_STATUSES.join(", ")}`,
    });
  }

  const client = await pool.connect();

  let customerUid = null;
  let order = null;
  let responseBody = null;

  try {
    await client.query("BEGIN");

    if (idempotencyKey) {
      await ensureIdempotencyTable(client);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${idempotencyScope}:${actorId}:${idempotencyKey}`,
      ]);

      const existingRecordResult = await client.query(
        `
        SELECT request_hash, response_status, response_body
        FROM api_idempotency_records
        WHERE idempotency_key = $1
          AND scope = $2
          AND actor_id = $3
        LIMIT 1
        `,
        [idempotencyKey, idempotencyScope, String(actorId)],
      );

      if (existingRecordResult.rowCount > 0) {
        const existingRecord = existingRecordResult.rows[0];
        if (existingRecord.request_hash !== requestHash) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            message:
              "Idempotency-Key was already used with a different request payload",
          });
        }

        await client.query("ROLLBACK");
        return res
          .status(existingRecord.response_status)
          .json(existingRecord.response_body);
      }
    }

    const updateResult = await client.query(
      `
      UPDATE orders
      SET status = $1
      WHERE id = $2
      RETURNING id, firebase_uid
      `,
      [status, req.params.orderId],
    );

    if (updateResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        message: "Order not found",
      });
    }

    customerUid = updateResult.rows[0].firebase_uid;

    await client.query(
      `
      INSERT INTO order_status_history (order_id, status)
      VALUES ($1, $2)
      `,
      [req.params.orderId, status],
    );

    if (status === "ready_for_pickup") {
      await client.query(
        `
        INSERT INTO deliveries (id, order_id, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (order_id)
        DO UPDATE SET updated_at = NOW()
        `,
        [`d_${randomUUID()}`, req.params.orderId],
      );
    }

    order = await getOrderWithDetails(req.params.orderId);
    responseBody = {
      message: "Order status updated",
      order,
    };

    if (idempotencyKey) {
      await client.query(
        `
        INSERT INTO api_idempotency_records (
          idempotency_key,
          scope,
          actor_id,
          request_hash,
          response_status,
          response_body
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [
          idempotencyKey,
          idempotencyScope,
          String(actorId),
          requestHash,
          200,
          JSON.stringify(responseBody),
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Keep Socket.IO only for driver dispatch notifications.
  const io = req.app.get("io");
  if (io) {
    // When order is ready for pickup, notify all available drivers
    if (status === "ready_for_pickup") {
      const deliveryInfoResult = await pool.query(
        `
        SELECT
          o.id          AS order_id,
          o.delivery_address,
          o.delivery_fee,
          r.name        AS restaurant_name,
          r.location    AS pickup_address
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN menu_items mi  ON mi.id = oi.menu_item_id
        JOIN restaurants r  ON r.id = mi.restaurant_id
        WHERE o.id = $1
        LIMIT 1
        `,
        [req.params.orderId],
      );

      if (deliveryInfoResult.rowCount > 0) {
        const d = deliveryInfoResult.rows[0];
        const onlineDriversResult = await pool.query(
          `SELECT firebase_uid FROM drivers WHERE is_online = TRUE`,
        );
        for (const driver of onlineDriversResult.rows) {
          io.to(`driver:${driver.firebase_uid}`).emit(
            "new_delivery_available",
            withSchemaVersion({
              orderId: d.order_id,
              restaurantName: d.restaurant_name,
              pickupAddress:
                parseCoordinateValue(d.pickup_address) ?? d.pickup_address,
              deliveryAddress:
                parseCoordinateValue(d.delivery_address) ?? d.delivery_address,
              fee: toCurrencyInt(d.delivery_fee) ?? 0,
            }),
          );
        }
      }
    }
  }

  if (["confirmed", "cancelled"].includes(status) && customerUid) {
    try {
      await sendOrderStatusPush(req.params.orderId, customerUid, status);
    } catch (error) {
      console.error(
        `Failed to send order status push for order ${req.params.orderId} (status: ${status}):`,
        error.message,
      );
    }
  }

  return res.status(200).json(responseBody);
});

module.exports = router;
