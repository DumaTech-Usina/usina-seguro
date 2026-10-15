import { vi } from 'vitest';
import { cpfOf } from '../../support/cpf.ts';

/** See the note in `web-fp01-flow.test.ts`: the DOM is outside the type program. */
// biome-ignore lint/suspicious/noExplicitAny: see above.
type Untyped = any;

/**
 * REQ-307: a proposal names a registered broker, so a journey that registers a
 * proposal registers its broker first — over HTTP, signed by the session
 * `signIn` opened (REQ-304). Answers the broker's id. `seed` keeps the CPFs of
 * one journey distinct (REQ-302).
 */
export async function registerBroker(baseUrl: string, name: string, seed: number): Promise<string> {
  const response = await fetch(`${baseUrl}/brokers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, cpf: cpfOf(seed) }),
  });
  if (response.status !== 201) {
    throw new Error(`The broker ${name} could not be registered: ${response.status}.`);
  }
  return ((await response.json()) as { id: string }).id;
}

/**
 * Chooses the broker on the proposal form the way an operator does (REQ-306,
 * REQ-307): types part of the name or CPF, waits for the server's options and
 * picks the one for `name`. Answers once the form holds the broker's id.
 */
export async function chooseBroker(
  document: Untyped,
  window: Untyped,
  typed: string,
  name: string,
): Promise<void> {
  const search = document.querySelector('#form-proposal [name="brokerSearch"]');
  search.value = typed;
  search.dispatchEvent(new window.Event('input'));

  const label = await vi.waitFor(() => {
    const option = [...document.querySelectorAll('#broker-options option')].find(
      (candidate: Untyped) => candidate.value.startsWith(`${name} · `),
    );
    if (option === undefined) {
      throw new Error(`No option for broker ${name}.`);
    }
    return option.value as string;
  });

  search.value = label;
  search.dispatchEvent(new window.Event('input'));
  await vi.waitFor(() => {
    if (document.querySelector('#form-proposal [name="brokerId"]').value === '') {
      throw new Error('The broker was not chosen.');
    }
  });
}
