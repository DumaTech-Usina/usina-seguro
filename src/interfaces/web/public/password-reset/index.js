/**
 * "Esqueci a senha" (REQ-425, REQ-426). Open to everyone (REQ-410).
 *
 * Without a token, the page asks for the e-mail and shows the one answer the
 * server gives, whether the e-mail has an account or not. With the token of
 * the e-mail, it asks for the new password; whether the link still works is
 * the server's to say.
 */

import { ApiError, api } from '/app/shared/api.js';

const token = new URLSearchParams(window.location.search).get('token') ?? '';
const requestForm = document.querySelector('#form-request');
const passwordForm = document.querySelector('#form-new-password');
const error = document.querySelector('#access-error');
const done = document.querySelector('#access-done');

function failed(failure) {
  error.textContent =
    failure instanceof ApiError ? failure.message : 'Falha de comunicação com o servidor.';
  error.hidden = false;
}

/** Runs the request of a form, keeping its button off meanwhile. */
function wire(form, send) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    button.disabled = true;
    error.hidden = true;

    try {
      await send(values);
    } catch (failure) {
      failed(failure);
    } finally {
      button.disabled = false;
    }
  });
}

if (token !== '') {
  requestForm.hidden = true;
  passwordForm.hidden = false;
}

// REQ-425: the same answer for every e-mail, as the server wrote it.
wire(requestForm, async (values) => {
  const answer = await api.requestPasswordReset(values.email ?? '');
  requestForm.hidden = true;
  done.textContent = answer.message;
  done.hidden = false;
});

// REQ-426: the new password; then the login, as any other time.
wire(passwordForm, async (values) => {
  await api.resetPassword(token, values.password ?? '');
  passwordForm.hidden = true;
  const login = document.createElement('a');
  login.href = '/app/login/';
  login.textContent = 'Entre com a nova senha.';
  done.replaceChildren('Senha redefinida. ', login);
  done.hidden = false;
});
