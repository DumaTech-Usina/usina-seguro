/**
 * The actions menu of the PDF viewer.
 *
 * One action today: download. Each action is one entry of `ACTIONS`, so a new
 * one is added there and nothing in the viewer changes.
 */

function download({ downloadUrl, fileName }) {
  const link = document.createElement('a');
  link.className = 'btn btn--outlined btn--sm';
  // The endpoint answers as an attachment: the browser saves the file, as
  // the link on the page used to do.
  link.href = downloadUrl;
  link.download = fileName;
  link.dataset.action = 'download';

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.textContent = 'download';

  link.append(icon, document.createTextNode('Baixar PDF'));
  return link;
}

const ACTIONS = [download];

/** `pdf` is `{ downloadUrl, fileName }`, the file the viewer is showing. */
export function pdfActions(pdf) {
  const menu = document.createElement('div');
  menu.className = 'pdf-actions';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', 'Ações do PDF');
  menu.append(...ACTIONS.map((action) => action(pdf)));
  return menu;
}
