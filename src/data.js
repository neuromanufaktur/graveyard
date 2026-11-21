// Load the data and prepare it for the world: families, zombies, pairs of product and landing page.

import { family, isZombie, LIVING, DEAD } from './util.js';
import { t } from './i18n.js';

// The world comes from /api/world (signed in only). If it is older than 24 h it is surveyed again
// first; `report(share, text)` drives the loading bar. Without the API (vite preview) the file stays.
export async function loadData(report = () => {}) {
  let response;
  try { response = await fetch('/api/world', { cache: 'no-store' }); } catch { response = null; }
  if (response?.status === 401) {
    location.replace('/login');
    return new Promise(() => {});
  }
  if (response?.ok) {
    let world = await response.json();
    let updated = false;
    if (world.stale) {
      const result = await refresh(report);
      if (!result.error) {
        const second = await fetch('/api/world', { cache: 'no-store' }).catch(() => null);
        if (second?.ok) { world = await second.json(); updated = true; }
      } else report(1, t('loading.' + result.error));
    }
    return { world, updated, api: true };
  }
  for (const url of ['/data/world.json', '/data/example.json']) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return { world: await r.json(), example: url.includes('example'), api: false };
    } catch { /* next source */ }
  }
  throw new Error('No data found');
}

// Reads the refresh stream (one JSON line per step) and translates it for the loading bar
async function refresh(report) {
  report(0, t('loading.surveying'));
  let r;
  try { r = await fetch('/api/refresh', { method: 'POST', cache: 'no-store' }); } catch { return { error: 'offline' }; }
  if (!r.ok || !r.body) return { error: 'refreshFailed' };
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let rest = '', last = {};
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    let i;
    while ((i = rest.indexOf('\n')) >= 0) {
      const row = rest.slice(0, i).trim();
      rest = rest.slice(i + 1);
      if (!row) continue;
      try { last = JSON.parse(row); } catch { continue; }
      if (!last.done) report(shareOf(last), textOf(last));
    }
  }
  if (rest.trim()) { try { last = JSON.parse(rest); } catch { /* incomplete */ } }
  return last;
}

// Steps of the chain (server/pipeline/refresh.js) with their section of the bar
const SECTIONS = { repos: [0, 0.05], commits: [0.05, 0.6], live: [0.6, 0.75], epitaphs: [0.75, 0.95], world: [0.95, 1] };
let highest = 0;
function shareOf(f) {
  const [from, to] = SECTIONS[f.step] || [highest, highest];
  const part = f.n ? Math.min(1, (f.i || 0) / f.n) : 0;
  highest = Math.max(highest, from + (to - from) * part);
  return highest;
}
function textOf(f) {
  const suffix = f.n > 1 ? ' · ' + t('loading.count', { i: f.i || 0, n: f.n }) : '';
  if (f.step === 'epitaphs') return t('loading.epitaphs') + suffix;
  if (f.step === 'live') return t('loading.live');
  if (f.step === 'world') return t('loading.world');
  return t('loading.surveying') + suffix;
}

const LANDING = /(-landingpage|-landing|\.de)$/;
function stem(name) {
  return name.toLowerCase().replace(/(-landingpage|-landing|\.de|\.ai)$/, '').replace(/-app$/, '');
}

export function prepareWorld(world) {
  const repos = world.repos.map((r) => ({ ...r, family: family(r.name), zombie: isZombie(r) }));

  // Pairs: a product and its landing page repo share one place
  // when both are alive or both are dead.
  const groups = new Map();
  for (const r of repos) {
    const k = stem(r.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const g of groups.values()) {
    if (g.length !== 2) continue;
    const [a, b] = g;
    const la = LANDING.test(a.name), lb = LANDING.test(b.name);
    if (la === lb) continue;
    const main = la ? b : a, partner = la ? a : b;
    const same = (LIVING.has(main.state) && LIVING.has(partner.state)) || (DEAD.has(main.state) && DEAD.has(partner.state));
    if (!same) continue;
    main.partner = partner;
    partner.partOf = main;
  }

  const as_of = world.as_of ? new Date(world.as_of) : new Date();
  return { repos, as_of, byName: new Map(repos.map((r) => [r.name, r])) };
}

// Count for the legend: every repo exactly once
export function countStates(repos) {
  const z = {};
  for (const r of repos) z[r.state] = (z[r.state] || 0) + 1;
  z.zombie = repos.filter((r) => r.zombie).length;
  return z;
}
