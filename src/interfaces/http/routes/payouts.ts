import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListEligiblePayoutsInput } from '../../../core/commission/application/list-eligible-payouts.ts';
import { SIGNATURE_PROPERTIES, SIGNATURE_REQUIRED, authorOf } from '../author.ts';

/**
 * FP-02 (V2 section 9A). Shape only: the range and precision of the CR, the
 * mandatory reason and who may become eligible are domain rules and are not
 * restated here.
 */
const policyIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const informSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['rate', ...SIGNATURE_REQUIRED],
    additionalProperties: false,
    // The CR as a decimal string, never a JSON number (REQ-120, REQ-121).
    properties: { rate: { type: 'string' }, ...SIGNATURE_PROPERTIES },
  },
};

const reviseSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['rate', 'reason', ...SIGNATURE_REQUIRED],
    additionalProperties: false,
    properties: {
      rate: { type: 'string' },
      reason: { type: 'string' },
      ...SIGNATURE_PROPERTIES,
    },
  },
};

const eligibilitySchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: [...SIGNATURE_REQUIRED],
    additionalProperties: false,
    properties: { ...SIGNATURE_PROPERTIES },
  },
};

const MONTH = { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' } as const;
const INSTANT = { type: 'string', format: 'date-time' } as const;

/** REQ-284: the filters; see `ListEligiblePayoutsInput` for their meaning. */
const listEligibleSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      policyNumber: { type: 'string' },
      broker: { type: 'string' },
      client: { type: 'string' },
      eligibleFrom: INSTANT,
      eligibleBefore: INSTANT,
      renewalFrom: MONTH,
      renewalUntil: MONTH,
    },
  },
};

interface PolicyIdParams {
  id: string;
}

export function registerPayoutRoutes(app: FastifyInstance, useCases: UseCases): void {
  // REQ-273, REQ-285: the situation of the policy and its payout commission.
  app.get('/policies/:id/payout', { schema: { params: policyIdParams } }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    return useCases.getPolicyPayout.execute(id);
  });

  // FP-02 steps 2 and 3: the CR informed for the first time.
  app.post('/policies/:id/payout', { schema: informSchema }, async (request, reply) => {
    const { id } = request.params as PolicyIdParams;
    const { rate } = request.body as { rate: string };
    const output = await useCases.informPayoutRate.execute({
      policyId: id,
      rate,
      userId: authorOf(request),
    });
    return reply.code(201).send(output);
  });

  // FP-02 step 4, REQ-277: the recalculation, with a reason.
  app.post('/policies/:id/payout/revision', { schema: reviseSchema }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    const { rate, reason } = request.body as { rate: string; reason: string };
    return useCases.revisePayoutRate.execute({
      policyId: id,
      rate,
      reason,
      userId: authorOf(request),
    });
  });

  // FP-02 steps 5 and 6, REQ-281: the eligibility, signed.
  app.post('/policies/:id/payout/eligibility', { schema: eligibilitySchema }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    return useCases.declarePayoutEligibility.execute({ policyId: id, userId: authorOf(request) });
  });

  // REQ-284: the eligible commissions, read-only, with their filters.
  app.get('/payouts/eligible', { schema: listEligibleSchema }, async (request) => {
    return useCases.listEligiblePayouts.execute(request.query as ListEligiblePayoutsInput);
  });

  // REQ-286: the policies that still need a CR.
  app.get('/payouts/policies-without-rate', async () => {
    return useCases.listPoliciesWithoutPayoutRate.execute();
  });
}
