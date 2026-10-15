import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { UseCases } from '../../composition-root.ts';
import { BusinessRuleViolation, RecordNotFound } from '../../core/proposal/domain/errors.ts';
import { translate } from '../../i18n/messages.ts';
import { registerWebInterface } from '../web/web.ts';
import { registerAuthentication, requireRole } from './authentication.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerCommissionRoutes } from './routes/commissions.ts';
import { registerHealthRoute } from './routes/health.ts';
import { registerNotificationRoutes } from './routes/notifications.ts';
import { registerPayoutRoutes } from './routes/payouts.ts';
import { registerPolicyRoutes } from './routes/policies.ts';
import { registerProposalRoutes } from './routes/proposals.ts';
import { registerReferenceRoutes } from './routes/references.ts';
import { registerUserRoutes } from './routes/users.ts';

export interface HttpServerOptions {
  readonly logger: boolean;
  /** Where the log goes; standard output when absent. */
  readonly logStream?: NodeJS.WritableStream;
  /** REQ-412: the session cookie only over https. `true` in production. */
  readonly secureCookies?: boolean;
  /** Where people reach the system: the base of the links handed out (REQ-436). */
  readonly publicUrl?: string;
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
    logger: loggerOptions(options),
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

  // V2 section 9C: every route below needs a session unless it says otherwise.
  const cookie = registerAuthentication(app, useCases, {
    secureCookies: options.secureCookies ?? false,
  });
  registerAuthRoutes(app, useCases, cookie);

  registerHealthRoute(app);

  // REQ-401, REQ-430: the business — every operation and every query — is for
  // both roles; a route in here that needs more says so itself.
  app.register(async (business) => {
    requireRole(business, 'USER');
    registerProposalRoutes(business, useCases);
    registerPolicyRoutes(business, useCases);
    registerCommissionRoutes(business, useCases);
    registerPayoutRoutes(business, useCases);
    registerReferenceRoutes(business, useCases);
    registerNotificationRoutes(business, useCases);
    registerUserRoutes(business, useCases, options.publicUrl ?? '');
  });

  return app;
}

/**
 * The request is logged by its path only. The query string is left out
 * because an invitation link carries its token there (REQ-416): the page
 * `/app/invitation/?token=...` must not leave a working link in the log.
 * Bodies, where the password travels, are never logged by Fastify.
 */
function loggerOptions(options: HttpServerOptions): NonNullable<FastifyServerOptions['logger']> {
  if (!options.logger) {
    return false;
  }

  return {
    ...(options.logStream === undefined ? {} : { stream: options.logStream }),
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url.split('?')[0] ?? request.url,
        hostname: request.hostname,
        remoteAddress: request.ip,
      }),
    },
  };
}
