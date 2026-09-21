/**
 * FP-02 as the Financeiro drives it: importar o relatório, ler o que aconteceu
 * com cada linha, e trabalhar as pendências (OUT-06).
 *
 * The page sends lines and renders answers. It classifies nothing: whether a
 * line matched a policy (REQ-082), whether it became a pendency (REQ-083),
 * whether the values disagree (REQ-076) and whether the competence was already
 * conciliated (REQ-086) are the import's answers, and each one arrives named
 * on the line it belongs to. The labels live in `shared/status.js`, which is
 * presentation and nothing else.
 *
 * What the page deliberately does not do is read a file. The layout is DEC-001
 * and the requirements state that REQ-080 to REQ-083 are not implementable
 * without a real sample, so the input here is what the endpoint has always
 * taken: lines already structured.
 *
 * A divergent line ends on the policy, which is where REQ-076 shows agreed and
 * real side by side and REQ-085 records who closed the divergence.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatInstant, formatMoney } from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

const form = document.querySelector('#form-report');
const lines = document.querySelector('#lines');
const result = document.querySelector('#result');
const pendencies = document.querySelector('#pendencies');

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

function emptyState(iconName, title, description) {
  const empty = element('div', 'empty');
  empty.append(
    icon(iconName),
    element('h3', 'text-subtitle', title),
    element('p', undefined, description),
  );
  return empty;
}

function metric(label, value, highlight = false) {
  const wrapper = element('div', `metric${highlight ? ' metric--highlight' : ''}`);
  wrapper.append(element('span', 'text-label', label), element('span', 'metric__value', value));
  return wrapper;
}

function headRow(columns) {
  const row = element('tr');
  for (const [label, className] of columns) {
    row.append(element('th', className, label));
  }
  const head = element('thead');
  head.append(row);
  return head;
}

function skeletons(host) {
  const body = element('div', 'card__body stack');
  for (const width of ['40%', '70%']) {
    const bar = element('div', 'skeleton');
    bar.style.width = width;
    body.append(bar);
  }
  host.replaceChildren(body);
}

/* ------------------------------------------------------- the entry grid -- */

/**
 * One line of the report, as REQ-081 brings it and REQ-082 reads it.
 *
 * Of the eleven fields REQ-081 lists, three are asked for: the two identifiers
 * of REQ-082 and the producer commission, which is the real value of REQ-075.
 * They are the ones a confirmed rule consumes — asking for the rest would be
 * typing data nothing checks.
 */
function addLine() {
  const row = element('div', 'line-row');
  row.innerHTML = `
    <div class="field">
      <input class="field__input" name="policyNumber" placeholder=" " />
      <label class="field__label">Número da apólice</label>
      <span class="field__hint">Sem ele, a apólice é resolvida pela proposta.</span>
    </div>
    <div class="field">
      <input class="field__input" name="proposalNumber" placeholder=" " required />
      <label class="field__label">Número da proposta</label>
    </div>
    <div class="field">
      <input class="field__input" name="producerCommission" placeholder=" "
             inputmode="decimal" pattern="\\d+(\\.\\d{1,2})?" required />
      <label class="field__label">Comissão do produtor</label>
      <span class="field__hint">Valor apurado, ex.: 40.00.</span>
    </div>
    <button class="line-row__remove" type="button" title="Remover linha">
      <span class="material-symbols-outlined">close</span>
    </button>`;

  row.querySelector('.line-row__remove').addEventListener('click', () => {
    row.remove();
    refreshRemoval();
  });

  lines.append(row);
  refreshRemoval();
}

/** A report has at least one line (REQ-080), so the last one cannot go. */
function refreshRemoval() {
  const rows = [...lines.querySelectorAll('.line-row')];
  for (const row of rows) {
    row.querySelector('.line-row__remove').disabled = rows.length === 1;
  }
}

function typedLines() {
  return [...lines.querySelectorAll('.line-row')].map((row) => {
    const policyNumber = row.querySelector('[name="policyNumber"]').value.trim();
    const line = {
      proposalNumber: row.querySelector('[name="proposalNumber"]').value,
      producerCommission: row.querySelector('[name="producerCommission"]').value,
    };

    // An absent policy number is what REQ-082 resolves through the proposal.
    // Sending an empty one instead would be saying something different.
    if (policyNumber !== '') {
      line.policyNumber = policyNumber;
    }

    return line;
  });
}

