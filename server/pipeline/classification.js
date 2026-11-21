// Classification of a repo from its GitHub topics, otherwise from the instance's classification
// file, otherwise the default.
//
// Topic scheme: at most one of graveyard-product | graveyard-client | graveyard-experiment |
// graveyard-internal, plus graveyard-client-<slug>, graveyard-buried, graveyard-successor-<repo>.
// Archived repos are read-only on GitHub and cannot get topics, so their classification stays in
// the file. live_url never comes from topics: it is the file entry, otherwise the repo's homepage.

import { normalize } from '../config.js'

export const CATEGORIES = ['product', 'experiment', 'internal', 'client']
// Topic word -> category in the world data
export const TOPIC_CATEGORY = Object.freeze({ product: 'product', experiment: 'experiment', internal: 'internal', client: 'client' })
const CATEGORY_TOPIC = Object.fromEntries(Object.entries(TOPIC_CATEGORY).map(([t, k]) => [k, t]))
export const PREFIX = 'graveyard-'
// If several categories are set anyway, the most specific one wins
const PRIORITY = ['client', 'product', 'internal', 'experiment']

// Default for repos without topics and without a file entry
export const EMPTY_CLASSIFICATION = Object.freeze({ category: 'experiment', client: null, successor: null, buried: false, live_url: null })

/** Lower case, every character other than a-z0-9- becomes - */
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]/gu, '-')

/** Valid as a GitHub topic (check before writing) */
export const topicValid = (t) => /^[a-z0-9][a-z0-9-]{0,49}$/.test(t)

const namesCache = new WeakMap()
const WITHOUT = {}
function clientsNames(file, clients) {
  const d = file && typeof file === 'object' ? file : WITHOUT
  const k = clients && typeof clients === 'object' ? clients : WITHOUT
  let perClients = namesCache.get(d)
  if (!perClients) namesCache.set(d, (perClients = new WeakMap()))
  let m = perClients.get(k)
  if (m) return m
  m = new Map()
  for (const [s, name] of Object.entries(k)) if (typeof name === 'string') m.set(slug(s), name)
  for (const e of Object.values(d)) {
    if (e && e.client && !m.has(slug(e.client))) m.set(slug(e.client), e.client)
  }
  perClients.set(k, m)
  return m
}

// Display name for a client slug: configuration, then the classification file, then derived from the slug
function clientDisplay(s, file, clients) {
  const known = clientsNames(file, clients).get(s)
  if (known) return known
  const words = s.split('-').filter(Boolean)
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : null
}

function successorName(s, allNames) {
  if (!allNames) return s
  const names = [...allNames]
  return names.find((n) => n === s) ?? names.find((n) => slug(n) === s) ?? null
}

function fileEntry(file, name) {
  if (!file || !Object.hasOwn(file, name)) return null
  const e = file[name]
  return e && typeof e === 'object' && !Array.isArray(e) ? e : null
}

/**
 * Classification of one repo.
 * @param {string[]} topics GitHub topics of the repo
 * @param {string} name repo name
 * @param {{file?: object, allNames?: Iterable<string>, homepage?: string|null, clients?: object, config?: object}} options
 *   file = classification file, allNames = all repo names (to resolve the successor),
 *   clients = client display names by slug (default: from config)
 * @returns {{category: string, client: string|null, successor: string|null, buried: boolean, live_url: string|null}}
 */
export function classificationFromTopics(topics, name, { file = {}, allNames, homepage = null, clients, config } = {}) {
  const names = clients ?? (config ? normalize(config).clients : WITHOUT)
  const t = (topics || []).map((x) => String(x).toLowerCase()).filter((x) => x.startsWith(PREFIX)).map((x) => x.slice(PREFIX.length))
  const category = PRIORITY.find((k) => t.includes(CATEGORY_TOPIC[k]))
  const clientT = t.find((x) => x.startsWith('client-'))
  const successorT = t.find((x) => x.startsWith('successor-'))
  const buried = t.includes('buried')
  const entry = fileEntry(file, name)
  // With a file entry its live_url wins (even null), otherwise the repo's homepage
  const live_url = entry ? entry.live_url || null : homepage || null

  if (category || clientT || successorT || buried) {
    return {
      category: category ?? (clientT ? 'client' : EMPTY_CLASSIFICATION.category),
      client: clientT ? clientDisplay(clientT.slice('client-'.length), file, names) : null,
      successor: successorT ? successorName(successorT.slice('successor-'.length), allNames) : null,
      buried,
      live_url,
    }
  }
  const e = { ...EMPTY_CLASSIFICATION, ...(entry || {}) }
  return { category: e.category, client: e.client, successor: e.successor, buried: e.buried, live_url }
}

/** Topic list for a classification, for setting topics on GitHub once (writing is up to the caller) */
export function topicsFromClassification(entry) {
  const e = entry || {}
  const t = []
  if (CATEGORIES.includes(e.category)) t.push(PREFIX + CATEGORY_TOPIC[e.category])
  if (e.client) t.push(PREFIX + 'client-' + slug(e.client))
  if (e.buried) t.push(PREFIX + 'buried')
  if (e.successor) t.push(PREFIX + 'successor-' + slug(e.successor))
  return t
}
