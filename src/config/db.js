const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: Number(
    process.env.PG_CONNECTION_TIMEOUT_MS || 10000,
  ),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  keepAlive: true,
  max: Number(process.env.PG_POOL_MAX || 20),
});

pool.on("error", (error) => {
  console.error(
    "Unexpected PostgreSQL pool error on idle client:",
    error.message,
  );
});

module.exports = pool;
