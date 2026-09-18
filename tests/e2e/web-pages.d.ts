/**
 * The pages the browser runs, importable by the prefix they are served under.
 *
 * `vitest.config.ts` resolves `/app/` to `src/interfaces/web/public/`, so a
 * test loads the same file the browser downloads, with no build and no copy.
 * There is nothing to type: these modules export nothing and are plain `.js`
 * on purpose (see the README). The declaration exists so importing one for its
 * side effect is not a resolution error.
 */
declare module '/app/*';
