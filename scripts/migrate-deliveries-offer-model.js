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
      ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'offered', 'accepted'));
    `);

    await client.query(`
      ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS offered_driver_firebase_uid TEXT;
    `);

    await client.query(`
      ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ;
    `);

    // Rows created before this column existed may already have a confirmed
    // driver from the old broadcast/first-to-claim model — don't leave them
    // looking like brand-new, undispatched jobs.
    await client.query(`
      UPDATE deliveries
      SET status = 'accepted'
      WHERE assigned_driver_firebase_uid IS NOT NULL
        AND status = 'pending';
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS delivery_offers (
        id BIGSERIAL PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        driver_firebase_uid TEXT NOT NULL,
        offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        responded_at TIMESTAMPTZ,
        response TEXT CHECK (response IN ('accepted', 'declined', 'cancelled'))
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_delivery_offers_order_id ON delivery_offers(order_id);
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: deliveries.status/offered_driver_firebase_uid/offered_at added, delivery_offers history table created.",
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
