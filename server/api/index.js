// All API routes of one instance. Every route asks for the session itself,
// even though the middleware already did.
import { auth } from '../auth.js';
import { normalize } from '../config.js';
import { storageFor } from '../storage.js';
import { refreshRoute } from './refresh.js';
import { presenceRoute } from './presence.js';
import { tributeRoute } from './tribute.js';
import { worldRoute } from './world.js';

const cache = new WeakMap();

/**
 * @param {{config: object, classification?: object, dataFolder: URL}} instance
 * @returns {{world: {GET: Function}, presence: {POST: Function}, tribute: {POST: Function}, refresh: {POST: Function}}}
 */
export function api(instance) {
  if (cache.has(instance)) return cache.get(instance);
  const config = normalize(instance.config);
  const a = auth(config);
  const ctx = { config, who: (request) => a.session(request), storage: storageFor({ ...instance, config }) };
  const routes = { world: worldRoute(ctx), presence: presenceRoute(ctx), tribute: tributeRoute(ctx), refresh: refreshRoute(ctx) };
  cache.set(instance, routes);
  return routes;
}
