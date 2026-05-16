require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateLikesTable() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS likes (
        firebase_uid TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
        restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (firebase_uid, restaurant_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_likes_restaurant_id
      ON likes(restaurant_id);
    `);

    await client.query("COMMIT");
    console.log("Migration completed: likes table is ready.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateLikesTable();
