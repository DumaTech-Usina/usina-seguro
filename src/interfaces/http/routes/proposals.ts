import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { RegisterProposalInput } from '../../../core/proposal/application/register-proposal.ts';

/**
 * Request shape validation (Fastify JSON Schema).
 *
 * It only covers type and presence — never business rules. If `customerAccepted`
 * is `false` the schema accepts it and the domain rejects it (REQ-040). The rule
 * lives in exactly one place.
 */
const registerProposalSchema: FastifySchema = {
  body: {
    type: 'object',
    required: [
      'clientId',
      'brokerId',
      'insurerId',
      'productId',
      'paymentMethodId',
      'customerAccepted',
      'netPremium',
    ],
    additionalProperties: false,
    properties: {
      clientId: { type: 'string' },
      brokerId: { type: 'string' },
      insurerId: { type: 'string' },
      productId: { type: 'string' },
      paymentMethodId: { type: 'string' },
      customerAccepted: { type: 'boolean' },
      // String, never number: money does not travel as binary floating point (REQ-120).
      netPremium: { type: 'string' },
    },
  },
};

export function registerProposalRoutes(app: FastifyInstance, useCases: UseCases): void {
  app.post('/proposals', { schema: registerProposalSchema }, async (request, reply) => {
    const output = await useCases.registerProposal.execute(request.body as RegisterProposalInput);
    return reply.code(201).send(output);
  });
}
