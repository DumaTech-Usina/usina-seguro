import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListEligiblePayoutsInput } from '../../../core/commission/application/list-eligible-payouts.ts';
import { authorOf } from '../author.ts';
import { PAGE_QUERY, filtersOf, pageOf, paged } from '../page-query.ts';

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
    required: ['rate'],
    additionalProperties: false,
    // The CR as a decimal string, never a JSON number (REQ-120, REQ-121).
    properties: { rate: { type: 'string' } },
  },
};

const reviseSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['rate', 'reason'],
    additionalProperties: false,
    properties: {
      rate: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};

/** REQ-281: the act takes no data — who signs is the session (REQ-216). */
const eligibilitySchema: FastifySchema = {
  params: policyIdParams,
};

/** V2 section 9B: the two CRs of a parcelled policy, as decimal strings. */
const informParcelledSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['firstRate', 'subsequentRate'],
    additionalProperties: false,
    properties: {
      firstRate: { type: 'string' },
      subsequentRate: { type: 'string' },
    },
  },
};

const reviseParcelledSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['firstRate', 'subsequentRate', 'reason'],
    additionalProperties: false,
    properties: {
      firstRate: { type: 'string' },
      subsequentRate: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};

const installmentEligibilitySchema: FastifySchema = {
  params: {
    type: 'object',
    required: ['id', 'number'],
    properties: {
      id: { type: 'string' },
      // Coercion is off for the whole server (REQ-120): the number stays a string.
      number: { type: 'string', pattern: '^[0-9]+$' },
    },
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
      ...PAGE_QUERY,
    },
  },
};

/** REQ-330: the listings with no filter of their own still take the page. */
const pageOnlySchema: FastifySchema = {
  querystring: { type: 'object', additionalProperties: false, properties: { ...PAGE_QUERY } },
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
    const query = request.query as Record<string, string>;
    return paged(
      await useCases.listEligiblePayouts.execute({
        ...(filtersOf(query) as ListEligiblePayoutsInput),
        ...pageOf(query),
      }),
    );
  });

  // REQ-286: the policies that still need a CR.
  app.get('/payouts/policies-without-rate', { schema: pageOnlySchema }, async (request) => {
    return paged(
      await useCases.listPoliciesWithoutPayoutRate.execute(
        pageOf(request.query as Record<string, string>),
      ),
    );
  });

  // REQ-268: every policy with parcelled CT, with its situation.
  app.get('/payouts/parcelled-policies', { schema: pageOnlySchema }, async (request) => {
    return paged(
      await useCases.listParcelledPolicies.execute(pageOf(request.query as Record<string, string>)),
    );
  });

  // V2 section 9B: the payout of a policy with parcelled CT, per installment.
  app.get(
    '/policies/:id/parcelled-payout',
    { schema: { params: policyIdParams } },
    async (request) => {
      const { id } = request.params as PolicyIdParams;
      return useCases.getParcelledPayout.execute(id);
    },
  );

  // REQ-287: the two CRs, informed together.
  app.post(
    '/policies/:id/parcelled-payout',
    { schema: informParcelledSchema },
    async (request, reply) => {
      const { id } = request.params as PolicyIdParams;
      const { firstRate, subsequentRate } = request.body as {
        firstRate: string;
        subsequentRate: string;
      };
      const output = await useCases.informParcelledPayoutRates.execute({
        policyId: id,
        firstRate,
        subsequentRate,
        userId: authorOf(request),
      });
      return reply.code(201).send(output);
    },
  );

  // REQ-265: both CRs changed together, with a reason.
  app.post(
    '/policies/:id/parcelled-payout/revision',
    { schema: reviseParcelledSchema },
    async (request) => {
      const { id } = request.params as PolicyIdParams;
      const { firstRate, subsequentRate, reason } = request.body as {
        firstRate: string;
        subsequentRate: string;
        reason: string;
      };
      return useCases.reviseParcelledPayoutRates.execute({
        policyId: id,
        firstRate,
        subsequentRate,
        reason,
        userId: authorOf(request),
      });
    },
  );

  // REQ-288: the eligibility of one installment, signed.
  app.post(
    '/policies/:id/installments/:number/eligibility',
    { schema: installmentEligibilitySchema },
    async (request) => {
      const { id, number } = request.params as { id: string; number: string };
      return useCases.declareInstallmentEligibility.execute({
        policyId: id,
        number: Number(number),
        userId: authorOf(request),
      });
    },
  );
}
