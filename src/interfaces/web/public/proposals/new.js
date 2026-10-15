/**
 * FP-01 steps 1 to 6: registers the proposal with everything it holds.
 *
 * One form, one call. Every rule — the payment method (REQ-040), the CTU an
 * intermediary requires (REQ-221), the signature (REQ-216) — belongs to
 * the domain, and this file learns the answer by being refused. The expected
 * value (REQ-232) is the server's answer too: this page shows it after the
 * registration and never computes it.
 */

import { ApiError, api } from '/app/shared/api.js';
import { base64Of } from '/app/shared/file.js';
import { addInstallmentRow, scheduleOf } from '/app/shared/installments.js';
import { formatDate, formatMoney } from '/app/shared/money.js';
import {
  bindReceiptFields,
  intermediaryOf,
  offerRegisteredIntermediaries,
} from '/app/shared/receipt.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';
import { bindWorkedCommissionFields, workedCommissionOf } from '/app/shared/worked-commission.js';

/* ------------------------------------------------------- IN-01 hints -- */

/**
 * Offers the identifiers already registered in IN-01, with their names.
 *
 * A suggestion, never a constraint: the field stays free text. A registry that
 * cannot be read leaves the fields exactly as they were.
 */
async function offerRegisteredReferences() {
  const fields = [
    ['CLIENT', 'client-options'],
    ['BROKER', 'broker-options'],
    ['INSURER', 'insurer-options'],
    ['PRODUCT', 'product-options'],
  ];

  let references;
  try {
    references = await api.listReferences();
  } catch {
    return;
  }

  for (const [kind, id] of fields) {
    const list = document.querySelector(`#${id}`);
    if (list === null) {
      continue;
    }

    list.replaceChildren(
      ...references
        .filter((reference) => reference.kind === kind)
        .map((reference) => {
          const option = document.createElement('option');
          option.value = reference.id;
          option.label = reference.name;
          option.textContent = reference.name;
          return option;
        }),
    );
  }
}

const form = document.querySelector('#form-proposal');

offerRegisteredReferences();
offerRegisteredIntermediaries(document.querySelector('#intermediary-options'));
bindReceiptFields(form);
bindWorkedCommissionFields(form);

/* ------------------------------------------------------------ renewal -- */

// REQ-203: the renewal is the end of coverage. Shown as it is typed, never
// asked for.
const coverageEnd = form.querySelector('[name="coverageEnd"]');
coverageEnd.addEventListener('input', () => {
  document.querySelector('#renewal').textContent =
    coverageEnd.value === '' ? 'igual ao fim da vigência' : formatDate(coverageEnd.value);
});

/* ------------------------------------------------------- installments -- */

// REQ-204: the number is the position, never typed.
const installments = document.querySelector('#installments');

document
  .querySelector('#add-installment')
  .addEventListener('click', () => addInstallmentRow(installments));

/* ------------------------------------------------------ PDF (REQ-218) -- */

/** What each field the reader can fill is called on this form. */
const PDF_FIELD_LABEL = {
  proposalNumber: 'Número da proposta',
  clientId: 'Cliente',
  brokerId: 'Corretor',
  insurerId: 'Seguradora',
  productId: 'Produto / ramo',
  paymentMethodId: 'Forma de pagamento',
  netPremium: 'Prêmio líquido',
  coverageStart: 'Início da vigência',
  coverageEnd: 'Fim da vigência',
  installments: 'Parcelas',
};

const PDF_STATUS = {
  SUCCESS: { title: 'PDF lido.', tone: '' },
  PARTIAL: { title: 'PDF lido parcialmente.', tone: 'banner--warning' },
  FAILED: { title: 'Não foi possível ler o PDF.', tone: 'banner--danger' },
};

const PDF_FAILURE = {
  UNREADABLE: 'O arquivo não pôde ser lido como PDF.',
  NO_TEXT: 'O PDF não tem texto legível.',
  UNRECOGNIZED_LAYOUT: 'O layout deste PDF ainda não é conhecido (hoje: proposta Allianz).',
};

const pdfForm = document.querySelector('#form-pdf');
const pdfResult = document.querySelector('#pdf-result');

/**
 * Fills the fields the reading found. What the PDF brings overwrites what was
 * typed (REQ-218); what it did not find is left exactly as it was.
 */
function fillFromPdf(fields) {
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'installments') {
      installments.replaceChildren();
      for (const installment of value) {
        addInstallmentRow(installments, installment.amount);
      }
      continue;
    }

    const input = form.querySelector(`[name="${name}"]`);
    if (input !== null) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
  }
}

function labelList(id, symbol, names) {
  const list = document.createElement('ul');
  list.id = id;
  for (const name of names) {
    const item = document.createElement('li');
    item.textContent = `${symbol} ${PDF_FIELD_LABEL[name] ?? name}`;
    list.append(item);
  }
  return list;
}

function showReading(reading) {
  const status = PDF_STATUS[reading.status] ?? PDF_STATUS.FAILED;
  const banner = document.createElement('div');
  banner.className = `banner ${status.tone}`.trim();

  const text = document.createElement('div');
  text.className = 'banner__text stack';
  const title = document.createElement('strong');
  title.textContent = status.title;
  text.append(title);

  if (reading.status === 'FAILED') {
    text.append(PDF_FAILURE[reading.reason] ?? '', ' Preencha os campos à mão.');
  } else {
    const found = Object.keys(reading.fields);
    if (found.length > 0) {
      text.append('Dados encontrados:', labelList('pdf-found', '✓', found));
    }
    if (reading.missing.length > 0) {
      text.append('Dados não encontrados:', labelList('pdf-missing', '!', reading.missing));
    }
    text.append(
      'Não vêm do PDF: comissão trabalhada e seu modo, recebimento (intermediária e CTU). Revise os dados antes de salvar.',
    );
  }

  banner.append(text);
  pdfResult.replaceChildren(banner);
  pdfResult.classList.remove('hidden');
}

/**
 * REQ-219: the PDF to be registered with the proposal — the last one sent,
 * whatever the reading made of it (CA-223, CA-224). Each send replaces it.
 */
let sourceDocument = null;

pdfForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const [file] = pdfForm.querySelector('[name="pdf"]').files ?? [];
  if (file === undefined) {
    return;
  }

  const button = pdfForm.querySelector('button[type="submit"]');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Lendo…';

  (async () => {
    try {
      const content = await base64Of(file);
      sourceDocument = {
        fileName: file.name,
        contentType: file.type || 'application/pdf',
        content,
      };
      const reading = await api.readProposalPdf(content);
      if (reading.status !== 'FAILED') {
        fillFromPdf(reading.fields);
      }
      showReading(reading);
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
  })();
});

/* ------------------------------------------------------------- submit -- */

function value(name) {
  return form.querySelector(`[name="${name}"]`).value;
}

/** Keeps the submit button from firing twice while the request is in flight. */
async function submitting(work) {
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

form.addEventListener('submit', (event) => {
  event.preventDefault();

  submitting(async () => {
    const proposal = await api.registerProposal({
      clientId: value('clientId'),
      brokerId: value('brokerId'),
      insurerId: value('insurerId'),
      productId: value('productId'),
      paymentMethodId: value('paymentMethodId'),
      proposalNumber: value('proposalNumber'),
      netPremium: value('netPremium'),
      coverageStart: value('coverageStart'),
      coverageEnd: value('coverageEnd'),
      installments: scheduleOf(installments),
      ...workedCommissionOf(form),
      intermediary: intermediaryOf(form),
      ...(sourceDocument === null ? {} : { sourceDocument }),
    });

    showSnackbar(`Proposta ${proposal.proposalNumber} registrada.`, { tone: 'success' });
    finish(proposal);
  });
});

/* ---------------------------------------------------------- conclusion -- */

function finish(proposal) {
  const body = document.querySelector('#done-body');
  const empty = document.createElement('div');
  empty.className = 'empty';

  const symbol = document.createElement('span');
  symbol.className = 'material-symbols-outlined';
  symbol.textContent = 'hourglass_top';

  const heading = document.createElement('h2');
  heading.className = 'text-title';
  heading.textContent = `Proposta ${proposal.proposalNumber} registrada`;

  const chip = statusChip('proposal', proposal.status);

  // REQ-232, CA-203: what the Usina expects, known before the issuance — one
  // value with an integral CT, one per installment with a parcelled one
  // (REQ-293), never a total.
  const expected = document.createElement('div');
  if (proposal.expectedInstallments === null) {
    expected.textContent = `A Usina espera receber ${formatMoney(proposal.expectedReceipt.usina)}.`;
  } else {
    const intro = document.createElement('p');
    intro.textContent = 'A Usina espera receber, por parcela:';
    const list = document.createElement('ul');
    for (const installment of proposal.expectedInstallments) {
      const item = document.createElement('li');
      item.textContent = `Parcela ${installment.number}: ${formatMoney(installment.usina)}`;
      list.append(item);
    }
    expected.append(intro, list);
  }

  const text = document.createElement('p');
  text.className = 'text-muted';
  text.textContent =
    'Enquanto aguarda a emissão, a CT e o recebimento podem ser corrigidos na própria proposta.';

  const open = document.createElement('a');
  open.className = 'btn btn--filled';
  open.href = `/app/proposals/detail.html?id=${encodeURIComponent(proposal.id)}`;
  open.textContent = 'Abrir proposta';

  const again = document.createElement('a');
  again.className = 'btn btn--outlined';
  again.href = '/app/proposals/new.html';
  again.textContent = 'Registrar outra';

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = 'var(--space-2)';
  actions.append(open, again);

  empty.append(symbol, heading, chip, expected, text, actions);
  body.replaceChildren(empty);

  form.classList.add('hidden');
  document.querySelector('[data-panel="pdf"]').classList.add('hidden');
  document.querySelector('[data-panel="done"]').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
