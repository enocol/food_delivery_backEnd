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
      ALTER TABLE cart_items
      ADD COLUMN IF NOT EXISTS image_url TEXT;
    `);

    await client.query(`
      UPDATE cart_items ci
      SET image_url = mi.image_url
      FROM menu_items mi
      WHERE ci.menu_item_id = mi.id
        AND ci.image_url IS NULL
        AND mi.image_url IS NOT NULL;
    `);

    await client.query("COMMIT");
    console.log("Migration completed: cart_items.image_url added.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrate();
