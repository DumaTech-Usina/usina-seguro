/**
 * A valid CPF for each seed (REQ-301), so tests that need several brokers get
 * distinct CPFs (REQ-302) without hard-coding real-looking numbers.
 */
export function cpfOf(seed: number): string {
  const base = String(100_000_000 + seed).slice(-9);
  const digits = [...base].map(Number);

  for (const position of [9, 10]) {
    let sum = 0;
    for (let index = 0; index < position; index++) {
      sum += (digits[index] ?? 0) * (position + 1 - index);
    }
    digits.push(((sum * 10) % 11) % 10);
  }

  return digits.join('');
}
