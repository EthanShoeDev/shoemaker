import type { ProductMigrations } from 'shoemaker-admin/sql';

// The host's own database, apart from where error tracking keeps its events, so
// the product has a history of its own.
export const flagMigrations: ProductMigrations = {
  product: 'edgehog_flags',
  migrations: [
    {
      name: '0001_flag',
      statements: [
        // `size` is the bytes of `key` and `definition`.
        `CREATE TABLE edgehog_flag (
          id TEXT PRIMARY KEY,
          project_id INTEGER NOT NULL,
          key TEXT NOT NULL,
          version INTEGER NOT NULL,
          size INTEGER NOT NULL,
          definition TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE UNIQUE INDEX edgehog_flag_key
          ON edgehog_flag (project_id, key)`,
      ],
    },
  ],
};
