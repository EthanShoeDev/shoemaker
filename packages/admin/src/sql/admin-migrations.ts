import type { ProductMigrations } from '../product/migrations.ts';

// The first is what a project may already have, so on such a database it
// changes nothing. `COLLATE "C"` orders text by its bytes on Postgres, as
// SQLite does, whatever the database's own collation.
export const adminMigrations: ProductMigrations = {
  product: 'admin',
  migrations: [
    {
      name: '0001_audit_log',
      statements: [
        `CREATE TABLE IF NOT EXISTS admin_audit_log (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL,
          actor_email TEXT,
          action TEXT NOT NULL,
          target_user_id TEXT,
          detail TEXT,
          created_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS admin_audit_log_created
          ON admin_audit_log (created_at DESC)`,
      ],
    },
    {
      // Nullable, so a project that returns to its earlier code can still write.
      name: '0002_audit_target',
      statements: [
        'ALTER TABLE admin_audit_log ADD COLUMN target_kind TEXT',
        'ALTER TABLE admin_audit_log ADD COLUMN target_id TEXT',
      ],
    },
    {
      name: '0003_audit_page',
      statements: [
        {
          sqlite: `CREATE INDEX admin_audit_log_page
            ON admin_audit_log (created_at DESC, id DESC)`,
          pg: `CREATE INDEX admin_audit_log_page
            ON admin_audit_log (created_at COLLATE "C" DESC, id COLLATE "C" DESC)`,
        },
      ],
    },
  ],
};