document.querySelector('#add-line').addEventListener('click', addLine);
addLine();

/* ----------------------------------------------------------- o resultado -- */

function resultRow(line) {
  const row = element('tr');

  row.append(
    element('td', 'report-number', line.proposalNumber),
    element('td', 'report-number', line.policyNumber ?? '—'),
    element('td', 'is-numeric', formatMoney(line.reportedCommission)),
  );

  const outcome = element('td');
  outcome.append(statusChip('reconciliation', line.outcome));
  row.append(outcome);

  const action = element('td', 'is-action');
  // Where the line lands next: the policy is where REQ-076 shows agreed and
  // real side by side, and where REQ-085 closes a divergence.
  if (line.policyId !== null) {
    const open = element('a', 'btn btn--sm btn--outlined', 'Abrir apólice');
    open.href = `/app/policies/detail.html?id=${encodeURIComponent(line.policyId)}`;
    action.append(open);
  }
  row.append(action);

  return row;
}

function renderResult(output) {
  const section = element('section', 'card');

  const header = element('div', 'card__header');
  header.append(icon('fact_check'), element('h2', 'text-title', 'Resultado da importação'));
  const headerActions = element('div', 'card__header-actions');
  headerActions.append(element('span', 'chip', `Competência ${output.competence}`));
  header.append(headerActions);

  const counters = element('div', 'card__body');
  const grid = element('div', 'counters');
  grid.append(
    metric('Conciliadas', String(output.reconciled)),
    metric('Divergentes', String(output.divergent), output.divergent > 0),
    metric('Já conciliadas', String(output.duplicated)),
    metric('Pendências', String(output.pending)),
  );
  counters.append(grid);

  const body = element('div', 'card__body card__body--flush');
  const table = element('table', 'table');
  table.append(
    headRow([
      ['Proposta', ''],
      ['Apólice', ''],
      ['Comissão informada', 'is-numeric'],
      ['Resultado', ''],
      ['', 'is-action'],
    ]),
  );
  const rows = element('tbody');
  for (const line of output.lines) {
    rows.append(resultRow(line));
  }
  table.append(rows);
  body.append(table);

  section.append(header, counters, body);
  result.replaceChildren(section);
}

/* ---------------------------------------------------------- OUT-06 -- */

function pendencyRow(pendency) {
  const row = element('tr');
  row.append(
    element('td', undefined, pendency.competence),
    element('td', 'report-number', pendency.proposalNumber),
    element('td', 'report-number', pendency.policyNumber ?? '—'),
    element('td', 'is-numeric', formatMoney(pendency.reportedCommission)),
    element('td', undefined, formatInstant(pendency.registeredAt)),
  );
  return row;
}

async function loadPendencies() {
  skeletons(pendencies);

  let open;
  try {
    open = await api.listReconciliationPendencies();
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    }
    pendencies.replaceChildren(
      emptyState(
        'cloud_off',
        'Não foi possível carregar as pendências',
        error instanceof ApiError ? error.message : 'Falha de comunicação com o servidor.',
      ),
    );
    return;
  }

  if (open.length === 0) {
    pendencies.replaceChildren(
      emptyState(
        'task_alt',
        'Nenhuma pendência',
        'Toda linha importada até aqui encontrou a apólice correspondente.',
      ),
    );
    return;
  }

  const table = element('table', 'table');
  table.append(
    headRow([
      ['Competência', ''],
      ['Proposta', ''],
      ['Apólice', ''],
      ['Comissão informada', 'is-numeric'],
      ['Registrada em', ''],
    ]),
  );
  const rows = element('tbody');
  for (const pendency of open) {
    rows.append(pendencyRow(pendency));
  }
  table.append(rows);

  pendencies.replaceChildren(table);
}

/* ------------------------------------------------------------ a ação -- */

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Conciliando…';

  try {
    const output = await api.reconcileCommissionReport({
      competence: document.querySelector('#competence').value,
      lines: typedLines(),
    });

    renderResult(output);
    showSnackbar(`Relatório da competência ${output.competence} importado.`, { tone: 'success' });
    // A line may have opened a pendency, and OUT-06 is read again rather than
    // patched from the answer: the list is what the backend holds.
    await loadPendencies();
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    } else {
      showSnackbar('Falha de comunicação com o servidor.', { tone: 'danger' });
    }
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
});

loadPendencies();
