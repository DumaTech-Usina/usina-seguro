/**
 * Dictionary of lines of business (REQ-218): puts the ramo a PDF prints under
 * the category the proposal records in "Produto / ramo".
 *
 * Meant to be extended — adding a term here is how the reading gets better. A
 * ramo not listed is not guessed: the field stays absent for the user to fill.
 */
const CATEGORIES: Readonly<Record<string, readonly string[]>> = {
  Auto: ['moto', 'carro'],
};

/** Case and accents do not matter: `Moto`, `MOTO` and `moto` are the same term. */
function normalized(term: string): string {
  return term
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

export function categoryOfLineOfBusiness(lineOfBusiness: string): string | null {
  const term = normalized(lineOfBusiness);

  for (const [category, terms] of Object.entries(CATEGORIES)) {
    if (terms.some((known) => normalized(known) === term)) {
      return category;
    }
  }

  return null;
}
