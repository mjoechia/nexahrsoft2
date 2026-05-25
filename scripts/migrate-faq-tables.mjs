// One-shot migration: create FAQ tables on the existing app_nexahrsoft2 schema.
// Idempotent — uses IF NOT EXISTS / IF NOT EXISTS for indices.
//
// Run with:
//   DATABASE_URL='postgresql://...' node scripts/migrate-faq-tables.mjs
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const SQL = `
SET search_path TO app_nexahrsoft2, public;

CREATE TABLE IF NOT EXISTS app_nexahrsoft2.faq_categories (
  id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamp NOT NULL DEFAULT NOW(),
  updated_at   timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_nexahrsoft2.faq_entries (
  id              varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     varchar NOT NULL REFERENCES app_nexahrsoft2.faq_categories(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL,
  audience        text NOT NULL DEFAULT 'both',
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      varchar REFERENCES app_nexahrsoft2.users(id),
  created_by_name text,
  created_at      timestamp NOT NULL DEFAULT NOW(),
  updated_at      timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS faq_entries_category_idx
  ON app_nexahrsoft2.faq_entries (category_id, sort_order);

CREATE TABLE IF NOT EXISTS app_nexahrsoft2.faq_entry_images (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    varchar NOT NULL REFERENCES app_nexahrsoft2.faq_entries(id) ON DELETE CASCADE,
  image_url   text NOT NULL,
  caption     text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS faq_entry_images_entry_idx
  ON app_nexahrsoft2.faq_entry_images (entry_id, sort_order);
`;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(SQL);
  await client.query("COMMIT");
  const r = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='app_nexahrsoft2' AND table_name IN ('faq_categories','faq_entries','faq_entry_images')
    ORDER BY table_name;
  `);
  console.log("FAQ tables present:", r.rows.map((x) => x.table_name).join(", "));
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
