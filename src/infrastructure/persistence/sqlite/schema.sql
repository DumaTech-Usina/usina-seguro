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
  -- Known at registration (REQ-206). Not UNIQUE: DEC-207 leaves the number
  -- unrestricted for now.
  proposal_number    TEXT    NOT NULL,
  -- Exact decimal as text (REQ-120). Never REAL: SQLite would store it as
  -- binary floating point. The equivalent PostgreSQL column is NUMERIC.
  net_premium        TEXT    NOT NULL,
  -- Calendar dates: 'YYYY-MM-DD', no time and no time zone. The renewal is
  -- the end of coverage (REQ-203), so it has no column of its own.
  coverage_start     TEXT    NOT NULL,
  coverage_end       TEXT    NOT NULL,
  -- ISO-8601 UTC as text: SQLite has no native date/time type.
  registered_at      TEXT    NOT NULL,
  status             TEXT    NOT NULL,
  -- Mandatory when the outcome is a refusal (REQ-253); the record stays.
  rejection_reason   TEXT,
  -- REQ-209: who recognised the issuance and when it was recorded. Both
  -- present exactly when the proposal is issued.
  issuance_recognized_by  TEXT,
  issuance_recognized_at  TEXT,
  -- REQ-219: the PDF the proposal was imported from, when there is one. The
  -- bytes are a row in `document`; the name is what the page shows.
  source_document_id         TEXT REFERENCES document (id),
  source_document_file_name  TEXT,
  CHECK ((source_document_id IS NULL) = (source_document_file_name IS NULL)),
  CHECK ((issuance_recognized_by IS NULL) = (issuance_recognized_at IS NULL))
);

-- REQ-254: every list of installments, signed -- the registration's first,
-- then each "Corrigir parcelas". Append-only: the one in force is the highest
-- sequence, and the earlier ones are never erased (REQ-124). A list may be
-- empty, which is why the signature has its own table.
CREATE TABLE IF NOT EXISTS proposal_installment_schedule (
  proposal_id  TEXT    NOT NULL REFERENCES proposal (id),
  sequence     INTEGER NOT NULL CHECK (sequence >= 1),
  informed_by  TEXT    NOT NULL,
  informed_at  TEXT    NOT NULL,
  PRIMARY KEY (proposal_id, sequence)
);

-- REQ-204: the installments of one list, in order. The due date is optional.
CREATE TABLE IF NOT EXISTS proposal_installment (
  proposal_id  TEXT    NOT NULL,
  sequence     INTEGER NOT NULL,
  number       INTEGER NOT NULL CHECK (number >= 1),
  amount       TEXT    NOT NULL,
  due_date     TEXT,
  PRIMARY KEY (proposal_id, sequence, number),
  FOREIGN KEY (proposal_id, sequence)
    REFERENCES proposal_installment_schedule (proposal_id, sequence)
);

-- REQ-214, REQ-215: every CT informed for the proposal, with its mode and who
-- informed it when. Append-only: the one in force is the highest sequence,
-- and the earlier ones are never erased (REQ-124).
CREATE TABLE IF NOT EXISTS proposal_worked_commission (
  proposal_id  TEXT    NOT NULL REFERENCES proposal (id),
  sequence     INTEGER NOT NULL CHECK (sequence >= 1),
  -- Percentage as exact decimal text, with the informed scale (REQ-121). With a
  -- parcelled CT, the CT of the first installment (REQ-291).
  rate         TEXT    NOT NULL,
  mode         TEXT    NOT NULL CHECK (mode IN ('INTEGRAL', 'PARCELLED')),
  -- REQ-291: the CT of the subsequent installments, present exactly when parcelled.
  subsequent_rate  TEXT,
  informed_by  TEXT    NOT NULL,
  informed_at  TEXT    NOT NULL,
  PRIMARY KEY (proposal_id, sequence),
  CHECK ((mode = 'PARCELLED') = (subsequent_rate IS NOT NULL))
);

