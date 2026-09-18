/**
 * Display helpers for the decimal strings the API exchanges.
 *
 * REQ-120 does not stop at the HTTP boundary: `parseFloat` would reintroduce
 * exactly the binary floating point the domain avoids. Nothing here converts a
 * value to `number` — formatting works on the text, and the one sum this
 * interface shows runs on `BigInt` cents.
 */

/** '1200.00' -> 'R$ 1.200,00'. Invalid input is echoed rather than guessed. */
export function formatMoney(decimal) {
  if (typeof decimal !== 'string' || !/^-?\d+(\.\d{1,2})?$/.test(decimal)) {
    return decimal ?? '—';
  }

  const negative = decimal.startsWith('-');
  const [whole, fraction = ''] = decimal.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${negative ? '-' : ''}R$ ${grouped},${fraction.padEnd(2, '0')}`;
}

/** '32.5' -> '32,5%'. The informed scale is preserved (REQ-121). */
export function formatPercentage(decimal) {
  if (typeof decimal !== 'string') {
    return '—';
  }
  return `${decimal.replace('.', ',')}%`;
}

/** '2026-10-01' -> '01/10/2026', with no time zone in the way. */
export function formatDate(isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) {
    return '—';
  }
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** An instant, shown in the reader's own time zone. */
export function formatInstant(iso) {
  if (typeof iso !== 'string') {
    return '—';
  }
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('pt-BR');
}

/**
 * Exact sum of decimal strings, on integer cents.
 *
 * Informative only: it tells the operator what the schedule adds up to while
 * it is being typed. It is not a rule — `Policy.register` deliberately does
 * not require the installments to match the premium, and this must not start
 * pretending otherwise.
 */
export function sumMoney(values) {
  let cents = 0n;

  for (const value of values) {
    if (typeof value !== 'string' || !/^\d+(\.\d{1,2})?$/.test(value)) {
      return null;
    }
    const [whole, fraction = ''] = value.split('.');
    cents += BigInt(whole + fraction.padEnd(2, '0'));
  }

  const text = cents.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}
