/**
 * REQ-229: a proposal is received through a registered intermediary, so a
 * journey that declares one registers it first in the reference registry —
 * over HTTP, with the session `signIn` opened (REQ-401).
 */
export async function registerIntermediary(baseUrl: string, id: string, name: string) {
  const response = await fetch(`${baseUrl}/references`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'INTERMEDIARY', id, name }),
  });
  if (response.status !== 201) {
    throw new Error(`The intermediary ${name} could not be registered: ${response.status}.`);
  }
}
