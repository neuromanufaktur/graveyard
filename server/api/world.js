// The world for the game, plus who is asking and what everyone left in respect, flowers and candles.
// `stale` tells the game to start a refresh before building the world (at most every 24 h).

import { json, unauthorized, isStale } from '../http.js';

export function worldRoute({ who, storage }) {
  return {
    async GET(request) {
      const me = await who(request);
      if (!me) return unauthorized();
      const [world, tribute, mine, pause, running] = await Promise.all([
        storage.getWorld(), storage.allTributes(), storage.tributesOf(me.email),
        storage.locked('pause:refresh'), storage.locked('lock:refresh'),
      ]);
      if (!world) return json({ error: 'No data yet.' }, 503);
      // Refreshing needs a token and somewhere to keep the result
      const can = !!process.env.GITHUB_TOKEN && storage.active;
      return json({ ...world, me: me.anonymous ? null : me, tribute, mine, stale: running || (can && !pause && isStale(world)) });
    },
  };
}
