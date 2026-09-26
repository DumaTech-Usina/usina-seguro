/**
 * The policy an operator works on: schedule, agreed commission and the payout
 * commission of FP-02 — the CR, its recalculation and the eligibility.
 *
 * Where FP-01 lands. The agreed commission shown here is the one calculated
 * when the policy was registered; the real one appears once a commission
 * report is conciliated, and the two sit side by side with the divergence
 * flagged.
 *
 * The page renders state and offers actions. Which action is admissible is the
 * domain's answer: a button that the domain refuses shows the refusal, it does
 * not disappear on a rule this file invented.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatDate, formatInstant, formatMoney, formatPercentage } from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { stageStrip, statusChip } from '/app/shared/status.js';

const policyId = new URLSearchParams(window.location.search).get('id');
const page = document.querySelector('#page');

/* ------------------------------------------------------------ helpers -- */

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function icon(name) {
  return element('span', 'material-symbols-outlined', name);
}

function card(title, iconName, ...body) {
  const section = element('section', 'card');
  const header = element('div', 'card__header');
  header.append(icon(iconName), element('h2', 'text-title', title));
  section.append(header, ...body);
  return { section, header };
}

function definition(label, value) {
  const wrapper = element('div', 'definition');
  wrapper.append(element('span', 'text-label', label), element('span', 'definition__value', value));
  return wrapper;
}

function metric(label, value, highlight = false) {
  const wrapper = element('div', `metric${highlight ? ' metric--highlight' : ''}`);
  wrapper.append(element('span', 'text-label', label), element('span', 'metric__value', value));
  return wrapper;
}

function emptyState(iconName, title, description, action) {
  const empty = element('div', 'empty');
  empty.append(
    icon(iconName),
    element('h3', 'text-subtitle', title),
    element('p', undefined, description),
  );
  if (action !== undefined) {
    empty.append(action);
  }
  return empty;
}

function button(label, { variant = 'outlined', iconName, onClick }) {
  const node = element('button', `btn btn--${variant}`);
  if (iconName !== undefined) {
    node.append(icon(iconName));
  }
  node.append(document.createTextNode(label));
  node.addEventListener('click', onClick);
  return node;
}

/** Opens a dialog and resolves with its fields, or null when dismissed. */
function ask(id, prepare) {
  const dialog = document.querySelector(id);
  const form = dialog.querySelector('form');
  form.reset();

  if (prepare !== undefined) {
    prepare(dialog);
  }

  dialog.showModal();

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue === 'confirm' ? Object.fromEntries(new FormData(form)) : null);
      },
      { once: true },
    );
  });
}

/**
 * Runs an operation and reloads the page state, reporting a refusal.
 * `success` is the message, or a function of what the operation answered.
 */
async function perform(work, success) {
  try {
    const result = await work();
    showSnackbar(typeof success === 'function' ? success(result) : success, { tone: 'success' });
    await render();
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    } else {
      showSnackbar('Falha de comunicação com o servidor.', { tone: 'danger' });
    }
  }
}

/* -------------------------------------------------------------- header -- */

function policyCard(policy) {
  const section = element('section', 'card');
  const body = element('div', 'card__body stack');

  // A apólice é a terceira etapa, e a tira diz de onde ela veio.
  section.append(stageStrip('policy', 'Apólice registrada: a proposta foi emitida (REQ-251).'));

  const head = element('div', 'policy-head');
  const numbers = element('div', 'policy-head__numbers');

  // REQ-050: os dois números seguem consultáveis, e o da proposta agora leva
  // ao registro que originou esta apólice — o vínculo existia no texto e não
  // no caminho.
  const origin = element('a', 'text-muted policy-head__origin');
  origin.href = `/app/proposals/detail.html?id=${encodeURIComponent(policy.proposalId)}`;
  origin.textContent = `Proposta ${policy.proposalNumber ?? '—'}`;

  numbers.append(
    element('span', 'text-label', 'Número da apólice'),
    element('span', 'policy-head__number', policy.policyNumber),
    origin,
  );

  const chip = statusChip('policy', policy.status);
  chip.style.marginLeft = 'auto';

  head.append(numbers, chip);

  const details = element('div', 'definitions');
  details.append(
    definition('Prêmio', formatMoney(policy.premium)),
    definition(
      'Vigência',
      `${formatDate(policy.coverageStart)} — ${formatDate(policy.coverageEnd)}`,
    ),
    definition('Renovação', formatDate(policy.renewalDate)),
    definition('Registro', formatInstant(policy.registeredAt)),
  );

  body.append(head, details);
  section.append(body);
  return section;
}

