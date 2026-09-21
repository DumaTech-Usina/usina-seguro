import type { FastifyInstance, FastifySchema } from 'fastify';
import type { UseCases } from '../../../composition-root.ts';
import type { ListNotificationsInput } from '../../../core/notification/application/list-notifications.ts';

/**
 * Shape only: which recipient to read, or none for every one of them. What a
 * notification carries is REQ-100, and it is decided in the core.
 */
const listNotificationsSchema: FastifySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { recipientId: { type: 'string' } },
  },
};

export function registerNotificationRoutes(app: FastifyInstance, useCases: UseCases): void {
  /**
   * OUT-10, REQ-102, REQ-105: the notifications of effectuated emission.
   *
   * There is no POST. A notification is not something a user sends: REQ-100
   * ties it to the registration of the policy, and offering a route that
   * produced one by hand would be a second, unrequired way of reaching a state
   * the flow owns.
   */
  app.get('/notifications', { schema: listNotificationsSchema }, async (request) => {
    return useCases.listNotifications.execute(request.query as ListNotificationsInput);
  });
}
