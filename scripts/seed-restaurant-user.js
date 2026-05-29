require("dotenv").config();
const { Client } = require("pg");
const bcrypt = require("bcrypt");
const readline = require("readline");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Show available restaurants
  const { rows } = await client.query(
    "SELECT id, name FROM restaurants ORDER BY name",
  );
  if (rows.length === 0) {
    console.error("No restaurants found. Create a restaurant first.");
    await client.end();
    rl.close();
    process.exit(1);
  }

  console.log("\nAvailable restaurants:");
  rows.forEach((r, i) => console.log(`  [${i + 1}] ${r.name}  (id: ${r.id})`));

  const choice = parseInt(await ask("\nEnter number: "), 10);
  if (!choice || choice < 1 || choice > rows.length) {
    console.error("Invalid choice.");
    await client.end();
    rl.close();
    process.exit(1);
  }

  const restaurant = rows[choice - 1];
  const email = (await ask("Email for this restaurant user: ")).trim();
  const password = (await ask("Password: ")).trim();
  const role =
    (await ask("Role (owner/manager/staff) [owner]: ")).trim() || "owner";

  if (!["owner", "manager", "staff"].includes(role)) {
    console.error("Invalid role. Must be owner, manager, or staff.");
    await client.end();
    rl.close();
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await client.query(
    `INSERT INTO restaurant_users (restaurant_id, email, password_hash, role)
     VALUES ($1, $2, $3, $4)`,
    [restaurant.id, email, passwordHash, role],
  );

  console.log(`\nDone! Restaurant user created:`);
  console.log(`  Restaurant : ${restaurant.name}`);
  console.log(`  Email      : ${email}`);
  console.log(`  Role       : ${role}`);

  await client.end();
  rl.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
