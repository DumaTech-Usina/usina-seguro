-- SQLite schema. This is not the production schema: PostgreSQL will have its
-- own file, in its own dialect. See SQLITE-NOTES.md for the differences that
-- matter.

CREATE TABLE IF NOT EXISTS proposal (
  id                 TEXT    PRIMARY KEY,
  client_id          TEXT    NOT NULL,
  broker_id          TEXT    NOT NULL,
  insurer_id         TEXT    NOT NULL,
  product_id         TEXT    NOT NULL,
  payment_method_id  TEXT    NOT NULL,
  customer_accepted  INTEGER NOT NULL CHECK (customer_accepted IN (0, 1)),
  -- Exact decimal as text (REQ-120). Never REAL: SQLite would store it as
  -- binary floating point. The equivalent PostgreSQL column is NUMERIC.
  net_premium        TEXT    NOT NULL,
  -- ISO-8601 UTC as text: SQLite has no native date/time type.
  registered_at      TEXT    NOT NULL,
  status             TEXT    NOT NULL
);
