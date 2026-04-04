const express = require("express");
const pool = require("../config/db");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

router.use(requireAuth);

function ensureOwnCart(req, res, next) {
  if (req.auth.userId !== req.params.userId) {
    return res.status(403).json({
      message: "You can only access your own cart",
    });
  }

  return next();
}

async function ensureCartExists(userId) {
  await pool.query(
    `
    INSERT INTO carts (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId],
  );
}

async function fetchHydratedCart(userId) {
  await ensureCartExists(userId);

  const result = await pool.query(
    `
    SELECT ci.menu_item_id, ci.quantity, mi.name, mi.price
    FROM cart_items ci
    JOIN menu_items mi ON mi.id = ci.menu_item_id
    WHERE ci.user_id = $1
    ORDER BY ci.id ASC
    `,
    [userId],
  );

  const items = result.rows.map((row) => {
    const unitPrice = Number(row.price);
    return {
      menuItemId: row.menu_item_id,
      quantity: row.quantity,
      name: row.name,
      unitPrice,
      subtotal: Number((unitPrice * row.quantity).toFixed(2)),
    };
  });

  const subtotal = Number(
    items.reduce((acc, item) => acc + item.subtotal, 0).toFixed(2),
  );

  return {
    userId,
    items,
    subtotal,
  };
}

router.get("/:userId", ensureOwnCart, async (req, res) => {
  const cart = await fetchHydratedCart(req.params.userId);
  return res.status(200).json(cart);
});

router.post("/:userId/items", ensureOwnCart, async (req, res) => {
  const { menuItemId, quantity } = req.body;

  if (!menuItemId || !Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({
      message: "menuItemId and positive integer quantity are required",
    });
  }

  const menuItemResult = await pool.query(
    `
    SELECT id
    FROM menu_items
    WHERE id = $1 AND is_available = TRUE
    `,
    [menuItemId],
  );

  if (menuItemResult.rowCount === 0) {
    return res.status(404).json({
      message: "Menu item is not available",
    });
  }

  await ensureCartExists(req.params.userId);
  await pool.query(
    `
    INSERT INTO cart_items (user_id, menu_item_id, quantity)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, menu_item_id)
    DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
    `,
    [req.params.userId, menuItemId, quantity],
  );

  const cart = await fetchHydratedCart(req.params.userId);

  return res.status(200).json({
    message: "Item added to cart",
    cart,
  });
});

router.patch("/:userId/items/:menuItemId", ensureOwnCart, async (req, res) => {
  const { quantity } = req.body;

  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({
      message: "quantity must be a positive integer",
    });
  }

  const updateResult = await pool.query(
    `
    UPDATE cart_items
    SET quantity = $1
    WHERE user_id = $2 AND menu_item_id = $3
    `,
    [quantity, req.params.userId, req.params.menuItemId],
  );

  if (updateResult.rowCount === 0) {
    return res.status(404).json({
      message: "Cart item not found",
    });
  }

  const cart = await fetchHydratedCart(req.params.userId);

  return res.status(200).json({
    message: "Cart item updated",
    cart,
  });
});

router.delete("/:userId/items/:menuItemId", ensureOwnCart, async (req, res) => {
  const deleteResult = await pool.query(
    `
    DELETE FROM cart_items
    WHERE user_id = $1 AND menu_item_id = $2
    `,
    [req.params.userId, req.params.menuItemId],
  );

  if (deleteResult.rowCount === 0) {
    return res.status(404).json({
      message: "Cart item not found",
    });
  }

  const cart = await fetchHydratedCart(req.params.userId);

  return res.status(200).json({
    message: "Item removed from cart",
    cart,
  });
});

router.delete("/:userId", ensureOwnCart, async (req, res) => {
  await ensureCartExists(req.params.userId);
  await pool.query("DELETE FROM cart_items WHERE user_id = $1", [
    req.params.userId,
  ]);

  const cart = await fetchHydratedCart(req.params.userId);

  return res.status(200).json({
    message: "Cart cleared",
    cart,
  });
});

module.exports = router;
