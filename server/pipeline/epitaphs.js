// Inscription, cause of death and mourner comment per repo.
// A repo only gets a new inscription when it has no valid one yet or when its default branch got
// new commits. Time passing, state changes, the live check, classification, description and pushes
// to other branches trigger nothing, so the model is only called when something really happened.
// Without a writer (no API key) repos without any inscription get a plain one built from facts.
import Anthropic from '@anthropic-ai/sdk'
import { normalize } from '../config.js'
import en from './prompts/en.js'
import de from './prompts/de.js'
import {
  PY_WS_CLASS, firstChars, isoSeconds, isObject, mapParallel, pyLen, py, pyJsonList, pyStr, pyStrip,
  rawList, sha256, sortedByName, SCHEMA_VERSION,
} from './helpers.js'

export const PARALLEL = 4 // at most 4 calls at the same time
export const HAIKU = 'claude-haiku-5-5'
export const LIVING = new Set(['alive', 'sleeping', 'client_active'])
const FORBIDDEN = /[–—\u{1F000}-\u{1FAFF}☀-➿]/u
const FENCE = new RegExp(`^\`\`\`(?:json)?${PY_WS_CLASS}*|${PY_WS_CLASS}*\`\`\`$`, 'g')

/** Prompt templates per language (prompts/en.js, prompts/de.js) */
export const PROMPTS = { en, de }

/** Template set for the epitaph language of a configuration */
export function promptsFor(config) {
  const language = normalize(config).epitaphs.language
  if (!Object.hasOwn(PROMPTS, language)) throw new Error(`epitaphs.language "${language}" is not supported (${Object.keys(PROMPTS).join(', ')})`)
  return PROMPTS[language]
}

const templates = new WeakMap()
/** Prompt template with the instance's project, tone and mourners filled in */
export function templateFor(config) {
  const k = normalize(config)
  if (templates.has(k)) return templates.get(k)
  const T = promptsFor(k)
  const guests = Object.values(k.mourners.members)
  const group = k.mourners.group ? ' ' + k.mourners.group : ''
  const values = {
    project: k.epitaphs.project || T.defaultProject(k.epitaphs.context),
    tone: k.epitaphs.tone,
    format: guests.length ? T.formatWithMourners : T.formatWithoutMourners,
    mourners: guests.length ? T.mourners(group, guests.map((g) => `${g.name} (${g.prompt})`).join(', ')) : '',
  }
  const v = T.template.replace(/\{(project|tone|format|mourners)\}/g, (_, x) => values[x])
  templates.set(k, v)
  return v
}

/** Names of the mourners who may comment (empty: no mourner field) */
export const mournersOf = (config) => new Set(Object.values(normalize(config).mourners.members).map((g) => g.name))

/** Short explanation of the state for the prompt */
export function explanation(r, config) {
  const E = promptsFor(config).explanation
  const v = { days: r.days_since_push, left: r.hospice_days_left, url: py(r.live?.url), successor: py(r.successor), client: py(r.client) }
  if (r.state === 'dead' && r._cls?.buried) return E.deadByHand(v)
  return Object.hasOwn(E, r.state) ? E[r.state](v) : r.state
}

/** Repo data as the model sees it, with field names and values in the prompt language */
export function promptInput(r, config) {
  const T = promptsFor(config)
  const F = T.fields
  const raw = r._raw
  const ext = Array.isArray(raw.extensions)
    ? raw.extensions.map((e) => ({ [F.extension]: e.extension === '(none)' ? T.noExtension : e.extension, [F.count]: e.count }))
    : raw.extensions
  return {
    name: r.name, [F.description]: r.description, [F.language]: r.language,
    [F.category]: T.categories[r.category] ?? r.category, [F.client]: r.client, [F.successor]: r.successor,
    [F.created_at]: r.created_at, [F.first_commit]: r.first_commit, [F.last_push]: r.last_push,
    [F.days_since_push]: r.days_since_push, commits: r.commits,
    [F.commits_per_month]: raw.commits_per_month, [F.longest_pause_days]: raw.longest_pause_days,
    [F.active_weeks]: raw.active_weeks, [F.files]: raw.files, [F.top_folders]: raw.top_folders,
    [F.extensions]: ext, [F.authors]: raw.authors, [F.recent_commits]: raw.recent_commits,
    readme: raw.readme,
  }
}

