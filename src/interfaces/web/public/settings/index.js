/**
 * The registries the Administrator maintains (IN-02 to IN-06).
 *
 * These are the parameters the calculation reads — commission rates, the
 * chain, the broker table and the release rule per payment method. They are
 * data rather than code so they change without a deploy, which is why no
 * payment method and no rate is ever named here either: the form takes
 * whatever identifier the business uses.
 */

import { ApiError, api } from '/app/shared/api.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Submits, reports a refusal with the server's own sentence, keeps the form. */
function wire(selector, send, success) {
  const form = document.querySelector(selector);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Enviando…';

    try {
      const result = await send(values(form));
      showSnackbar(success(result), { tone: 'success' });
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
}

/* ---------------------------------------------------------- agreement -- */

const intermediaryToggle = document.querySelector('#has-intermediary');
const intermediaryFields = document.querySelector('#intermediary-fields');

intermediaryToggle.addEventListener('change', () => {
  intermediaryFields.classList.toggle('hidden', !intermediaryToggle.checked);
});

wire(
  '#form-agreement',
  (input) => {
    const body = {
      insurerId: input.insurerId,
      productId: input.productId,
      effectiveFrom: input.effectiveFrom,
      insurerRate: input.insurerRate,
    };

    // An absent `intermediary` is what states a direct chain; the default base
    // when one exists is decided by the server, not restated here.
    if (intermediaryToggle.checked) {
      body.intermediary = {
        intermediaryId: input.intermediaryId,
        intermediaryRate: input.intermediaryRate,
        brokerBase: input.brokerBase,
      };
    }

    return api.registerCommissionAgreement(body);
  },
  (agreement) => `Acordo de ${agreement.insurerId} / ${agreement.productId} registrado.`,
);

/* -------------------------------------------------------- broker rate -- */

wire(
  '#form-broker-rate',
  (input) => api.registerBrokerRate({ brokerId: input.brokerId, rate: input.rate }),
  (rate) => `Tabela do corretor ${rate.brokerId} registrada em ${rate.rate}%.`,
);

/* ------------------------------------------------------- release rule -- */

wire(
  '#form-release-rule',
  (input) =>
    api.registerReleaseRule({
      paymentMethodId: input.paymentMethodId,
      release: input.release,
    }),
  (rule) => `Regra de ${rule.paymentMethodId} registrada.`,
);
