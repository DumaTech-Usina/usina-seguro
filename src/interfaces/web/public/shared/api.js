/**
 * The only place that talks to the HTTP API.
 *
 * The pages call named operations, never a URL. Two rules hold everywhere:
 *
 * - money and percentages travel as decimal strings, never as JSON numbers.
 *   The server runs with `coerceTypes: false` and answers 400 to a number
 *   (REQ-120, REQ-121), which is the behaviour we want, not a quirk to work
 *   around;
 * - a rule violation arrives already translated. `ApiError.message` is the
 *   Portuguese sentence the server rendered through `src/i18n`, and the pages
 *   display it as it came. The interface never writes its own text for a
 *   domain error.
 */

/** A response the server refused: 400 (shape), 404 (absent) or 422 (rule). */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? 'Não foi possível completar a operação.');
    this.name = 'ApiError';
    this.status = status;
    /** Requirement id, e.g. 'REQ-040'. Present on a 422. */
    this.rule = body?.rule ?? null;
    this.messageKey = body?.messageKey ?? null;
    this.body = body ?? null;
  }

  get isNotFound() {
    return this.status === 404;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

  const text = await response.text();
  const payload = text === '' ? null : JSON.parse(text);

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  return payload;
}

export const api = {
  // FP-01 — proposal, transmission, outcome.
  registerProposal: (input) => request('/proposals', { method: 'POST', body: input }),
  transmitProposal: (id, input) =>
    request(`/proposals/${encodeURIComponent(id)}/transmission`, { method: 'POST', body: input }),
  rejectProposal: (id, reason) =>
    request(`/proposals/${encodeURIComponent(id)}/rejection`, {
      method: 'POST',
      body: { reason },
    }),

  // FP-01 step 5 (REQ-043, OUT-01/OUT-02): the proposals still being followed.
  // `status` is the state to filter by, or nothing for all of them.
  listProposals: (status) =>
    request(
      status === undefined ? '/proposals' : `/proposals?status=${encodeURIComponent(status)}`,
    ),
  getProposal: (id) => request(`/proposals/${encodeURIComponent(id)}`),
  /** The policy this proposal originated, at most one (REQ-049, REQ-050). */
  getPolicyByProposal: (id) => request(`/proposals/${encodeURIComponent(id)}/policy`),

  // FP-01 step 6 and the policy the operator works on afterwards.
  registerPolicy: (input) => request('/policies', { method: 'POST', body: input }),
  getPolicy: (id) => request(`/policies/${encodeURIComponent(id)}`),
  payInstallment: (policyId, number, userId) =>
    request(`/policies/${encodeURIComponent(policyId)}/installments/${number}/payment`, {
      method: 'POST',
      body: { userId },
    }),

  // FP-01 step 7 and the agreed-versus-real panel of REQ-076.
  getCommission: (policyId) => request(`/policies/${encodeURIComponent(policyId)}/commission`),
  overrideCommission: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/commission/override`, {
      method: 'POST',
      body: input,
    }),
  resolveDivergence: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/commission/divergence-resolution`, {
      method: 'POST',
      body: input,
    }),

  // FP-03 — the broker transfer of this policy.
  getSettlement: (policyId) => request(`/policies/${encodeURIComponent(policyId)}/settlement`),
  openSettlement: (policyId) =>
    request(`/policies/${encodeURIComponent(policyId)}/settlement`, { method: 'POST' }),
  releaseSettlement: (policyId) =>
    request(`/policies/${encodeURIComponent(policyId)}/settlement/release`, { method: 'POST' }),
  registerSettlementPayment: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/settlement/payment`, {
      method: 'POST',
      body: input,
    }),

  // Registries the Administrator maintains (IN-02 to IN-06).
  registerCommissionAgreement: (input) =>
    request('/commission-agreements', { method: 'POST', body: input }),
  registerBrokerRate: (input) =>
    request('/broker-commission-rates', { method: 'POST', body: input }),
  registerReleaseRule: (input) =>
    request('/payment-method-release-rules', { method: 'POST', body: input }),
};
