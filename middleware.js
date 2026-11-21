// Gatekeeper with this deployment's sign-in configuration
import { gatekeeper } from './server/gatekeeper.js';
import { instance } from './instance.js';

export const config = { runtime: 'nodejs' };
export default gatekeeper(instance);