/* ----------------------------------------------------------- schedule -- */

function installmentsCard(policy) {
  const { section } = card('Parcelas', 'receipt_long');
  const body = element('div', 'card__body card__body--flush');

  const table = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');
  for (const [label, className] of [
    ['#', ''],
    ['Valor', 'is-numeric'],
    ['Vencimento', ''],
    ['Situação', ''],
    ['Confirmação', ''],
    ['', 'is-action'],
  ]) {
    headRow.append(element('th', className, label));
  }
  head.append(headRow);

  const rows = element('tbody');

  for (const installment of policy.installments) {
    const row = element('tr');
    row.append(
      element('td', 'text-numeric', String(installment.number)),
      element('td', 'is-numeric', formatMoney(installment.amount)),
      element('td', undefined, formatDate(installment.dueDate)),
    );

    const status = element('td');
    status.append(statusChip('installment', installment.status));
    row.append(status);

    // REQ-123: who confirmed the receipt, and when.
    const confirmation = element('td', 'text-muted');
    confirmation.textContent =
      installment.confirmedBy === null
        ? '—'
        : `${installment.confirmedBy} · ${formatInstant(installment.confirmedAt)}`;
    row.append(confirmation);

    const action = element('td', 'is-action');
    if (installment.status === 'PENDING') {
      action.append(
        button('Confirmar recebimento', {
          variant: 'sm btn--outlined',
          onClick: () => confirmInstallment(policy, installment),
        }),
      );
    }
    row.append(action);

    rows.append(row);
  }

  table.append(head, rows);
  body.append(table);
  section.append(body);
  return section;
}

async function confirmInstallment(policy, installment) {
  const answer = await ask('#dialog-installment', (dialog) => {
    dialog.querySelector('#dialog-installment-subtitle').textContent =
      `Parcela ${installment.number} — ${formatMoney(installment.amount)}, vencimento ${formatDate(installment.dueDate)}.`;
  });

  if (answer === null) {
    return;
  }

  await perform(
    () => api.payInstallment(policy.id, installment.number, answer.userId),
    `Recebimento da parcela ${installment.number} confirmado.`,
  );
}

/* --------------------------------------------------------- commission -- */

function commissionCard(policy, commission) {
  const { section, header } = card('Comissão', 'percent');
  const body = element('div', 'card__body stack');

  if (commission === null) {
    // A comissão acordada nasce com a apólice (REQ-236); a ausência só ocorre
    // num registro anterior a essa regra.
    body.append(
      emptyState(
        'price_change',
        'Comissão acordada não calculada',
        'A comissão acordada é calculada no reconhecimento da emissão, pela CT (e CTU com intermediária) da proposta.',
      ),
    );
    section.append(body);
    return section;
  }

  header.append(
    (() => {
      const actions = element('div', 'card__header-actions');
      actions.append(statusChip('commission', commission.status));
      if (commission.divergent) {
        const flag = element('span', 'chip chip--danger', 'Acordado ≠ real');
        actions.append(flag);
      }
      return actions;
    })(),
  );

  // The agreed and the real value side by side, which is the whole point of
  // the panel; the divergence is signalled and blocks nothing.
  const comparison = element('div', 'comparison');
  comparison.append(
    metric('Acordado a receber', formatMoney(commission.effectiveReceivable)),
    metric(
      'Real a receber',
      commission.realReceivable === null ? 'Não apurado' : formatMoney(commission.realReceivable),
      commission.divergent,
    ),
  );
  body.append(comparison);

  const basis = element('div', 'definitions');
  basis.append(
    definition('Prêmio base', formatMoney(commission.basis.premium)),
    definition('% seguradora', formatPercentage(commission.basis.insurerRate)),
    definition('Valor da seguradora', formatMoney(commission.basis.insurerAmount)),
    definition('Competência', commission.reconciledCompetence ?? '—'),
  );
  body.append(basis);

  if (commission.override !== null) {
    body.append(
      auditNote(
        'override',
        'Ajuste aplicado',
        commission.override.justification,
        commission.override,
      ),
    );
  }

  if (commission.resolution !== null) {
    body.append(
      auditNote(
        'resolved',
        'Divergência resolvida',
        commission.resolution.justification,
        commission.resolution,
      ),
    );
  }

  const footer = element('div', 'card__footer');
  footer.append(
    button('Ajustar comissão', { iconName: 'tune', onClick: () => overrideCommission(policy) }),
  );
  if (commission.status === 'DIVERGENT') {
    footer.append(
      button('Resolver divergência', {
        variant: 'filled',
        iconName: 'fact_check',
        onClick: () => resolveDivergence(policy),
      }),
    );
  }

  section.append(body, footer);
  return section;
}

function auditNote(kind, title, justification, record) {
  const note = element('div', `audit-note audit-note--${kind}`);
  const body = element('div', 'audit-note__body');
  body.append(
    element('span', 'text-label', title),
    element('span', undefined, justification),
    element('span', 'text-muted', `${record.userId} · ${formatInstant(record.at)}`),
  );
  note.append(icon(kind === 'resolved' ? 'fact_check' : 'tune'), body);
  return note;
}

async function overrideCommission(policy) {
  const answer = await ask('#dialog-override');
  if (answer === null) {
    return;
  }

  await perform(
    () =>
      api.overrideCommission(policy.id, {
        receivable: answer.receivable,
        justification: answer.justification,
        userId: answer.userId,
      }),
    'Ajuste aplicado.',
  );
}

async function resolveDivergence(policy) {
  const answer = await ask('#dialog-resolution');
  if (answer === null) {
    return;
  }

  await perform(() => api.resolveDivergence(policy.id, answer), 'Resolução registrada.');
}

/* ------------------------------------------------------------- payout -- */

/**
 * REQ-278: the values that follow a CR, in one sentence. The numbers are the
 * server's; nothing is calculated here.
 */
function payoutOutcome(view) {
  const commission = view.commission;
  return `CR ${formatPercentage(commission.rate)}: ${formatMoney(commission.payout)} a repassar ao corretor, ${formatMoney(commission.retained)} ficam na Usina.`;
}

function payoutHistory(entries) {
  const table = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');
  for (const [label, className] of [
    ['CR', 'is-numeric'],
    ['Anterior', 'is-numeric'],
    ['Valor da Usina', 'is-numeric'],
    ['A repassar', 'is-numeric'],
    ['Fica na Usina', 'is-numeric'],
    ['Motivo', ''],
    ['Quem · quando', ''],
  ]) {
    headRow.append(element('th', className, label));
  }
  head.append(headRow);

  const rows = element('tbody');
  for (const entry of entries) {
    const row = element('tr');
    row.append(
      element('td', 'is-numeric', formatPercentage(entry.rate)),
      element(
        'td',
        'is-numeric text-muted',
        entry.previousRate === null ? '—' : formatPercentage(entry.previousRate),
      ),
      element('td', 'is-numeric', formatMoney(entry.base)),
      element('td', 'is-numeric', formatMoney(entry.payout)),
      element('td', 'is-numeric', formatMoney(entry.retained)),
      element('td', undefined, entry.reason ?? 'Primeira informação'),
      element('td', 'text-muted', `${entry.informedBy} · ${formatInstant(entry.informedAt)}`),
    );
    rows.append(row);
  }

  table.append(head, rows);
  const wrapper = element('div', 'payout-history');
  wrapper.append(element('span', 'text-label', 'Histórico da CR'), table);
  return wrapper;
}

/** REQ-283: the eligibility statement, as it was generated. */
function statementBlock(statement) {
  const block = element('div', 'payout-statement stack');
  const details = element('div', 'definitions');
  details.append(
    definition('Número da apólice', statement.policyNumber),
    definition('Corretor', statement.broker),
    definition('Cliente', statement.client),
    definition('Prêmio líquido', formatMoney(statement.netPremium)),
    definition('CT', formatPercentage(statement.workedCommission)),
    definition('CR', formatPercentage(statement.payoutRate)),
  );
  if (statement.ctu !== null) {
    details.append(definition('CTU', formatPercentage(statement.ctu)));
  }
  details.append(
    definition('Valor recebido pela Usina', formatMoney(statement.usinaValue)),
    definition('Data da elegibilidade', formatInstant(statement.eligibleAt)),
    definition('Fica na Usina', formatMoney(statement.retained)),
    definition('A repassar ao corretor', formatMoney(statement.payout)),
    definition('Confirmado por', statement.signedBy),
  );
  block.append(element('span', 'text-label', 'Extrato de elegibilidade'), details);
  return block;
}

function payoutCard(policy, view) {
  const { section, header } = card('Comissão de repasse (CR)', 'volunteer_activism');
  const body = element('div', 'card__body stack');

  // REQ-271, REQ-285, FA-214: parcelled CT is outside the three situations.
  if (view.situation === null) {
    const chip = element('span', 'chip', 'CT parcelada');
    const actions = element('div', 'card__header-actions');
    actions.append(chip);
    header.append(actions);
    body.append(
      emptyState(
        'block',
        'Sem CR para CT parcelada',
        'Apólice com CT parcelada não recebe CR nem tem comissão calculada ou elegível enquanto a regra do recebimento parcelado (DEC-210) não for definida.',
      ),
    );
    section.append(body);
    return section;
  }

  const actions = element('div', 'card__header-actions');
  actions.append(statusChip('payout', view.situation));
  header.append(actions);

  const footer = element('div', 'card__footer');

  if (view.commission === null) {
    body.append(
      metric('Valor da Usina', formatMoney(view.usinaValue)),
      emptyState(
        'pending_actions',
        'Apólice sem CR',
        'A apólice é válida, mas ainda não tem repasse calculado nem pode ser tornada elegível. Nenhuma CR é assumida: informe-a.',
      ),
    );
    footer.append(
      button('Informar CR', {
        variant: 'filled',
        iconName: 'edit',
        onClick: () => informPayoutRate(policy),
      }),
    );
    section.append(body, footer);
    return section;
  }

  const commission = view.commission;
  const values = element('div', 'comparison');
  values.append(
    metric('Valor da Usina', formatMoney(commission.base)),
    metric('CR', formatPercentage(commission.rate)),
    metric('A repassar ao corretor', formatMoney(commission.payout), true),
    metric('Fica na Usina', formatMoney(commission.retained)),
  );
  body.append(values);

  if (commission.statement !== null) {
    body.append(statementBlock(commission.statement));
  }

  body.append(payoutHistory(commission.entries));
  section.append(body);

  // REQ-277: while calculated, the only acts are the recalculation and the
  // eligibility. REQ-282: an eligible commission is only consulted.
  if (commission.status === 'CALCULATED') {
    footer.append(
      button('Recalcular CR', { iconName: 'tune', onClick: () => revisePayoutRate(policy) }),
      button('Assinar elegibilidade', {
        variant: 'filled',
        iconName: 'verified',
        onClick: () => declareEligibility(policy),
      }),
    );
    section.append(footer);
  }

  return section;
}

async function informPayoutRate(policy) {
  const answer = await ask('#dialog-payout-rate');
  if (answer === null) {
    return;
  }

  await perform(
    () => api.informPayoutRate(policy.id, { rate: answer.rate, userId: answer.userId }),
    payoutOutcome,
  );
}

async function revisePayoutRate(policy) {
  const answer = await ask('#dialog-payout-revision');
  if (answer === null) {
    return;
  }

  await perform(
    () =>
      api.revisePayoutRate(policy.id, {
        rate: answer.rate,
        reason: answer.reason,
        userId: answer.userId,
      }),
    payoutOutcome,
  );
}

async function declareEligibility(policy) {
  const answer = await ask('#dialog-payout-eligibility');
  if (answer === null) {
    return;
  }

  await perform(
    () => api.declarePayoutEligibility(policy.id, answer.userId),
    'Elegibilidade assinada. O extrato de elegibilidade foi gerado.',
  );
}

/* --------------------------------------------------------------- page -- */

/** A read that answers 404 means "does not exist yet", not a failure. */
async function optional(read) {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) {
      return null;
    }
    throw error;
  }
}

function notFound(message) {
  const section = element('section', 'card');
  const body = element('div', 'card__body');
  const back = element('a', 'btn btn--outlined', 'Voltar ao início');
  back.href = '/app/';
  body.append(emptyState('search_off', 'Apólice não encontrada', message, back));
  section.append(body);
  page.replaceChildren(section);
}

async function render() {
  if (policyId === null || policyId === '') {
    notFound('Informe o identificador da apólice na URL.');
    return;
  }

  let policy;
  try {
    policy = await api.getPolicy(policyId);
  } catch (error) {
    notFound(error instanceof ApiError ? error.message : 'Falha ao consultar a apólice.');
    return;
  }

  const [commission, payout] = await Promise.all([
    optional(() => api.getCommission(policyId)),
    api.getPolicyPayout(policyId),
  ]);

  const head = element('div', 'page-head');
  const text = element('div', 'page-head__text');
  text.append(
    element('h1', 'text-display', 'Apólice'),
    element('p', 'text-muted', 'Parcelas, comissão acordada × real e comissão de repasse (CR).'),
  );
  const actions = element('div', 'page-head__actions');
  const another = element('a', 'btn btn--outlined', 'Novo negócio');
  another.href = '/app/proposals/new.html';
  actions.append(another);
  head.append(text, actions);

  page.replaceChildren(
    head,
    policyCard(policy),
    installmentsCard(policy),
    commissionCard(policy, commission),
    payoutCard(policy, payout),
  );
}

render();
