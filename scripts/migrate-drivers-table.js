require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateDriversTable() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id              SERIAL PRIMARY KEY,
        phone           TEXT,
        is_online       BOOLEAN NOT NULL DEFAULT FALSE,
        current_location TEXT,
        status          TEXT NOT NULL DEFAULT 'Offline'
      );
    `);

    await client.query("COMMIT");
    console.log("Migration completed: drivers table is ready.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateDriversTable();
