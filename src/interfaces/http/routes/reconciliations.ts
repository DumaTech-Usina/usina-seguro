import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ReconcileCommissionReportInput } from '../../../core/reconciliation/application/reconcile-commission-report.ts';

/**
 * FP-02, REQ-080: the Financeiro imports the commission report.
 *
 * The endpoint takes **structured lines**, not a file. The layout of the file
 * — spreadsheet, CSV or PDF, column names and order, one or several
 * intermediaries with distinct layouts — is `DEC-001`, and the requirements
 * state that REQ-080 to REQ-083 cannot be implemented or tested without a real
 * sample. The parser that turns a file into these lines is exactly the piece
 * that decision blocks; everything the confirmed rules do with a line — match
 * it (REQ-082), open a pendency (REQ-083), refuse a duplicate (REQ-086) — is
 * here and exercised.
 */
const reconcileSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['competence', 'lines'],
    additionalProperties: false,
    properties: {
      competence: { type: 'string' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          required: ['proposalNumber', 'producerCommission'],
          additionalProperties: false,
          properties: {
            // REQ-082: the key, when the report brings it.
            policyNumber: { type: 'string' },
            proposalNumber: { type: 'string' },
            // Money as a decimal string, never a number (REQ-120).
            producerCommission: { type: 'string' },
          },
        },
      },
    },
  },
};

export function registerReconciliationRoutes(app: FastifyInstance, useCases: UseCases): void {
  app.post('/commission-reconciliations', { schema: reconcileSchema }, async (request, reply) => {
    const output = await useCases.reconcileCommissionReport.execute(
      request.body as ReconcileCommissionReportInput,
    );
    return reply.code(201).send(output);
  });

  // OUT-06: the lines with no matching policy, waiting for a human.
  app.get('/commission-reconciliations/pendencies', async () =>
    useCases.listReconciliationPendencies.execute(),
  );
}
