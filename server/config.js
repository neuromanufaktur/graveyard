// Instance configuration: reads the raw object from graveyard.config.json and fills in defaults.
// Everything specific to one organisation (names, people, photos, wording, login) comes from here;
// the engine itself ships with neutral defaults only. See config.schema.json for the format.
import en from '../locales/en.json' with { type: 'json' }
import de from '../locales/de.json' with { type: 'json' }

/** Languages with a locale file (user interface) and an inscription prompt template */
export const LANGUAGES = { en, de }

export const DEFAULT_THRESHOLDS = Object.freeze({
  deadDays: 90,
  aliveDays: 30,
  zombiePauseDays: 90,
  graveTiers: Object.freeze([[5, 'cross'], [20, 'stone'], [50, 'marble']]),
})

export const DEFAULT_TONE = { en: 'dry, self-deprecating, affectionate.', de: 'trocken, selbstironisch, liebevoll, deutsch.' }

// Auth.js providers the engine knows how to wire up (environment prefix AUTH_<ID>_ID/_SECRET/_ISSUER)
export const PROVIDERS = ['microsoft-entra-id', 'github', 'google', 'gitlab']

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const text = (x, standard = '') => (typeof x === 'string' ? x : standard)

function person(id, p, withPrompt) {
  const look = isObject(p.look) ? p.look : {}
  const off = {
    id,
    name: text(p.name, id),
    role: text(p.role),
    look: { ...look },
  }
  if (typeof p.accent === 'string') off.accent = p.accent
  if (typeof p.photo === 'string') off.photo = p.photo
  if (Array.isArray(p.logins)) off.logins = p.logins.map((l) => String(l).toLowerCase())
  else off.logins = [id.toLowerCase()]
  if (withPrompt) off.prompt = text(p.prompt, off.role)
  return off
}

function people(raw, withPrompt) {
  const off = {}
  if (!isObject(raw)) return off
  for (const [id, p] of Object.entries(raw)) if (isObject(p)) off[id] = person(id, p, withPrompt)
  return off
}

function auth(raw) {
  const a = isObject(raw) ? raw : {}
  const provider = typeof a.provider === 'string' && a.provider !== 'none' ? a.provider : null
  if (provider && !PROVIDERS.includes(provider)) throw new Error(`Unknown auth provider "${provider}" (known: ${PROVIDERS.join(', ')})`)
  return {
    provider,
    label: text(a.label, provider || ''),
    domains: Array.isArray(a.allowedDomains) ? a.allowedDomains.map((d) => String(d).toLowerCase()) : [],
  }
}

/** Owner types the pipeline can read: a GitHub organisation or a GitHub user */
export const OWNER_TYPES = ['org', 'user']

// owner (organisation or user) with the deprecated alias org. ownerType null: detected via the API;
// the alias org alone stands for an organisation. includeForks null: default of the owner type
// (organisations: all repos, users: no forks).
function ownerOf(c) {
  for (const key of ['owner', 'org']) {
    if (c[key] !== undefined && typeof c[key] !== 'string') throw new Error(`config.${key} must be a string (GitHub organisation or user login)`)
  }
  if (c.owner && c.org && c.owner !== c.org) throw new Error(`config.owner ("${c.owner}") and the deprecated config.org ("${c.org}") disagree; keep only owner`)
  if (c.ownerType !== undefined && !OWNER_TYPES.includes(c.ownerType)) throw new Error(`config.ownerType must be one of ${OWNER_TYPES.join(', ')} (or left out to detect it)`)
  if (c.includeForks !== undefined && typeof c.includeForks !== 'boolean') throw new Error('config.includeForks must be true or false')
  const owner = text(c.owner) || text(c.org)
  const ownerType = c.ownerType ?? (!c.owner && c.org ? 'org' : null)
  return { owner, ownerType, includeForks: c.includeForks ?? null }
}

const cache = new WeakMap()
const done = new WeakSet()

/**
 * Normalised configuration with all defaults applied.
 * @param {object} roh content of graveyard.config.json
 */
export function normalize(raw = {}) {
  if (done.has(raw)) return raw
  if (isObject(raw) && cache.has(raw)) return cache.get(raw)
  const c = isObject(raw) ? raw : {}
  const { owner: org, ownerType, includeForks } = ownerOf(c)
  const brand = isObject(c.branding) ? c.branding : {}
  const t = isObject(c.thresholds) ? c.thresholds : {}
  const m = isObject(c.mourners) ? c.mourners : {}
  const g = isObject(c.epitaphs) ? c.epitaphs : {}
  const authors = isObject(c.authors) ? c.authors : {}
  if (c.language !== undefined && !Object.hasOwn(LANGUAGES, c.language)) throw new Error(`config.language must be one of ${Object.keys(LANGUAGES).join(', ')}`)
  const language = typeof c.language === 'string' ? c.language : 'en'
  const epitaphLanguage = typeof g.language === 'string' ? g.language : language
  const aliases = {}
  for (const [k, v] of Object.entries(isObject(authors.aliases) ? authors.aliases : {})) aliases[k.toLowerCase()] = String(v)
  const k = {
    owner: org,
    ownerType,
    includeForks,
    org, // older name of owner, kept for existing callers
    brand: text(brand.mark, org),
    title: text(brand.title, LANGUAGES[language].defaultTitle),
    language,
    team: people(c.team, false),
    mourners: {
      label: text(m.label),
      group: text(m.promptGroup),
      members: people(m.members, true),
    },
    epitaphs: {
      language: epitaphLanguage,
      project: text(g.project, ''),
      context: text(g.context, org),
      tone: text(g.tone, DEFAULT_TONE[epitaphLanguage] || DEFAULT_TONE.en),
      model: text(g.model, ''),
    },
    exclude: new Set(Array.isArray(c.exclude) ? c.exclude.map(String) : []),
    clients: isObject(c.clients) ? { ...c.clients } : {},
    familyColors: isObject(c.familyColors) ? { ...c.familyColors } : {},
    authors: { aliases, bots: Array.isArray(authors.bots) ? authors.bots.map(String) : [] },
    auth: auth(c.auth),
    storage: c.storage === 'upstash' ? 'upstash' : 'none',
    thresholds: {
      deadDays: Number.isFinite(t.deadDays) ? t.deadDays : DEFAULT_THRESHOLDS.deadDays,
      aliveDays: Number.isFinite(t.aliveDays) ? t.aliveDays : DEFAULT_THRESHOLDS.aliveDays,
      zombiePauseDays: Number.isFinite(t.zombiePauseDays) ? t.zombiePauseDays : DEFAULT_THRESHOLDS.zombiePauseDays,
      graveTiers: Array.isArray(t.graveTiers) ? t.graveTiers.map(([n, s]) => [Number(n), String(s)]) : DEFAULT_THRESHOLDS.graveTiers,
    },
  }
  if (isObject(raw)) cache.set(raw, k)
  done.add(k)
  return k
}

/** The part of the configuration the browser needs (no prompts, no logins, no exclusions). */
export function forBrowser(k) {
  const without = ({ logins, prompt, ...rest }) => rest
  return {
    org: k.org,
    brand: k.brand,
    title: k.title,
    language: k.language,
    team: Object.fromEntries(Object.entries(k.team).map(([id, p]) => [id, without(p)])),
    mourners: {
      label: k.mourners.label,
      members: Object.fromEntries(Object.entries(k.mourners.members).map(([id, p]) => [id, without(p)])),
    },
    familyColors: k.familyColors,
    thresholds: { deadDays: k.thresholds.deadDays, aliveDays: k.thresholds.aliveDays, zombiePauseDays: k.thresholds.zombiePauseDays },
    auth: !!k.auth.provider,
    multiplayer: k.storage !== 'none',
  }
}