/** Prompt for one repo from base() */
export function promptFor(r, config) {
  const T = promptsFor(config)
  const values = {
    state: T.states[r.state] ?? r.state,
    state_explanation: explanation(r, config),
    data: JSON.stringify(promptInput(r, config), null, 1),
  }
  return templateFor(config).replace(/\{(state|state_explanation|data)\}/g, (_, k) => values[k])
}

/**
 * Hash of the inputs, stored with every inscription. Kept for compatibility, it triggers nothing.
 * The state goes in under its name in the prompt language, so existing hashes stay valid.
 */
export function hashOf(r, config) {
  const parts = [r.last_push, r.commits, promptsFor(config).states[r.state] ?? r.state, r.description, sha256(r._raw.readme || '')]
  return sha256(pyJsonList(parts))
}

/**
 * Check a model answer: [fields, errors], fields only holds the valid fields.
 * @param {Set<string>} [guests] allowed mourner names; empty: the npc field is not expected
 * @param {object} [config] instance configuration (answer keys and messages follow its epitaph language)
 */
export function check(text, state, guests = new Set(), config) {
  const T = promptsFor(config)
  const A = T.answer
  const M = T.errors
  const t = pyStrip(text).replace(FENCE, '')
  let j
  try {
    j = JSON.parse(t)
  } catch (e) {
    return [{}, { json: M.json(e.message) }]
  }
  if (!isObject(j)) return [{}, { json: M.notObject }]
  const npc = isObject(j[A.npc]) ? j[A.npc] : {}
  const ins = pyStrip(pyStr(j[A.inscription]))
  let death = pyStrip(pyStr(j[A.cause_of_death]))
  const who = pyStrip(pyStr(npc[A.who]))
  const npcText = pyStrip(pyStr(npc[A.text]))
  if (LIVING.has(state)) death = ''
  const fields = {}
  const error = {}
  if (!ins || pyLen(ins) > 140) error.inscription = M.inscriptionLength(pyLen(ins))
  else if (FORBIDDEN.test(ins)) error.inscription = M.inscriptionChars
  else fields.inscription = ins
  if (pyLen(death) > 80) error.cause_of_death = M.causeLength(pyLen(death))
  else if (FORBIDDEN.test(death)) error.cause_of_death = M.causeChars
  else fields.cause_of_death = death
  if (!guests.size) { /* no mourners configured */ }
  else if (!guests.has(who)) error.npc = M.who(who, [...guests].sort().map((w) => `'${w}'`).join(', '))
  else if (!npcText || pyLen(npcText) > 100) error.npc = M.npcLength(pyLen(npcText))
  else if (FORBIDDEN.test(npcText)) error.npc = M.npcChars
  else fields.npc = { who, text: npcText }
  return [fields, error]
}

/**
 * One attempt, a second one on errors. Valid fields from both attempts are kept; whatever is
 * invalid twice stays empty.
 * @param {object} r repo from base()
 * @param {(prompt: string) => Promise<string>} write model call
 * @param {object} [config] instance configuration (project, tone, mourners, language)
 */
