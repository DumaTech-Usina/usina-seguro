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

/**
 * How big a proof may be, in bytes of body.
 *
 * This is a transport bound, not a business rule: no requirement states a
 * size for the *comprovante* of REQ-095, and the domain does not know this
 * number exists. It is here for the same reason any server caps a request —
 * so a single upload cannot exhaust the process — and Fastify answers 413
 * when it is exceeded, which is a refusal of the request and not of the
 * payment.
 *
 * Base64 costs four bytes per three, so the usable file is about 3/4 of this.
 */
const PROOF_BODY_LIMIT = 12 * 1024 * 1024;

const paymentSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['amount', 'proof', 'userId'],
    additionalProperties: false,
    properties: {
      // Money as a decimal string, never a number (REQ-120).
      amount: { type: 'string' },
      // REQ-095, CA-028: the attached document. It travels base64-encoded in
      // the JSON body — the transport the rest of the API already uses, with
      // no multipart parser and no build step to add. What the core receives
      // is bytes; base64 stops at this layer.
      proof: {
        type: 'object',
        required: ['fileName', 'contentType', 'content'],
        additionalProperties: false,
        properties: {
          fileName: { type: 'string', minLength: 1 },
          contentType: { type: 'string', minLength: 1 },
          content: { type: 'string', minLength: 1 },
        },
      },
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

  // FP-03 step 5, REQ-095, IN-15, CA-028: the payment sent to the broker,
  // with the proof attached.
  app.post(
    '/policies/:id/settlement/payment',
    { schema: paymentSchema, bodyLimit: PROOF_BODY_LIMIT },
    async (request) => {
      const { id } = request.params as PolicyIdParams;
      const body = request.body as {
        amount: string;
        proof: { fileName: string; contentType: string; content: string };
        userId: string;
      };

      return useCases.registerSettlementPayment.execute({
        policyId: id,
        amount: body.amount,
        userId: body.userId,
        proof: {
          fileName: body.proof.fileName,
          contentType: body.proof.contentType,
          // Base64 is how the document crossed HTTP; the core is handed bytes.
          content: new Uint8Array(Buffer.from(body.proof.content, 'base64')),
        },
      });
    },
  );

  /**
   * REQ-095, CA-028: the attached proof itself.
   *
   * The only route in the API that does not answer JSON, because the whole
   * point of an attachment is the file. Two headers are not decoration:
   * `attachment` and `nosniff` make the browser save the document instead of
   * rendering it, which is what keeps a proof uploaded as HTML or SVG from
   * running as a page of this application.
   */
  app.get(
    '/policies/:id/settlement/payment/proof',
    { schema: { params: policyIdParams } },
    async (request, reply) => {
      const { id } = request.params as PolicyIdParams;
      const document = await useCases.getSettlementPaymentProof.execute(id);

      return reply
        .header('content-type', document.contentType)
        .header('content-disposition', contentDisposition(document.fileName))
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(document.content));
    },
  );
}

/**
 * `Content-Disposition` for a name the Financeiro typed, which may hold
 * quotes, accents or anything else a file name can hold.
 *
 * RFC 6266: the plain `filename` carries an ASCII fallback for old clients,
 * and `filename*` carries the real name percent-encoded as UTF-8.
 */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
