import type { UseCases } from '../../../src/composition-root.ts';
import type { UserView } from '../../../src/core/identity/application/user-view.ts';

/**
 * Every operation needs a session (REQ-410), so every journey starts logged in.
 *
 * The user is a test one, created the way the first administrator is (REQ-405)
 * and logged in over HTTP like a browser would. Node's `fetch` keeps no cookie,
 * so from here on the session cookie is added to every request to the test
 * server that does not already carry one — standing in for the browser that
 * stores what `Set-Cookie` said. Nothing about the server is bypassed.
 */
export const TEST_USER = {
  email: 'operadora.teste@usina.com.br',
  name: 'Operadora de Teste',
  password: 'senha de teste longa',
} as const;

export interface SignedIn {
  /** `usina_session=<token>`, as a `cookie` header carries it. */
  readonly cookie: string;
  /** The `fetch` as it was before the cookie was attached: a visitor with no session. */
  readonly anonymousFetch: typeof globalThis.fetch;
  /** The test user: the author of every act the journey signs (REQ-216). */
  readonly user: UserView;
}

export async function signIn(useCases: UseCases, baseUrl: string): Promise<SignedIn> {
  const { token } = await useCases.issueFirstAdministratorInvitation.execute({
    email: TEST_USER.email,
  });
  const user = await useCases.acceptInvitation.execute({
    token,
    password: TEST_USER.password,
    name: TEST_USER.name,
  });

  const anonymousFetch = globalThis.fetch;
  const response = await anonymousFetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEST_USER.email, password: TEST_USER.password }),
  });
  if (!response.ok) {
    throw new Error(`The test user could not log in: ${response.status}.`);
  }
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;

  const origin = new URL(baseUrl).origin;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), baseUrl);
    if (url.origin !== origin) {
      return anonymousFetch(input, init);
    }

    const headers = new Headers(init?.headers);
    if (!headers.has('cookie')) {
      headers.set('cookie', cookie);
    }
    return anonymousFetch(url, { ...init, headers });
  }) as typeof globalThis.fetch;

  return { cookie, anonymousFetch, user };
}

/**
 * Another user, of the role asked, created by the command of REQ-407 and
 * logged in. Answers the cookie of its own session, to send explicitly — the
 * `fetch` installed by `signIn` keeps sending the test user's.
 */
export async function logInAs(
  useCases: UseCases,
  baseUrl: string,
  anonymousFetch: typeof globalThis.fetch,
  input: { email: string; role: 'ADMINISTRATOR' | 'USER'; name?: string },
): Promise<{ user: UserView; cookie: string }> {
  const user = await useCases.createUser.execute({
    email: input.email,
    password: TEST_USER.password,
    role: input.role,
    name: input.name ?? null,
  });
  const response = await anonymousFetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: input.email, password: TEST_USER.password }),
  });
  if (!response.ok) {
    throw new Error(`${input.email} could not log in: ${response.status}.`);
  }
  return { user, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] as string };
}
