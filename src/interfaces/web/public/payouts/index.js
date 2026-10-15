/**
 * FP-02 (V2 section 9A) seen as lists: the policies that still need a CR
 * (REQ-286) and the eligible commissions, read-only, with their filters
 * (REQ-284). Each line leads to its policy, and the policy to its commission
 * (CA-235).
 *
 * The page reads and filters; it decides nothing. Which policy lacks a CR and
 * which commission matches a filter are the backend's answers — changing a
 * filter is a new reading.
 */

import { ApiError, api } from '/app/shared/api.js';
import { authorName, loadAuthors } from '/app/shared/authors.js';
import { brokerName, loadBrokers } from '/app/shared/brokers.js';
import { formatDate, formatInstant, formatMoney, formatPercentage } from '/app/shared/money.js';
import { reportError } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const withoutRate = document.querySelector('#without-rate');
const withoutSummary = document.querySelector('#without-summary');
const parcelled = document.querySelector('#parcelled');
const parcelledSummary = document.querySelector('#parcelled-summary');
const eligible = document.querySelector('#eligible');
const eligibleSummary = document.querySelector('#eligible-summary');
const filters = document.querySelector('#eligible-filters');

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

function table(headers, rows) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');
  for (const [label, className] of headers) {
    headRow.append(element('th', className, label));
  }
  head.append(headRow);
  const body = element('tbody');
  body.append(...rows);
  node.append(head, body);
  return node;
}

/** CA-235: from the line to the policy, where its commission is. */
function policyLink(policyId, label) {
  const cell = element('td', 'is-action');
  const link = element('a', 'btn btn--sm btn--outlined', label);
  link.href = `/app/policies/detail.html?id=${encodeURIComponent(policyId)}`;
  cell.append(link);
  return cell;
}

function failure(region, title, error) {
  if (error instanceof ApiError) {
    reportError(error);
  }
  region.replaceChildren(
    emptyState(
      'cloud_off',
      title,
      error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
    ),
  );
}

/* ------------------------------------------------------- without CR -- */

async function loadWithoutRate() {
  let lines;
  try {
    // REQ-308: the lines carry the broker's id; the registry gives the name.
    [lines] = await Promise.all([api.listPoliciesWithoutPayoutRate(), loadBrokers()]);
  } catch (error) {
    failure(withoutRate, 'Não foi possível carregar as apólices sem CR', error);
    return;
  }

  withoutSummary.replaceChildren(element('span', 'chip', `${lines.length} sem CR`));

  if (lines.length === 0) {
    withoutRate.replaceChildren(
      emptyState(
        'task_alt',
        'Nenhuma apólice sem CR',
        'Toda apólice com CT integral já tem a sua CR informada.',
      ),
    );
    return;
  }

  withoutRate.replaceChildren(
    table(
      [
        ['Apólice', ''],
        ['Cliente', ''],
        ['Corretor', ''],
        ['Valor da Usina', 'is-numeric'],
        ['Renovação', ''],
        ['', 'is-action'],
      ],
      lines.map((line) => {
        const row = element('tr');
        row.append(
          element('td', 'policy-number', line.policyNumber),
          element('td', undefined, line.client),
          element('td', undefined, brokerName(line.broker)),
          element('td', 'is-numeric', formatMoney(line.usinaValue)),
          element('td', undefined, formatDate(line.renewalDate)),
          policyLink(line.policyId, 'Informar CR'),
        );
        return row;
      }),
    ),
  );
}

/* -------------------------------------------------------- parcelled -- */

/**
 * REQ-268: every policy with parcelled CT and its situation. No Usina value:
 * a parcelled CT has no total (REJ-232).
 */
