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
  status             TEXT    NOT NULL,
  -- Known only from the transmission on (REQ-041): the insurer issues the
  -- number and the worked commission is informed in that act.
  proposal_number    TEXT,
  -- Percentage as exact decimal text, with the informed scale (REQ-121).
  worked_commission  TEXT,
  transmitted_at     TEXT,
  -- Mandatory when the outcome is a refusal (REQ-045); the record stays.
  rejection_reason   TEXT
);

CREATE TABLE IF NOT EXISTS policy (
  id              TEXT    PRIMARY KEY,
  -- REQ-049 / REJ-005: a proposal originates at most one policy. The domain
  -- enforces it through the proposal state; the constraint is the storage-level
  -- guarantee, and PostgreSQL enforces the same one.
  proposal_id     TEXT    NOT NULL UNIQUE REFERENCES proposal (id),
  policy_number   TEXT    NOT NULL,
  premium         TEXT    NOT NULL,
  -- Calendar dates (REQ-020): 'YYYY-MM-DD', no time and no time zone.
  coverage_start  TEXT    NOT NULL,
  coverage_end    TEXT    NOT NULL,
  renewal_date    TEXT    NOT NULL,
  registered_at   TEXT    NOT NULL,
  status          TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS installment (
  id          TEXT    PRIMARY KEY,
  policy_id   TEXT    NOT NULL REFERENCES policy (id),
  -- Position in the schedule, starting at 1: REQ-091 releases the broker
  -- transfer against the first installment, so it has to be identifiable.
  number      INTEGER NOT NULL CHECK (number >= 1),
  amount      TEXT    NOT NULL,
  due_date    TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  UNIQUE (policy_id, number)
);
