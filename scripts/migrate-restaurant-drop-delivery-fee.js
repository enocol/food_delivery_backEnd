require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

async function migrate() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE restaurants
      DROP COLUMN IF EXISTS delivery_fee;
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: restaurants.delivery_fee column removed. Order delivery fees are calculated per order from delivery distance and are unaffected.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrate();
