import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListProposalsInput } from '../../../core/proposal/application/list-proposals.ts';
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

const proposalIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const transmitProposalSchema: FastifySchema = {
  params: proposalIdParams,
  body: {
    type: 'object',
    required: ['proposalNumber', 'workedCommission'],
    additionalProperties: false,
    properties: {
      proposalNumber: { type: 'string' },
      // Percentage as a decimal string, for the same reason money is (REQ-121).
      workedCommission: { type: 'string' },
    },
  },
};

const rejectProposalSchema: FastifySchema = {
  params: proposalIdParams,
  body: {
    type: 'object',
    required: ['reason'],
    additionalProperties: false,
    // Presence only: an empty reason is rejected by the domain (REQ-045).
    properties: { reason: { type: 'string' } },
  },
};

/**
 * Shape only. The set of states is the domain's (section 10.2) and the schema
 * repeats it so an unknown value is a 400 instead of an empty listing that
 * looks like "nothing to do".
 */
const listProposalsSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        enum: ['DRAFT', 'TRANSMITTED', 'ACCEPTED', 'REJECTED', 'CANCELLED'],
      },
    },
  },
};

const getProposalSchema: FastifySchema = { params: proposalIdParams };

interface ProposalIdParams {
  id: string;
}

export function registerProposalRoutes(app: FastifyInstance, useCases: UseCases): void {
  // FP-01 step 5 (REQ-043): the proposals still open, or the refused ones of
  // OUT-02, depending on the state asked for. No filter lists every proposal.
  app.get('/proposals', { schema: listProposalsSchema }, async (request) => {
    // The schema already restricted the query to a known state or nothing.
    return useCases.listProposals.execute(request.query as ListProposalsInput);
  });

  // REQ-043, REQ-046: a proposal stays consultable, outcome or not.
  app.get('/proposals/:id', { schema: getProposalSchema }, async (request) => {
    const { id } = request.params as ProposalIdParams;
    return useCases.getProposal.execute(id);
  });

  app.post('/proposals', { schema: registerProposalSchema }, async (request, reply) => {
    const output = await useCases.registerProposal.execute(request.body as RegisterProposalInput);
    return reply.code(201).send(output);
  });

  // FP-01 step 4 (REQ-041): the outcome of transmitting is a change of state on
  // the proposal, not a new resource, so it answers 200.
  app.post('/proposals/:id/transmission', { schema: transmitProposalSchema }, async (request) => {
    const { id } = request.params as ProposalIdParams;
    const body = request.body as { proposalNumber: string; workedCommission: string };

    return useCases.transmitProposal.execute({
      proposalId: id,
      proposalNumber: body.proposalNumber,
      workedCommission: body.workedCommission,
    });
  });

  // FP-01 step 6, refusal branch (REQ-045).
  app.post('/proposals/:id/rejection', { schema: rejectProposalSchema }, async (request) => {
    const { id } = request.params as ProposalIdParams;
    const { reason } = request.body as { reason: string };

    return useCases.rejectProposal.execute({ proposalId: id, reason });
  });
}
