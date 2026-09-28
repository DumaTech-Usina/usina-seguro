/**
 * The proposal an operator is following, from registration until its outcome.
 *
 * While it awaits issuance it shows what the Usina expects to receive
 * (REQ-232) and offers the corrections REQ-252 allows — the CT with its mode,
 * and the receipt — plus the outcome: the refusal (REQ-253), or the
 * recognition of issuance (REQ-209), which creates the policy from the
 * proposal's own data (REQ-240, REQ-241). Once issued or refused, it offers
 * nothing (REQ-260, REQ-253).
 *
 * Which act is admissible is the domain's answer, not this file's; every
 * refusal shown is the sentence the server rendered through `src/i18n`.
 */

import { ApiError, api } from '/app/shared/api.js';
import { base64Of } from '/app/shared/file.js';
import { formatDate, formatInstant, formatMoney, formatPercentage } from '/app/shared/money.js';
import {
  bindReceiptFields,
  intermediaryOf,
  offerRegisteredIntermediaries,
} from '/app/shared/receipt.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import {
  WORKED_COMMISSION_MODE,
  stageOfProposal,
  stageStrip,
  statusChip,
} from '/app/shared/status.js';

const proposalId = new URLSearchParams(window.location.search).get('id');
const page = document.querySelector('#page');

const panels = {
  corrections: document.querySelector('[data-panel="corrections"]'),
  outcome: document.querySelector('[data-panel="outcome"]'),
};

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

