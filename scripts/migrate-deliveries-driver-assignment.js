require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateDeliveriesDriverAssignment() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS drivers (
        id               SERIAL PRIMARY KEY,
        firebase_uid     TEXT UNIQUE,
        phone            TEXT,
        is_online        BOOLEAN NOT NULL DEFAULT FALSE,
        current_location TEXT,
        socket_id        TEXT,
        status           TEXT NOT NULL DEFAULT 'Offline'
      );
    `);

    await client.query(`
      ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS assigned_driver_firebase_uid TEXT;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'deliveries_assigned_driver_firebase_uid_fkey'
        ) THEN
          ALTER TABLE deliveries
          ADD CONSTRAINT deliveries_assigned_driver_firebase_uid_fkey
          FOREIGN KEY (assigned_driver_firebase_uid)
          REFERENCES drivers(firebase_uid)
          ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_deliveries_assigned_driver_firebase_uid
      ON deliveries(assigned_driver_firebase_uid);
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_firebase_uid
      ON drivers(firebase_uid);
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: deliveries assignment is now tied to driver identity.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateDeliveriesDriverAssignment();
