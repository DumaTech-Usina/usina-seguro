/**
 * OUT-05: o painel acordado × real de todas as apólices.
 *
 * The comparison itself is the one the policy screen already shows (REQ-076,
 * CA-016); here it is read as a list, which is what makes a divergence
 * findable after the import that produced it. FP-02 step 5 is manual work on
 * a worklist, and without this page the worklist only existed while the
 * import result was on screen.
 *
 * The page reads and filters; it decides nothing. Whether a commission
 * diverges is the backend's answer (`divergent`), never a subtraction done
 * here, and changing the filter is a new reading, not a slice of the previous
 * one. The line ends on the policy, where REQ-085 records who closed the
 * divergence and why.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatMoney } from '/app/shared/money.js';
import { referenceLabel } from '/app/shared/reference.js';
import { reportError } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const list = document.querySelector('#list');
const filters = document.querySelector('#filters');
const summary = document.querySelector('#summary');

/**
 * The tabs. `status: undefined` asks for every commission.
 *
 * `RECEBIDA` of section 10.5 has no tab because no operation reaches that
 * state: no requirement says who records the baixa de comissionamento, so a
 * tab for it would always be empty.
 */
const TABS = [
  { id: 'all', label: 'Todas', status: undefined },
  { id: 'divergent', label: 'Divergentes', status: 'DIVERGENT' },
  { id: 'forecast', label: 'Previstas', status: 'FORECAST' },
  { id: 'reconciled', label: 'Conciliadas', status: 'RECONCILED' },
  { id: 'resolved', label: 'Resolvidas', status: 'RESOLVED' },
];

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

function emptyState(iconName, title, description) {
  const empty = element('div', 'empty');
  empty.append(
    icon(iconName),
    element('h3', 'text-subtitle', title),
    element('p', undefined, description),
  );
  return empty;
}

/* --------------------------------------------------------------- table -- */

function row(commission) {
  const line = element('tr');

  const identification = element('td');
  identification.append(
    element('span', 'policy-number', commission.policyNumber),
    // REQ-050: the proposal number stays consultable beside the policy one.
    element(
      'div',
      'text-muted',
      `Proposta ${commission.proposalNumber ?? 'sem número'} · ${referenceLabel(
        commission.clientName,
        commission.clientId,
      )}`,
    ),
    element(
      'div',
      'text-muted',
      `${referenceLabel(commission.insurerName, commission.insurerId)} · ${referenceLabel(
        commission.productName,
        commission.productId,
      )}`,
    ),
  );
  line.append(identification);

  // REQ-066: what is in force is the overridden value; the calculated one is
  // shown beside it so the adjustment does not hide what it replaced.
  const agreed = element('td', 'is-numeric');
  agreed.append(element('span', undefined, formatMoney(commission.effectiveReceivable)));
  if (commission.effectiveReceivable !== commission.agreedReceivable) {
    agreed.append(
      element('div', 'text-muted', `calculado ${formatMoney(commission.agreedReceivable)}`),
    );
  }
  line.append(agreed);

  const real = element(
    'td',
    // REQ-075: null is not zero — it is a report that never matched this policy.
    commission.realReceivable === null
      ? 'is-numeric not-apurado'
      : `is-numeric${commission.divergent ? ' is-divergent' : ''}`,
    commission.realReceivable === null ? 'Não apurado' : formatMoney(commission.realReceivable),
  );
  line.append(real);

  line.append(
    element('td', 'is-numeric', formatMoney(commission.effectivePayable)),
    element('td', undefined, commission.reconciledCompetence ?? '—'),
  );

  const status = element('td');
  status.append(statusChip('commission', commission.status));
  if (commission.divergent) {
    status.append(element('div', 'chip chip--danger', 'Acordado ≠ real'));
  }
  line.append(status);

  const action = element('td', 'is-action');
  // Where the line lands next: the policy is where the override of REQ-066 and
  // the resolution of REQ-085 are recorded, and where the transfer is opened.
  const open = element('a', 'btn btn--sm btn--outlined', 'Abrir apólice');
  open.href = `/app/policies/detail.html?id=${encodeURIComponent(commission.policyId)}`;
  action.append(open);
  line.append(action);

  return line;
}

function table(commissions) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');

  for (const [label, className] of [
    ['Apólice', ''],
    ['Acordado a receber', 'is-numeric'],
    ['Real a receber', 'is-numeric'],
    ['A pagar ao corretor', 'is-numeric'],
    ['Competência', ''],
    ['Situação', ''],
    ['', 'is-action'],
  ]) {
    headRow.append(element('th', className, label));
  }

  head.append(headRow);
  const body = element('tbody');
  for (const commission of commissions) {
    body.append(row(commission));
  }

  node.append(head, body);
  return node;
}

/* ---------------------------------------------------------------- page -- */

let current = TABS[0];

function renderFilters() {
  filters.replaceChildren(
    ...TABS.map((tab) => {
      const option = element('button', 'filters__option', tab.label);
      option.type = 'button';
      option.setAttribute('role', 'tab');
      option.setAttribute('aria-selected', String(tab === current));
      option.dataset.tab = tab.id;
      option.addEventListener('click', () => {
        current = tab;
        renderFilters();
        load();
      });
      return option;
    }),
  );
}

function loading() {
  summary.replaceChildren();
  const skeletons = element('div', 'card__body stack');
  for (const width of ['40%', '70%', '55%']) {
    const bar = element('div', 'skeleton');
    bar.style.width = width;
    skeletons.append(bar);
  }
  list.replaceChildren(skeletons);
}

/** How many lines are on screen, and how many of them diverge (REQ-076). */
function renderSummary(commissions) {
  const divergent = commissions.filter((commission) => commission.divergent).length;
  const chips = [element('span', 'chip', `${commissions.length} apólices`)];

  if (divergent > 0) {
    chips.push(element('span', 'chip chip--danger', `${divergent} com divergência`));
  }

  summary.replaceChildren(...chips);
}

async function load() {
  loading();

  let commissions;
  try {
    commissions = await api.listCommissions(current.status);
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    }
    list.replaceChildren(
      emptyState(
        'cloud_off',
        'Não foi possível carregar as comissões',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  renderSummary(commissions);

  if (commissions.length === 0) {
    list.replaceChildren(
      emptyState(
        current.status === 'DIVERGENT' ? 'task_alt' : 'inbox',
        current.status === 'DIVERGENT'
          ? 'Nenhuma divergência a tratar'
          : 'Nenhuma comissão neste estado',
        current.status === 'DIVERGENT'
          ? 'Toda comissão apurada até aqui bate com o valor previsto.'
          : 'Troque o filtro ou concilie um relatório de comissionamento.',
      ),
    );
    return;
  }

  list.replaceChildren(table(commissions));
}

renderFilters();
load();
