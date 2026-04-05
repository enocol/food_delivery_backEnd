const express = require("express");
const pool = require("../config/db");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.get("/:orderId/tracking", requireAuth, async (req, res) => {
  const orderResult = await pool.query(
    `
    SELECT id, firebase_uid, status
    FROM orders
    WHERE id = $1
    `,
    [req.params.orderId],
  );
  const order = orderResult.rows[0];

  if (!order) {
    return res.status(404).json({
      message: "Order not found",
    });
  }

  if (order.firebase_uid !== req.auth.userId) {
    return res.status(403).json({
      message: "You can only track your own orders",
    });
  }

  let etaMinutes = null;

  if (["pending", "confirmed", "preparing"].includes(order.status)) {
    etaMinutes = 35;
  } else if (order.status === "picked_up") {
    etaMinutes = 15;
  } else if (order.status === "on_the_way") {
    etaMinutes = 8;
  } else if (order.status === "delivered") {
    etaMinutes = 0;
  }

  const historyResult = await pool.query(
    `
    SELECT status, timestamp
    FROM order_status_history
    WHERE order_id = $1
    ORDER BY timestamp ASC
    `,
    [req.params.orderId],
  );

  return res.status(200).json({
    orderId: order.id,
    status: order.status,
    etaMinutes,
    history: historyResult.rows,
  });
});

module.exports = router;
