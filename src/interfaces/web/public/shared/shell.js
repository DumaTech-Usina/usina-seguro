/**
 * The chrome every page shares: app bar, navigation and the snackbar host.
 *
 * Injected instead of copied so a page file holds only its own content. With
 * no build step there is no include mechanism, and one small ES module beats
 * the same forty lines of markup pasted into six files.
 *
 * A page opts in with `<body class="shell" data-nav="policies">`; the value
 * marks the current item.
 */

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
      // OUT-01 (REQ-043) and OUT-02 (REQ-045), as a filter over the same list.
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
      // FP-02 and OUT-06.
      {
        id: 'reconciliations',
        label: 'Conciliação',
        icon: 'sync_alt',
        href: '/app/reconciliations/',
        ready: true,
      },
      // OUT-07.
      {
        id: 'settlements',
        label: 'Repasses',
        icon: 'payments',
        href: '/app/settlements/',
        ready: true,
      },
    ],
  },
  {
    group: 'Administração',
    items: [
      { id: 'settings', label: 'Cadastros', icon: 'tune', href: '/app/settings/', ready: true },
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

  bar.append(mark, titles, spacer, environment);
  return bar;
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
}

mount();
