import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListPoliciesInput } from '../../../core/policy/application/list-policies.ts';
import { authorOf } from '../author.ts';
import { PDF_BODY_LIMIT, contentDisposition } from './proposals.ts';

/**
 * The recognition of issuance (REQ-209): the proposal and who identified it.
 * Nothing else is accepted — the policy inherits every datum of the proposal
 * and nothing is typed again (REQ-242, REJ-204). Whether the proposal may
 * originate a policy and whether the signature is present are domain rules
 * (REQ-049, REQ-216, REQ-253) and are not restated here.
 *
 * The PDF of the policy may travel with it (REQ-247), base64-encoded like the
 * proposal's. It is a document, not a datum: nothing reads its content
 * (DEC-213).
 */
const policyDocumentProperty = {
  type: 'object',
  required: ['fileName', 'content'],
  additionalProperties: false,
  properties: {
    fileName: { type: 'string' },
    content: { type: 'string' },
  },
} as const;

const registerPolicySchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['proposalId'],
    additionalProperties: false,
    properties: {
      proposalId: { type: 'string' },
      document: policyDocumentProperty,
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

/** REQ-247: a PDF sent after the policy exists, signed (REQ-216). */
const attachPolicyDocumentSchema: FastifySchema = {
  params: getPolicySchema.params,
  body: {
    type: 'object',
    required: ['fileName', 'content'],
    additionalProperties: false,
    properties: policyDocumentProperty.properties,
  },
};

interface PolicyDocumentBody {
  fileName: string;
  content: string;
}

function documentOf(body: PolicyDocumentBody) {
  return {
    fileName: body.fileName,
    content: new Uint8Array(Buffer.from(body.content, 'base64')),
  };
}

/**
 * Shape only. Whether the day is a real calendar date is the domain's answer
 * (`CalendarDate`, REQ-020), so a malformed one is a 422 with the translated
 * sentence, not a pattern restated here.
 */
const listPoliciesSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      renewalUntil: { type: 'string' },
      // REQ-319: part of the client's name or of its CPF.
      client: { type: 'string' },
    },
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
  // No body: who confirms is the session (REQ-123, REQ-216).
};

export function registerPolicyRoutes(app: FastifyInstance, useCases: UseCases): void {
  // FP-01 step 6, acceptance branch (REQ-048): the insurer effectuated the
  // proposal and the policy is recorded with its installments.
  // The PDF of the policy may come along (REQ-247).
  app.post(
    '/policies',
    { schema: registerPolicySchema, bodyLimit: PDF_BODY_LIMIT },
    async (request, reply) => {
      const body = request.body as {
        proposalId: string;
        document?: PolicyDocumentBody;
      };

      const output = await useCases.registerPolicy.execute({
        proposalId: body.proposalId,
        // REQ-209, REQ-216: who recognised the issuance is the session user.
        userId: authorOf(request),
        document: body.document === undefined ? null : documentOf(body.document),
      });
      return reply.code(201).send(output);
    },
  );

  // REQ-247: the PDF sent after the policy exists; the last one sent is the
  // policy's (CA-244). A change of the policy, not a new resource: 200.
  app.post(
    '/policies/:id/document',
    { schema: attachPolicyDocumentSchema, bodyLimit: PDF_BODY_LIMIT },
    async (request) => {
      const { id } = request.params as { id: string };

      return useCases.attachPolicyDocument.execute({
        policyId: id,
        userId: authorOf(request),
        document: documentOf(request.body as PolicyDocumentBody),
      });
    },
  );

  // REQ-247, CA-243: the PDF in force, as uploaded. Same headers as the
  // proposal's source document: saved by the browser, never rendered as a
  // page of this app.
  app.get('/policies/:id/document', { schema: getPolicySchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const document = await useCases.getPolicyDocument.execute(id);

    return reply
      .header('content-type', document.contentType)
      .header('content-disposition', contentDisposition(document.fileName))
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(document.content));
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

  // IN-13: a user confirms the client paid an installment.
  app.post(
    '/policies/:id/installments/:number/payment',
    { schema: payInstallmentSchema },
    async (request) => {
      const { id, number } = request.params as { id: string; number: string };

      return useCases.payInstallment.execute({
        policyId: id,
        number: Number(number),
        userId: authorOf(request),
      });
    },
  );
}