-- REQ-220, REQ-223, REQ-225: every receipt declaration, append-only like the
-- CT. A direct receipt has neither intermediary nor CTU; one through an
-- intermediary has both (REQ-221).
CREATE TABLE IF NOT EXISTS proposal_receipt_declaration (
  proposal_id      TEXT    NOT NULL REFERENCES proposal (id),
  sequence         INTEGER NOT NULL CHECK (sequence >= 1),
  intermediary_id  TEXT,
  ctu              TEXT,
  declared_by      TEXT    NOT NULL,
  declared_at      TEXT    NOT NULL,
  PRIMARY KEY (proposal_id, sequence),
  CHECK ((intermediary_id IS NULL) = (ctu IS NULL))
);

CREATE TABLE IF NOT EXISTS policy (
  id              TEXT    PRIMARY KEY,
  -- REQ-049 / REJ-005: a proposal originates at most one policy. The domain
  -- enforces it through the proposal state; the constraint is the storage-level
  -- guarantee, and PostgreSQL enforces the same one.
  proposal_id     TEXT    NOT NULL UNIQUE REFERENCES proposal (id),
  -- The proposal number, inherited (REQ-241). Not UNIQUE: proposal numbers
  -- may repeat (DEC-207), and so may the policy numbers.
  policy_number   TEXT    NOT NULL,
  premium         TEXT    NOT NULL,
  -- Calendar dates (REQ-020): 'YYYY-MM-DD', no time and no time zone.
  coverage_start  TEXT    NOT NULL,
  coverage_end    TEXT    NOT NULL,
  renewal_date    TEXT    NOT NULL,
  registered_at   TEXT    NOT NULL,
  status          TEXT    NOT NULL,
  -- REQ-247: the PDF in force -- the last one sent -- and who sent it, when.
  -- The bytes are a row in `document`; an earlier PDF keeps its row there.
  document_id           TEXT REFERENCES document (id),
  document_file_name    TEXT,
  document_attached_by  TEXT,
  document_attached_at  TEXT,
  CHECK (
    (document_id IS NULL) = (document_file_name IS NULL)
    AND (document_id IS NULL) = (document_attached_by IS NULL)
    AND (document_id IS NULL) = (document_attached_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS installment (
  id          TEXT    PRIMARY KEY,
  policy_id   TEXT    NOT NULL REFERENCES policy (id),
  -- Position in the schedule, starting at 1, in the proposal's order (REQ-241).
  number      INTEGER NOT NULL CHECK (number >= 1),
  amount      TEXT    NOT NULL,
  -- Optional, inherited from the proposal (REQ-204, REQ-241).
  due_date    TEXT,
  status      TEXT    NOT NULL,
  -- REQ-123: the manual confirmation of receipt (IN-13) is one of the
  -- operations that must record who and when.
  confirmed_at   TEXT,
  confirmed_by   TEXT,
  UNIQUE (policy_id, number)
);

-- Reference records the Administrator maintains (IN-01). One row per entity
-- the Usina works with, holding the identifier the rest of the schema already
-- stores and the name REQ-096 has to print. Nothing references this table by
-- foreign key on purpose: no requirement says a proposal must name a
-- registered client, and REQ-002 makes this system reflect a control that
-- happens outside it -- an unregistered reference is a missing name, not an
-- invalid business.
CREATE TABLE IF NOT EXISTS reference (
  kind           TEXT NOT NULL
    CHECK (kind IN ('CLIENT', 'BROKER', 'INSURER', 'INTERMEDIARY', 'PRODUCT')),
  id             TEXT NOT NULL,
  name           TEXT NOT NULL,
  registered_at  TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);

-- Commission of a policy, agreed and real side by side (REQ-075, CA-016).
CREATE TABLE IF NOT EXISTS commission (
  id                      TEXT PRIMARY KEY,
  -- REQ-245: the base is the policy, and only one entry per
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
  agreed_receivable       TEXT NOT NULL,
  -- Override per policy (REQ-066), receivable side only: the broker's part is
  -- the CR of FP-02 (REQ-270). The calculated value above is kept untouched
  -- next to it (REQ-124).
  override_receivable     TEXT,
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

-- Payout commission of a policy (V2 section 9A). At most one per policy
-- (REQ-271, REJ-217): the UNIQUE is the storage-level guarantee.
--
-- The statement columns are the eligibility statement of REQ-283, written
-- once when the commission becomes ELIGIBLE and never recalculated. They are
-- all NULL while the commission is CALCULATED.
CREATE TABLE IF NOT EXISTS payout_commission (
  id                   TEXT PRIMARY KEY,
  policy_id            TEXT NOT NULL UNIQUE REFERENCES policy (id),
  status               TEXT NOT NULL CHECK (status IN ('CALCULATED', 'ELIGIBLE')),
  statement_policy_number     TEXT,
  statement_broker            TEXT,
  statement_client            TEXT,
  statement_net_premium       TEXT,
  statement_worked_commission TEXT,
  statement_payout_rate       TEXT,
  statement_ctu               TEXT,
  statement_usina_value       TEXT,
  statement_retained          TEXT,
  statement_payout            TEXT,
  -- REQ-281: who signed the eligibility and when; the eligibility date.
  eligible_by          TEXT,
  eligible_at          TEXT,
  CHECK ((status = 'ELIGIBLE') = (eligible_at IS NOT NULL))
);

-- REQ-279: every CR informed or changed, with the calculation as it was.
-- Append-only: the one in force is the highest sequence (REQ-124).
CREATE TABLE IF NOT EXISTS payout_rate_entry (
  payout_commission_id  TEXT    NOT NULL REFERENCES payout_commission (id),
  sequence              INTEGER NOT NULL CHECK (sequence >= 1),
  -- Percentages as exact decimal text, amounts as exact decimal text.
  rate                  TEXT    NOT NULL,
  previous_rate         TEXT,
  reason                TEXT,
  base                  TEXT    NOT NULL,
  payout                TEXT    NOT NULL,
  retained              TEXT    NOT NULL,
  informed_by           TEXT    NOT NULL,
  informed_at           TEXT    NOT NULL,
  PRIMARY KEY (payout_commission_id, sequence)
);

-- Payout of a policy with parcelled CT (V2 section 9B). At most one per policy:
-- the two CRs are informed once and then only revised (REQ-287, REQ-265).
CREATE TABLE IF NOT EXISTS parcelled_payout (
  id         TEXT PRIMARY KEY,
  policy_id  TEXT NOT NULL UNIQUE REFERENCES policy (id)
);

-- REQ-265: every information or change of the two CRs, signed. Append-only:
-- the one in force is the highest sequence (REQ-124).
CREATE TABLE IF NOT EXISTS parcelled_payout_entry (
  parcelled_payout_id       TEXT    NOT NULL REFERENCES parcelled_payout (id),
  sequence                  INTEGER NOT NULL CHECK (sequence >= 1),
  first_rate                TEXT    NOT NULL,
  subsequent_rate           TEXT    NOT NULL,
  previous_first_rate       TEXT,
  previous_subsequent_rate  TEXT,
  reason                    TEXT,
  informed_by               TEXT    NOT NULL,
  informed_at               TEXT    NOT NULL,
  PRIMARY KEY (parcelled_payout_id, sequence)
);

-- REQ-265: the calculation of each installment, as it was in that entry.
-- Amounts and percentages as exact decimal text (REQ-120, REQ-121).
CREATE TABLE IF NOT EXISTS parcelled_payout_calculation (
  parcelled_payout_id  TEXT    NOT NULL,
  sequence             INTEGER NOT NULL,
  number               INTEGER NOT NULL CHECK (number >= 1),
  amount               TEXT    NOT NULL,
  worked_commission    TEXT    NOT NULL,
  usina_value          TEXT    NOT NULL,
  payout_rate          TEXT    NOT NULL,
  payout               TEXT    NOT NULL,
  retained             TEXT    NOT NULL,
  PRIMARY KEY (parcelled_payout_id, sequence, number),
  FOREIGN KEY (parcelled_payout_id, sequence)
    REFERENCES parcelled_payout_entry (parcelled_payout_id, sequence)
);

-- REQ-266, REQ-288: the statement of each eligible installment, written once
-- when it becomes eligible and never recalculated. One per installment.
CREATE TABLE IF NOT EXISTS parcelled_installment_statement (
  parcelled_payout_id  TEXT    NOT NULL REFERENCES parcelled_payout (id),
  installment_number   INTEGER NOT NULL CHECK (installment_number >= 1),
  policy_number        TEXT    NOT NULL,
  broker               TEXT    NOT NULL,
  insurer              TEXT    NOT NULL,
  client               TEXT    NOT NULL,
  installment_amount   TEXT    NOT NULL,
  worked_commission    TEXT    NOT NULL,
  payout_rate          TEXT    NOT NULL,
  retained             TEXT    NOT NULL,
  payout               TEXT    NOT NULL,
  eligible_by          TEXT    NOT NULL,
  eligible_at          TEXT    NOT NULL,
  PRIMARY KEY (parcelled_payout_id, installment_number)
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

-- Attached document: the PDF a proposal was imported from (REQ-219) or the
-- PDF of a policy (REQ-247). One table and no notion of "owner": whoever
-- attaches a document keeps its id.
--
-- The bytes are a BLOB and not a path: the database is one file, a backup is
-- a copy of it, and there is no second place for the row and the file to get
-- out of step. PostgreSQL would use `bytea` -- see SQLITE-NOTES.md.
--
-- No delete: nothing is erased (REQ-124).
CREATE TABLE IF NOT EXISTS document (
  id            TEXT NOT NULL PRIMARY KEY,
  file_name     TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  content       BLOB NOT NULL
);

-- Notification of an effectuated emission (REQ-100, REQ-105, OUT-10). It is
-- both the record REQ-105 asks for -- what was notified, to whom and when --
-- and the in-app notification of REQ-102, which is what the screen reads.
--
-- The five fields of REQ-100 are stored, not joined: REQ-105 records what was
-- notified, and resolving the names again on a later reading would show what
-- IN-01 says today instead of what the broker was told. The name columns are
-- nullable for the same reason every listing tolerates it -- an unregistered
-- reference is a missing name, not an invalid business (REQ-002).
--
-- No UNIQUE constraint: the table is a log, nothing keys off it, and a second
-- notification for the same policy would be a second event -- which the
-- requirements do not define yet.
CREATE TABLE IF NOT EXISTS notification (
  id                 TEXT NOT NULL PRIMARY KEY,
  event              TEXT NOT NULL CHECK (event IN ('POLICY_ISSUED')),
  -- REQ-100 names the broker and no other recipient (ATR-004).
  recipient_id       TEXT NOT NULL,
  policy_id          TEXT NOT NULL REFERENCES policy (id),
  policy_number      TEXT NOT NULL,
  client_id          TEXT NOT NULL,
  client_name        TEXT,
  broker_id          TEXT NOT NULL,
  broker_name        TEXT,
  product_id         TEXT NOT NULL,
  product_name       TEXT,
  -- Percentage as exact decimal text, with the informed scale (REQ-121).
  -- Nullable in the type only: the CT is mandatory at the registration of the
  -- proposal (REQ-202), so it is always present.
  worked_commission  TEXT,
  -- REQ-228: with a parcelled CT, the CT of the subsequent installments.
  subsequent_worked_commission  TEXT,
  -- Exact decimal as text (REQ-120). Never REAL.
  net_premium        TEXT NOT NULL,
  occurred_at        TEXT NOT NULL
);
