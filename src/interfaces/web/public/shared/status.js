/**
 * Portuguese label and colour tone for every state the API can answer.
 *
 * This is the one place where the interface holds domain vocabulary, and it is
 * presentation only: a label and a colour, never a decision. Whether a
 * transition is allowed is the domain's answer, and the interface learns it by
 * being refused.
 *
 * The maps are per aggregate because Portuguese does not let one label serve
 * all: a *parcela* is `Paga`, a *repasse* is `Pago`.
 */

const NEUTRAL = { label: '—', tone: 'neutral' };

const PROPOSAL = {
  DRAFT: { label: 'Rascunho', tone: 'neutral' },
  TRANSMITTED: { label: 'Transmitida', tone: 'info' },
  ACCEPTED: { label: 'Aceita', tone: 'success' },
  REJECTED: { label: 'Recusada', tone: 'danger' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

const POLICY = {
  ACTIVE: { label: 'Vigente', tone: 'success' },
  RENEWED: { label: 'Renovada', tone: 'info' },
  CANCELLED: { label: 'Cancelada', tone: 'danger' },
  EXPIRED: { label: 'Expirada', tone: 'neutral' },
};

const INSTALLMENT = {
  PENDING: { label: 'Pendente', tone: 'warning' },
  PAID: { label: 'Paga', tone: 'success' },
  OVERDUE: { label: 'Atrasada', tone: 'danger' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

const COMMISSION = {
  FORECAST: { label: 'Prevista', tone: 'neutral' },
  RECONCILED: { label: 'Conciliada', tone: 'success' },
  RECEIVED: { label: 'Recebida', tone: 'success' },
  DIVERGENT: { label: 'Divergente', tone: 'danger' },
  RESOLVED: { label: 'Resolvida', tone: 'info' },
};

/**
 * What happened to one line of the commission report (FP-02).
 *
 * Not a state of an aggregate: it is the answer the import gives per line,
 * and the labels say what the requirements say. `DUPLICATE` is not an error —
 * REQ-086 means the policy was already conciliated in that competence and
 * nothing was written a second time.
 */
const RECONCILIATION = {
  RECONCILED: { label: 'Conciliada', tone: 'success' },
  DIVERGENT: { label: 'Divergente', tone: 'danger' },
  DUPLICATE: { label: 'Já conciliada', tone: 'neutral' },
  PENDING: { label: 'Pendência', tone: 'warning' },
  NO_COMMISSION: { label: 'Sem comissão calculada', tone: 'info' },
};

const SETTLEMENT = {
  AWAITING_CONFIRMATION: { label: 'Aguardando confirmação', tone: 'warning' },
  RELEASED: { label: 'Liberado', tone: 'info' },
  PAID: { label: 'Pago', tone: 'success' },
  DIVERGENT: { label: 'Divergente', tone: 'danger' },
  RESOLVED: { label: 'Resolvido', tone: 'info' },
};

const RELEASE_RULE = {
  IMMEDIATE: { label: 'Liberação imediata', tone: 'success' },
  REQUIRES_RECEIPT_CONFIRMATION: { label: 'Exige confirmação', tone: 'warning' },
};

const MAPS = {
  proposal: PROPOSAL,
  policy: POLICY,
  installment: INSTALLMENT,
  commission: COMMISSION,
  reconciliation: RECONCILIATION,
  settlement: SETTLEMENT,
  releaseRule: RELEASE_RULE,
};

/** The label and tone of a state, or the raw value if it is unknown to us. */
export function describeStatus(aggregate, status) {
  const map = MAPS[aggregate];
  if (map === undefined || status === null || status === undefined) {
    return NEUTRAL;
  }
  return map[status] ?? { label: status, tone: 'neutral' };
}

/** The chip element for a state, ready to append. */
export function statusChip(aggregate, status) {
  const { label, tone } = describeStatus(aggregate, status);
  const chip = document.createElement('span');
  chip.className = `chip chip--${tone}`;
  chip.textContent = label;
  return chip;
}
