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
      CREATE TABLE IF NOT EXISTS contact_requests (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        company TEXT,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        need_type TEXT NOT NULL CHECK (need_type IN (
          'New Product Build',
          'Existing System Upgrade',
          'Mobile Application',
          'Payment/Mobile Money Integration',
          'Support and Maintenance',
          'Something Else'
        )),
        project_description TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_requests_created_at ON contact_requests(created_at DESC);
    `);

    await client.query("COMMIT");
    console.log(
      "Migration completed: contact_requests table created (captures the contact/quote-request form submissions).",
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
