require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const NEW_STATUSES =
  "'pending', 'confirmed', 'preparing', 'picked_up', 'ready_for_pickup', 'on_the_way', 'delivered', 'cancelled'";

async function migrateOrderStatusConstraints() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    // Update orders.status constraint
    await client.query(`
      ALTER TABLE orders
      DROP CONSTRAINT IF EXISTS orders_status_check;
    `);
    await client.query(`
      ALTER TABLE orders
      ADD CONSTRAINT orders_status_check
      CHECK (status IN (${NEW_STATUSES}));
    `);

    // Update order_status_history.status constraint
    await client.query(`
      ALTER TABLE order_status_history
      DROP CONSTRAINT IF EXISTS order_status_history_status_check;
    `);
    await client.query(`
      ALTER TABLE order_status_history
      ADD CONSTRAINT order_status_history_status_check
      CHECK (status IN (${NEW_STATUSES}));
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: ready_for_pickup added to orders and order_status_history status constraints.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateOrderStatusConstraints();
