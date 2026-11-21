// The whole pipeline in one call: read GitHub, live check, inscriptions, build the world.
// Pure module: no storage, no system clock (now comes from the caller).
import { normalize } from '../config.js'
import { base, prepare } from './prepare.js'
import { classificationFromTopics } from './classification.js'
import { updateEpitaphs } from './epitaphs.js'
import { isoSeconds, SCHEMA_VERSION } from './helpers.js'
import { liveChecks } from './live.js'
import { collect } from './collect.js'

/**
 * @param {object} input
 * @param {object} input.config instance configuration (raw or normalised)
 * @param {string} input.token GitHub token (read-only is enough)
 * @param {((prompt: string) => Promise<string>)|null} input.write model call; without one, existing inscriptions stay
 * @param {{raw?: object, epitaphs?: object}} input.before state of the last run (format of raw.json, epitaphs.json)
 * @param {object} input.classificationFile classification file of the instance
 * @param {object} [input.liveFile] content of live.json; only used with liveCheck: false
 * @param {boolean} [input.liveCheck=true] false: skip the live check and use liveFile
 * @param {Date|string} input.now time of the run
 * @param {(f: {step: string, done: number, total: number, text: string}) => void} [input.progress]
 *   step: repos | commits | live | epitaphs | world
 * @param {Function} [input.fetch] for tests
 * @returns {Promise<{world: object, raw: object, epitaphs: object, live: object, stats: object}>}
 */
export async function refresh({
  config, token, write = null, before = {}, classificationFile = {}, liveFile = null, liveCheck = true, now, progress, fetch,
}) {
  if (!now) throw new Error('now is missing')
  const k = normalize(config)
  const start = performance.now()
  const as_of = isoSeconds(now)
  const report = (f) => progress?.(f)

  // 1 and 2: list repos, fetch commits
  const s = await collect({ config: k, token, before: before.raw, progress: report, fetch })
  const raw = { schema_version: SCHEMA_VERSION, as_of, org: k.owner, repos: s.repos } // org: login of the owner (organisation or user)

  // 3: live check for every repo with a live address
  const allNames = new Set(s.repos.map((r) => r.name))
  const urls = {}
  for (const r of s.repos) {
    const cls = classificationFromTopics(r.topics, r.name, { file: classificationFile, allNames, homepage: r.homepage, clients: k.clients })
    if (cls.live_url) urls[r.name] = cls.live_url
  }
  let live
  if (liveCheck) {
    live = { schema_version: SCHEMA_VERSION, as_of, live: await liveChecks(urls, { fetch, progress: report }) }
  } else {
    live = liveFile || { schema_version: SCHEMA_VERSION, as_of: null, live: {} }
    report({ step: 'live', done: 0, total: 0, text: 'Live check skipped.' })
  }

  // 4: inscriptions only for repos without a valid one or with new commits
  const g = await updateEpitaphs({
    config: k,
    repos: base({ raw, classificationFile, live, now, config: k }),
    before: before.epitaphs,
    beforeRaw: before.raw,
    write,
    now,
    progress: report,
  })

  // 5: build the world
  report({ step: 'world', done: 0, total: 1, text: 'Building the world.' })
  const world = prepare({ raw, classificationFile, live, epitaphs: g.file, now, config: k })
  report({ step: 'world', done: 1, total: 1, text: `World with ${world.repos.length} repos done.` })

  const results = Object.values(live.live || {})
  return {
    world,
    raw,
    epitaphs: g.file,
    live,
    stats: {
      repos: s.repos.length,
      github_requests: s.requests,
      fetched: s.fetched,
      fetched_full: s.full.length,
      fetched_incremental: s.incremental.length,
      unchanged: s.unchanged,
      github_error: s.error,
      live_checked: liveCheck ? results.length : 0,
      live_ok: results.filter((e) => e.ok).length,
      haiku_calls: g.calls,
      epitaphs_new: g.written,
      epitaphs_pending: g.open,
      epitaphs_without_writer: g.without_writer,
      epitaphs_facts: g.facts,
      epitaphs_error: g.error,
      duration_ms: Math.round(performance.now() - start),
    },
  }
}
