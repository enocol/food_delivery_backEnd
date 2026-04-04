require("dotenv").config();
const { Client } = require("pg");

async function verifyRestaurantColumns() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    const result = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'restaurants' ORDER BY ordinal_position",
    );

    const columns = result.rows.map((row) => row.column_name);
    console.log("Restaurant columns:", columns.join(", "));

    if (!columns.includes("image_url")) {
      console.error("image_url column is missing");
      process.exitCode = 1;
      return;
    }

    console.log("image_url column is present.");
  } catch (error) {
    console.error("Failed to verify restaurant columns:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

verifyRestaurantColumns();
