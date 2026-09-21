import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListReferencesInput } from '../../../core/registry/application/list-references.ts';
import type { RegisterReferenceInput } from '../../../core/registry/application/register-reference.ts';

/** The five kinds of IN-01. Shape only: what a record must carry is REQ-096. */
const KINDS = ['CLIENT', 'BROKER', 'INSURER', 'INTERMEDIARY', 'PRODUCT'] as const;

const registerReferenceSchema: FastifySchema = {
  body: {
    type: 'object',
    required: ['kind', 'id', 'name'],
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: KINDS },
      id: { type: 'string' },
      name: { type: 'string' },
    },
  },
};

/**
 * An unknown kind is a 400 rather than an empty listing, for the same reason
 * the commission panel refuses an unknown state: an empty answer to a question
 * nobody understood reads as "nothing is registered".
 */
const listReferencesSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { kind: { type: 'string', enum: KINDS } },
  },
};

export function registerReferenceRoutes(app: FastifyInstance, useCases: UseCases): void {
  // IN-01: the Administrator maintains the reference records.
  app.post('/references', { schema: registerReferenceSchema }, async (request, reply) => {
    const output = await useCases.registerReference.execute(request.body as RegisterReferenceInput);
    return reply.code(201).send(output);
  });

  // IN-01: what is registered, all of it or one kind at a time.
  app.get('/references', { schema: listReferencesSchema }, async (request) => {
    return useCases.listReferences.execute(request.query as ListReferencesInput);
  });
}
