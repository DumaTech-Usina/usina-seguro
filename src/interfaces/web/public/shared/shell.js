/**
 * The chrome every page shares: app bar, navigation and the snackbar host.
 *
 * Injected instead of copied so a page file holds only its own content. With
 * no build step there is no include mechanism, and one small ES module beats
 * the same forty lines of markup pasted into six files.
 *
 * A page opts in with `<body class="shell" data-nav="policies">`; the value
 * marks the current item.
 *
 * The app bar also says who is logged in (REQ-400) and holds "Sair", which
 * ends the session on the server (REQ-411). With no session, the reading of
 * who is logged in is what sends the operator to the login (REQ-431).
 */

import { api } from '/app/shared/api.js';
import { navigateTo } from '/app/shared/navigation.js';

/**
 * The navigation. `ready: false` marks a page that exists as a placeholder:
 * it is shown, labelled "em breve" and not clickable, so nobody lands on a
 * blank document. Each entry says which output of the requirements it will
 * serve once the backend answers it.
 */
const NAV = [
  {
    group: 'Operação',
    items: [
      { id: 'home', label: 'Início', icon: 'home', href: '/app/', ready: true },
      {
        id: 'proposals-new',
        label: 'Nova proposta',
        icon: 'note_add',
        href: '/app/proposals/new.html',
        ready: true,
      },
      // The proposals by state of REQ-250, as a filter over the same list.
      {
        id: 'proposals',
        label: 'Propostas',
        icon: 'description',
        href: '/app/proposals/',
        ready: true,
      },
      // OUT-03 and OUT-04 (REQ-055), as one listing with a renewal cut-off.
      { id: 'policies', label: 'Apólices', icon: 'shield', href: '/app/policies/', ready: true },
    ],
  },
  {
    group: 'Financeiro',
    items: [
      // OUT-05.
      {
        id: 'commissions',
        label: 'Comissões',
        icon: 'percent',
        href: '/app/commissions/',
        ready: true,
      },
      // FP-02 of V2: policies without CR and eligible commissions.
      {
        id: 'payouts',
        label: 'Repasses',
        icon: 'volunteer_activism',
        href: '/app/payouts/',
        ready: true,
      },
      // OUT-10 (REQ-100, REQ-102, REQ-105): what the broker was told when the
      // emission was effectuated.
      {
        id: 'notifications',
        label: 'Notificações',
        icon: 'notifications',
        href: '/app/notifications/',
        ready: true,
      },
    ],
  },
  {
    group: 'Administração',
    items: [
      { id: 'settings', label: 'Cadastros', icon: 'tune', href: '/app/settings/', ready: true },
      // REQ-440: only an administrator sees it — a convenience; the server is
      // what refuses anyone else (REQ-430).
      {
        id: 'users',
        label: 'Usuários',
        icon: 'manage_accounts',
        href: '/app/users/',
        ready: true,
        requires: 'ADMINISTRATOR',
      },
    ],
  },
];

function icon(name) {
  const element = document.createElement('span');
  element.className = 'material-symbols-outlined';
  element.textContent = name;
  return element;
}

function buildAppBar() {
  const bar = document.createElement('header');
  bar.className = 'app-bar';

  const mark = document.createElement('div');
  mark.className = 'app-bar__mark';
  mark.append(icon('local_fire_department'));

  const titles = document.createElement('div');
  titles.className = 'app-bar__titles';
  const title = document.createElement('span');
  title.className = 'text-subtitle';
  title.textContent = 'Usina do Seguro';
  const subtitle = document.createElement('span');
  subtitle.className = 'text-muted';
  subtitle.style.fontSize = '12px';
  subtitle.textContent = 'Controle interno';
  titles.append(title, subtitle);

  const spacer = document.createElement('div');
  spacer.className = 'app-bar__spacer';

  const environment = document.createElement('span');
  environment.className = 'chip';
  environment.textContent = 'MVP';

  const user = document.createElement('span');
  user.className = 'app-bar__user text-muted';

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'btn btn--sm app-bar__logout';
  logout.append(icon('logout'), document.createTextNode('Sair'));
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await api.logOut();
    } finally {
      navigateTo('/app/login/');
    }
  });

  bar.append(mark, titles, spacer, environment, user, logout);
  return bar;
}

/** REQ-400: the name, or the e-mail when there is none, as the server renders it. */
async function showUser() {
  try {
    const user = await api.me();
    document.querySelector('.app-bar__user').textContent = user.displayName;
    for (const item of document.querySelectorAll('.app-nav__item[data-requires]')) {
      item.hidden = item.dataset.requires !== user.role;
    }
  } catch {
    // A 401 already sent the operator to the login; anything else leaves the
    // bar without a name, and the page reports its own failures.
  }
}

function buildNav(current) {
  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.setAttribute('aria-label', 'Navegação principal');

  for (const group of NAV) {
    const section = document.createElement('div');
    section.className = 'app-nav__group';

    const label = document.createElement('div');
    label.className = 'app-nav__group-label text-label';
    label.textContent = group.group;
    section.append(label);

    for (const item of group.items) {
      const link = document.createElement('a');
      link.className = 'app-nav__item';
      link.href = item.href;
      link.append(icon(item.icon), document.createTextNode(item.label));

      if (!item.ready) {
        link.setAttribute('aria-disabled', 'true');
        const soon = document.createElement('span');
        soon.className = 'app-nav__soon';
        soon.textContent = 'em breve';
        link.append(soon);
      }

      if (item.id === current) {
        link.setAttribute('aria-current', 'page');
      }

      if (item.requires !== undefined) {
        link.dataset.requires = item.requires;
        link.hidden = true;
      }

      section.append(link);
    }

    nav.append(section);
  }

  return nav;
}

/** Feedback for one operation. `rule` shows the requirement that refused it. */
export function showSnackbar(message, { tone = 'neutral', rule = null, timeout = 6000 } = {}) {
  const host = document.querySelector('.snackbar-host');
  if (host === null) {
    return;
  }

  const snackbar = document.createElement('div');
  snackbar.className = `snackbar snackbar--${tone}`;
  snackbar.setAttribute('role', tone === 'danger' ? 'alert' : 'status');

  const text = document.createElement('div');
  text.textContent = message;
  snackbar.append(text);

  if (rule !== null) {
    const badge = document.createElement('span');
    badge.className = 'snackbar__rule';
    badge.textContent = rule;
    snackbar.append(badge);
  }

  host.append(snackbar);
  setTimeout(() => snackbar.remove(), timeout);
}

/** Reports a rejected operation with the sentence the server rendered. */
export function reportError(error) {
  const rule = error?.rule ?? null;
  const message = error?.message ?? 'Não foi possível completar a operação.';
  showSnackbar(message, { tone: 'danger', rule });
}

function mount() {
  const current = document.body.dataset.nav ?? '';
  document.body.prepend(buildAppBar(), buildNav(current));

  const host = document.createElement('div');
  host.className = 'snackbar-host';
  document.body.append(host);

  void showUser();
}

mount();
