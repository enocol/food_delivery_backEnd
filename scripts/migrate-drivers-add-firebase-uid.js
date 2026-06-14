require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateDriversAddFirebaseUid() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    // Add firebase_uid column if it does not already exist
    await client.query(`
      ALTER TABLE drivers
        ADD COLUMN IF NOT EXISTS firebase_uid TEXT UNIQUE;
    `);

    // Index for fast lookups by firebase_uid
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_firebase_uid
      ON drivers(firebase_uid);
    `);

    await client.query("COMMIT");
    console.log("Migration completed: firebase_uid column added to drivers.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateDriversAddFirebaseUid();
