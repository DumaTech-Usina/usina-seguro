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
  -- number and the worked commission is informed in that act. UNIQUE because
  -- REQ-082/CA-019 reach the policy through it: NULLs stay distinct, so a
  -- proposal still in DRAFT is unaffected.
  proposal_number    TEXT    UNIQUE,
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
  -- REQ-082 / CA-018: the conciliation key. The use case refuses a number
  -- already registered; the constraint is the storage-level guarantee, and
  -- PostgreSQL enforces the same one.
  policy_number   TEXT    NOT NULL UNIQUE,
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
  -- REQ-123: the manual confirmation of receipt (IN-13, REQ-092) is one of the
  -- operations that must record who and when; it is what releases the transfer
  -- of REQ-091.
  confirmed_at   TEXT,
  confirmed_by   TEXT,
  UNIQUE (policy_id, number)
);

-- Commercial agreement (REQ-065, IN-02/03/04). One row per version: a new
-- validity is a new row, never an update, so a calculation already made keeps
-- pointing at the numbers it used (CA-012, REJ-011, REQ-124).
CREATE TABLE IF NOT EXISTS commission_agreement (
  id                 TEXT PRIMARY KEY,
  insurer_id         TEXT NOT NULL,
  product_id         TEXT NOT NULL,
  -- Calendar date (REQ-065): 'YYYY-MM-DD', no time and no time zone.
  effective_from     TEXT NOT NULL,
  -- Percentages as exact decimal text with the informed scale (REQ-121).
  insurer_rate       TEXT NOT NULL,
  chain_kind         TEXT NOT NULL CHECK (chain_kind IN ('DIRECT', 'INTERMEDIARY')),
  -- Only for a chain with an intermediary (REQ-060, REQ-069).
  intermediary_id    TEXT,
  intermediary_rate  TEXT,
  -- REQ-063 default, REQ-064 configurable.
  broker_base        TEXT NOT NULL CHECK (broker_base IN ('USINA', 'INTERMEDIARY')),
  registered_at      TEXT NOT NULL,
  UNIQUE (insurer_id, product_id, effective_from)
);

-- Broker commission table (IN-05, REQ-093).
CREATE TABLE IF NOT EXISTS broker_commission_rate (
  broker_id      TEXT PRIMARY KEY,
  rate           TEXT NOT NULL,
  registered_at  TEXT NOT NULL
);

-- Commission of a policy, agreed and real side by side (REQ-075, CA-016).
CREATE TABLE IF NOT EXISTS commission (
  id                      TEXT PRIMARY KEY,
  -- REQ-051, REQ-070, REJ-001: the base is the policy, and only one entry per
  -- policy exists, which is also what REQ-086 relies on.
  policy_id               TEXT NOT NULL UNIQUE REFERENCES policy (id),
  status                  TEXT NOT NULL,
  calculated_at           TEXT NOT NULL,
  -- Basis copied at calculation time (REJ-011). Amounts as exact decimal text
  -- (REQ-120), percentages with the informed scale (REQ-121).
  premium                 TEXT NOT NULL,
  insurer_rate            TEXT NOT NULL,
  insurer_amount          TEXT NOT NULL,
  intermediary_id         TEXT,
  intermediary_rate       TEXT,
  broker_base             TEXT NOT NULL CHECK (broker_base IN ('USINA', 'INTERMEDIARY')),
  broker_base_amount      TEXT NOT NULL,
  broker_rate             TEXT NOT NULL,
  agreed_receivable       TEXT NOT NULL,
  agreed_payable          TEXT NOT NULL,
  -- Override per policy (REQ-066). The calculated values above are kept
  -- untouched next to it (REQ-124).
  override_receivable     TEXT,
  override_payable        TEXT,
  override_justification  TEXT,
  override_user_id        TEXT,
  override_at             TEXT,
  -- Apurado na conciliacao (REQ-075). The competence is what makes a second
  -- import of the same file a no-op (REQ-086, REJ-012).
  real_receivable         TEXT,
  reconciled_competence   TEXT,
  reconciled_at           TEXT,
  -- Manual resolution of a divergence (REQ-085, CA-026, REQ-123).
  resolution_justification TEXT,
  resolution_user_id      TEXT,
  resolved_at             TEXT
);

-- Report line with no matching policy (REQ-083, EX-01, OUT-06). It carries no
-- foreign key on purpose: the whole point is that no policy was found.
CREATE TABLE IF NOT EXISTS reconciliation_pendency (
  id                  TEXT PRIMARY KEY,
  competence          TEXT NOT NULL,
  proposal_number     TEXT NOT NULL,
  policy_number       TEXT,
  reported_commission TEXT NOT NULL,
  registered_at       TEXT NOT NULL,
  -- CA-021 / EX-05: importing the same report again must not duplicate what it
  -- produced, the pendency included. The use case looks the line up before
  -- opening a second one; the constraint is the storage-level guarantee.
  UNIQUE (competence, proposal_number)
);

-- Release rule per payment method (IN-06, REQ-090). Data, not code, so
-- CA-024 changes behaviour without a deploy (REQ-125).
CREATE TABLE IF NOT EXISTS payment_method_release_rule (
  payment_method_id  TEXT PRIMARY KEY,
  release_rule       TEXT NOT NULL
    CHECK (release_rule IN ('IMMEDIATE', 'REQUIRES_RECEIPT_CONFIRMATION')),
  registered_at      TEXT NOT NULL
);

-- Broker transfer (REQ-090 to REQ-095). One per policy: REQ-094 mentions a
-- period, but the window is DEC-008 and undecided.
CREATE TABLE IF NOT EXISTS settlement (
  id               TEXT PRIMARY KEY,
  policy_id        TEXT NOT NULL UNIQUE REFERENCES policy (id),
  broker_id        TEXT NOT NULL,
  amount           TEXT NOT NULL,
  release_rule     TEXT NOT NULL,
  status           TEXT NOT NULL,
  opened_at        TEXT NOT NULL,
  released_at      TEXT,
  -- Payment sent to the broker (REQ-095, IN-15, CA-028).
  paid_at          TEXT,
  paid_amount      TEXT,
  proof_reference  TEXT,
  payment_user_id  TEXT
);
