require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
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
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS contact_phone TEXT;
    `);

    await client.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_notes TEXT CHECK (char_length(delivery_notes) <= 200);
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: orders.contact_phone and orders.delivery_notes columns added (delivery_notes capped at 200 characters).",
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
