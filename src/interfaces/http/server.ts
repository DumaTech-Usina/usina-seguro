import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { UseCases } from '../../composition-root.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../core/proposal/domain/errors.ts';
import { translate } from '../../i18n/messages.ts';
import { registerWebInterface } from '../web/web.ts';
import { registerCommissionRoutes } from './routes/commissions.ts';
import { registerHealthRoute } from './routes/health.ts';
import { registerPolicyRoutes } from './routes/policies.ts';
import { registerProposalRoutes } from './routes/proposals.ts';
import { registerReconciliationRoutes } from './routes/reconciliations.ts';
import { registerSettlementRoutes } from './routes/settlements.ts';

export interface HttpServerOptions {
  readonly logger: boolean;
}

/**
 * Builds the HTTP server on top of the already composed use cases.
 *
 * Fastify: mature, typed, with built-in schema validation and `inject()` for
 * testing without opening a socket. The layer is thin on purpose — it maps HTTP
 * to a use case and nothing else.
 */
export function createHttpServer(
  useCases: UseCases,
  options: HttpServerOptions = { logger: false },
): FastifyInstance {
  const app = Fastify({
    logger: options.logger,
    // No type coercion during validation: by default Ajv would turn the number
    // 1234.56 into the string '1234.56', letting a binary float in as a monetary
    // value (REQ-120). Here a wrong type is an invalid request, not a silent
    // conversion.
    ajv: { customOptions: { coerceTypes: false } },
  });

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    // The only place that maps a business rule violation to HTTP, and the only
    // place that turns a message key into readable text.
    if (error instanceof BusinessRuleViolation) {
      return reply.code(422).send({
        error: 'business_rule_violation',
        rule: error.rule,
        messageKey: error.messageKey,
        message: translate(error.messageKey, error.params),
      });
    }

    // No rule was broken: the record the operation refers to does not exist.
    if (error instanceof RecordNotFound) {
      return reply.code(404).send({
        error: 'not_found',
        messageKey: error.messageKey,
        message: translate(error.messageKey, error.params),
      });
    }

    if (error.validation !== undefined) {
      return reply.code(400).send({ error: 'invalid_request', message: error.message });
    }

    // Fastify's own client errors: a body that is not valid JSON, an empty
    // body under a JSON content type, an unsupported media type. They are
    // malformed requests like a schema failure, and answering 500 would blame
    // the server for what the caller sent.
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ error: 'invalid_request', message: error.message });
    }

    app.log.error(error);
    return reply.code(500).send({ error: 'internal_error' });
  });

  // The operator's pages, under `/app/`. They consume the routes below over
  // HTTP like any other client, so nothing about the API changes because they
  // exist.
  registerWebInterface(app);

  registerHealthRoute(app);
  registerProposalRoutes(app, useCases);
  registerPolicyRoutes(app, useCases);
  registerCommissionRoutes(app, useCases);
  registerReconciliationRoutes(app, useCases);
  registerSettlementRoutes(app, useCases);

  return app;
}
