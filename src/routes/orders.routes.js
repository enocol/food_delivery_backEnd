const express = require("express");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const { ORDER_STATUSES, PAYMENT_METHODS } = require("../utils/constants");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

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
      unitPrice: Number(item.unit_price),
      subtotal: Number(item.subtotal),
    })),
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.delivery_fee),
    total: Number(order.total),
    deliveryAddress: order.delivery_address,
    paymentMethod: order.payment_method,
    status: order.status,
    createdAt: order.created_at,
    statusHistory: statusResult.rows.map((entry) => ({
      status: entry.status,
      timestamp: entry.timestamp,
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
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    deliveryAddress: row.delivery_address,
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
    subtotal: Number(row.subtotal),
    deliveryFee: Number(row.delivery_fee),
    deliveryAddress: row.delivery_address,
    paymentMethod: row.payment_method,
    status: row.status,
    createdAt: row.created_at,
    user: {
      id: row.firebase_uid,
      name: row.name,
      email: row.email,
      phone: row.phone,
    },
  }));
}

router.post("/", requireAuth, async (req, res) => {
  const { deliveryAddress, paymentMethod } = req.body;
  const userId = req.auth.userId;

  if (!deliveryAddress || !paymentMethod) {
    return res.status(400).json({
      message: "deliveryAddress and paymentMethod are required",
    });
  }

  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({
      message: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`,
    });
  }

  const userResult = await pool.query(
    "SELECT firebase_uid FROM users WHERE firebase_uid = $1",
    [userId],
  );
  if (userResult.rowCount === 0) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  const cartItemsResult = await pool.query(
    `
    SELECT ci.menu_item_id, ci.quantity, mi.name, mi.price
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
      quantity: item.quantity,
      name: item.name,
      unitPrice: Number(item.price),
      subtotal: Number((Number(item.price) * item.quantity).toFixed(2)),
    })),
  };
  hydrated.subtotal = Number(
    hydrated.items.reduce((acc, item) => acc + item.subtotal, 0).toFixed(2),
  );

  if (hydrated.items.length === 0) {
    return res.status(400).json({
      message: "Cart is empty",
    });
  }

  const deliveryFee = 20;
  const total = Number((hydrated.subtotal + deliveryFee).toFixed(2));

  const orderId = `o_${randomUUID()}`;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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
        deliveryAddress,
        paymentMethod,
      ],
    );

    for (const item of hydrated.items) {
      await client.query(
        `
        INSERT INTO order_items (
          order_id,
          menu_item_id,
          name_snapshot,
          unit_price,
          quantity,
          subtotal
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          orderId,
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

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const order = await getOrderWithDetails(orderId);

  return res.status(201).json({
    message: "Order created",
    order,
  });
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
      SELECT menu_item_id, name_snapshot, unit_price, quantity, subtotal
      FROM order_items
      WHERE order_id = $1
      ORDER BY id ASC
      `,
      [orderRow.id],
    );

    const items = itemsResult.rows.map((item) => ({
      name: item.name_snapshot,
      qty: item.quantity,
      price: Number(item.unit_price),
    }));

    const itemCount = items.reduce((sum, item) => sum + item.qty, 0);

    orders.push({
      id: orderRow.id,
      created_at: orderRow.created_at,
      total: Number(orderRow.total),
      status: orderRow.status,
      totals: {
        itemCount,
        cartTotal: Number(orderRow.total),
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

router.patch("/:orderId/status", async (req, res) => {
  const { status } = req.body;

  if (!status || !ORDER_STATUSES.includes(status)) {
    return res.status(400).json({
      message: `status must be one of: ${ORDER_STATUSES.join(", ")}`,
    });
  }

  const updateResult = await pool.query(
    `
    UPDATE orders
    SET status = $1
    WHERE id = $2
    RETURNING id
    `,
    [status, req.params.orderId],
  );

  if (updateResult.rowCount === 0) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  await pool.query(
    `
    INSERT INTO order_status_history (order_id, status)
    VALUES ($1, $2)
    `,
    [req.params.orderId, status],
  );

  const order = await getOrderWithDetails(req.params.orderId);

  return res.status(200).json({
    message: "Order status updated",
    order,
  });
});

module.exports = router;
