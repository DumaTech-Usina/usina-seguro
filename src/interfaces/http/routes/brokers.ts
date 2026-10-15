import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import { authorOf } from '../author.ts';

/**
 * The brokers (V2 section 9D). Shape only: what a name or a CPF must be, and
 * that a CPF is held by one broker, are domain rules and are not restated
 * here. There is no removal (REQ-305), so there is no route for it.
 */
const brokerIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const brokerBody = {
  type: 'object',
  required: ['name', 'cpf'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    cpf: { type: 'string' },
  },
} as const;

const listBrokersSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { q: { type: 'string' } },
  },
};

interface BrokerIdParams {
  id: string;
}

interface BrokerBody {
  name: string;
  cpf: string;
}

export function registerBrokerRoutes(app: FastifyInstance, useCases: UseCases): void {
  // REQ-300–REQ-302, REQ-304: a broker is registered, signed.
  app.post('/brokers', { schema: { body: brokerBody } }, async (request, reply) => {
    const { name, cpf } = request.body as BrokerBody;
    const output = await useCases.registerBroker.execute({
      name,
      cpf,
      userId: authorOf(request),
    });
    return reply.code(201).send(output);
  });

  // REQ-306: every broker, or those whose name or CPF matches `q`.
  app.get('/brokers', { schema: listBrokersSchema }, async (request) => {
    const { q } = request.query as { q?: string };
    return useCases.listBrokers.execute({ query: q });
  });

  // REQ-304: a broker with its signed history.
  app.get('/brokers/:id', { schema: { params: brokerIdParams } }, async (request) => {
    const { id } = request.params as BrokerIdParams;
    return useCases.getBroker.execute({ brokerId: id });
  });

  // REQ-303, REQ-304: name and CPF change, signed.
  app.post(
    '/brokers/:id/revision',
    { schema: { params: brokerIdParams, body: brokerBody } },
    async (request) => {
      const { id } = request.params as BrokerIdParams;
      const { name, cpf } = request.body as BrokerBody;
      return useCases.changeBroker.execute({
        brokerId: id,
        name,
        cpf,
        userId: authorOf(request),
      });
    },
  );
}
