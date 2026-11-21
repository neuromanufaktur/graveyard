import { api } from '../server/api/index.js';
import { instance } from '../instance.js';

export function POST(request) {
  return api(instance).tribute.POST(request);
}
