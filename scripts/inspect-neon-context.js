require("dotenv").config();
const { Client } = require("pg");

async function inspect() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const context = await client.query(
      "SELECT current_database() AS database_name, current_schema() AS schema_name, current_user AS db_user",
    );

    const tables = await client.query(
      `
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_name = 'restaurants'
      ORDER BY table_schema, table_name
      `,
    );

    const columns = await client.query(
      `
      SELECT table_schema, table_name, column_name
      FROM information_schema.columns
      WHERE table_name = 'restaurants'
      ORDER BY table_schema, ordinal_position
      `,
    );

    console.log("Connection context:");
    console.log(JSON.stringify(context.rows[0], null, 2));
    console.log("Restaurants tables:");
    console.log(JSON.stringify(tables.rows, null, 2));
    console.log("Restaurants columns:");
    console.log(JSON.stringify(columns.rows, null, 2));
  } catch (error) {
    console.error("Inspection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

inspect();
