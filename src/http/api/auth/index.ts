import type { FastifyPluginAsync } from 'fastify';
import { loginRoute } from './login/login.controller.js';
import { logoutRoute } from './logout/logout.controller.js';
import { meRoute } from './me/me.controller.js';
import { refreshRoute } from './refresh/refresh.controller.js';
import { registerRoute } from './register/register.controller.js';

/** Auth routes. Register/login/refresh/logout are public; /me is bearer-authenticated per-route. */
export const authRoutes: FastifyPluginAsync = async (app) => {
  await app.register(registerRoute);
  await app.register(loginRoute);
  await app.register(refreshRoute);
  await app.register(logoutRoute);
  await app.register(meRoute);
};
