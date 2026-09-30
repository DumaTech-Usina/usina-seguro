/**
 * A minimal PDF viewer: the file in a native `<dialog>`, with its actions
 * menu. Viewing is what a click on a PDF does; downloading is one of the
 * actions (`pdf-actions.js`).
 *
 * The file is read from the same endpoint the download uses, and shown from a
 * Blob always typed `application/pdf`. The type is set here on purpose: the
 * stored type is whatever the uploader's browser informed, and a Blob typed
 * from it could render an upload as a page of this app — the reason the
 * endpoint answers as an attachment with `nosniff`.
 */

import { ApiError, api } from '/app/shared/api.js';
import { closeOnBackdropClick } from '/app/shared/dialog.js';
import { pdfActions } from '/app/shared/pdf-actions.js';
import { reportError, showSnackbar } from '/app/shared/shell.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** Opens the viewer on the file at `url`, the endpoint that serves it. */
export async function openPdfViewer({ url, fileName }) {
  const bytes = await api.readFile(url);
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

  const dialog = element('dialog', 'dialog pdf-viewer');
  dialog.setAttribute('aria-label', fileName);

  const header = element('div', 'pdf-viewer__header');
  const close = element('button', 'btn', 'Fechar');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  header.append(
    element('h2', 'text-title pdf-viewer__title', fileName),
    pdfActions({ downloadUrl: url, fileName }),
    close,
  );

  const frame = element('iframe', 'pdf-viewer__frame');
  frame.title = fileName;
  frame.src = objectUrl;

  dialog.append(header, frame);
  closeOnBackdropClick(dialog);
  dialog.addEventListener('close', () => {
    URL.revokeObjectURL(objectUrl);
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Makes viewing the default of a PDF link. The link keeps its `href`, so
 * opening it in a new tab or saving it still downloads the file.
 */
export function viewPdfOnClick(link, { url, fileName }) {
  link.addEventListener('click', async (event) => {
    event.preventDefault();

    try {
      await openPdfViewer({ url, fileName });
    } catch (error) {
      if (error instanceof ApiError) {
        reportError(error);
      } else {
        showSnackbar('Falha de comunicação com o servidor.', { tone: 'danger' });
      }
    }
  });
}
