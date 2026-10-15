import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import { authorOf } from '../author.ts';

/**
 * The clients (V2 section 9E). Shape only: what a name or a CPF must be, and
 * that a CPF is held by one client, are domain rules and are not restated
 * here. There is no removal (REQ-315), so there is no route for it.
 */
const clientIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const clientBody = {
  type: 'object',
  required: ['name', 'cpf'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    cpf: { type: 'string' },
  },
} as const;

const listClientsSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { q: { type: 'string' } },
  },
};

interface ClientIdParams {
  id: string;
}

interface ClientBody {
  name: string;
  cpf: string;
}

export function registerClientRoutes(app: FastifyInstance, useCases: UseCases): void {
  // REQ-311, REQ-312, REQ-314: a client is registered, signed.
  app.post('/clients', { schema: { body: clientBody } }, async (request, reply) => {
    const { name, cpf } = request.body as ClientBody;
    const output = await useCases.registerClient.execute({
      name,
      cpf,
      userId: authorOf(request),
    });
    return reply.code(201).send(output);
  });

  // REQ-316: every client, or those whose name or CPF matches `q`.
  app.get('/clients', { schema: listClientsSchema }, async (request) => {
    const { q } = request.query as { q?: string };
    return useCases.listClients.execute({ query: q });
  });

  // REQ-314: a client with its signed history.
  app.get('/clients/:id', { schema: { params: clientIdParams } }, async (request) => {
    const { id } = request.params as ClientIdParams;
    return useCases.getClient.execute({ clientId: id });
  });

  // REQ-313, REQ-314: name and CPF change, signed.
  app.post(
    '/clients/:id/revision',
    { schema: { params: clientIdParams, body: clientBody } },
    async (request) => {
      const { id } = request.params as ClientIdParams;
      const { name, cpf } = request.body as ClientBody;
      return useCases.changeClient.execute({
        clientId: id,
        name,
        cpf,
        userId: authorOf(request),
      });
    },
  );
}
