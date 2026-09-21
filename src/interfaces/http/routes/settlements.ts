import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListBrokerStatementInput } from '../../../core/settlement/application/list-broker-statement.ts';

const registerReleaseRuleSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['paymentMethodId', 'release'],
    additionalProperties: false,
    properties: {
      paymentMethodId: { type: 'string' },
      // REQ-090. The two values are the ones the requirement names; which
      // payment method gets which is data (REQ-091, CA-024), and Pix has no
      // default because DEC-002 has not decided it.
      release: { type: 'string', enum: ['IMMEDIATE', 'REQUIRES_RECEIPT_CONFIRMATION'] },
    },
  },
};

const policyIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const paymentSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['amount', 'proofReference', 'userId'],
    additionalProperties: false,
    properties: {
      // Money as a decimal string, never a number (REQ-120).
      amount: { type: 'string' },
      proofReference: { type: 'string' },
      userId: { type: 'string' },
    },
  },
};

/**
 * Shape only. The broker is a free reference (IN-01 is not modelled), so there
 * is nothing to enumerate here: an unknown broker is an empty statement, not a
 * refusal.
 */
const brokerStatementSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { brokerId: { type: 'string' } },
  },
};

interface PolicyIdParams {
  id: string;
}

export function registerSettlementRoutes(app: FastifyInstance, useCases: UseCases): void {
  // IN-06, REQ-090, CA-024: configuration, not code.
  app.post(
    '/payment-method-release-rules',
    { schema: registerReleaseRuleSchema },
    async (request, reply) => {
      const body = request.body as {
        paymentMethodId: string;
        release: 'IMMEDIATE' | 'REQUIRES_RECEIPT_CONFIRMATION';
      };
      const output = await useCases.registerPaymentMethodReleaseRule.execute(body);
      return reply.code(201).send(output);
    },
  );

  // IN-06, REQ-090: the rules configured. A payment method with no rule is
  // absent from the answer, which is how the operator sees that opening a
  // transfer for it is refused — Pix included, whose rule is DEC-002.
  app.get('/payment-method-release-rules', async () => {
    return useCases.listPaymentMethodReleaseRules.execute();
  });

  // OUT-07: the commission statement of a broker — forecast, held, released
  // and paid. No filter answers for every broker.
  app.get('/broker-commission-statements', { schema: brokerStatementSchema }, async (request) => {
    return useCases.listBrokerStatement.execute(request.query as ListBrokerStatementInput);
  });

  // FP-03 steps 1 to 3: the transfer is opened and the release rule evaluated.
  app.post(
    '/policies/:id/settlement',
    { schema: { params: policyIdParams } },
    async (request, reply) => {
      const { id } = request.params as PolicyIdParams;
      const output = await useCases.openSettlement.execute({ policyId: id });
      return reply.code(201).send(output);
    },
  );

  app.get('/policies/:id/settlement', { schema: { params: policyIdParams } }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    return useCases.getSettlement.execute(id);
  });

  // FP-03 step 3 (REQ-091, REQ-092): releasing a transfer that was waiting.
  app.post(
    '/policies/:id/settlement/release',
    { schema: { params: policyIdParams } },
    async (request) => {
      const { id } = request.params as PolicyIdParams;
      return useCases.releaseSettlement.execute({ policyId: id });
    },
  );

  // FP-03 step 5, REQ-095, IN-15: the payment sent to the broker.
  app.post('/policies/:id/settlement/payment', { schema: paymentSchema }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    const body = request.body as { amount: string; proofReference: string; userId: string };

    return useCases.registerSettlementPayment.execute({ policyId: id, ...body });
  });
}
