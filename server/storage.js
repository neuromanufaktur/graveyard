// Shared storage. Three modes:
//   upstash with credentials   Upstash Redis (KV_REST_API_* or UPSTASH_REDIS_REST_*)
//   upstash without them       in-memory store of the dev server, same commands (local development)
//   none                       no storage: no multiplayer, no shared counters, the world comes from the data files
//
// Keys:
//   world           finished world (same as data/world.json)
//   raw             hash: repo -> raw data
//   epitaphs        hash: repo -> inscription, cause of death, mourner, commit state
//   presence        hash: e-mail -> position and character (multiplayer)
//   tribute         hash: "repo|kind" -> count for everyone
//   tribute:<mail>  hash: "repo|kind" -> count for this person
//   lock:refresh, progress, pause:refresh

import { readFileSync } from 'node:fs'
import { Redis } from '@upstash/redis'
import { normalize } from './config.js'

const KINDS = ['respect', 'flower', 'candle']
export const TRIBUTE_KINDS = KINDS

function upstash() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? new Redis({ url, token, automaticDeserialization: false }) : null
}

// Stand-in for local development: same commands, kept in the dev server's memory
function memory() {
  const g = globalThis
  if (!g.__graveyardStorage) g.__graveyardStorage = { kv: new Map(), expiry: new Map() }
  const { kv, expiry } = g.__graveyardStorage
  const alive = (k) => { const t = expiry.get(k); if (t && t < Date.now()) { kv.delete(k); expiry.delete(k) } return kv.has(k) }
  const hash = (k) => { if (!alive(k)) kv.set(k, new Map()); return kv.get(k) }
  return {
    async get(k) { return alive(k) ? kv.get(k) : null },
    async set(k, v, o = {}) {
      if (o.nx && alive(k)) return null
      kv.set(k, v)
      if (o.ex) expiry.set(k, Date.now() + o.ex * 1000); else expiry.delete(k)
      return 'OK'
    },
    async del(k) { kv.delete(k); expiry.delete(k); return 1 },
    async hgetall(k) { return alive(k) ? Object.fromEntries(kv.get(k)) : null },
    async hset(k, o) { const h = hash(k); for (const [f, v] of Object.entries(o)) h.set(f, v); return 1 },
    async hincrby(k, f, n) { const h = hash(k); const v = Number(h.get(f) || 0) + n; h.set(f, String(v)); return v },
    async hdel(k, ...f) { const h = hash(k); for (const x of f) h.delete(x); return f.length },
  }
}

// No storage at all: reads find nothing, writes are dropped
const nothing = {
  async get() { return null },
  async set() { return 'OK' },
  async del() { return 0 },
  async hgetall() { return null },
  async hset() { return 0 },
  async hincrby() { return 0 },
  async hdel() { return 0 },
}

/**
 * Storage for one instance.
 * @param {{config: object, classification?: object, dataFolder: URL|string}} instance
 *   dataFolder = folder with world.json, raw.json, epitaphs.json, live.json (as file URL)
 */
export function storageFor({ config, classification = {}, dataFolder }) {
  const k = normalize(config)
  const active = k.storage !== 'none'
  let db = null
  const storage = () => {
    if (!db) db = active ? upstash() || memory() : nothing
    return db
  }

  // ---------- Starting point shipped with the deployment (last local run) ----------
  const folder = typeof dataFolder === 'string' ? new URL(dataFolder.endsWith('/') ? dataFolder : dataFolder + '/', 'file://') : dataFolder
  function file(name) {
    try { return JSON.parse(readFileSync(new URL(name, folder), 'utf8')) } catch { return null }
  }

  // If the storage fails, the village keeps running with the shipped data (without players and counters)
  async function safe(fn, fallback) {
    try { return await fn() } catch (e) { console.error('Storage unreachable:', e?.message || e); return fallback }
  }

  async function hashAsObject(key) {
    const h = (await safe(() => storage().hgetall(key), null)) || {}
    const o = {}
    for (const [f, v] of Object.entries(h)) { try { o[f] = typeof v === 'string' ? JSON.parse(v) : v } catch { /* skip broken field */ } }
    return o
  }
  async function writeHash(key, o, only) {
    const fields = {}
    for (const [f, v] of Object.entries(o)) if (!only || only.has(f)) fields[f] = JSON.stringify(v)
    // in batches so no single request gets too large
    const entries = Object.entries(fields)
    for (let i = 0; i < entries.length; i += 8) await storage().hset(key, Object.fromEntries(entries.slice(i, i + 8)))
  }

  function asCounter(h) {
    const o = {}
    for (const [f, v] of Object.entries(h || {})) {
      const i = f.lastIndexOf('|')
      const repo = f.slice(0, i), kind = f.slice(i + 1)
      if (!KINDS.includes(kind)) continue
      ;(o[repo] ||= {})[kind] = Number(v) || 0
    }
    return o
  }

  return {
    active,
    isLocal: () => active && !upstash(),
    startClassification: () => classification,
    startLive: () => file('live.json'),

    // ---------- World ----------
    async getWorld() {
      const s = await safe(() => storage().get('world'), null)
      if (s) return JSON.parse(s)
      const start = file('world.json')
      if (start && active) await safe(() => storage().set('world', JSON.stringify(start)), null)
      return start
    },
    async writeWorld(world) { await storage().set('world', JSON.stringify(world)) },

    // ---------- Raw data and inscriptions (one field per repo) ----------
    async getRaw() {
      const r = await hashAsObject('raw')
      if (Object.keys(r).length) return r
      const start = file('raw.json')
      return Object.fromEntries((start?.repos || []).map((x) => [x.name, x]))
    },
    async writeRaw(raw, only) { await writeHash('raw', raw, only) },
    async getEpitaphs() {
      const g = await hashAsObject('epitaphs')
      if (Object.keys(g).length) return g
      const start = file('epitaphs.json')
      const entries = start?.repos || start || {}
      return typeof entries === 'object' ? entries : {}
    },
    async writeEpitaphs(g, only) { await writeHash('epitaphs', g, only) },

    // ---------- Refresh: lock, progress, pause after errors ----------
    async lock(key, sec) { return (await storage().set(key, String(Date.now()), { nx: true, ex: sec })) === 'OK' },
    async locked(key) { return !!(await safe(() => storage().get(key), null)) },
    async giveFree(key) { await storage().del(key) },
    async setProgress(f) { await storage().set('progress', JSON.stringify({ ...f, t: Date.now() }), { ex: 900 }) },
    async getProgress() { const s = await storage().get('progress'); return s ? JSON.parse(s) : null },

    // ---------- Multiplayer ----------
    async reportPresence(email, entry) { await safe(() => storage().hset('presence', { [email]: JSON.stringify(entry) }), null) },
    async leave(...emails) { if (emails.length) await storage().hdel('presence', ...emails) },
    async allPresent() { return Object.values(await hashAsObject('presence')) },

    // ---------- Respect, flowers, candles ----------
    async allTributes() { return asCounter(await safe(() => storage().hgetall('tribute'), {})) },
    async tributesOf(email) { return asCounter(await safe(() => storage().hgetall(`tribute:${email}`), {})) },
    async addTribute(repo, kind, email) {
      const field = `${repo}|${kind}`
      const all = await storage().hincrby('tribute', field, 1)
      const mine = await storage().hincrby(`tribute:${email}`, field, 1)
      return { all: Number(all), mine: Number(mine) }
    },
  }
}
