// Multiplayer by short polling: every player reports their position about every 1.5 s and gets the
// others back, plus the shared counters so flowers and candles of others appear without reloading.

import { createHash } from 'node:crypto';
import { json, unauthorized, readBody } from '../http.js';

const clamp = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
const idFor = (email) => createHash('sha256').update(email).digest('hex').slice(0, 12);

export function presenceRoute({ config, who, storage }) {
  const figures = new Set(Object.keys(config.team));
  return {
    async POST(request) {
      const me = await who(request);
      if (!me) return unauthorized();
      if (!storage.active || me.anonymous) return json({ others: [], tribute: {} });
      const b = await readBody(request);
      if (b.gone) { await storage.leave(me.email); return json({ ok: true }); }

      const now = Date.now();
      const figure = me.figure || (figures.has(b.figure) ? b.figure : null);
      const x = clamp(b.x, -400, 400), z = clamp(b.z, -400, 400);
      if (figure && x !== null && z !== null) {
        await storage.reportPresence(me.email, {
          id: idFor(me.email), email: me.email, name: me.name, own: !!me.figure,
          figure, x, z, rot: clamp(b.rot, -100, 100) ?? 0, bow: b.bow === true, t: now,
        });
      }
      const all = await storage.allPresent();
      const old = all.filter((e) => now - e.t > 60_000).map((e) => e.email);
      if (old.length) await storage.leave(...old);
      const others = all.filter((e) => e.email !== me.email && now - e.t < 8000).map(({ email, ...rest }) => rest);
      return json({ others, tribute: await storage.allTributes() });
    },
  };
}
