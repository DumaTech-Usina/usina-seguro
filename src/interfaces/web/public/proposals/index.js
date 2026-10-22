/**
 * The proposals an operator follows, by state of REQ-250.
 *
 * The page reads and filters; it decides nothing. The default is what awaits
 * issuance, with what the Usina expects from each (REQ-232). Refused
 * proposals stay reachable because REQ-253 keeps them on the record.
 */

import { fromAddress, rememberInAddress } from '/app/shared/address.js';
import { ApiError, api } from '/app/shared/api.js';
import { brokerName, loadBrokers } from '/app/shared/brokers.js';
import { formatDate, formatMoney, formatPercentage } from '/app/shared/money.js';
import {
  firstPage,
  pageToRetry,
  pager,
  pagingFromAddress,
  rememberPaging,
} from '/app/shared/pager.js';
import { intermediaryName, loadIntermediaries } from '/app/shared/receipt.js';
import { reportError } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const list = document.querySelector('#list');
const filters = document.querySelector('#filters');
const clientSearchForm = document.querySelector('#form-client-search');
const clientSearch = clientSearchForm.querySelector('[name="client"]');

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

/** REQ-291: a parcelled CT is two rates — the first installment's and the others'. */
function workedCommissionLabel(proposal) {
  const first = formatPercentage(proposal.workedCommission);
  return proposal.workedCommissionMode === 'PARCELLED'
    ? `${first} · demais ${formatPercentage(proposal.subsequentWorkedCommission)}`
    : first;
}

function row(proposal) {
  const line = element('tr');

  const number = element('td', 'proposal-cell');
  number.append(
    element('span', 'proposal-number', proposal.proposalNumber),
    // REQ-318, REQ-320: the server names the client on each line.
    element('div', 'text-muted', `Cliente ${proposal.clientName}`),
    element('div', 'text-muted', `${proposal.insurerId} · ${proposal.productId}`),
  );
  line.append(number);

  line.append(
    element('td', undefined, brokerName(proposal.brokerId)),
    // REQ-220: no intermediary is a direct receipt.
    proposal.intermediaryId === null
      ? element('td', 'text-muted', 'Transação direta')
      : element('td', undefined, intermediaryName(proposal.intermediaryId)),
  );

  line.append(
    element('td', 'is-numeric', formatMoney(proposal.netPremium)),
    element('td', 'is-numeric', workedCommissionLabel(proposal)),
    // REQ-232: what the Usina expects, as the server calculated it. A parcelled
    // CT has one value per installment and no total (REQ-293, REJ-232).
    proposal.expectedReceipt === null
      ? element('td', 'is-numeric text-muted', 'Por parcela')
      : element('td', 'is-numeric', formatMoney(proposal.expectedReceipt.usina)),
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
    ['Corretor', ''],
    ['Intermediária', ''],
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

// The tab and the client search the address asks for; the first tab goes unsaid.
let current = TABS.find((tab) => tab.id === fromAddress('tab')) ?? TABS[0];
clientSearch.value = fromAddress('client');

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
        reload();
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

let listRequest = 0;
// REQ-330, REQ-332: the page on screen and how many lines it holds.
let paging = pagingFromAddress();

/** A new filter starts on the first page, with the same size (REQ-333). */
function reload() {
  paging = firstPage(paging.size);
  load();
}

async function load() {
  rememberPaging(paging);
  rememberInAddress({
    tab: current === TABS[0] ? undefined : current.id,
    client: clientSearch.value,
  });
  const request = ++listRequest;
  const client = clientSearch.value.trim();
  loading();

  let proposals;
  try {
    // REQ-308, REQ-229: the proposal keeps the broker's and the
    // intermediary's ids; those registries are small and give the names.
    // REQ-318, REQ-319: the server names the client and matches it.
    [proposals] = await Promise.all([
      api.listProposals(current.status, client, paging),
      loadBrokers(),
      loadIntermediaries(),
    ]);
  } catch (error) {
    if (request !== listRequest) {
      return;
    }
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

  // Only the latest answer is shown: typing in the search fires one reading per key.
  if (request !== listRequest) {
    return;
  }

  const retry = pageToRetry(proposals);
  if (retry !== null && proposals.total > 0) {
    paging = { ...paging, page: retry };
    load();
    return;
  }

  if (proposals.total === 0) {
    list.replaceChildren(
      client !== ''
        ? emptyState(
            'search_off',
            'Nenhuma proposta desse cliente',
            'Busque por outro nome ou CPF.',
          )
        : emptyState(
            'inbox',
            'Nenhuma proposta nesta etapa',
            EMPTY_NOTE[current.id] ?? 'Troque o filtro ou registre um novo negócio.',
          ),
    );
    return;
  }

  const scroll = element('div', 'table-scroll');
  scroll.append(table(proposals.items));
  list.replaceChildren(
    scroll,
    pager(proposals, {
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

clientSearchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  reload();
});
clientSearch.addEventListener('input', () => reload());

renderFilters();
load();
