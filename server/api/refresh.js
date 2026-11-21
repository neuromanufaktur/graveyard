// Refresh on open, at most every 24 h. Answers as a stream of JSON lines so the game can show a
// real progress bar. If a refresh is already running (someone else opened the page first), its
// progress is passed through instead of starting a second run.

import { json, unauthorized, isStale } from '../http.js';

const LOCK = 'lock:refresh';
const PAUSE = 'pause:refresh';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function refreshRoute({ config, who, storage }) {
  return {
    async POST(request) {
      const me = await who(request);
      if (!me) return unauthorized();
      const world = await storage.getWorld();
      if (!storage.active) return json({ done: true, as_of: world?.as_of, updated: false, reason: 'no storage' });
      if (!process.env.GITHUB_TOKEN) return json({ done: true, as_of: world?.as_of, updated: false, reason: 'no token' });
      if (!(await storage.locked(LOCK)) && (!isStale(world) || (await storage.locked(PAUSE)))) {
        return json({ done: true, as_of: world?.as_of, updated: false });
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(ctrl) {
          const send = (o) => { try { ctrl.enqueue(encoder.encode(JSON.stringify(o) + '\n')); } catch { /* connection gone */ } };
          if (!(await storage.lock(LOCK, 300))) {
            // someone else is refreshing: follow along until the lock is released
            for (let i = 0; i < 290 && (await storage.locked(LOCK)); i++) {
              const f = await storage.getProgress();
              if (f && !f.done) send(f);
              await wait(1000);
            }
            send({ done: true, as_of: (await storage.getWorld())?.as_of });
            ctrl.close();
            return;
          }
          try {
            const { refresh } = await import('../pipeline/refresh.js');
            const { writerFromEnv } = await import('../pipeline/epitaphs.js');
            const [rawBefore, graveBefore] = await Promise.all([storage.getRaw(), storage.getEpitaphs()]);
            let last = 0;
            const result = await refresh({
              config,
              token: process.env.GITHUB_TOKEN,
              write: writerFromEnv(config),
              before: { raw: Object.values(rawBefore), epitaphs: { repos: graveBefore } },
              classificationFile: storage.startClassification(),
              liveFile: storage.startLive(),
              now: new Date(),
              progress: (f) => {
                // The pipeline counts done/total; in the stream "done: true" means the end, hence i/n
                const z = { step: f.step, i: f.done, n: f.total };
                send(z);
                if (Date.now() - last > 700) { last = Date.now(); storage.setProgress(z).catch(() => {}); }
              },
            });
            await storage.writeRaw(Object.fromEntries(result.raw.repos.map((r) => [r.name, r])));
            await storage.writeEpitaphs(result.epitaphs.repos);
            await storage.writeWorld(result.world);
            console.log('Refresh', JSON.stringify(result.stats));
            send({ done: true, as_of: result.world.as_of, stats: result.stats });
          } catch (e) {
            console.error('Refresh failed', e);
            await storage.lock(PAUSE, 3600); // one hour of rest so not every visit fails again
            send({ done: true, error: 'refreshFailed', as_of: world?.as_of });
          } finally {
            await storage.setProgress({ done: true }).catch(() => {});
            await storage.giveFree(LOCK);
            ctrl.close();
          }
        },
      });
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
    },
  };
}
