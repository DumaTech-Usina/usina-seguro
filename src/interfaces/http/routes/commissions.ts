import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { RegisterCommissionAgreementInput } from '../../../core/commission/application/register-commission-agreement.ts';

/**
 * Request shape validation only. Which rate applies, how the chain is walked
 * and what an override requires are domain rules (REQ-060..REQ-067) and are
 * not restated here.
 */
const registerAgreementSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['insurerId', 'productId', 'effectiveFrom', 'insurerRate'],
    additionalProperties: false,
    properties: {
      insurerId: { type: 'string' },
      productId: { type: 'string' },
      effectiveFrom: { type: 'string' },
      // Percentage as a decimal string, never a number (REQ-121).
      insurerRate: { type: 'string' },
      // Absent means a direct chain (REQ-060, REQ-062).
      intermediary: {
        type: 'object',
        required: ['intermediaryId', 'intermediaryRate'],
        additionalProperties: false,
        properties: {
          intermediaryId: { type: 'string' },
          intermediaryRate: { type: 'string' },
          // REQ-064; omitted falls back to the default of REQ-063.
          brokerBase: { type: 'string', enum: ['USINA', 'INTERMEDIARY'] },
        },
      },
    },
  },
};

const registerBrokerRateSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['brokerId', 'rate'],
    additionalProperties: false,
    properties: {
      brokerId: { type: 'string' },
      rate: { type: 'string' },
    },
  },
};

const policyIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const overrideSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['justification', 'userId'],
    additionalProperties: false,
    properties: {
      // Money as a decimal string (REQ-120). At least one of the two is
      // required, which the domain checks (REQ-066).
      receivable: { type: 'string' },
      payable: { type: 'string' },
      justification: { type: 'string' },
      userId: { type: 'string' },
    },
  },
};

const resolutionSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['justification', 'userId'],
    additionalProperties: false,
    properties: {
      justification: { type: 'string' },
      userId: { type: 'string' },
    },
  },
};

interface PolicyIdParams {
  id: string;
}

export function registerCommissionRoutes(app: FastifyInstance, useCases: UseCases): void {
  // IN-02, IN-03, IN-04, REQ-065: the Administrator maintains the agreement.
  app.post(
    '/commission-agreements',
    { schema: registerAgreementSchema },
    async (request, reply) => {
      const output = await useCases.registerCommissionAgreement.execute(
        request.body as RegisterCommissionAgreementInput,
      );
      return reply.code(201).send(output);
    },
  );

  // IN-05: the broker's commission table.
  app.post(
    '/broker-commission-rates',
    { schema: registerBrokerRateSchema },
    async (request, reply) => {
      const body = request.body as { brokerId: string; rate: string };
      const output = await useCases.registerBrokerCommissionRate.execute(body);
      return reply.code(201).send(output);
    },
  );

  // CA-016, REQ-076, OUT-05: agreed and real side by side, divergence flagged.
  app.get('/policies/:id/commission', { schema: { params: policyIdParams } }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    return useCases.getCommission.execute(id);
  });

  // IN-14, FA-07, REQ-066: extraordinary agreement on a single policy.
  app.post('/policies/:id/commission/override', { schema: overrideSchema }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    const body = request.body as {
      receivable?: string;
      payable?: string;
      justification: string;
      userId: string;
    };

    return useCases.overrideCommission.execute({ policyId: id, ...body });
  });

  // FP-02 step 5, REQ-085, CA-026: a human closes the divergence.
  app.post(
    '/policies/:id/commission/divergence-resolution',
    { schema: resolutionSchema },
    async (request) => {
      const { id } = request.params as PolicyIdParams;
      const body = request.body as { justification: string; userId: string };

      return useCases.resolveCommissionDivergence.execute({ policyId: id, ...body });
    },
  );
}
