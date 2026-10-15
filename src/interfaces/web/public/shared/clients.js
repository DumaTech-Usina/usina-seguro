/**
 * The client of a proposal or a policy, as a person reads it (REQ-318).
 *
 * The records keep the client's id; the screen shows the client's current
 * name. A page calls `loadClients()` once before it renders and
 * `clientName(id)` wherever a client appears. A proposal registered before the
 * client registry holds the text that was typed instead of an id (REQ-320):
 * no client has it, and it is shown as it is.
 */

import { api } from '/app/shared/api.js';
import { formatCpf } from '/app/shared/brokers.js';

let clients = new Map();

export async function loadClients() {
  const list = await api.listClients();
  clients = new Map(list.map((client) => [client.id, client]));
}

export function clientName(id) {
  return clients.get(id)?.name ?? id;
}

/** `Maria Souza · 529.982.247-25`; the text of an older proposal as it is. */
export function clientLabel(id) {
  const client = clients.get(id);
  return client === undefined ? id : `${client.name} · ${formatCpf(client.cpf)}`;
}
