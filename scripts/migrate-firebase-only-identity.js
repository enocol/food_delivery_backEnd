require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateFirebaseOnlyIdentity() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    const tables = ["carts", "cart_items", "orders"];

    for (const table of tables) {
      await client.query(`
        ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
      `);

      const hasUserId = await client.query(
        `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = 'user_id'
        ) AS exists;
        `,
        [table],
      );

      if (hasUserId.rows[0].exists) {
        await client.query(`
          UPDATE ${table} t
          SET firebase_uid = u.firebase_uid
          FROM users u
          WHERE t.user_id = u.id
            AND t.firebase_uid IS NULL;
        `);
      }

      await client.query(`
        ALTER TABLE ${table}
        ALTER COLUMN firebase_uid SET NOT NULL;
      `);
    }

    await client.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid
           AND a.attnum = ANY (c.conkey)
          WHERE c.contype = 'f'
            AND c.conrelid = 'carts'::regclass
            AND a.attname = 'user_id'
        LOOP
          EXECUTE format('ALTER TABLE carts DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$;
    `);

    await client.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT c.conname, c.conrelid::regclass AS table_name
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.confrelid
           AND a.attnum = ANY (c.confkey)
          WHERE c.contype = 'f'
            AND c.confrelid = 'carts'::regclass
            AND a.attname = 'firebase_uid'
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.table_name, r.conname);
        END LOOP;
      END $$;
    `);

    await client.query(`
      ALTER TABLE carts
      DROP CONSTRAINT IF EXISTS carts_pkey;
    `);

    await client.query(`
      ALTER TABLE carts
      ADD CONSTRAINT carts_pkey PRIMARY KEY (firebase_uid);
    `);

    await client.query(`
      ALTER TABLE carts
      DROP CONSTRAINT IF EXISTS carts_firebase_uid_fkey;
    `);

    await client.query(`
      ALTER TABLE carts
      ADD CONSTRAINT carts_firebase_uid_fkey
      FOREIGN KEY (firebase_uid)
      REFERENCES users(firebase_uid)
      ON UPDATE CASCADE ON DELETE CASCADE;
    `);

    await client.query(`
      ALTER TABLE carts
      DROP COLUMN IF EXISTS user_id;
    `);

    await client.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid
           AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'cart_items'::regclass
            AND a.attname = 'user_id'
        LOOP
          EXECUTE format('ALTER TABLE cart_items DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$;
    `);

    await client.query(`
      ALTER TABLE cart_items
      DROP CONSTRAINT IF EXISTS cart_items_user_id_menu_item_id_key;
    `);

    await client.query(`
      ALTER TABLE cart_items
      DROP CONSTRAINT IF EXISTS cart_items_firebase_uid_menu_item_id_key;
    `);

    await client.query(`
      ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_firebase_uid_menu_item_id_key
      UNIQUE (firebase_uid, menu_item_id);
    `);

    await client.query(`
      ALTER TABLE cart_items
      DROP CONSTRAINT IF EXISTS cart_items_firebase_uid_fkey;
    `);

    await client.query(`
      ALTER TABLE cart_items
      ADD CONSTRAINT cart_items_firebase_uid_fkey
      FOREIGN KEY (firebase_uid)
      REFERENCES carts(firebase_uid)
      ON UPDATE CASCADE ON DELETE CASCADE;
    `);

    await client.query(`
      ALTER TABLE cart_items
      DROP COLUMN IF EXISTS user_id;
    `);

    await client.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT c.conname
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.conrelid
           AND a.attnum = ANY (c.conkey)
          WHERE c.conrelid = 'orders'::regclass
            AND a.attname = 'user_id'
        LOOP
          EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$;
    `);

    await client.query(`
      ALTER TABLE orders
      DROP COLUMN IF EXISTS user_id;
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cart_items_firebase_uid ON cart_items(firebase_uid);",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_orders_firebase_uid ON orders(firebase_uid);",
    );

    await client.query("COMMIT");
    console.log(
      "Migration completed: firebase_uid is now the only user identity in carts/cart_items/orders.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateFirebaseOnlyIdentity();
