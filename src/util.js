// Small helpers: seeded randomness, noise, formatting, states and colours.

import config from './config.js';
import { t, NUMBER_LOCALE } from './i18n.js';

export function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function h2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}


export function formatDate(iso, short = false) {
  if (!iso) return t('date.unknown');
  const d = new Date(iso);
  if (isNaN(d)) return t('date.unknown');
  const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  if (short) return t('date.short', { d: dd, m: mm, y: d.getFullYear() });
  return t('date.long', { d: d.getDate(), month: t('months')[d.getMonth()], y: d.getFullYear() });
}
export function year(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : String(d.getFullYear());
}

export function daysAgo(n) {
  if (n == null) return '';
  if (n <= 0) return t('ago.today');
  if (n === 1) return t('ago.yesterday');
  if (n < 45) return t('ago.days', { n });
  if (n < 365) return t('ago.months', { n: Math.round(n / 30) });
  const j = n / 365;
  return j < 1.5 ? t('ago.oneYear') : t('ago.years', { n: Math.round(j) });
}

export function formatNumber(n) {
  return n == null ? '0' : n.toLocaleString(NUMBER_LOCALE);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// stone colour per language, muted so the graveyard stays calm
const LANGUAGE = {
  TypeScript: '#8b95a6', JavaScript: '#a89d86', Python: '#8f988a', HCL: '#968fa6',
  Shell: '#85878c', Lua: '#8790a8', Go: '#8aa0a4', Rust: '#a08e84', HTML: '#a8948a',
  CSS: '#8d90aa', Swift: '#a8927f', Java: '#9e977f', PHP: '#8f8ca2',
};
export function stoneColor(language) {
  return LANGUAGE[language] || '#8e9096';
}

// window light per product family (prefix of the repo name -> colour, from the configuration)
const FAMILY_COLORS = config.familyColors || {};
export function family(name) {
  const n = name.toLowerCase();
  for (const k of Object.keys(FAMILY_COLORS).sort((a, b) => b.length - a.length)) {
    if (n === k || n.startsWith(k + '-') || n.startsWith(k + '.') || n.startsWith(k + '_')) return k;
  }
  return n.split(/[-._]/)[0];
}
// windows stay golden, the product colour only tints them slightly
const WARM = [1.0, 0.71, 0.37];
export function windowLight(name) {
  const hex = FAMILY_COLORS[family(name)];
  if (!hex) return '#ffb45e';
  const p = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const m = p.map((v, i) => Math.round((WARM[i] * 0.62 + v * 0.38) * 255));
  return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const state = (k, zone, sentence) => ({ title: t(`states.${k}.title`), zone: t('places.' + zone), sentence });
export const STATES = {
  alive: state('alive', 'village', (r) => t('states.alive.sentence', { ago: daysAgo(r.days_since_push) })),
  sleeping: state('sleeping', 'village', (r) => t('states.sleeping.sentence', { days: r.days_since_push })),
  client_active: state('client_active', 'clients', (r) => t('states.client_active.sentence', { ago: daysAgo(r.days_since_push) })),
  delivered: state('delivered', 'clients', (r) => t('states.delivered.sentence', { days: r.days_since_push })),
  hospice: state('hospice', 'hospice', (r) => t('states.hospice.sentence', { n: r.hospice_days_left })),
  dead: state('dead', 'graveyard', (r) => t('states.dead.sentence', { days: r.days_since_push })),
  buried: state('buried', 'graveyard', () => t('states.buried.sentence')),
  ancestor: state('ancestor', 'village', (r) => t('states.ancestor.sentence', { successor: r.successor })),
};

// point colours per state: legend, map, tooltip
export const DOT = {
  alive: '#ffb35c',
  sleeping: '#c9a26a',
  client_active: '#7fb6ff',
  delivered: '#c79a62',
  hospice: '#ff7a6a',
  dead: '#9aa0aa',
  buried: '#c9c2b4',
  ancestor: '#b3a4ff',
  zombie: '#a6e07a',
};

export function isZombie(r) {
  return !!r.resurrected_at && ['alive', 'sleeping', 'hospice', 'client_active'].includes(r.state);
}

export const LIVING = new Set(['alive', 'sleeping']);
export const DEAD = new Set(['dead', 'buried']);
