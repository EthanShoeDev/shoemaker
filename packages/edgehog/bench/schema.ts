import type { ProductMigrations } from 'shoemaker-admin/sql';

// What design.md's decisions 2, 3 and 7 need, as far as the write path goes.
// `src/limits/costs.ts` counts these rows and indexes.
export const benchMigrations: ProductMigrations = {
  product: 'edgehog_bench',
  migrations: [
    {
      name: '0001_tables',
      statements: [
        // An id is unique within its project. `attempt` names the write that
        // stored the row, so later statements of one unit know whether they
        // belong to it.
        `CREATE TABLE edgehog_event (
          project INTEGER NOT NULL,
          id TEXT NOT NULL,
          attempt TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          rules INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          person TEXT,
          trace_id TEXT,
          span_id TEXT,
          occurred_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          properties TEXT NOT NULL,
          PRIMARY KEY (project, id)
        )`,
        `CREATE INDEX edgehog_event_fingerprint
          ON edgehog_event (project, fingerprint, rules, occurred_at)`,
        `CREATE INDEX edgehog_event_received
          ON edgehog_event (project, received_at)`,
        `CREATE INDEX edgehog_event_trace
          ON edgehog_event (project, trace_id) WHERE trace_id IS NOT NULL`,
        `CREATE TABLE edgehog_fingerprint (
          project INTEGER NOT NULL,
          fingerprint TEXT NOT NULL,
          rules INTEGER NOT NULL,
          issue TEXT NOT NULL,
          PRIMARY KEY (project, fingerprint, rules)
        )`,
        'CREATE INDEX edgehog_fingerprint_issue ON edgehog_fingerprint (issue)',
        `CREATE TABLE edgehog_issue (
          id TEXT PRIMARY KEY,
          project INTEGER NOT NULL,
          state TEXT NOT NULL,
          title TEXT NOT NULL,
          first_seen TEXT NOT NULL,
          opened_at TEXT NOT NULL,
          resolved_at TEXT
        )`,
        'CREATE INDEX edgehog_issue_state ON edgehog_issue (project, state)',
        `CREATE TABLE edgehog_alert (
          issue TEXT NOT NULL,
          cause TEXT NOT NULL,
          state TEXT NOT NULL,
          sends INTEGER NOT NULL,
          PRIMARY KEY (issue, cause)
        )`,
        `CREATE INDEX edgehog_alert_pending
          ON edgehog_alert (issue) WHERE state = 'pending'`,
        `CREATE TABLE edgehog_counted (
          project INTEGER NOT NULL,
          fingerprint TEXT NOT NULL,
          rules INTEGER NOT NULL,
          hour TEXT NOT NULL,
          run TEXT NOT NULL,
          total INTEGER NOT NULL,
          PRIMARY KEY (project, fingerprint, rules, hour, run)
        )`,
        `CREATE TABLE edgehog_usage (
          project INTEGER NOT NULL,
          day TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          stored_bytes INTEGER NOT NULL,
          PRIMARY KEY (project, day)
        )`,
      ],
    },
  ],
};
