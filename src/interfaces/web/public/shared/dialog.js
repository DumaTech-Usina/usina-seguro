/**
 * Closes a native `<dialog>` when the backdrop is clicked, the same way its
 * "Cancelar" does: with the value `cancel`, so whoever waits on the dialog
 * reads it as dismissed.
 *
 * A click on the backdrop reaches the `<dialog>` itself; a click on its
 * content reaches a child. `.dialog` has no padding, so the content covers the
 * whole box and only the backdrop can target the dialog.
 */
export function closeOnBackdropClick(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close('cancel');
    }
  });
}
