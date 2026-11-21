// Pay respect, leave a flower, light a candle: counted for everyone and per person.

import { json, unauthorized, readBody } from '../http.js';
import { TRIBUTE_KINDS } from '../storage.js';

export function tributeRoute({ who, storage }) {
  return {
    async POST(request) {
      const me = await who(request);
      if (!me) return unauthorized();
      if (!storage.active) return json({ error: 'Nothing is counted without storage.' }, 404);
      const { repo, kind } = await readBody(request);
      if (!TRIBUTE_KINDS.includes(kind) || typeof repo !== 'string' || repo.length > 140) return json({ error: 'Unknown.' }, 400);
      const world = await storage.getWorld();
      // Ancestral vault: "vault:<successor>", the successor does not have to stand in the village itself
      const vault = repo.startsWith('vault:') ? repo.slice(6) : null;
      const known = world?.repos?.some((r) => (vault ? r.successor === vault || r.name === vault : r.name === repo));
      if (!known) return json({ error: 'Unknown repo.' }, 400);
      const n = await storage.addTribute(repo, kind, me.email);
      return json({ ...n, tribute: await storage.allTributes() });
    },
  };
}
