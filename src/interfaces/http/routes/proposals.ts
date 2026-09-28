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
 * It only covers type and presence — never business rules. An empty payment
 * method passes here and the domain rejects it (REQ-040); an intermediary
 * without CTU passes here and is refused by the domain (REQ-221). Money and percentages are strings, never numbers (REQ-120,
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
      // REQ-219: the imported PDF, base64-encoded like the reading's body.
      sourceDocument: {
        type: 'object',
        required: ['fileName', 'contentType', 'content'],
        additionalProperties: false,
        properties: {
          fileName: { type: 'string' },
          contentType: { type: 'string' },
          content: { type: 'string' },
        },
      },
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

/** REQ-218: the PDF travels base64-encoded in the JSON body, like the payment proof. */
const readProposalPdfSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['content'],
    additionalProperties: false,
    properties: { content: { type: 'string' } },
  },
};

/** A proposal PDF is small; base64 costs four bytes per three. Also the policy PDF's (REQ-247). */
export const PDF_BODY_LIMIT = 12 * 1024 * 1024;

interface ProposalIdParams {
  id: string;
}

interface RegisterProposalBody {
  clientId: string;
  brokerId: string;
  insurerId: string;
  productId: string;
  paymentMethodId: string;
  proposalNumber: string;
  netPremium: string;
  coverageStart: string;
  coverageEnd: string;
  installments?: { amount: string; dueDate?: string | null }[];
  workedCommission: string;
  workedCommissionMode: WorkedCommissionMode;
  intermediary: { intermediaryId: string; ctu?: string | null } | null;
  sourceDocument?: { fileName: string; contentType: string; content: string };
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

  // REQ-218: reads the PDF and answers what it found, for the form to fill.
  // Nothing is registered: the answer is 200 even when the reading FAILED,
  // because a document that cannot be read is an outcome, not a bad request.
  app.post(
    '/proposals/pdf-reading',
    { schema: readProposalPdfSchema, bodyLimit: PDF_BODY_LIMIT },
    async (request) => {
      const { content } = request.body as { content: string };
      return useCases.readProposalPdf.read(new Uint8Array(Buffer.from(content, 'base64')));
    },
  );

  // FP-01 steps 1 to 6. The body may carry the imported PDF (REQ-219).
  app.post(
    '/proposals',
    { schema: registerProposalSchema, bodyLimit: PDF_BODY_LIMIT },
    async (request, reply) => {
      const body = request.body as RegisterProposalBody;

      const output = await useCases.registerProposal.execute({
        clientId: body.clientId,
        brokerId: body.brokerId,
        insurerId: body.insurerId,
        productId: body.productId,
        paymentMethodId: body.paymentMethodId,
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
        sourceDocument:
          body.sourceDocument === undefined
            ? null
            : {
                fileName: body.sourceDocument.fileName,
                contentType: body.sourceDocument.contentType,
                content: new Uint8Array(Buffer.from(body.sourceDocument.content, 'base64')),
              },
      });

      return reply.code(201).send(output);
    },
  );

  /**
   * REQ-219, CA-223: the PDF the proposal was imported from, as uploaded.
   * Same headers as the payment proof: `attachment` and `nosniff` make the
   * browser save the file instead of rendering it as a page of this app.
   */
  app.get(
    '/proposals/:id/source-document',
    { schema: getProposalSchema },
    async (request, reply) => {
      const { id } = request.params as ProposalIdParams;
      const document = await useCases.getProposalSourceDocument.execute(id);

      return reply
        .header('content-type', document.contentType)
        .header('content-disposition', contentDisposition(document.fileName))
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(document.content));
    },
  );

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

/**
 * `Content-Disposition` for a name the user chose, which may hold quotes,
 * accents or anything else a file name can hold.
 *
 * RFC 6266: the plain `filename` carries an ASCII fallback for old clients,
 * and `filename*` carries the real name percent-encoded as UTF-8.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