async function loadParcelled() {
  let lines;
  try {
    [lines] = await Promise.all([api.listParcelledPolicies(), loadBrokers()]);
  } catch (error) {
    failure(parcelled, 'Não foi possível carregar as apólices parceladas', error);
    return;
  }

  parcelledSummary.replaceChildren(element('span', 'chip', `${lines.length} parceladas`));

  if (lines.length === 0) {
    parcelled.replaceChildren(
      emptyState('inbox', 'Nenhuma apólice parcelada', 'Nenhuma apólice tem CT parcelada.'),
    );
    return;
  }

  parcelled.replaceChildren(
    table(
      [
        ['Apólice', ''],
        ['Cliente', ''],
        ['Corretor', ''],
        ['Renovação', ''],
        ['Situação', ''],
        ['', 'is-action'],
      ],
      lines.map((line) => {
        const row = element('tr');
        const situation = element('td');
        situation.append(statusChip('parcelledPayout', line.situation));
        row.append(
          element('td', 'policy-number', line.policyNumber),
          element('td', undefined, line.client),
          element('td', undefined, brokerName(line.broker)),
          element('td', undefined, formatDate(line.renewalDate)),
          situation,
          policyLink(line.policyId, 'Abrir apólice'),
        );
        return row;
      }),
    ),
  );
}

/* --------------------------------------------------------- eligible -- */

/**
 * The start of a calendar day in the reader's own time zone, as an instant.
 * The eligibility period includes both days (REQ-284), so the upper bound
 * sent is the start of the day after the last one.
 */
function startOfDay(isoDate, plusDays = 0) {
  const [year, month, day] = isoDate.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day + plusDays).toISOString();
}

/** Only the filters the operator informed. */
function informedFilters() {
  const values = Object.fromEntries(new FormData(filters));
  const query = {};

  for (const name of ['policyNumber', 'broker', 'client', 'renewalFrom', 'renewalUntil']) {
    const value = String(values[name] ?? '').trim();
    if (value !== '') {
      query[name] = value;
    }
  }
  if (values.eligibleFrom) {
    query.eligibleFrom = startOfDay(values.eligibleFrom);
  }
  if (values.eligibleUntil) {
    query.eligibleBefore = startOfDay(values.eligibleUntil, 1);
  }

  return query;
}

async function loadEligible() {
  let lines;
  try {
    // REQ-216: who signed each eligibility is kept by id; the directory names it.
    [lines] = await Promise.all([api.listEligiblePayouts(informedFilters()), loadAuthors()]);
  } catch (error) {
    failure(eligible, 'Não foi possível carregar as comissões elegíveis', error);
    return;
  }

  eligibleSummary.replaceChildren(element('span', 'chip', `${lines.length} elegíveis`));

  if (lines.length === 0) {
    eligible.replaceChildren(
      emptyState(
        'inbox',
        'Nenhuma comissão elegível',
        'Nenhuma comissão elegível corresponde aos filtros informados.',
      ),
    );
    return;
  }

  eligible.replaceChildren(
    table(
      [
        ['Apólice', ''],
        ['Corretor', ''],
        ['Cliente', ''],
        ['Elegível em', ''],
        ['Renovação', ''],
        ['Valor da Usina', 'is-numeric'],
        ['CR', 'is-numeric'],
        ['A repassar', 'is-numeric'],
        ['Fica na Usina', 'is-numeric'],
        ['Assinado por', ''],
        ['', 'is-action'],
      ],
      lines.map((line) => {
        const row = element('tr');
        row.append(
          element('td', 'policy-number', line.policyNumber),
          element('td', undefined, line.broker),
          element('td', undefined, line.client),
          element('td', undefined, formatInstant(line.eligibleAt)),
          element('td', undefined, formatDate(line.renewalDate)),
          element('td', 'is-numeric', formatMoney(line.usinaValue)),
          element('td', 'is-numeric', formatPercentage(line.payoutRate)),
          element('td', 'is-numeric', formatMoney(line.payout)),
          element('td', 'is-numeric', formatMoney(line.retained)),
          element('td', 'text-muted', authorName(line.signedBy)),
          policyLink(line.policyId, 'Abrir apólice'),
        );
        return row;
      }),
    ),
  );
}

filters.addEventListener('submit', (event) => {
  event.preventDefault();
  loadEligible();
});

document.querySelector('#clear-filters').addEventListener('click', () => {
  filters.reset();
  loadEligible();
});

loadWithoutRate();
loadParcelled();
loadEligible();
