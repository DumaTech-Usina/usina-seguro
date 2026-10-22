/**
 * What a listing shows — its filters and its page — kept in the address, so
 * going back from a detail, reloading or sharing the link opens the same
 * reading. The address is presentation state only: the server is asked again
 * every time, and nothing in it is trusted beyond what a field would accept.
 */

/** The value of `name` in the address, or `''` when it says nothing. */
export function fromAddress(name) {
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

/**
 * Writes the values into the address without a new history entry: the back
 * button still leaves the listing, and comes back to it as it was. A blank or
 * absent value is taken out, so a default goes unsaid.
 */
export function rememberInAddress(values) {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(values)) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    if (text === '') {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, text);
    }
  }
  window.history.replaceState(window.history.state, '', url);
}
