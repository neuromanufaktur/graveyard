// Combines raw data, classification, live check and inscriptions into the world. base() returns
// the repos with their state but without inscriptions; epitaphs.js uses it so both compute
// the same state.
import { normalize, DEFAULT_THRESHOLDS } from '../config.js'
import { classificationFromTopics } from './classification.js'
import { asDate, isoSeconds, isObject, rawList, daysBetween, SCHEMA_VERSION } from './helpers.js'

// Defaults; an instance can change them under thresholds in its configuration
export const DEAD_DAYS = DEFAULT_THRESHOLDS.deadDays // days without a push: dead
export const ALIVE_LIMIT = DEFAULT_THRESHOLDS.aliveDays // days without a push: still alive, chimney smokes
export const ZOMBIE_PAUSE = DEFAULT_THRESHOLDS.zombiePauseDays // pause after which new commits count as a resurrection
export const GRAVE_TIERS = DEFAULT_THRESHOLDS.graveTiers // below n commits; above the last tier: mausoleum

/**
 * State of a repo in the village.
 * Order: buried by hand > archived (with successor: ancestral vault) > client project
 * (active or delivered) > alive > asleep (site is live) > hospice > dead.
 */
export function state(r, cls, liveOk, days, thresholds = DEFAULT_THRESHOLDS) {
  if (cls.buried) return 'dead'
  if (r.archived && cls.successor) return 'ancestor'
  if (r.archived) return 'buried'
  if (cls.category === 'client') return days < thresholds.deadDays ? 'client_active' : 'delivered'
  if (days < thresholds.aliveDays) return 'alive'
  if (liveOk) return 'sleeping'
  if (days < thresholds.deadDays) return 'hospice'
  return 'dead'
}

export function grave_tier(commits, tiers = GRAVE_TIERS) {
  for (const [limit, tier] of tiers) if (commits < limit) return tier
  return 'mausoleum'
}

/** First commit after the last pause of at least `pause` days between two commits */
export function resurrectedAt(commitData, pause = ZOMBIE_PAUSE) {
  let hit = null
  for (let i = 1; i < commitData.length; i++) {
    if (daysBetween(commitData[i - 1], commitData[i]) >= pause) hit = commitData[i]
  }
  return hit ? asDate(hit).toISOString().slice(0, 10) : null
}

const liveMap = (live) => (isObject(live?.live) ? live.live : live || {})

/**
 * Repos with state, without inscriptions. _roh (raw data) and _ein (classification) are internal.
 * @param {{raw: object, classificationFile?: object, live?: object, now: Date|string, config?: object}} input
 *   raw = content of raw.json, live = content of live.json (or just its live object)
 */
export function base({ raw, classificationFile = {}, live, now, config }) {
  const k = normalize(config)
  const s = k.thresholds
  const today = asDate(now)
  const results = liveMap(live)
  const reposRaw = rawList(raw).filter((r) => !k.exclude.has(r.name))
  const names = new Set(reposRaw.map((r) => r.name))
  return reposRaw.map((r) => {
    const cls = classificationFromTopics(r.topics, r.name, { file: classificationFile, allNames: names, homepage: r.homepage, clients: k.clients })
    if (cls.successor && !names.has(cls.successor)) cls.successor = null
    const lv = results[r.name]
    const liveOk = Boolean(lv && lv.ok)
    const days = r.last_push ? daysBetween(r.last_push, today) : 9999
    const z = state(r, cls, liveOk, days, s)
    return {
      name: r.name,
      description: r.description,
      language: r.language,
      category: cls.category,
      client: cls.client,
      successor: cls.successor,
      created_at: r.created_at,
      first_commit: r.first_commit,
      last_commit: r.last_commit,
      last_push: r.last_push,
      days_since_push: days,
      commits: r.commits,
      files: r.files,
      authors: r.authors.slice(0, 3).map((a) => a.name),
      last_words: r.last_words,
      archived: r.archived,
      live: cls.live_url ? { url: cls.live_url, ok: liveOk } : null,
      state: z,
      hospice_days_left: z === 'hospice' ? s.deadDays - days : null,
      grave_tier: grave_tier(r.commits, s.graveTiers),
      resurrected_at: resurrectedAt(r.commit_dates, s.zombiePauseDays),
      commits_per_month: r.commits_per_month,
      _raw: r,
      _cls: cls,
    }
  })
}

/**
 * The world as the game loads it (world.json).
 * @param {{raw: object, classificationFile?: object, live?: object, epitaphs?: object, now: Date|string, config?: object}} input
 */
export function prepare({ raw, classificationFile = {}, live, epitaphs, now, config }) {
  const byName = isObject(epitaphs?.repos) ? epitaphs.repos : epitaphs || {}
  const repos = base({ raw, classificationFile, live, now, config }).map(({ _raw, _cls, ...r }) => {
    const g = byName[r.name] || {}
    const npc = g.npc || {}
    return {
      ...r,
      inscription: g.inscription || '',
      cause_of_death: g.cause_of_death || '',
      npc: { who: npc.who || '', text: npc.text || '' },
    }
  })
  return { schema_version: SCHEMA_VERSION, as_of: isoSeconds(now), repos }
}
