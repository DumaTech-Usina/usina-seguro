import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListProposalsInput } from '../../../core/proposal/application/list-proposals.ts';
import type {
  IntermediaryDeclarationInput,
  RegisterProposalInstallmentInput,
} from '../../../core/proposal/application/register-proposal.ts';
import type { WorkedCommissionMode } from '../../../core/proposal/domain/worked-commission.ts';
import { SIGNATURE_PROPERTIES, SIGNATURE_REQUIRED, authorOf } from '../author.ts';

/**
 * Request shape validation (Fastify JSON Schema).
 *
 * It only covers type and presence — never business rules. If
 * `customerAccepted` is `false` the schema accepts it and the domain rejects it
 * (REQ-040); an intermediary without CTU passes here and is refused by the
 * domain (REQ-221). Money and percentages are strings, never numbers (REQ-120,
 * REQ-121).
 */
const workedCommissionProperties = {
  workedCommission: { type: 'string' },
  workedCommissionMode: { type: 'string', enum: ['INTEGRAL', 'PARCELLED'] },
} as const;

/**
 * REQ-220: `null` declares a direct receipt; an object declares the one
 * intermediary. It is an object and not a list, so a second intermediary
 * cannot even be expressed (REJ-209). The CTU may be absent or null so that
 * the domain, not the schema, answers REJ-202.
 */
const intermediaryProperty = {
  type: ['object', 'null'],
  required: ['intermediaryId'],
  additionalProperties: false,
  properties: {
    intermediaryId: { type: 'string' },
    ctu: { type: ['string', 'null'] },
  },
} as const;

const registerProposalSchema: FastifySchema = {
  body: {
    type: 'object',
    // REQ-202: every datum is required except the installments.
    required: [
      'clientId',
      'brokerId',
      'insurerId',
      'productId',
      'paymentMethodId',
      'customerAccepted',
      'proposalNumber',
      'netPremium',
      'coverageStart',
      'coverageEnd',
      'workedCommission',
      'workedCommissionMode',
      'intermediary',
      ...SIGNATURE_REQUIRED,
    ],
    additionalProperties: false,
    properties: {
      clientId: { type: 'string' },
      brokerId: { type: 'string' },
      insurerId: { type: 'string' },
      productId: { type: 'string' },
      paymentMethodId: { type: 'string' },
      customerAccepted: { type: 'boolean' },
      proposalNumber: { type: 'string' },
      netPremium: { type: 'string' },
      coverageStart: { type: 'string' },
      coverageEnd: { type: 'string' },
      // REQ-204: the due date is optional.
      installments: {
        type: 'array',
        items: {
          type: 'object',
          required: ['amount'],
          additionalProperties: false,
          properties: {
            amount: { type: 'string' },
            dueDate: { type: ['string', 'null'] },
          },
        },
      },
      ...workedCommissionProperties,
      intermediary: intermediaryProperty,
      ...SIGNATURE_PROPERTIES,
    },
  },
};

const proposalIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const reviseWorkedCommissionSchema: FastifySchema = {
  params: proposalIdParams,
  body: {
    type: 'object',
    required: ['workedCommission', 'workedCommissionMode', ...SIGNATURE_REQUIRED],
    additionalProperties: false,
    properties: { ...workedCommissionProperties, ...SIGNATURE_PROPERTIES },
  },
};

const reviseReceiptSchema: FastifySchema = {
  params: proposalIdParams,
  body: {
    type: 'object',
    required: ['intermediary', ...SIGNATURE_REQUIRED],
    additionalProperties: false,
    properties: { intermediary: intermediaryProperty, ...SIGNATURE_PROPERTIES },
  },
};

const rejectProposalSchema: FastifySchema = {
  params: proposalIdParams,
  body: {
    type: 'object',
    required: ['reason'],
    additionalProperties: false,
    // Presence only: an empty reason is rejected by the domain (REQ-253).
    properties: { reason: { type: 'string' } },
  },
};

/**
 * Shape only. The set of states is the domain's (REQ-250) and the schema
 * repeats it so an unknown value is a 400 instead of an empty listing that
 * looks like "nothing to do".
 */
const listProposalsSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: ['AWAITING_ISSUANCE', 'ISSUED', 'REJECTED'] },
    },
  },
};

