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
  // FP-01 — the proposal, its corrections while it awaits issuance, and the
  // refusal. Every correction is signed: `input.userId` (REQ-216).
  registerProposal: (input) => request('/proposals', { method: 'POST', body: input }),
  /**
   * REQ-218: reads the PDF of a proposal and answers what it found, for the
   * form to fill. Registers nothing. `content` is the file base64-encoded.
   */
  readProposalPdf: (content) =>
    request('/proposals/pdf-reading', { method: 'POST', body: { content } }),
  reviseWorkedCommission: (id, input) =>
    request(`/proposals/${encodeURIComponent(id)}/worked-commission`, {
      method: 'POST',
      body: input,
    }),
  reviseReceipt: (id, input) =>
    request(`/proposals/${encodeURIComponent(id)}/receipt`, { method: 'POST', body: input }),
  rejectProposal: (id, reason) =>
    request(`/proposals/${encodeURIComponent(id)}/rejection`, {
      method: 'POST',
      body: { reason },
    }),

  // The proposals being followed. `status` is the state of REQ-250 to filter
  // by, or nothing for all of them.
  listProposals: (status) =>
    request(
      status === undefined ? '/proposals' : `/proposals?status=${encodeURIComponent(status)}`,
    ),
  getProposal: (id) => request(`/proposals/${encodeURIComponent(id)}`),
  /** The policy this proposal originated, at most one (REQ-049, REQ-050). */
  getPolicyByProposal: (id) => request(`/proposals/${encodeURIComponent(id)}/policy`),

  // The recognition of issuance (REQ-209): creates the policy from the
  // proposal (REQ-240, REQ-241). Then the policy worked on afterwards.
  // `input.document` is the PDF of the policy, optional (REQ-247).
  registerPolicy: (input) => request('/policies', { method: 'POST', body: input }),
  getPolicy: (id) => request(`/policies/${encodeURIComponent(id)}`),
  /**
   * REQ-247: sends the PDF of a policy that exists, signed. The last one sent
   * is the policy's. `input` is `{ fileName, content, userId }`, `content`
   * base64-encoded.
   */
  attachPolicyDocument: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/document`, {
      method: 'POST',
      body: input,
    }),
  /** REQ-247: the PDF of a policy; a file, not JSON. */
  policyDocumentUrl: (policyId) => `/policies/${encodeURIComponent(policyId)}/document`,
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

  /** REQ-219: the PDF a proposal was imported from; a file, not JSON. */
  proposalSourceDocumentUrl: (proposalId) =>
    `/proposals/${encodeURIComponent(proposalId)}/source-document`,
  // FP-02 of V2 (section 9A) — the CR of a policy, its recalculation and the
  // eligibility. Every act is signed: `userId` (REQ-216). The system pays
  // nothing (REQ-280).
  /** REQ-285: the situation of the policy, its Usina value and its commission. */
  getPolicyPayout: (policyId) => request(`/policies/${encodeURIComponent(policyId)}/payout`),
  informPayoutRate: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/payout`, { method: 'POST', body: input }),
  revisePayoutRate: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/payout/revision`, {
      method: 'POST',
      body: input,
    }),
  declarePayoutEligibility: (policyId, userId) =>
    request(`/policies/${encodeURIComponent(policyId)}/payout/eligibility`, {
      method: 'POST',
      body: { userId },
    }),
  /**
   * REQ-284: the eligible commissions. `filters` holds only what was informed:
   * `policyNumber`, `broker`, `client`, `eligibleFrom`/`eligibleBefore`
   * (instants) and `renewalFrom`/`renewalUntil` (YYYY-MM).
   */
  listEligiblePayouts: (filters = {}) => {
    const query = new URLSearchParams(filters).toString();
    return request(query === '' ? '/payouts/eligible' : `/payouts/eligible?${query}`);
  },
  /** REQ-286: the policies that still need a CR. */
  listPoliciesWithoutPayoutRate: () => request('/payouts/policies-without-rate'),

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

  /**
   * OUT-10, REQ-102, REQ-105: the notifications of effectuated emission —
   * what was notified, to whom and when (REQ-100).
   *
   * Read-only: a notification is produced by FP-01 step 7, never by a user,
   * so there is nothing to post here. `recipientId` narrows it to one broker,
   * or nothing for every one of them.
   */
  listNotifications: (recipientId) =>
    request(
      recipientId === undefined
        ? '/notifications'
        : `/notifications?recipientId=${encodeURIComponent(recipientId)}`,
    ),

  /**
   * IN-01: the reference records — client, broker, insurer, intermediary and
   * product — that give a business a name (REQ-096).
   *
   * Nothing is validated against them: a proposal may name a client nobody
   * registered (REQ-002), and the screens show the identifier when there is no
   * name. `kind` narrows the reading to one of the five, or nothing for all.
   */
  registerReference: (input) => request('/references', { method: 'POST', body: input }),
  listReferences: (kind) =>
    request(kind === undefined ? '/references' : `/references?kind=${encodeURIComponent(kind)}`),
};
