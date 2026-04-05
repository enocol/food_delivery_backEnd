require("dotenv").config();
const { Client } = require("pg");

const expectedTables = [
  "users",
  "restaurants",
  "menu_items",
  "carts",
  "cart_items",
  "orders",
  "order_items",
  "order_status_history",
  "deliveries",
];

async function verifyTables() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const result = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );

    const found = result.rows.map((row) => row.table_name);
    const missing = expectedTables.filter((table) => !found.includes(table));

    console.log("Found tables:", found.join(", "));

    if (missing.length > 0) {
      console.error("Missing tables:", missing.join(", "));
      process.exitCode = 1;
      return;
    }

    console.log("All required Neon tables are present.");
  } catch (error) {
    console.error("Failed to verify Neon tables:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

verifyTables();