function definition(label, value, key) {
  const wrapper = element('div', 'definition');
  if (key !== undefined) {
    wrapper.dataset.definition = key;
  }
  wrapper.append(element('span', 'text-label', label), element('span', 'definition__value', value));
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

function link(label, href, variant = 'outlined') {
  const node = element('a', `btn btn--${variant}`, label);
  node.href = href;
  return node;
}

/** Keeps a submit button from firing twice while the request is in flight. */
async function submitting(form, work) {
  const button = form.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando…';

  try {
    await work();
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
}

/* ------------------------------------------------------------ summary -- */

/** Onde o negócio está, em uma frase, por estado de REQ-250. */
const STAGE_NOTE = {
  AWAITING_ISSUANCE: 'Aguardando proposta ser emitida pela seguradora.',
  ISSUED: 'Proposta emitida: o negócio evoluiu para apólice.',
  REJECTED: 'Proposta recusada. O ciclo comercial está encerrado.',
};

function receiptText(intermediaryId, ctu) {
  return intermediaryId === null
    ? 'Direto da seguradora'
    : `Através de ${intermediaryId} — CTU ${formatPercentage(ctu)}`;
}

function summaryCard(proposal) {
  const section = element('section', 'card');
  const body = element('div', 'card__body stack');

  // A progressão comercial antes dos dados: a primeira coisa que o operador
  // precisa saber é em que etapa o negócio está, não qual é o prêmio.
  section.append(stageStrip(stageOfProposal(proposal.status), STAGE_NOTE[proposal.status]));

  const head = element('div', 'proposal-head');
  const numbers = element('div', 'proposal-head__numbers');
  numbers.append(
    element('span', 'text-label', 'Número da proposta'),
    element('span', 'proposal-head__number', proposal.proposalNumber),
  );

  const chip = statusChip('proposal', proposal.status);
  chip.style.marginLeft = 'auto';
  head.append(numbers, chip);

  const details = element('div', 'definitions');
  details.append(
    definition('Cliente', proposal.clientId),
    definition('Corretor', proposal.brokerId),
    definition('Seguradora', proposal.insurerId),
    definition('Produto / ramo', proposal.productId),
    definition('Forma de pagamento', proposal.paymentMethodId),
    definition('Prêmio líquido', formatMoney(proposal.netPremium)),
    definition(
      'Vigência',
      `${formatDate(proposal.coverageStart)} — ${formatDate(proposal.coverageEnd)}`,
    ),
    // REQ-203: the renewal is the end of coverage.
    definition('Renovação', formatDate(proposal.renewalDate), 'renewal'),
    definition(
      'Comissão trabalhada',
      `${formatPercentage(proposal.workedCommission)} · ${
        WORKED_COMMISSION_MODE[proposal.workedCommissionMode] ?? proposal.workedCommissionMode
      }`,
      'workedCommission',
    ),
    definition('Recebimento', receiptText(proposal.intermediaryId, proposal.ctu), 'receipt'),
    definition('Registro', formatInstant(proposal.registeredAt)),
  );

  // REQ-219, CA-223: the PDF the data was imported from, kept as uploaded.
  if (proposal.sourceDocument !== null) {
    const source = element('a', 'definition__value');
    source.id = 'source-document';
    source.href = api.proposalSourceDocumentUrl(proposal.id);
    source.append(icon('attach_file'), ` ${proposal.sourceDocument.fileName}`);

    const wrapper = element('div', 'definition');
    wrapper.append(element('span', 'text-label', 'Documento de origem'), source);
    details.append(wrapper);
  }

  body.append(head, details, installmentsBlock(proposal.installments));
  section.append(body);
  return section;
}

/** REQ-204: the installments informed at registration, due date optional. */
function installmentsBlock(installments) {
  const block = element('div', 'stack');
  block.append(element('span', 'text-label', 'Parcelas'));

  if (installments.length === 0) {
    block.append(element('p', 'text-muted', 'Nenhuma parcela informada.'));
    return block;
  }

  const list = element('div', 'definitions');
  for (const installment of installments) {
    list.append(
      definition(
        `Parcela ${installment.number}`,
        `${formatMoney(installment.amount)} · ${
          installment.dueDate === null
            ? 'sem vencimento informado'
            : `vence em ${formatDate(installment.dueDate)}`
        }`,
      ),
    );
  }
  block.append(list);
  return block;
}

/** REQ-230, REQ-231, REQ-232: what the Usina expects, as the server calculated it. */
function expectedCard(proposal) {
  const section = element('section', 'card');
  section.id = 'expected';
  const header = element('div', 'card__header');
  header.append(icon('payments'), element('h2', 'text-title', 'Quanto a Usina espera receber'));

  const body = element('div', 'card__body stack');
  const metrics = element('div', 'definitions');

  if (proposal.expectedReceipt.intermediary !== null) {
    metrics.append(
      definition(
        `A intermediária recebe (prêmio × CT ${formatPercentage(proposal.workedCommission)})`,
        formatMoney(proposal.expectedReceipt.intermediary),
      ),
      definition(
        `A Usina recebe (valor da intermediária × CTU ${formatPercentage(proposal.ctu)})`,
        formatMoney(proposal.expectedReceipt.usina),
      ),
    );
  } else {
    metrics.append(
      definition(
        `A Usina recebe (prêmio × CT ${formatPercentage(proposal.workedCommission)})`,
        formatMoney(proposal.expectedReceipt.usina),
      ),
    );
  }

  body.append(
    metrics,
    element(
      'p',
      'text-muted',
      proposal.status === 'AWAITING_ISSUANCE'
        ? 'Expectativa: a base se fixa quando a proposta é emitida.'
        : 'O repasse ao corretor é um processo separado e não entra neste valor.',
    ),
  );
  section.append(header, body);
  return section;
}

/** REQ-215, REQ-223: every CT and receipt entry, with who informed it and when. */
function historyCard(proposal) {
  const section = element('section', 'card');
  section.id = 'history';
  const header = element('div', 'card__header');
  header.append(icon('history'), element('h2', 'text-title', 'Quem informou'));

  const body = element('div', 'card__body stack');

  const commission = element('div', 'definitions');
  for (const entry of proposal.workedCommissionHistory) {
    commission.append(
      definition(
        `CT · ${entry.informedBy} · ${formatInstant(entry.informedAt)}`,
        `${formatPercentage(entry.workedCommission)} · ${
          WORKED_COMMISSION_MODE[entry.workedCommissionMode] ?? entry.workedCommissionMode
        }`,
      ),
    );
  }

  const receipt = element('div', 'definitions');
  for (const entry of proposal.receiptHistory) {
    receipt.append(
      definition(
        `Recebimento · ${entry.declaredBy} · ${formatInstant(entry.declaredAt)}`,
        receiptText(entry.intermediaryId, entry.ctu),
      ),
    );
  }

  body.append(commission, receipt);

  // REQ-209, CA-207: who identified the issuance, and when it was recorded.
  if (proposal.issuanceRecognizedBy !== null) {
    const issuance = element('div', 'definitions');
    issuance.append(
      definition(
        `Emissão reconhecida · ${proposal.issuanceRecognizedBy} · ${formatInstant(
          proposal.issuanceRecognizedAt,
        )}`,
        'Emitida',
      ),
    );
    body.append(issuance);
  }

  section.append(header, body);
  return section;
}

/** REQ-253: the refusal is final; the record and its reason remain. */
function rejectionCard(proposal) {
  const section = element('section', 'card');
  const body = element('div', 'card__body');
  body.append(
    emptyState(
      'block',
      'Proposta recusada',
      `Motivo: ${proposal.rejectionReason}. O ciclo comercial está encerrado e a proposta não origina apólice.`,
      link('Ver propostas', '/app/proposals/'),
    ),
  );
  section.append(body);
  return section;
}

/** The policy the issued proposal originated (REQ-251). */
function policyCard(policy) {
  const section = element('section', 'card');
  const header = element('div', 'card__header');
  header.append(icon('shield'), element('h2', 'text-title', 'Apólice registrada'));

  const body = element('div', 'card__body stack');

  if (policy === null) {
    body.append(
      emptyState(
        'help',
        'Apólice não localizada',
        'A proposta consta como emitida, mas a apólice correspondente não foi encontrada.',
      ),
    );
    section.append(header, body);
    return section;
  }

  const details = element('div', 'definitions');
  details.append(
    definition('Número da apólice', policy.policyNumber),
    definition('Prêmio', formatMoney(policy.premium)),
    definition(
      'Vigência',
      `${formatDate(policy.coverageStart)} — ${formatDate(policy.coverageEnd)}`,
    ),
    definition('Renovação', formatDate(policy.renewalDate)),
    definition('Parcelas', String(policy.installments.length)),
  );

  const actions = element('div', 'row');
  actions.append(
    link(
      'Abrir apólice',
      `/app/policies/detail.html?id=${encodeURIComponent(policy.id)}`,
      'filled',
    ),
  );

  body.append(details, actions);
  section.append(header, body);
  return section;
}

/* ------------------------------------------------------------ actions -- */

const commissionForm = document.querySelector('#form-worked-commission');
const receiptForm = document.querySelector('#form-receipt');
const issuanceForm = document.querySelector('#form-issuance');
const rejectionForm = document.querySelector('#form-rejection');

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

for (const option of document.querySelectorAll('.outcome-switch__option')) {
  option.addEventListener('click', () => {
    const accept = option.dataset.outcome === 'accept';

    for (const other of document.querySelectorAll('.outcome-switch__option')) {
      other.setAttribute('aria-selected', String(other === option));
    }

    issuanceForm.classList.toggle('hidden', !accept);
    rejectionForm.classList.toggle('hidden', accept);
  });
}

bindReceiptFields(receiptForm);
offerRegisteredIntermediaries(document.querySelector('#intermediary-options'));

// FA-203: the CT and its mode, signed (REQ-214, REQ-215).
commissionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(commissionForm);

  submitting(commissionForm, async () => {
    await api.reviseWorkedCommission(proposalId, {
      workedCommission: input.workedCommission,
      workedCommissionMode: input.workedCommissionMode,
      userId: input.userId,
    });

    showSnackbar('Comissão trabalhada corrigida.', { tone: 'success' });
    await render();
  });
});

