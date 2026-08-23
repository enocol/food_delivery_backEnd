require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateOrdersRestaurantIdNotNull() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    const nullCountResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM orders
      WHERE restaurant_id IS NULL;
    `);
    const nullCount = nullCountResult.rows[0].count;

    if (nullCount > 0) {
      await client.query("ROLLBACK");
      console.error(
        `Migration aborted: ${nullCount} order(s) still have a NULL restaurant_id. Resolve them (they likely span multiple restaurants) before enforcing NOT NULL.`,
      );
      process.exitCode = 1;
      return;
    }

    await client.query(`
      ALTER TABLE orders
      ALTER COLUMN restaurant_id SET NOT NULL;
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: orders.restaurant_id is now NOT NULL.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateOrdersRestaurantIdNotNull();
