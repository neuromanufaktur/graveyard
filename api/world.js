import { api } from '../server/api/index.js';
import { instance } from '../instance.js';

export function GET(request) {
  return api(instance).world.GET(request);
}
