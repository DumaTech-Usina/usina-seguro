/**
 * Who signed a record, as a person reads it (REQ-216, REQ-400).
 *
 * The records keep the id of the user who signed; the screen shows the name,
 * or the e-mail when there is none. A page calls `loadAuthors()` once before
 * it renders and `authorName(id)` wherever a signature appears. An id the
 * directory does not know is shown as it is rather than hidden.
 */

import { api } from '/app/shared/api.js';

let names = new Map();

export async function loadAuthors() {
  const directory = await api.listUserDirectory();
  names = new Map(directory.map((entry) => [entry.id, entry.displayName]));
}

export function authorName(id) {
  return names.get(id) ?? id;
}
