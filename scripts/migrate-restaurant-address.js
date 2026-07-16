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
      ALTER TABLE restaurants
      ADD COLUMN IF NOT EXISTS location JSONB;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'restaurants'
            AND column_name = 'address'
        ) THEN
          UPDATE restaurants
          SET location = COALESCE(location, jsonb_build_object('address', address))
          WHERE address IS NOT NULL;

          ALTER TABLE restaurants
          DROP COLUMN address;
        END IF;
      END
      $$;
    `);

    await client.query(`
      DO $$
      DECLARE
        location_data_type TEXT;
      BEGIN
        SELECT data_type
        INTO location_data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'restaurants'
          AND column_name = 'location';

        IF location_data_type = 'text' THEN
          ALTER TABLE restaurants
          ALTER COLUMN location TYPE JSONB
          USING (
            CASE
              WHEN location IS NULL OR BTRIM(location) = '' THEN NULL
              WHEN LEFT(BTRIM(location), 1) = '{' THEN location::jsonb
              ELSE jsonb_build_object('address', location)
            END
          );
        END IF;
      END
      $$;
    `);

    await client.query(`
      ALTER TABLE menu_items
      ALTER COLUMN price SET DEFAULT 0;
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: restaurants.location is active, legacy restaurants.address removed, menu_items.price defaults to 0.",
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
