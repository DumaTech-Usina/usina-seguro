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
 *   domain error;
 * - a 401 means there is no session (REQ-410): the operator is sent to the
 *   login, which brings them back here afterwards (REQ-431).
 */

import { navigateTo } from '/app/shared/navigation.js';

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

/** REQ-431: no session — to the login, keeping the way back to this page. */
function sendToLogin() {
  const here = `${window.location.pathname}${window.location.search}`;
  navigateTo(`/app/login/?next=${encodeURIComponent(here)}`);
}

/** `?a=1&b=2` from the filters that have a value; blank ones are left out. */
function query(filters) {
  const present = Object.entries(filters)
    .filter(([, value]) => value !== undefined && String(value).trim() !== '')
    .map(([name, value]) => [name, String(value)]);
  return present.length === 0 ? '' : `?${new URLSearchParams(present).toString()}`;
}

/**
 * REQ-330 to REQ-332: every listing in pages answers
 * `{ items, total, page, size }`; `{ page, size }` asks for one. The first
 * page of 50 is what the server answers when nothing is asked, so it goes
 * unsaid and the address stays the listing's own.
 */
function paging({ page, size } = {}) {
  return {
    page: page === undefined || page === 1 ? undefined : page,
    size: size === undefined || size === 50 ? undefined : size,
  };
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });

  if (response.status === 401) {
    sendToLogin();
  }

  const text = await response.text();
  const payload = text === '' ? null : JSON.parse(text);

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  return payload;
}

/** The bytes of a file the API serves, e.g. a PDF; a refusal as `ApiError`. */
async function readFile(path) {
  const response = await fetch(path);

  if (response.status === 401) {
    sendToLogin();
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text === '' ? null : JSON.parse(text));
  }

  return response.arrayBuffer();
}