// FA-204, FA-209: the receipt declared again, signed (REQ-223, REQ-225).
receiptForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(receiptForm);

  submitting(receiptForm, async () => {
    await api.reviseReceipt(proposalId, {
      intermediary: intermediaryOf(receiptForm),
      userId: input.userId,
    });

    showSnackbar('Recebimento corrigido.', { tone: 'success' });
    await render();
  });
});

// FP-01 step 8 (REQ-209): signed by who identified it; the policy is created
// from the proposal (REQ-240, REQ-241) — no datum is sent again (REQ-242).
// The PDF of the policy may go with it (REQ-247): a document, not a datum.
issuanceForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(issuanceForm);
  const [file] = issuanceForm.querySelector('[name="policyPdf"]').files ?? [];

  submitting(issuanceForm, async () => {
    const pdf =
      file === undefined ? undefined : { fileName: file.name, content: await base64Of(file) };
    const policy = await api.registerPolicy({
      proposalId,
      userId: input.userId,
      ...(pdf === undefined ? {} : { document: pdf }),
    });

    showSnackbar(`Emissão reconhecida. Apólice ${policy.policyNumber} criada.`, {
      tone: 'success',
    });
    await render();
  });
});

rejectionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(rejectionForm);

  submitting(rejectionForm, async () => {
    await api.rejectProposal(proposalId, input.reason);

    showSnackbar('Recusa registrada.', { tone: 'neutral' });
    await render();
  });
});

/* --------------------------------------------------------------- page -- */

function notFound(message) {
  const section = element('section', 'card');
  const body = element('div', 'card__body');
  body.append(
    emptyState(
      'search_off',
      'Proposta não encontrada',
      message,
      link('Ver propostas', '/app/proposals/'),
    ),
  );
  section.append(body);
  page.replaceChildren(section);
  show([]);
}

/** The panels a proposal awaiting issuance offers; none for a finished one. */
function show(open) {
  for (const [name, node] of Object.entries(panels)) {
    node.classList.toggle('hidden', !open.includes(name));
  }
}

/** Starts each correction from what is in force; the signature is always typed. */
function fillCorrections(proposal) {
  commissionForm.querySelector('[name="workedCommission"]').value = proposal.workedCommission;
  commissionForm.querySelector('[name="workedCommissionMode"]').value =
    proposal.workedCommissionMode;

  const kind = receiptForm.querySelector('[name="receiptKind"]');
  kind.value = proposal.intermediaryId === null ? 'DIRECT' : 'INTERMEDIARY';
  kind.dispatchEvent(new Event('change'));
  receiptForm.querySelector('[name="intermediaryId"]').value = proposal.intermediaryId ?? '';
  receiptForm.querySelector('[name="ctu"]').value = proposal.ctu ?? '';
}

function header() {
  const head = element('div', 'page-head');
  const text = element('div', 'page-head__text');
  text.append(
    element('h1', 'text-display', 'Proposta'),
    element('p', 'text-muted', 'Registro, correções enquanto aguarda emissão, e desfecho.'),
  );
  const actions = element('div', 'page-head__actions');
  actions.append(link('Ver propostas', '/app/proposals/'));
  head.append(text, actions);
  return head;
}

async function render() {
  if (proposalId === null || proposalId === '') {
    notFound('Informe o identificador da proposta na URL.');
    return;
  }

  let proposal;
  try {
    proposal = await api.getProposal(proposalId);
  } catch (error) {
    notFound(error instanceof ApiError ? error.message : 'Falha ao consultar a proposta.');
    return;
  }

  const sections = [header(), summaryCard(proposal), expectedCard(proposal), historyCard(proposal)];

  if (proposal.status === 'REJECTED') {
    sections.push(rejectionCard(proposal));
    show([]);
  } else if (proposal.status === 'ISSUED') {
    // REQ-251: issued is the state that confirms a policy exists.
    let policy = null;
    try {
      policy = await api.getPolicyByProposal(proposalId);
    } catch (error) {
      if (!(error instanceof ApiError && error.isNotFound)) {
        throw error;
      }
    }
    sections.push(policyCard(policy));
    show([]);
  } else {
    fillCorrections(proposal);
    show(['corrections', 'outcome']);
    // REQ-241: the policy number is the proposal number.
    issuanceForm.querySelector('[name="policyNumber"]').value = proposal.proposalNumber;
  }

  page.replaceChildren(...sections);
}

render();
