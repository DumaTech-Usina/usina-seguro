import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { UseCases } from '../../composition-root.ts';
import { BusinessRuleViolation } from '../../core/proposal/domain/errors.ts';
import { translate } from '../../i18n/messages.ts';
import { registerHealthRoute } from './routes/health.ts';
import { registerProposalRoutes } from './routes/proposals.ts';

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

    if (error.validation !== undefined) {
      return reply.code(400).send({ error: 'invalid_request', message: error.message });
    }

    app.log.error(error);
    return reply.code(500).send({ error: 'internal_error' });
  });

  registerHealthRoute(app);
  registerProposalRoutes(app, useCases);

  return app;
}
