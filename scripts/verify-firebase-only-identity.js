require("dotenv").config();
const { Client } = require("pg");

async function verifyFirebaseOnlyIdentity() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const columns = await client.query(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('carts', 'cart_items', 'orders')
      ORDER BY table_name, ordinal_position;
    `);

    console.log(JSON.stringify(columns.rows, null, 2));
  } catch (error) {
    console.error("Verification failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

verifyFirebaseOnlyIdentity();
