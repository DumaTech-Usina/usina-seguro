/**
 * The acceptance of an invitation (REQ-422): the link opens this page with its
 * token, and the person sets the password and, if they want, the name.
 *
 * Whether the link is valid is the server's to say: a link expired, used or
 * superseded is refused there with one sentence, shown here as it came. A link
 * with no token at all is the one case the page can tell by itself.
 */

import { ApiError, api } from '/app/shared/api.js';

const INVALID_LINK = 'Este link não é válido ou já expirou.';

const token = new URLSearchParams(window.location.search).get('token') ?? '';
const form = document.querySelector('#form-invitation');
const error = document.querySelector('#access-error');
const done = document.querySelector('#access-done');

function showError(message) {
  error.textContent = message;
  error.hidden = false;
}

if (token === '') {
  form.hidden = true;
  showError(INVALID_LINK);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form).entries());
  const name = (values.name ?? '').trim();
  button.disabled = true;
  error.hidden = true;

  try {
    await api.acceptInvitation({
      token,
      password: values.password ?? '',
      name: name === '' ? null : name,
    });
    form.hidden = true;
    done.hidden = false;
  } catch (failure) {
    showError(
      failure instanceof ApiError ? failure.message : 'Falha de comunicação com o servidor.',
    );
    button.disabled = false;
  }
});
