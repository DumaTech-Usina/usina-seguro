/**
 * The broker of a proposal or a policy, as a person reads it (REQ-308).
 *
 * The records keep the broker's id; the screen shows the broker's current
 * name. A page calls `loadBrokers()` once before it renders and
 * `brokerName(id)` wherever a broker appears. A proposal registered before the
 * broker registry holds the text that was typed instead of an id (REQ-309):
 * no broker has it, and it is shown as it is.
 */

import { api } from '/app/shared/api.js';

let names = new Map();

export async function loadBrokers() {
  const brokers = await api.listBrokers();
  names = new Map(brokers.map((broker) => [broker.id, broker.name]));
}

export function brokerName(id) {
  return names.get(id) ?? id;
}

/** `52998224725` → `529.982.247-25`. Presentation only: the server keeps the digits. */
export function formatCpf(digits) {
  return /^\d{11}$/.test(digits)
    ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
    : digits;
}
