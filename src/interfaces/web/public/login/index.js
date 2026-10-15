/**
 * The login (REQ-411). Open to everyone, like the invitation page (REQ-410).
 *
 * A refusal is shown as the server wrote it, which is the same sentence for
 * every cause (REQ-413). After the login the operator goes back to the page
 * that sent them here (REQ-431) — only if it is one of the system's pages, so
 * a crafted link cannot use the login to send someone elsewhere.
 */

import { ApiError, api } from '/app/shared/api.js';
import { navigateTo } from '/app/shared/navigation.js';

const HOME = '/app/';

/** The return address, if it is a page of this system; the home page otherwise. */
function nextPage() {
  const next = new URLSearchParams(window.location.search).get('next') ?? '';
  return next.startsWith('/app/') && !next.startsWith('//') ? next : HOME;
}

const form = document.querySelector('#form-login');
const error = document.querySelector('#access-error');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form).entries());
  button.disabled = true;
  error.hidden = true;

  try {
    await api.logIn(values.email ?? '', values.password ?? '');
    navigateTo(nextPage());
  } catch (failure) {
    error.textContent =
      failure instanceof ApiError ? failure.message : 'Falha de comunicação com o servidor.';
    error.hidden = false;
    button.disabled = false;
  }
});
