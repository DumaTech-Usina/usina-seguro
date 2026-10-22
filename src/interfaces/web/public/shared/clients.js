/**
 * The client of a proposal or a policy, as a person reads it (REQ-318).
 *
 * The records keep the client's id; the screen shows the client's current
 * name. A detail page calls `loadClient(id)` once before it renders and
 * `clientLabel(id)` where the client appears — one client read, never the
 * whole registry (REQ-330). The listings get the name from the server, on each
 * line. A proposal registered before the client registry holds the text that
 * was typed instead of an id (REQ-320): no client has it, and it is shown as
 * it is.
 */

import { ApiError, api } from '/app/shared/api.js';
import { formatCpf } from '/app/shared/brokers.js';

const clients = new Map();

export async function loadClient(id) {
  try {
    clients.set(id, await api.getClient(id));
  } catch (error) {
    // REQ-320: the typed text of an older proposal is no client.
    if (!(error instanceof ApiError && error.isNotFound)) {
      throw error;
    }
  }
}

/** `Maria Souza · 529.982.247-25`; the text of an older proposal as it is. */
export function clientLabel(id) {
  const client = clients.get(id);
  return client === undefined ? id : `${client.name} · ${formatCpf(client.cpf)}`;
}
