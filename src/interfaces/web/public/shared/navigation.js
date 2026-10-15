/**
 * The one place a page changes `window.location`.
 *
 * Kept apart so the journeys in `tests/e2e/` can record where a page asked to
 * go: jsdom does not navigate.
 */
export function navigateTo(url) {
  window.location.assign(url);
}
