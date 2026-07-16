require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateUserPushTokensTable() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_push_tokens (
        id TEXT PRIMARY KEY,
        firebase_uid TEXT NOT NULL,
        fcm_token TEXT NOT NULL,
        platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
        device_id TEXT NULL,
        app_version TEXT NULL,
        locale TEXT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query("COMMIT");
    console.log("Migration completed: user_push_tokens table is ready.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateUserPushTokensTable();
