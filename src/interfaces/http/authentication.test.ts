import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { UseCases } from '../../composition-root.ts';
import { registerAuthentication } from './authentication.ts';

/**
 * REQ-410, REQ-430: every route says who may run it. A route that says
 * nothing — neither open to everyone nor the role it requires — stops the
 * server from starting, so it can never be served by accident.
 */
const useCases = {} as UseCases;

describe('the access declaration of the routes (REQ-430)', () => {
  it('refuses to start with a route that declares no access', async () => {
    const app = Fastify();
    registerAuthentication(app, useCases, { secureCookies: false });
    app.get('/forgotten', async () => ({}));

    await expect(app.ready()).rejects.toThrow(/GET \/forgotten/);
  });

  it('starts when every route declares it', async () => {
    const app = Fastify();
    registerAuthentication(app, useCases, { secureCookies: false });
    app.get('/open', { config: { public: true } }, async () => ({}));
    app.get('/operation', { config: { requires: 'USER' } }, async () => ({}));
    app.get('/management', { config: { requires: 'ADMINISTRATOR' } }, async () => ({}));

    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });
});
