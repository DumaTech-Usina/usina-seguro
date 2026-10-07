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

// Os três estados de REQ-250.
const PROPOSAL = {
  AWAITING_ISSUANCE: { label: 'Aguardando emissão', tone: 'warning' },
  // REQ-251: emitida é o estado que confirma que a proposta gerou a apólice.
  ISSUED: { label: 'Emitida', tone: 'success' },
  REJECTED: { label: 'Recusada', tone: 'danger' },
};

/** REQ-213: como a comissão trabalhada é recebida. */
export const WORKED_COMMISSION_MODE = {
  INTEGRAL: 'Integral',
  PARCELLED: 'Parcelada',
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

/**
 * REQ-285: as três situações de uma apólice com CT integral quanto ao
 * repasse. `CALCULATED` e `ELIGIBLE` são também os estados da comissão
 * (REQ-276).
 */
const PAYOUT = {
  WITHOUT_CR: { label: 'Sem CR', tone: 'warning' },
  CALCULATED: { label: 'Calculada', tone: 'info' },
  ELIGIBLE: { label: 'Elegível', tone: 'success' },
};

/** REQ-268: as quatro situações de uma apólice com CT parcelada quanto ao repasse. */
const PARCELLED_PAYOUT = {
  WITHOUT_CR: { label: 'Sem CR', tone: 'warning' },
  NONE_ELIGIBLE: { label: 'Nenhuma parcela elegida', tone: 'info' },
  PARTIALLY_ELIGIBLE: { label: 'Parcialmente elegida', tone: 'info' },
  FULLY_ELIGIBLE: { label: 'Totalmente elegida', tone: 'success' },
};

const MAPS = {
  proposal: PROPOSAL,
  policy: POLICY,
  installment: INSTALLMENT,
  commission: COMMISSION,
  reconciliation: RECONCILIATION,
  payout: PAYOUT,
  parcelledPayout: PARCELLED_PAYOUT,
};

/**
 * A progressão comercial de um negócio: Cotação → Proposta → Apólice.
 *
 * São três etapas do negócio, e não três estados de um registro. O sistema
 * guarda **duas** delas:
 *
 * - **Cotação** acontece no Ager, fora daqui, e o registro interno é opcional
 *   (`REQ-030`, `FA-01`) — não está implementado, então a etapa aparece como
 *   não registrada em vez de sumir da tira. Dizer que ela existe seria mentir;
 *   escondê-la faria a progressão parecer começar na proposta;
 * - **Proposta** é o registro que existe desde o seu cadastro, com os
 *   estados de `REQ-250`: aguardando emissão → emitida | recusada;
 * - **Apólice** é a proposta emitida (`REQ-240`, `REQ-251`).
 *
 * Isto é apresentação: nenhuma decisão de domínio é tomada aqui.
 */
const STAGES = [
  { id: 'quote', label: 'Cotação' },
  { id: 'proposal', label: 'Proposta' },
  { id: 'policy', label: 'Apólice' },
];

/** Em que etapa comercial um estado da proposta coloca o negócio. */
export function stageOfProposal(status) {
  return status === 'ISSUED' ? 'policy' : 'proposal';
}

/**
 * A tira das três etapas, com a atual marcada e as anteriores concluídas.
 *
 * `current` é o id da etapa; `note` é a frase que descreve onde o negócio
 * está, exibida abaixo da tira.
 */
export function stageStrip(current, note) {
  const reached = STAGES.findIndex((stage) => stage.id === current);

  const strip = document.createElement('div');
  strip.className = 'stepper stage-strip';
  strip.setAttribute('aria-label', 'Progressão comercial');

  STAGES.forEach((stage, index) => {
    if (index > 0) {
      const connector = document.createElement('div');
      connector.className = 'step__connector';
      strip.append(connector);
    }

    const step = document.createElement('div');
    step.className = 'step';
    step.dataset.stage = stage.id;

    // A cotação nunca é "concluída": ou foi feita fora do sistema, ou não
    // houve. Marcá-la como cumprida afirmaria um registro que não existe.
    if (index === reached) {
      step.dataset.state = 'current';
    } else if (index < reached && stage.id !== 'quote') {
      step.dataset.state = 'done';
    }

    const bullet = document.createElement('span');
    bullet.className = 'step__bullet';
    bullet.textContent = String(index + 1);

    const label = document.createElement('span');
    label.textContent = stage.label;
    step.append(bullet, label);

    if (stage.id === 'quote') {
      const aside = document.createElement('span');
      aside.className = 'text-muted stage-strip__aside';
      aside.textContent = 'fora do sistema';
      step.append(aside);
    }

    strip.append(step);
  });

  if (note === undefined) {
    return strip;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'stage-strip__wrapper';
  const caption = document.createElement('p');
  caption.className = 'text-muted stage-strip__note';
  caption.textContent = note;
  wrapper.append(strip, caption);
  return wrapper;
}

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
