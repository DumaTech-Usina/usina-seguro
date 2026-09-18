/**
 * FP-01 step 5: the proposals an operator has to follow (REQ-043, OUT-01).
 *
 * The page reads and filters; it decides nothing. The filter is the state
 * itself, so "em aberto" is not a rule this file invented — it is the
 * `TRANSMITTED` of section 10.2, which REQ-043 names as sent to the insurer
 * and without an outcome. Refused proposals stay reachable here because
 * REQ-045/REQ-046 keep them on the record (OUT-02).
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatDate, formatMoney, formatPercentage } from '/app/shared/money.js';
import { reportError } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const list = document.querySelector('#list');
const filters = document.querySelector('#filters');

/**
 * The tabs. `status: undefined` asks for every proposal.
 *
 * The first one is the default because it is the worklist REQ-043 exists for:
 * what was sent to the insurer and is still waiting for an answer.
 */
const TABS = [
  { id: 'open', label: 'Em aberto', status: 'TRANSMITTED' },
  { id: 'draft', label: 'Rascunhos', status: 'DRAFT' },
  { id: 'accepted', label: 'Aceitas', status: 'ACCEPTED' },
  { id: 'rejected', label: 'Recusadas', status: 'REJECTED' },
  { id: 'all', label: 'Todas', status: undefined },
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

function row(proposal) {
  const line = element('tr');

  const number = element('td');
  number.append(
    element('span', 'proposal-number', proposal.proposalNumber ?? 'sem número'),
    element('div', 'text-muted', `Cliente ${proposal.clientId} · Corretor ${proposal.brokerId}`),
  );
  line.append(number);

  line.append(
    element('td', undefined, proposal.insurerId),
    element('td', undefined, proposal.productId),
    element('td', 'is-numeric', formatMoney(proposal.netPremium)),
    element(
      'td',
      'is-numeric',
      // REQ-041: only exists from the transmission on.
      proposal.workedCommission === null ? '—' : formatPercentage(proposal.workedCommission),
    ),
    element(
      'td',
      undefined,
      formatDate((proposal.transmittedAt ?? proposal.registeredAt).slice(0, 10)),
    ),
  );

  const status = element('td');
  status.append(statusChip('proposal', proposal.status));
  // REQ-045: the reason is what makes a refusal readable in a listing.
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
    ['% trabalhada', 'is-numeric'],
    ['Data', ''],
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
    proposals = await api.listProposals(current.status);
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
        'Nenhuma proposta neste estado',
        current.status === 'TRANSMITTED'
          ? 'Nada aguardando desfecho da seguradora.'
          : 'Troque o filtro ou registre uma nova proposta.',
      ),
    );
    return;
  }

  list.replaceChildren(table(proposals));
}

renderFilters();
load();
