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
      CREATE TABLE IF NOT EXISTS restaurant_users (
        id          BIGSERIAL PRIMARY KEY,
        restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        email       TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'staff'
                    CHECK (role IN ('owner', 'manager', 'staff')),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_restaurant_users_restaurant_id
      ON restaurant_users (restaurant_id);
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: restaurant_users table created successfully.",
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