const getProposalSchema: FastifySchema = { params: proposalIdParams };

interface ProposalIdParams {
  id: string;
}

interface RegisterProposalBody {
  clientId: string;
  brokerId: string;
  insurerId: string;
  productId: string;
  paymentMethodId: string;
  customerAccepted: boolean;
  proposalNumber: string;
  netPremium: string;
  coverageStart: string;
  coverageEnd: string;
  installments?: { amount: string; dueDate?: string | null }[];
  workedCommission: string;
  workedCommissionMode: WorkedCommissionMode;
  intermediary: { intermediaryId: string; ctu?: string | null } | null;
}

/** An absent CTU and a null one mean the same: not informed. */
function intermediaryOf(
  intermediary: { intermediaryId: string; ctu?: string | null } | null,
): IntermediaryDeclarationInput | null {
  return intermediary === null
    ? null
    : { intermediaryId: intermediary.intermediaryId, ctu: intermediary.ctu ?? null };
}

export function registerProposalRoutes(app: FastifyInstance, useCases: UseCases): void {
  // The proposals to follow, optionally narrowed to one state.
  app.get('/proposals', { schema: listProposalsSchema }, async (request) => {
    // The schema already restricted the query to a known state or nothing.
    return useCases.listProposals.execute(request.query as ListProposalsInput);
  });

  // REQ-232: the proposal with what the Usina expects; a refused one stays
  // consultable (REQ-253).
  app.get('/proposals/:id', { schema: getProposalSchema }, async (request) => {
    const { id } = request.params as ProposalIdParams;
    return useCases.getProposal.execute(id);
  });

  // FP-01 steps 1 to 6.
  app.post('/proposals', { schema: registerProposalSchema }, async (request, reply) => {
    const body = request.body as RegisterProposalBody;

    const output = await useCases.registerProposal.execute({
      clientId: body.clientId,
      brokerId: body.brokerId,
      insurerId: body.insurerId,
      productId: body.productId,
      paymentMethodId: body.paymentMethodId,
      customerAccepted: body.customerAccepted,
      proposalNumber: body.proposalNumber,
      netPremium: body.netPremium,
      coverageStart: body.coverageStart,
      coverageEnd: body.coverageEnd,
      installments: (body.installments ?? []).map(
        (installment): RegisterProposalInstallmentInput => ({
          amount: installment.amount,
          dueDate: installment.dueDate ?? null,
        }),
      ),
      workedCommission: body.workedCommission,
      workedCommissionMode: body.workedCommissionMode,
      intermediary: intermediaryOf(body.intermediary),
      author: authorOf(request),
    });

    return reply.code(201).send(output);
  });

  // FP-01 step 7, FA-203: a correction of the CT and its mode (REQ-214). A
  // change of the proposal, not a new resource, so it answers 200.
  app.post(
    '/proposals/:id/worked-commission',
    { schema: reviseWorkedCommissionSchema },
    async (request) => {
      const { id } = request.params as ProposalIdParams;
      const body = request.body as {
        workedCommission: string;
        workedCommissionMode: WorkedCommissionMode;
      };

      return useCases.reviseWorkedCommission.execute({
        proposalId: id,
        workedCommission: body.workedCommission,
        workedCommissionMode: body.workedCommissionMode,
        author: authorOf(request),
      });
    },
  );

  // FP-01 step 7, FA-204, FA-209: the receipt — direct or through the one
  // intermediary — declared again (REQ-225).
  app.post('/proposals/:id/receipt', { schema: reviseReceiptSchema }, async (request) => {
    const { id } = request.params as ProposalIdParams;
    const { intermediary } = request.body as Pick<RegisterProposalBody, 'intermediary'>;

    return useCases.reviseReceipt.execute({
      proposalId: id,
      intermediary: intermediaryOf(intermediary),
      author: authorOf(request),
    });
  });

  // FP-01 step 8, refusal branch (REQ-253).
  app.post('/proposals/:id/rejection', { schema: rejectProposalSchema }, async (request) => {
    const { id } = request.params as ProposalIdParams;
    const { reason } = request.body as { reason: string };

    return useCases.rejectProposal.execute({ proposalId: id, reason });
  });
}
