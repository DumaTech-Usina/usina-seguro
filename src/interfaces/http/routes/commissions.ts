import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListCommissionsInput } from '../../../core/commission/application/list-commissions.ts';
import { authorOf } from '../author.ts';

/**
 * Request shape validation only. What the commission is worth and what an
 * override requires are domain rules and are not restated here.
 */
const policyIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string' } },
} as const;

const overrideSchema: FastifySchema = {
  params: policyIdParams,
  body: {
    type: 'object',
    required: ['receivable', 'justification'],
    additionalProperties: false,
    properties: {
      // Money as a decimal string (REQ-120). Receivable side only: the
      // broker's part is the CR of FP-02 (REQ-270).
      receivable: { type: 'string' },
      justification: { type: 'string' },
    },
  },
};

/**
 * Shape only. The set of states is the domain's and the schema repeats it so
 * an unknown value is a 400 instead of an empty panel.
 */
const listCommissionsSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: {
        type: 'string',
        enum: ['FORECAST'],
      },
    },
  },
};

interface PolicyIdParams {
  id: string;
}

export function registerCommissionRoutes(app: FastifyInstance, useCases: UseCases): void {
  // OUT-05: the agreed commission of every policy.
  app.get('/commissions', { schema: listCommissionsSchema }, async (request) => {
    // The schema already restricted the query to a known state or nothing.
    return useCases.listCommissions.execute(request.query as ListCommissionsInput);
  });

  // REQ-236: the agreed commission of one policy.
  app.get('/policies/:id/commission', { schema: { params: policyIdParams } }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    return useCases.getCommission.execute(id);
  });

  // IN-14, FA-07, REQ-066: extraordinary agreement on a single policy.
  app.post('/policies/:id/commission/override', { schema: overrideSchema }, async (request) => {
    const { id } = request.params as PolicyIdParams;
    const body = request.body as { receivable: string; justification: string };

    // REQ-067, REQ-216: who applied it is the session user.
    return useCases.overrideCommission.execute({
      policyId: id,
      ...body,
      userId: authorOf(request),
    });
  });
}
