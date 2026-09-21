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
  /**
   * OUT-03: the policies the Usina sold, nearest renewal first. With a day,
   * it is the a-vencer listing of OUT-04 (REQ-055, CA-032) — only the policies
   * that renew on or before it.
   *
   * The day is informed by the operator: no requirement says how near
   * "proxima" is, so nothing here picks a window.
   */
  listPolicies: (renewalUntil) =>
    request(
      renewalUntil === undefined
        ? '/policies'
        : `/policies?renewalUntil=${encodeURIComponent(renewalUntil)}`,
    ),
  payInstallment: (policyId, number, userId) =>
    request(`/policies/${encodeURIComponent(policyId)}/installments/${number}/payment`, {
      method: 'POST',
      body: { userId },
    }),

  // FP-01 step 7 and the agreed-versus-real panel of REQ-076.
  getCommission: (policyId) => request(`/policies/${encodeURIComponent(policyId)}/commission`),
  /**
   * OUT-05: the same comparison over every policy. `status` narrows it to one
   * state of section 10.5 — `DIVERGENT` is the worklist of FP-02 step 5 — and
   * nothing asks for the whole panel.
   */
  listCommissions: (status) =>
    request(
      status === undefined ? '/commissions' : `/commissions?status=${encodeURIComponent(status)}`,
    ),
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

  /**
   * OUT-07: the commission statement of a broker — forecast, held, released
   * and paid. Nothing asks for every broker at once.
   *
   * This is not the report and the receipt of REQ-094/REQ-096: those need the
   * period of DEC-008 and the registries of IN-01, and neither exists.
   */
  getBrokerStatement: (brokerId) =>
    request(
      brokerId === undefined
        ? '/broker-commission-statements'
        : `/broker-commission-statements?brokerId=${encodeURIComponent(brokerId)}`,
    ),

  // FP-02 — the commission report the Financeiro imports.
  //
  // The endpoint takes lines already structured, not a file: the layout is
  // DEC-001 and REQ-080..REQ-083 are not implementable without a real sample.
  // Every confirmed rule over a line — the key of REQ-082, the pendency of
  // REQ-083, the refusal to duplicate of REQ-086 — runs on what is sent here.
  reconcileCommissionReport: (input) =>
    request('/commission-reconciliations', { method: 'POST', body: input }),
  /** OUT-06: the lines with no matching policy, waiting for a human. */
  listReconciliationPendencies: () => request('/commission-reconciliations/pendencies'),

  // Registries the Administrator maintains (IN-02 to IN-06).
  //
  // These are the parameters the calculation reads — they are data and not
  // code (REQ-061, REQ-125), so each one is written and read back through the
  // same shape: what a registration answers is one line of what the listing
  // answers.
  registerCommissionAgreement: (input) =>
    request('/commission-agreements', { method: 'POST', body: input }),
  /** IN-02, IN-03, IN-04: every agreement registered, by insurer and product. */
  listCommissionAgreements: () => request('/commission-agreements'),
  registerBrokerRate: (input) =>
    request('/broker-commission-rates', { method: 'POST', body: input }),
  /** IN-05: the broker commission table (REQ-093). */
  listBrokerRates: () => request('/broker-commission-rates'),
  registerReleaseRule: (input) =>
    request('/payment-method-release-rules', { method: 'POST', body: input }),
  /** IN-06: the release rule of each payment method (REQ-090, CA-024). */
  listReleaseRules: () => request('/payment-method-release-rules'),
};
