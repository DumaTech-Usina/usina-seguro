/**
 * The users page of the administrator (REQ-440): the users with name, e-mail,
 * role and situation, the pending invitations, and the acts on them —
 * invite, resend, deactivate, change the role.
 *
 * Whether the act is allowed is the server's answer: a Usuário who opens this
 * page is refused by it (REQ-430), and the page shows that refusal. While no
 * e-mail is configured the invitation link comes back here, to hand over
 * (REQ-436).
 */

import { ApiError, api } from '/app/shared/api.js';
import { closeOnBackdropClick } from '/app/shared/dialog.js';
import { formatInstant } from '/app/shared/money.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';

/** REQ-401: the two roles, in Portuguese. */
const ROLE = { ADMINISTRATOR: 'Administrador', USER: 'Usuário' };
/** REQ-440: the situation of a user; a pending invitation is a line of its own. */
const STATUS = {
  ACTIVE: { label: 'Ativo', tone: 'success' },
  DEACTIVATED: { label: 'Desativado', tone: 'neutral' },
};

const list = document.querySelector('#users');
const inviteForm = document.querySelector('#form-invite');
const inviteLink = document.querySelector('#invite-link');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function chip(label, tone) {
  return element('span', `chip chip--${tone}`, label);
}

function button(label, onClick, variant = 'sm btn--outlined') {
  const node = element('button', `btn btn--${variant}`, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function ask(id, prepare) {
  const dialog = document.querySelector(id);
  const form = dialog.querySelector('form');
  form.reset();
  prepare?.(dialog);
  dialog.showModal();

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () =>
        resolve(dialog.returnValue === 'confirm' ? Object.fromEntries(new FormData(form)) : null),
      { once: true },
    );
  });
}

/** Runs an act, reports a refusal with the server's sentence, and reads the list again. */
async function perform(work, success) {
  try {
    const result = await work();
    if (success !== undefined) {
      showSnackbar(typeof success === 'function' ? success(result) : success, { tone: 'success' });
    }
    await load();
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      reportError(error);
    } else {
      showSnackbar('Falha de comunicação com o servidor.', { tone: 'danger' });
    }
    return null;
  }
}

/**
 * REQ-436: the link of the invitation, to hand over while no e-mail is sent.
 * Once e-mail is configured the server answers no link: it went by e-mail.
 */
function showLink(invitation) {
  const field = inviteLink.querySelector('.field');
  const validity = `válido até ${formatInstant(invitation.expiresAt)}`;

  document.querySelector('#invite-link-text').textContent =
    invitation.link === null
      ? `Convite enviado por e-mail para ${invitation.email}, ${validity}.`
      : `Convite para ${invitation.email}, ${validity}.`;
  inviteLink.querySelector('[name="link"]').value = invitation.link ?? '';
  field.hidden = invitation.link === null;
  inviteLink.hidden = false;
}

function userRow(user) {
  const row = element('tr');
  const status = STATUS[user.status];
  const situation = element('td');
  situation.append(chip(status.label, status.tone));

  const actions = element('td', 'is-action');
  if (user.status === 'ACTIVE') {
    actions.append(
      button('Trocar papel', () => changeRole(user)),
      button('Desativar', () => deactivate(user), 'sm btn--danger'),
    );
  }

  row.append(
    element('td', undefined, user.name ?? '—'),
    element('td', undefined, user.email),
    element('td', undefined, ROLE[user.role]),
    situation,
    actions,
  );
  return row;
}

function invitationRow(invitation) {
  const row = element('tr');
  const situation = element('td');
  situation.append(
    chip('Convite pendente', 'warning'),
    element('span', 'text-muted', ` válido até ${formatInstant(invitation.expiresAt)}`),
  );

  const actions = element('td', 'is-action');
  actions.append(
    button('Reenviar convite', () =>
      perform(() => api.resendInvitation(invitation.id), 'Convite reenviado.').then((sent) => {
        if (sent !== null) {
          showLink(sent);
        }
      }),
    ),
  );

  row.append(
    element('td', undefined, '—'),
    element('td', undefined, invitation.email),
    element('td', undefined, ROLE[invitation.role]),
    situation,
    actions,
  );
  return row;
}

async function deactivate(user) {
  const answer = await ask('#dialog-deactivate', (dialog) => {
    dialog.querySelector('#dialog-deactivate-subtitle').textContent =
      `${user.displayName} (${user.email})`;
  });
  if (answer !== null) {
    await perform(() => api.deactivateUser(user.id), 'Usuário desativado.');
  }
}

async function changeRole(user) {
  const answer = await ask('#dialog-role', (dialog) => {
    dialog.querySelector('#dialog-role-subtitle').textContent =
      `${user.displayName} (${user.email})`;
    dialog.querySelector('[name="role"]').value = user.role;
  });
  if (answer !== null) {
    await perform(() => api.changeUserRole(user.id, answer.role), 'Papel trocado.');
  }
}

async function load() {
  let listing;
  try {
    listing = await api.listUsers();
  } catch (error) {
    // REQ-430: a Usuário is refused by the server; the page says what it said.
    const banner = element('div', 'banner');
    banner.append(
      element(
        'div',
        'banner__text',
        error instanceof ApiError ? error.message : 'Não foi possível carregar os usuários.',
      ),
    );
    list.replaceChildren(banner);
    document.querySelector('#invite-card').hidden = true;
    inviteForm.hidden = true;
    return;
  }

  if (listing.users.length === 0 && listing.invitations.length === 0) {
    list.replaceChildren(element('div', 'empty', 'Nenhum usuário.'));
    return;
  }

  const table = element('table', 'table');
  const head = element('thead');
  const headRow = element('tr');
  for (const label of ['Nome', 'E-mail', 'Papel', 'Situação', '']) {
    headRow.append(element('th', undefined, label));
  }
  head.append(headRow);

  const body = element('tbody');
  for (const user of listing.users) {
    body.append(userRow(user));
  }
  for (const invitation of listing.invitations) {
    body.append(invitationRow(invitation));
  }

  table.append(head, body);
  list.replaceChildren(table);
}

inviteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = inviteForm.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(inviteForm).entries());
  submit.disabled = true;

  const invitation = await perform(
    () => api.inviteUser(values.email ?? '', values.role ?? 'USER'),
    'Convite criado.',
  );
  if (invitation !== null) {
    inviteForm.reset();
    showLink(invitation);
  }
  submit.disabled = false;
});

for (const dialog of document.querySelectorAll('dialog')) {
  closeOnBackdropClick(dialog);
}

void load();