export const api = {
  readFile,
  // V2 section 9C — access to the system. The session token travels in an
  // HttpOnly cookie the page never reads.
  /** REQ-411: answers `{ user }`; a refusal is the same for every cause (REQ-413). */
  logIn: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logOut: () => request('/auth/logout', { method: 'POST' }),
  /** Who is logged in: `{ id, email, name, role, displayName }` (REQ-400). */
  me: () => request('/auth/me'),
  /** REQ-216: `[{ id, displayName }]`, every user a record may be signed by. */
  listUserDirectory: () => request('/users/directory'),
  // REQ-440 — the administrator's management of users. The server refuses
  // anyone else (REQ-430); the page only shows what it answers.
  /** `{ users: [...], invitations: [...] }`. */
  listUsers: () => request('/users'),
  /** REQ-420: answers `{ email, expiresAt, link }` — the link to hand over (REQ-436). */
  inviteUser: (email, role) =>
    request('/users/invitations', { method: 'POST', body: { email, role } }),
  resendInvitation: (invitationId) =>
    request(`/users/invitations/${encodeURIComponent(invitationId)}/resend`, { method: 'POST' }),
  deactivateUser: (userId) =>
    request(`/users/${encodeURIComponent(userId)}/deactivation`, { method: 'POST' }),
  changeUserRole: (userId, role) =>
    request(`/users/${encodeURIComponent(userId)}/role`, { method: 'POST', body: { role } }),
  /** REQ-422: `input` is `{ token, password, name }`, `name` optional. */
  acceptInvitation: (input) =>
    request('/auth/invitation/acceptance', { method: 'POST', body: input }),
  /** REQ-425: answers `{ message }`, the same whether the e-mail has an account or not. */
  requestPasswordReset: (email) =>
    request('/auth/password-reset/request', { method: 'POST', body: { email } }),
  /** REQ-426: the new password through the link of the e-mail. */
  resetPassword: (token, password) =>
    request('/auth/password-reset', { method: 'POST', body: { token, password } }),
  // FP-01 — the proposal, its corrections while it awaits issuance, and the
  // refusal. Every correction is signed by the session user (REQ-216).
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
  /** REQ-254: "Corrigir parcelas" — `input` is `{ installments }`, the list as it stays. */
  reviseInstallments: (id, input) =>
    request(`/proposals/${encodeURIComponent(id)}/installments`, { method: 'POST', body: input }),
  rejectProposal: (id, reason) =>
    request(`/proposals/${encodeURIComponent(id)}/rejection`, {
      method: 'POST',
      body: { reason },
    }),

  // The proposals being followed. `status` is the state of REQ-250 to filter
  // by, or nothing for all of them; `client` is part of the client's name or
  // CPF (REQ-319), or nothing.
  listProposals: (status, client, page) =>
    request(`/proposals${query({ status, client, ...paging(page) })}`),
  getProposal: (id) => request(`/proposals/${encodeURIComponent(id)}`),
  /** The policy this proposal originated, at most one (REQ-049, REQ-050). */
  getPolicyByProposal: (id) => request(`/proposals/${encodeURIComponent(id)}/policy`),

  // The recognition of issuance (REQ-209): creates the policy from the
  // proposal (REQ-240, REQ-241). Then the policy worked on afterwards.
  // `input.document` is the PDF of the policy, optional (REQ-247).
  registerPolicy: (input) => request('/policies', { method: 'POST', body: input }),
  /**
   * REQ-248: reads the policy PDF and answers the policy number it found, for
   * the issuance form to fill. Registers nothing. `content` is base64.
   */
  readPolicyPdf: (content) =>
    request('/policies/pdf-reading', { method: 'POST', body: { content } }),
  getPolicy: (id) => request(`/policies/${encodeURIComponent(id)}`),
  /**
   * REQ-247: sends the PDF of a policy that exists, signed. The last one sent
   * is the policy's. `input` is `{ fileName, content }`, `content`
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
  listPolicies: (renewalUntil, client, page) =>
    request(`/policies${query({ renewalUntil, client, ...paging(page) })}`),
  /** IN-13: who confirms is the session user (REQ-216); the act carries no data. */
  payInstallment: (policyId, number) =>
    request(`/policies/${encodeURIComponent(policyId)}/installments/${number}/payment`, {
      method: 'POST',
    }),

  // REQ-236: the agreed commission of a policy.
  getCommission: (policyId) => request(`/policies/${encodeURIComponent(policyId)}/commission`),
  /** OUT-05: the agreed commission of every policy, optionally by state. */
  listCommissions: (status, page) => request(`/commissions${query({ status, ...paging(page) })}`),
  overrideCommission: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/commission/override`, {
      method: 'POST',
      body: input,
    }),

  /** REQ-219: the PDF a proposal was imported from; a file, not JSON. */
  proposalSourceDocumentUrl: (proposalId) =>
    `/proposals/${encodeURIComponent(proposalId)}/source-document`,
  // FP-02 of V2 (section 9A) — the CR of a policy, its recalculation and the
  // eligibility. Every act is signed by the session user (REQ-216). The
  // system pays nothing (REQ-280).
  /** REQ-285: the situation of the policy, its Usina value and its commission. */
  getPolicyPayout: (policyId) => request(`/policies/${encodeURIComponent(policyId)}/payout`),
  informPayoutRate: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/payout`, { method: 'POST', body: input }),
  revisePayoutRate: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/payout/revision`, {
      method: 'POST',
      body: input,
    }),
  declarePayoutEligibility: (policyId) =>
    request(`/policies/${encodeURIComponent(policyId)}/payout/eligibility`, { method: 'POST' }),
  /**
   * REQ-284: the eligible commissions. `filters` holds only what was informed:
   * `policyNumber`, `broker`, `client`, `eligibleFrom`/`eligibleBefore`
   * (instants) and `renewalFrom`/`renewalUntil` (YYYY-MM).
   */
  listEligiblePayouts: (filters, page) =>
    request(`/payouts/eligible${query({ ...(filters ?? {}), ...paging(page) })}`),
  /** REQ-286: the policies that still need a CR. */
  listPoliciesWithoutPayoutRate: (page) =>
    request(`/payouts/policies-without-rate${query(paging(page))}`),

  // V2 section 9B — the payout of a policy with parcelled CT: two CRs and the
  // eligibility of each installment. Every act is signed by the session user
  // (REQ-216).
  /** REQ-268, REQ-293: each installment with its CT, Usina value and payout. */
  getParcelledPayout: (policyId) =>
    request(`/policies/${encodeURIComponent(policyId)}/parcelled-payout`),
  /** REQ-287: `input` is `{ firstRate, subsequentRate }`. */
  informParcelledPayoutRates: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/parcelled-payout`, {
      method: 'POST',
      body: input,
    }),
  /** REQ-265: `input` is `{ firstRate, subsequentRate, reason }`. */
  reviseParcelledPayoutRates: (policyId, input) =>
    request(`/policies/${encodeURIComponent(policyId)}/parcelled-payout/revision`, {
      method: 'POST',
      body: input,
    }),
  /** REQ-288: the eligibility of one installment, signed. */
  declareInstallmentEligibility: (policyId, number) =>
    request(`/policies/${encodeURIComponent(policyId)}/installments/${number}/eligibility`, {
      method: 'POST',
    }),
  /** REQ-268: every policy with parcelled CT, with its situation. */
  listParcelledPolicies: (page) => request(`/payouts/parcelled-policies${query(paging(page))}`),

  /**
   * OUT-10, REQ-102, REQ-105: the notifications of effectuated emission —
   * what was notified, to whom and when (REQ-100).
   *
   * Read-only: a notification is produced by FP-01 step 7, never by a user,
   * so there is nothing to post here. `recipientId` narrows it to one broker,
   * or nothing for every one of them.
   */
  listNotifications: (recipientId, page) =>
    request(`/notifications${query({ recipientId, ...paging(page) })}`),

  /**
   * V2 section 9D: the brokers. Registering and changing are signed by the
   * session (REQ-304); `query` searches by name or CPF (REQ-306). There is no
   * removal (REQ-305).
   */
  registerBroker: (input) => request('/brokers', { method: 'POST', body: input }),
  changeBroker: (id, input) =>
    request(`/brokers/${encodeURIComponent(id)}/revision`, { method: 'POST', body: input }),
  getBroker: (id) => request(`/brokers/${encodeURIComponent(id)}`),
  listBrokers: (query) =>
    request(
      query === undefined || query.trim() === ''
        ? '/brokers'
        : `/brokers?q=${encodeURIComponent(query.trim())}`,
    ),

  /**
   * V2 section 9E: the clients. Registering and changing are signed by the
   * session (REQ-314); `query` searches by name or CPF (REQ-316). There is no
   * removal (REQ-315). A proposal registers its client by itself (REQ-317).
   */
  registerClient: (input) => request('/clients', { method: 'POST', body: input }),
  changeClient: (id, input) =>
    request(`/clients/${encodeURIComponent(id)}/revision`, { method: 'POST', body: input }),
  getClient: (id) => request(`/clients/${encodeURIComponent(id)}`),
  listClients: (search, page) =>
    request(`/clients${query({ q: search?.trim(), ...paging(page) })}`),

  /**
   * IN-01: the reference records — client, insurer, intermediary and product
   * — that give a business a name (REQ-096). The broker has its own registry.
   *
   * Nothing is validated against them: a proposal may name a client nobody
   * registered (REQ-002), and the screens show the identifier when there is no
   * name. `kind` narrows the reading to one of the kinds, or nothing for all.
   */
  registerReference: (input) => request('/references', { method: 'POST', body: input }),
  listReferences: (kind) =>
    request(kind === undefined ? '/references' : `/references?kind=${encodeURIComponent(kind)}`),
};
