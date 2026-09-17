import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { RegisterPolicyInput } from '../../../core/policy/application/register-policy.ts';

/**
 * Request shape validation only. Whether the proposal may originate a policy,
 * whether the coverage period makes sense and whether the schedule is numbered
 * correctly are domain rules (REQ-020, REQ-047, REQ-049) and are not restated
 * here.
 */
const registerPolicySchema: FastifySchema = {
  body: {
    type: 'object',
    required: [
      'proposalId',
      'policyNumber',
      'premium',
      'coverageStart',
      'coverageEnd',
      'renewalDate',
      'installments',
    ],
    additionalProperties: false,
    properties: {
      proposalId: { type: 'string' },
      policyNumber: { type: 'string' },
      // String, never number: money does not travel as binary floating point (REQ-120).
      premium: { type: 'string' },
      coverageStart: { type: 'string' },
      coverageEnd: { type: 'string' },
      renewalDate: { type: 'string' },
      installments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['number', 'amount', 'dueDate'],
          additionalProperties: false,
          properties: {
            number: { type: 'integer' },
            amount: { type: 'string' },
            dueDate: { type: 'string' },
          },
        },
      },
    },
  },
};

const getPolicySchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
};

export function registerPolicyRoutes(app: FastifyInstance, useCases: UseCases): void {
  // FP-01 step 6, acceptance branch (REQ-048): the insurer effectuated the
  // proposal and the policy is recorded with its installments.
  app.post('/policies', { schema: registerPolicySchema }, async (request, reply) => {
    const output = await useCases.registerPolicy.execute(request.body as RegisterPolicyInput);
    return reply.code(201).send(output);
  });

  // CA-008 / OUT-03: both numbers and the schedule stay consultable.
  app.get('/policies/:id', { schema: getPolicySchema }, async (request) => {
    const { id } = request.params as { id: string };
    return useCases.getPolicy.execute(id);
  });
}
