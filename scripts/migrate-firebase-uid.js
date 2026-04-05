require("dotenv").config();
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "DATABASE_URL is missing. Set it in .env or environment variables.",
  );
  process.exit(1);
}

async function migrateFirebaseUid() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
    `);

    const usersHasIdColumn = await client.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'id'
      ) AS exists;
    `);

    if (usersHasIdColumn.rows[0].exists) {
      await client.query(`
        UPDATE users
        SET firebase_uid = id
        WHERE firebase_uid IS NULL;
      `);
    }

    const nullUidResult = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE firebase_uid IS NULL;
    `);

    if (nullUidResult.rows[0].count > 0) {
      throw new Error(
        "Backfill incomplete: users.firebase_uid has NULL values. Fix data before retrying.",
      );
    }

    const duplicateUidResult = await client.query(`
      SELECT firebase_uid
      FROM users
      GROUP BY firebase_uid
      HAVING COUNT(*) > 1;
    `);

    if (duplicateUidResult.rowCount > 0) {
      throw new Error(
        "Duplicate firebase_uid values detected. Resolve duplicates before retrying.",
      );
    }

    await client.query(`
      ALTER TABLE users
      ALTER COLUMN firebase_uid SET NOT NULL;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'users_firebase_uid_key'
            AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE users DROP CONSTRAINT users_firebase_uid_key;
        END IF;
      END $$;
    `);

    await client.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_firebase_uid_key UNIQUE (firebase_uid);
    `);

    await client.query(`
      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_auth_provider_check;
    `);

    await client.query(`
      ALTER TABLE users
      ADD CONSTRAINT users_auth_provider_check
      CHECK (auth_provider IN ('local', 'emailjs', 'firebase'));
    `);

    const dependentTables = ["carts", "cart_items", "orders"];

    for (const table of dependentTables) {
      await client.query(`
        ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
      `);

      const tableHasUserIdColumn = await client.query(
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

      if (
        tableHasUserIdColumn.rows[0].exists &&
        usersHasIdColumn.rows[0].exists
      ) {
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

    const fkDropStatements = [
      `
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
      `,
      `
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
            AND c.conrelid = 'cart_items'::regclass
            AND a.attname = 'user_id'
        LOOP
          EXECUTE format('ALTER TABLE cart_items DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$;
      `,
      `
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
            AND c.conrelid = 'orders'::regclass
            AND a.attname = 'user_id'
        LOOP
          EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$;
      `,
    ];

    for (const statement of fkDropStatements) {
      await client.query(statement);
    }

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
      ALTER TABLE orders
      DROP CONSTRAINT IF EXISTS orders_firebase_uid_fkey;
    `);

    await client.query(`
      ALTER TABLE orders
      ADD CONSTRAINT orders_firebase_uid_fkey
      FOREIGN KEY (firebase_uid)
      REFERENCES users(firebase_uid)
      ON UPDATE CASCADE ON DELETE RESTRICT;
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cart_items_firebase_uid ON cart_items(firebase_uid);",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_orders_firebase_uid ON orders(firebase_uid);",
    );

    await client.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT
            c.conname,
            c.conrelid::regclass AS table_name
          FROM pg_constraint c
          JOIN pg_attribute a
            ON a.attrelid = c.confrelid
           AND a.attnum = ANY (c.confkey)
          WHERE c.contype = 'f'
            AND c.confrelid = 'users'::regclass
            AND a.attname = 'id'
        LOOP
          EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.table_name, r.conname);
        END LOOP;
      END $$;
    `);

    await client.query(`
      DO $$
      DECLARE current_pk_column TEXT;
      BEGIN
        SELECT a.attname
        INTO current_pk_column
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = ANY (c.conkey)
        WHERE c.conname = 'users_pkey'
          AND c.conrelid = 'users'::regclass
        LIMIT 1;

        IF current_pk_column IS DISTINCT FROM 'firebase_uid' THEN
          IF current_pk_column IS NOT NULL THEN
            ALTER TABLE users DROP CONSTRAINT users_pkey;
          END IF;
          ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (firebase_uid);
        END IF;
      END $$;
    `);

    await client.query("DROP INDEX IF EXISTS idx_sessions_firebase_uid;");
    await client.query("DROP INDEX IF EXISTS idx_sessions_user_id;");
    await client.query("DROP TABLE IF EXISTS sessions;");

    await client.query("COMMIT");
    console.log(
      "Migration completed: firebase_uid is now the canonical user key.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrateFirebaseUid();
