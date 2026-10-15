import type { FastifyPluginAsync } from 'fastify';
import { archiveIcpRoute } from './archive-icp/archive-icp.controller.js';
import { createIcpRoute } from './create-icp/create-icp.controller.js';
import { getIcpRoute } from './get-icp/get-icp.controller.js';
import { listIcpsRoute } from './list-icps/list-icps.controller.js';
import { updateIcpRoute } from './update-icp/update-icp.controller.js';

export const icpsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listIcpsRoute);
  await app.register(getIcpRoute);
  await app.register(createIcpRoute);
  await app.register(updateIcpRoute);
  await app.register(archiveIcpRoute);
};
