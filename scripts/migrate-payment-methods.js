require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

async function migratePaymentMethods() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE orders
      DROP CONSTRAINT IF EXISTS orders_payment_method_check;
    `);

    await client.query(`
      ALTER TABLE orders
      ADD CONSTRAINT orders_payment_method_check
      CHECK (payment_method IN ('cash', 'mtn-momo', 'orange-mobile-money'));
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: payment_method constraint updated to cash, mtn-momo, orange-mobile-money.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migratePaymentMethods();
