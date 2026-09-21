import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListPoliciesInput } from '../../../core/policy/application/list-policies.ts';
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

/**
 * Shape only. Whether the day is a real calendar date is the domain's answer
 * (`CalendarDate`, REQ-020), so a malformed one is a 422 with the translated
 * sentence, not a pattern restated here.
 */
const listPoliciesSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { renewalUntil: { type: 'string' } },
  },
};

const payInstallmentSchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id', 'number'],
    properties: {
      id: { type: 'string' },
      // Coercion is off for the whole server (REQ-120), so a path segment
      // stays a string and the use case converts it.
      number: { type: 'string', pattern: '^[0-9]+$' },
    },
  },
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    // Presence only: an empty user is rejected by the domain (REQ-123).
    properties: { userId: { type: 'string' } },
  },
};

export function registerPolicyRoutes(app: FastifyInstance, useCases: UseCases): void {
  // FP-01 step 6, acceptance branch (REQ-048): the insurer effectuated the
  // proposal and the policy is recorded with its installments.
  app.post('/policies', { schema: registerPolicySchema }, async (request, reply) => {
    const output = await useCases.registerPolicy.execute(request.body as RegisterPolicyInput);
    return reply.code(201).send(output);
  });

  // OUT-03: the policies the Usina sold, with coverage, state and renewal
  // date. With `renewalUntil` it is the a-vencer listing of OUT-04 (REQ-055,
  // CA-032); the window is informed, because no requirement fixes one.
  app.get('/policies', { schema: listPoliciesSchema }, async (request) => {
    return useCases.listPolicies.execute(request.query as ListPoliciesInput);
  });

  // CA-008: both numbers and the schedule stay consultable.
  app.get('/policies/:id', { schema: getPolicySchema }, async (request) => {
    const { id } = request.params as { id: string };
    return useCases.getPolicy.execute(id);
  });

  // FP-01 step 6 seen from the proposal being tracked (REQ-043): the policy it
  // originated, at most one (REQ-049). The path belongs to the proposal, the
  // answer belongs to this module, which is why it is registered here.
  app.get('/proposals/:id/policy', { schema: getPolicySchema }, async (request) => {
    const { id } = request.params as { id: string };
    return useCases.getPolicyByProposal.execute(id);
  });

  // IN-13, REQ-092, FP-03 step 3: a user confirms the client paid. REQ-091
  // makes the first installment the condition that releases the transfer.
  app.post(
    '/policies/:id/installments/:number/payment',
    { schema: payInstallmentSchema },
    async (request) => {
      const { id, number } = request.params as { id: string; number: string };
      const { userId } = request.body as { userId: string };

      return useCases.payInstallment.execute({
        policyId: id,
        number: Number(number),
        userId,
      });
    },
  );
}
