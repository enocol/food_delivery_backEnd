require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

async function migrateDeliveriesCurrentLocation() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE deliveries
      ADD COLUMN IF NOT EXISTS current_location TEXT;
    `);

    await client.query(`
      UPDATE deliveries
      SET current_location = CONCAT(current_lat::text, ',', current_lng::text)
      WHERE current_location IS NULL
        AND current_lat IS NOT NULL
        AND current_lng IS NOT NULL;
    `);

    await client.query(`
      ALTER TABLE deliveries
      DROP COLUMN IF EXISTS current_lat;
    `);

    await client.query(`
      ALTER TABLE deliveries
      DROP COLUMN IF EXISTS current_lng;
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: deliveries now uses current_location and removed current_lat/current_lng.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateDeliveriesCurrentLocation();
