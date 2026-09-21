/**
 * FP-01 steps 3 and 4: register the proposal and transmit it to the insurer.
 *
 * The page orchestrates two calls and nothing else. Every rule — the
 * customer's acceptance (REQ-040), the number the insurer issues (REQ-041) —
 * belongs to the domain, and this file learns the answer by being refused.
 * Nothing is validated here beyond the shape the inputs already declare.
 *
 * It stops at the transmitted proposal on purpose. Step 5 (REQ-043) is a wait:
 * the insurer answers later, and the outcome of step 6 is recorded on the
 * proposal itself, at `/app/proposals/detail.html`.
 */

import { ApiError, api } from '/app/shared/api.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';
import { statusChip } from '/app/shared/status.js';

/* ------------------------------------------------------- IN-01 hints -- */

/**
 * Offers the identifiers already registered in IN-01, with their names.
 *
 * A suggestion, never a constraint: no requirement says a proposal must name a
 * registered client, and REQ-002 makes this system reflect a control that
 * happens outside it. The field stays free text — the list only spares the
 * operator from retyping an identifier the registry already holds, which is
 * what keeps the two sides matching.
 *
 * A registry that cannot be read leaves the fields exactly as they were: this
 * is an aid, so its absence must not stop a proposal from being registered.
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

offerRegisteredReferences();

/** What the wizard has accumulated. `null` means "this step has not run". */
const state = {
  proposalId: null,
};

const panels = {
  1: document.querySelector('[data-panel="1"]'),
  2: document.querySelector('[data-panel="2"]'),
  done: document.querySelector('[data-panel="done"]'),
};

function goToStep(step) {
  for (const [key, panel] of Object.entries(panels)) {
    panel.classList.toggle('hidden', key !== String(step));
  }

  for (const marker of document.querySelectorAll('.step')) {
    const position = Number(marker.dataset.step);
    const current = Number(step);

    if (Number.isNaN(current)) {
      marker.dataset.state = 'done';
      continue;
    }

    if (position < current) {
      marker.dataset.state = 'done';
      marker.querySelector('.step__bullet').textContent = 'check';
      marker.querySelector('.step__bullet').className = 'step__bullet material-symbols-outlined';
    } else if (position === current) {
      marker.dataset.state = 'current';
    } else {
      marker.removeAttribute('data-state');
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
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

/* ------------------------------------------------------------- step 1 -- */

const proposalForm = document.querySelector('#form-proposal');

proposalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(proposalForm);

  submitting(proposalForm, async () => {
    const proposal = await api.registerProposal({
      clientId: input.clientId,
      brokerId: input.brokerId,
      insurerId: input.insurerId,
      productId: input.productId,
      paymentMethodId: input.paymentMethodId,
      // The checkbox is absent from the payload when unchecked; the domain is
      // what refuses it (REQ-040), so it travels as the boolean it is.
      customerAccepted: input.customerAccepted === 'on',
      netPremium: input.netPremium,
    });

    state.proposalId = proposal.id;

    document
      .querySelector('#proposal-chip')
      .replaceChildren(statusChip('proposal', proposal.status));

    showSnackbar('Proposta registrada.', { tone: 'success' });
    goToStep(2);
  });
});

/* ------------------------------------------------------------- step 2 -- */

const transmissionForm = document.querySelector('#form-transmission');

transmissionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = values(transmissionForm);

  submitting(transmissionForm, async () => {
    const proposal = await api.transmitProposal(state.proposalId, {
      proposalNumber: input.proposalNumber,
      workedCommission: input.workedCommission,
    });

    showSnackbar(`Proposta ${proposal.proposalNumber} transmitida.`, { tone: 'success' });
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
  symbol.textContent = 'send';

  const heading = document.createElement('h2');
  heading.className = 'text-title';
  heading.textContent = `Proposta ${proposal.proposalNumber} transmitida`;

  const text = document.createElement('p');
  text.className = 'text-muted';
  text.textContent =
    'Fica em aberto e rastreável até a seguradora responder. O desfecho — aceite com a apólice, ou recusa com motivo — é registrado na própria proposta.';

  const open = document.createElement('a');
  open.className = 'btn btn--filled';
  open.href = `/app/proposals/detail.html?id=${encodeURIComponent(proposal.id)}`;
  open.textContent = 'Abrir proposta';

  const listing = document.createElement('a');
  listing.className = 'btn btn--outlined';
  listing.href = '/app/proposals/';
  listing.textContent = 'Ver propostas em aberto';

  const again = document.createElement('a');
  again.className = 'btn btn--outlined';
  again.href = '/app/proposals/new.html';
  again.textContent = 'Registrar outra';

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.style.marginTop = 'var(--space-2)';
  actions.append(open, listing, again);

  empty.append(symbol, heading, text, actions);
  body.replaceChildren(empty);
  goToStep('done');
}
