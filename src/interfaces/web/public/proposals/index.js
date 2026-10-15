/**
 * The proposals an operator follows, by state of REQ-250.
 *
 * The page reads and filters; it decides nothing. The default is what awaits
 * issuance, with what the Usina expects from each (REQ-232). Refused
 * proposals stay reachable because REQ-253 keeps them on the record.
 */

import { ApiError, api } from '/app/shared/api.js';
import { brokerName, loadBrokers } from '/app/shared/brokers.js';
import { formatDate, formatMoney, formatPercentage } from '/app/shared/money.js';
import { reportError } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const list = document.querySelector('#list');
const filters = document.querySelector('#filters');

/** The tabs, in the order of REQ-250. `status: undefined` asks for every proposal. */
const TABS = [
  { id: 'awaiting', label: 'Aguardando emissão', status: 'AWAITING_ISSUANCE' },
  { id: 'issued', label: 'Emitidas', status: 'ISSUED' },
  { id: 'rejected', label: 'Recusadas', status: 'REJECTED' },
  { id: 'all', label: 'Todas', status: undefined },
];

/** O que a ausência significa em cada estado, que não é a mesma coisa. */
const EMPTY_NOTE = {
  awaiting: 'Nenhuma proposta aguardando a seguradora emitir.',
  issued: 'Nenhuma proposta emitida ainda — é daqui que nascem as apólices.',
  rejected: 'Nenhuma recusa registrada.',
  all: 'Registre um novo negócio para começar.',
};

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

function row(proposal) {
  const line = element('tr');

  const number = element('td');
  number.append(
    element('span', 'proposal-number', proposal.proposalNumber),
    element(
      'div',
      'text-muted',
      `Cliente ${proposal.clientId} · Corretor ${brokerName(proposal.brokerId)}`,
    ),
  );
  line.append(number);

  line.append(
    element('td', undefined, proposal.insurerId),
    element('td', undefined, proposal.productId),
    element('td', 'is-numeric', formatMoney(proposal.netPremium)),
    element('td', 'is-numeric', formatPercentage(proposal.workedCommission)),
    // REQ-232: what the Usina expects, as the server calculated it.
    element('td', 'is-numeric', formatMoney(proposal.expectedReceipt.usina)),
    element('td', undefined, formatDate(proposal.registeredAt.slice(0, 10))),
  );

  const status = element('td');
  status.append(statusChip('proposal', proposal.status));
  // REQ-253: the reason is what makes a refusal readable in a listing.
  if (proposal.rejectionReason !== null) {
    status.append(element('div', 'text-muted', proposal.rejectionReason));
  }
  line.append(status);

  const action = element('td', 'is-action');
  const open = element('a', 'btn btn--sm btn--outlined', 'Abrir');
  open.href = `/app/proposals/detail.html?id=${encodeURIComponent(proposal.id)}`;
  action.append(open);
  line.append(action);

  return line;
}

function table(proposals) {
  const node = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');

  for (const [label, className] of [
    ['Proposta', ''],
    ['Seguradora', ''],
    ['Produto', ''],
    ['Prêmio líquido', 'is-numeric'],
    ['CT', 'is-numeric'],
    ['Usina espera', 'is-numeric'],
    ['Registro', ''],
    ['Situação', ''],
    ['', 'is-action'],
  ]) {
    headRow.append(element('th', className, label));
  }

  head.append(headRow);
  const body = element('tbody');
  for (const proposal of proposals) {
    body.append(row(proposal));
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
  const skeletons = element('div', 'card__body stack');
  for (const width of ['40%', '70%', '55%']) {
    const bar = element('div', 'skeleton');
    bar.style.width = width;
    skeletons.append(bar);
  }
  list.replaceChildren(skeletons);
}

async function load() {
  loading();

  let proposals;
  try {
    // REQ-308: the proposal keeps the broker's id; the registry gives the name.
    [proposals] = await Promise.all([api.listProposals(current.status), loadBrokers()]);
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    }
    list.replaceChildren(
      emptyState(
        'cloud_off',
        'Não foi possível carregar as propostas',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  if (proposals.length === 0) {
    list.replaceChildren(
      emptyState(
        'inbox',
        'Nenhuma proposta nesta etapa',
        EMPTY_NOTE[current.id] ?? 'Troque o filtro ou registre um novo negócio.',
      ),
    );
    return;
  }

  list.replaceChildren(table(proposals));
}

renderFilters();
load();
