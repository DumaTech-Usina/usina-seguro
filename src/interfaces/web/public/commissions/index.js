/**
 * OUT-05: a comissão acordada de todas as apólices (REQ-236).
 *
 * The page reads and filters; it decides nothing. Changing the filter is a new
 * reading, not a slice of the previous one. The line ends on the policy, where
 * the override of REQ-066 is recorded.
 */

import { fromAddress, rememberInAddress } from '/app/shared/address.js';
import { ApiError, api } from '/app/shared/api.js';
import { formatMoney } from '/app/shared/money.js';
import {
  firstPage,
  pageToRetry,
  pager,
  pagingFromAddress,
  rememberPaging,
} from '/app/shared/pager.js';

const COUNT = new Intl.NumberFormat('pt-BR');
import { referenceLabel } from '/app/shared/reference.js';
import { reportError } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const list = document.querySelector('#list');
const filters = document.querySelector('#filters');
const summary = document.querySelector('#summary');

/** The tabs. `status: undefined` asks for every commission. */
const TABS = [
  { id: 'all', label: 'Todas', status: undefined },
  { id: 'forecast', label: 'Previstas', status: 'FORECAST' },
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

  const status = element('td');
  status.append(statusChip('commission', commission.status));
  line.append(status);

  const action = element('td', 'is-action');
  // Where the line lands next: the policy is where the override of REQ-066 is
  // recorded.
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

// The tab the address asks for; the first goes unsaid.
let current = TABS.find((tab) => tab.id === fromAddress('tab')) ?? TABS[0];

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
        paging = firstPage(paging.size);
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

/** How many commissions the filter found (REQ-331). */
function renderSummary(commissions) {
  summary.replaceChildren(element('span', 'chip', `${COUNT.format(commissions.total)} apólices`));
}

// REQ-330, REQ-332: the page on screen and how many lines it holds.
let paging = pagingFromAddress();

async function load() {
  rememberPaging(paging);
  rememberInAddress({ tab: current === TABS[0] ? undefined : current.id });
  loading();

  let commissions;
  try {
    commissions = await api.listCommissions(current.status, paging);
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

  const retry = pageToRetry(commissions);
  if (retry !== null && commissions.total > 0) {
    paging = { ...paging, page: retry };
    load();
    return;
  }

  renderSummary(commissions);

  if (commissions.total === 0) {
    list.replaceChildren(
      emptyState(
        'inbox',
        'Nenhuma comissão neste estado',
        'A comissão acordada nasce quando a emissão da proposta é reconhecida.',
      ),
    );
    return;
  }

  list.replaceChildren(
    table(commissions.items),
    pager(commissions, {
      onPage: (page) => {
        paging = { ...paging, page };
        load();
      },
      onSize: (size) => {
        paging = firstPage(size);
        load();
      },
    }),
  );
}

renderFilters();
load();