export async function generate(r, write, config) {
  const T = promptsFor(config)
  const prompt = promptFor(r, config)
  const guests = mournersOf(config)
  let calls = 0
  let collected = {}
  let error = {}
  for (let attempt = 0; attempt < 2; attempt++) {
    let p = prompt
    if (attempt) p += T.retry(Object.values(error).join('; '))
    let fields
    let newError
    try {
      calls++
      ;[fields, newError] = check(await write(p), r.state, guests, config)
    } catch (e) {
      fields = {}
      newError = { call: T.errors.call(firstChars(String(e?.message ?? e), 200)) }
    }
    if (!Object.keys(newError).length) {
      collected = fields
      error = {}
      break
    }
    for (const [k, v] of Object.entries(fields)) if (!(k in collected)) collected[k] = v
    error = Object.fromEntries(Object.entries(newError).filter(([k]) => !(k in collected)))
  }
  const empty = ['inscription', 'cause_of_death', ...(guests.size ? ['npc'] : [])].filter((k) => !(k in collected))
  const result = {
    inscription: collected.inscription ?? '',
    cause_of_death: collected.cause_of_death ?? '',
    npc: collected.npc ?? { who: '', text: '' },
  }
  let reason = null
  if (empty.length) {
    reason = Object.fromEntries(empty.map((k) => [k, error[k] ?? T.errors.invalid]))
    if (error.call) reason.call = error.call
  }
  return { result, calls, reason }
}

/** Commit state of a raw data entry, stored with every inscription */
export const commitState = (raw) => ({
  commits: raw?.commits ?? 0,
  last_commit: raw?.last_commit ?? null,
  head_sha: raw?.head_sha ?? null,
})

function sameState(a, b) {
  if (a.head_sha && b.head_sha) return a.head_sha === b.head_sha
  return a.commits === b.commits && a.last_commit === b.last_commit
}

/**
 * Does the inscription have to be written again?
 * @param {object|undefined} entry previous entry from epitaphs.json
 * @param {object} rawNow current raw data entry
 * @param {object|undefined} rawBefore raw data entry before this run (for entries without a stored
 *   commit state; if that is missing too, a last commit after `generated_at` counts as new)
 */
export function needsNewEpitaph(entry, rawNow, rawBefore) {
  if (!entry || !entry.inscription || entry.hash == null) return { due: true, reason: 'no valid epitaph' }
  const now = commitState(rawNow)
  const outcome = (same) => (same ? { due: false, reason: null } : { due: true, reason: 'new commits' })
  if ('commits' in entry) return outcome(sameState(commitState(entry), now))
  if (rawBefore) return outcome(sameState(commitState(rawBefore), now))
  // no old raw data either: new only if the last commit is younger than the inscription
  if (entry.generated_at) return outcome(!now.last_commit || Date.parse(now.last_commit) <= Date.parse(entry.generated_at))
  return { due: true, reason: 'no commit state' }
}

const yearOf = (iso) => (iso ? String(iso).slice(0, 4) : '')

/**
 * Plain inscription from facts, used when no model is available.
 * @param {object} r repo from base()
 * @param {object} [config] instance configuration (language of the text)
 * @returns {{inscription: string, cause_of_death: string, npc: {who: string, text: string}}}
 */
export function factsEpitaph(r, config) {
  const F = promptsFor(config).facts
  const from = yearOf(r.first_commit || r.created_at)
  const to = yearOf(r.last_push)
  const time = from && to && from !== to ? F.span(from, to) : from || to
  const v = { name: r.name, commits: F.commits(r.commits), successor: r.successor, client: r.client, days: r.days_since_push, time, from }
  let inscription
  let cause_of_death = ''
  switch (r.state) {
    case 'ancestor': inscription = F.ancestor(v); break
    case 'buried': inscription = F.buried(v); cause_of_death = F.buriedCause(v); break
    case 'dead': inscription = F.dead(v); cause_of_death = r._cls?.buried ? F.deadByHandCause(v) : F.deadCause(v); break
    case 'hospice': inscription = F.hospice(v); cause_of_death = F.hospiceCause(v); break
    case 'delivered': inscription = F.delivered(v); break
    default: inscription = F.other(v)
  }
  return { inscription: firstChars(inscription, 140), cause_of_death: firstChars(cause_of_death, 80), npc: { who: '', text: '' } }
}

/**
 * Inscriptions for all repos: keep what is still valid, write the rest via write().
 * Errors for a single repo do not abort the run; the old entry then stays.
 * @param {{repos: object[], before?: object, beforeRaw?: object, write?: Function|null,
 *   now: Date|string, parallel?: number, progress?: Function, config?: object}} input
 *   repos = base(), before = previous epitaphs.json, beforeRaw = raw.json before this run
 */
export async function updateEpitaphs({ repos, before, beforeRaw, write, now, parallel = PARALLEL, progress, config }) {
  const old = isObject(before?.repos) ? before.repos : before || {}
  const rawOld = new Map(rawList(beforeRaw).map((r) => [r.name, r]))
  const as_of = isoSeconds(now)
  const entries = {}
  const open = []
  for (const r of repos) {
    const a = old[r.name]
    const e = needsNewEpitaph(a, r._raw, rawOld.get(r.name))
    if (e.due) open.push({ r, reason: e.reason })
    else entries[r.name] = { ...a, ...commitState(r._raw) }
  }
  // Due but not rewritten: the old entry stays and stays due. Without its own commit state the
  // next run would compare against the then-new raw data and wrongly conclude "unchanged".
  const staysDue = (a) => ('commits' in a ? a : { ...a, commits: null, last_commit: null, head_sha: null })
  const report = (done, text) => progress?.({ step: 'epitaphs', done, total: open.length, text })
  let calls = 0
  const error = {}
  const written = []
  const withoutWriter = []
  const facts = []
  if (open.length && !write) {
    for (const { r } of open) {
      if (old[r.name]?.inscription) entries[r.name] = staysDue(old[r.name])
      else {
        // nothing to keep: plain facts, without hash so a model rewrites it once one is available
        entries[r.name] = { ...factsEpitaph(r, config), hash: null, state: r.state, generated_at: as_of, source: 'facts', ...commitState(r._raw) }
        facts.push(r.name)
      }
      withoutWriter.push(r.name)
    }
    report(0, `${open.length} epitaphs would be new; without a key the old ones stay.`)
  } else {
    report(0, open.length ? `Writing ${open.length} epitaphs.` : 'All epitaphs are up to date.')
    let done = 0
    await mapParallel(open, parallel, async ({ r }) => {
      const { result, calls: n, reason } = await generate(r, write, config)
      calls += n
      if (!result.inscription && old[r.name]) {
        entries[r.name] = staysDue(old[r.name]) // nothing usable came back: old entry stays, next run tries again
        error[r.name] = reason
      } else {
        const entry = { ...result, hash: result.inscription ? hashOf(r, config) : null, state: r.state, generated_at: as_of, ...commitState(r._raw) }
        if (reason) {
          entry.empty_fields = reason
          error[r.name] = reason
        }
        entries[r.name] = entry
        if (result.inscription) written.push(r.name)
      }
      done++
      report(done, `Epitaph for ${r.name} written.`)
    })
  }
  return {
    file: { schema_version: SCHEMA_VERSION, as_of, repos: sortedByName(entries) },
    calls,
    written: written.sort(),
    open: open.map(({ r, reason }) => ({ name: r.name, reason })),
    without_writer: withoutWriter,
    facts: facts.sort(),
    error,
  }
}

/**
 * Default writer via the Claude API (Haiku by default). Returns the text of the answer.
 */
export function claudeWriter({ apiKey, model = HAIKU, effort = 'low', maxTokens = 16000, timeoutMs = 60_000, fetch } = {}) {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2, ...(fetch ? { fetch } : {}) })
  return async (prompt) => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      output_config: { effort },
      messages: [{ role: 'user', content: prompt }],
    })
    if (response.stop_reason === 'refusal') {
      throw new Error(`Claude refused (${response.stop_details?.category ?? 'no category'})`)
    }
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
}

/** Writer from the environment: Claude with ANTHROPIC_API_KEY, otherwise none (facts only) */
export function writerFromEnv(config, env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null
  return claudeWriter({ apiKey: env.ANTHROPIC_API_KEY, model: normalize(config).epitaphs.model || HAIKU })
}
