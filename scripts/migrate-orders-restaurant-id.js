require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateOrdersRestaurantId() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS restaurant_id TEXT REFERENCES restaurants(id) ON DELETE RESTRICT;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_orders_restaurant_id ON orders(restaurant_id);
    `);

    // Backfill orders whose items all belong to a single restaurant.
    // Orders spanning multiple restaurants are left NULL — they need the
    // checkout flow to split into one order per restaurant before they
    // can carry a single restaurant_id.
    const backfillResult = await client.query(`
      UPDATE orders o
      SET restaurant_id = sub.restaurant_id
      FROM (
        SELECT order_id, MIN(restaurant_id) AS restaurant_id
        FROM order_items
        GROUP BY order_id
        HAVING COUNT(DISTINCT restaurant_id) = 1
      ) sub
      WHERE o.id = sub.order_id
        AND o.restaurant_id IS NULL
      RETURNING o.id;
    `);

    const ambiguousResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM orders
      WHERE restaurant_id IS NULL;
    `);

    await client.query("COMMIT");
    console.log(
      `Migration completed: restaurant_id column added to orders. Backfilled ${backfillResult.rowCount} single-restaurant order(s). ${ambiguousResult.rows[0].count} order(s) span multiple restaurants and remain NULL — restaurant_id is not yet NOT NULL until checkout splits multi-restaurant carts into one order per restaurant.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateOrdersRestaurantId();
