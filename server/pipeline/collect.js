// Raw data for every repo of a GitHub organisation or user, read-only.
// GraphQL lists the repos with metadata and head SHA (the commit count is only requested for
// changed repos because it makes the listing several seconds slower); REST fetches commits, tree
// and README. A repo is only read again when the head SHA of its default branch changed or it is
// new. Then only the commits since the last known head are fetched; if the old head is no longer
// where it is expected (force push, merge of older commits), everything is read again.
import { normalize } from '../config.js'
import { limiter, firstChars, mapParallel, rawList, sleep as wait, utcIso, pyCompare } from './helpers.js'

export const RAW_VERSION = 1 // bump when fields change: every repo is then read once more
const API = 'https://api.github.com'
const PAGE = 100

const BOT_PATTERN = '\\[bot\\]|dependabot|github-actions|renovate|vercel|semantic-release'

/** Author rules from the configuration: bot pattern (plus configured extras) and name aliases (keys lower case) */
export function authorRules(config) {
  const k = normalize(config)
  return { bot: new RegExp([BOT_PATTERN, ...k.authors.bots].join('|'), 'i'), alias: k.authors.aliases }
}
const STANDARD_RULES = authorRules({})

export class RateLimitError extends Error {
  constructor(message, waitMs) {
    super(message)
    this.name = 'RateLimitError'
    this.waitMs = waitMs
  }
}

export class GithubError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'GithubError'
    this.status = status
  }
}

// ---------- GitHub access ----------

// Wait time for rate-limit answers, otherwise null. Time reference is GitHub's Date header.
function rateLimitWait(status, headers, text) {
  if (status !== 403 && status !== 429) return null
  const ra = headers.get('retry-after')
  if (ra !== null && ra !== '' && !Number.isNaN(Number(ra))) return Math.max(0, Number(ra)) * 1000
  const reset = Number(headers.get('x-ratelimit-reset'))
  if (headers.get('x-ratelimit-remaining') === '0' && reset) {
    const server = Date.parse(headers.get('date') || '')
    return Number.isNaN(server) ? 60_000 : Math.max(0, reset * 1000 - server) + 1000
  }
  if (/rate limit/i.test(text)) return 60_000 // secondary limit without a hint: GitHub recommends one minute
  return null
}

/**
 * Small GitHub client with a concurrency limit, retries on 5xx and rate-limit handling.
 * Counts every HTTP request in counter.requests.
 * @param {{token: string, owner?: string, ownerType?: 'org'|'user'|null, org?: string, fetch?: Function, parallel?: number,
 *   maxWaitMs?: number, sleep?: Function, timeoutMs?: number}} options
 *   owner = login of the organisation or user (org: older name, implies ownerType 'org'),
 *   ownerType null: detected on the first listing
 */
export function githubClient({
  token, owner, ownerType, org = '', fetch: f = globalThis.fetch, parallel = 6, maxWaitMs = 60_000, sleep = wait, timeoutMs = 30_000,
} = {}) {
  if (!token) throw new Error('GitHub token missing')
  const run = limiter(parallel)
  const counter = { requests: 0, rest: 0, graphql: 0 }
  const head = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'graveyard-pipeline',
  }

  async function send(url, init = {}) {
    for (let attempt = 0; ; attempt++) {
      let response
      try {
        response = await run(async () => {
          counter.requests++
          const res = await f(url, { ...init, headers: { ...head, ...init.headers }, signal: AbortSignal.timeout(timeoutMs) })
          return { status: res.status, headers: res.headers, text: await res.text() }
        })
      } catch (e) {
        if (attempt < 2) {
          await sleep(1000 * (attempt + 1))
          continue
        }
        throw new GithubError(`GitHub unreachable: ${e?.cause?.code || e?.name}: ${e?.message}`, null)
      }
      const w = rateLimitWait(response.status, response.headers, response.text)
      if (w !== null) {
        if (w > maxWaitMs || attempt >= 3) {
          throw new RateLimitError(`GitHub rate limit reached, free again in about ${Math.ceil(w / 1000)} s`, w)
        }
        await sleep(w)
        continue
      }
      if (response.status >= 500 && attempt < 2) {
        await sleep(1000 * (attempt + 1))
        continue
      }
      try {
        response.data = response.text ? JSON.parse(response.text) : null
      } catch {
        response.data = null
      }
      return response
    }
  }

  /** GET on the REST API; null for 404/409/422 (missing, empty repo) */
  async function rest(path) {
    counter.rest++
    const a = await send(API + path)
    if ([404, 409, 422].includes(a.status)) return null
    if (a.status !== 200) throw new GithubError(`GitHub ${a.status} for ${path}: ${a.text.slice(0, 200)}`, a.status)
    return a.data
  }

  async function graphql(query, variables) {
    for (let attempt = 0; ; attempt++) {
      counter.graphql++
      const a = await send(API + '/graphql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })
      if (a.status !== 200) throw new GithubError(`GitHub GraphQL ${a.status}: ${a.text.slice(0, 200)}`, a.status)
      const error = a.data?.errors
      if (error?.length) {
        if (error.some((e) => e.type === 'RATE_LIMITED')) {
          const w = rateLimitWait(403, a.headers, 'rate limit')
          if (w > maxWaitMs || attempt >= 3) throw new RateLimitError(`GitHub rate limit (GraphQL) reached, free again in about ${Math.ceil(w / 1000)} s`, w)
          await sleep(w)
          continue
        }
        throw new GithubError('GitHub GraphQL: ' + error.map((e) => e.message).join('; '), a.status)
      }
      return a.data?.data
    }
  }

  const login = owner || org
  const type = ownerType !== undefined ? ownerType : owner ? null : org ? 'org' : null
  return { rest, graphql, counter, owner: login, org: login, ownerType: type }
}

// ---------- Repo list ----------

const OWNER_TYPE = `query($login: String!) {
  repositoryOwner(login: $login) { __typename login }
}`

/**
 * Is the login an organisation or a user? One small GraphQL request.
 * @returns {Promise<'org'|'user'>}
 */
export async function ownerTypeOf(gh, login = gh.owner) {
  const d = await gh.graphql(OWNER_TYPE, { login })
  const t = d?.repositoryOwner?.__typename
  if (t === 'Organization') return 'org'
  if (t === 'User') return 'user'
  throw new GithubError(`GitHub account "${login}" not found (neither an organisation nor a user), or the token cannot see it`, null)
}

// Listing for an organisation or a user. Users: only repos they own (not the ones they
// collaborate on); forks only with includeForks. Organisations: all repos unless includeForks is false.
function listQuery(type, includeForks) {
  const root = type === 'user' ? 'user' : 'organization'
  const forks = type === 'user' ? includeForks !== true : includeForks === false
  const filter = (type === 'user' ? ', ownerAffiliations: [OWNER]' : '') + (forks ? ', isFork: false' : '')
  return `query($org: String!, $n: Int!, $after: String) {
  ${root}(login: $org) {
    repositories(first: $n, after: $after, orderBy: {field: NAME, direction: ASC}${filter}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name description createdAt pushedAt isArchived isEmpty homepageUrl
        primaryLanguage { name }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        defaultBranchRef { name target { oid } }
      }
    }
  }
}`
}

/**
 * All repos of the organisation or user with metadata and head SHA (one GraphQL request per 100
 * repos, plus one to detect the owner type when it is not known).
 * @param {object} gh client from githubClient()
 * @param {string} [org] login of the owner (default: the client's owner)
 * @param {{ownerType?: 'org'|'user'|null, includeForks?: boolean|null}} [options]
 */
export async function listRepos(gh, org = gh.owner, { ownerType = org === gh.owner ? gh.ownerType : null, includeForks = null } = {}) {
  const type = ownerType || (await ownerTypeOf(gh, org))
  if (org === gh.owner) gh.ownerType = type
  const LIST = listQuery(type, includeForks)
  const metas = []
  let after = null
  let n = 100
  for (;;) {
    let d
    try {
      d = await gh.graphql(LIST, { org, n, after })
    } catch (e) {
      if (e instanceof GithubError && e.status >= 500 && n > 25) {
        n = Math.floor(n / 2) // query too heavy: smaller pages
        continue
      }
      throw e
    }
    const r = (type === 'user' ? d?.user : d?.organization)?.repositories
    if (!r) {
      const hint = ownerType ? ` (ownerType "${type}" is set in the configuration; leave it out to detect the type)` : ''
      throw new GithubError(`GitHub ${type === 'user' ? 'user' : 'organisation'} "${org}" not found or no access${hint}`, null)
    }
    metas.push(...r.nodes.filter(Boolean))
    if (!r.pageInfo.hasNextPage) return metas
    after = r.pageInfo.endCursor
  }
}

/**
 * Commit count at the listed head, for several repos per request (aliases).
 * @returns {Promise<Map<string, number|null>>} null when the count could not be obtained
 */
export async function commitCounts(gh, metas, org = gh.owner, perRequest = 30) {
  const numbers = new Map()
  const chunks = []
  for (let i = 0; i < metas.length; i += perRequest) chunks.push(metas.slice(i, i + perRequest))
  await Promise.all(chunks.map(async (chunk) => {
    const parts = chunk.map((m, i) =>
      `r${i}: repository(owner: ${JSON.stringify(org)}, name: ${JSON.stringify(m.name)}) { object(oid: ${JSON.stringify(headOf(m))}) { ... on Commit { history { totalCount } } } }`)
    let d = null
    try {
      d = await gh.graphql(`query {\n${parts.join('\n')}\n}`)
    } catch (e) {
      if (e instanceof RateLimitError) throw e // otherwise continue without a count: pages are then read until the end
    }
    chunk.forEach((m, i) => numbers.set(m.name, d?.[`r${i}`]?.object?.history?.totalCount ?? null))
  }))
  return numbers
}

// ---------- Metrics ----------

/** Groups per author in order of first appearance, bots left out */
export function authorGroups(commits, rules = STANDARD_RULES) {
  const groups = new Map()
  for (const c of commits) {
    if (rules.bot.test(c.login || '') || rules.bot.test(c.name || '')) continue
    const key = (c.login || c.email || c.name || '').toLowerCase()
    let g = groups.get(key)
    if (!g) {
      g = { key, login: c.login, names: new Map(), commits: 0 }
      groups.set(key, g)
    }
    g.names.set(c.name, (g.names.get(c.name) || 0) + 1)
    g.commits++
  }
  return [...groups.values()].map((g) => ({ key: g.key, login: g.login, names: [...g.names], commits: g.commits }))
}

/** Merge groups of newer commits (front) with those of older ones (back) as if they were one list */
export function mergeGroups(front, back) {
  const off = front.map((g) => ({ ...g, names: g.names.map(([n, k]) => [n, k]) }))
  const index = new Map(off.map((g, i) => [g.key, i]))
  for (const g of back || []) {
    const i = index.get(g.key)
    if (i === undefined) {
      index.set(g.key, off.length)
      off.push({ ...g, names: g.names.map(([n, k]) => [n, k]) })
      continue
    }
    const z = off[i]
    z.commits += g.commits
    for (const [n, k] of g.names) {
      const existing = z.names.find((p) => p[0] === n)
      if (existing) existing[1] += k
      else z.names.push([n, k])
    }
  }
  return off
}

/** The five most active authors from the groups; each group is shown under its most frequent name */
export function authorsFromGroups(groups, rules = STANDARD_RULES) {
  const byName = new Map()
  for (const g of groups) {
    let [n, best] = g.names[0]
    for (const [m, k] of g.names) if (k > best) [n, best] = [m, k]
    n = rules.alias[n.toLowerCase()] ?? n
    let z = byName.get(n.toLowerCase())
    if (!z) {
      z = { login: g.login, name: n, commits: 0 }
      byName.set(n.toLowerCase(), z)
    }
    z.commits += g.commits
    z.login = z.login || g.login
  }
  return [...byName.values()].sort((a, b) => b.commits - a.commits).slice(0, 5)
}

export const authors = (commits, rules = STANDARD_RULES) => authorsFromGroups(authorGroups(commits, rules), rules)

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7))
  const year = t.getUTCFullYear()
  return `${year}-${Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7)}`
}

/** [commits_per_month, longest_pause_days, active_weeks] */
export function metrics(data) {
  if (!data.length) return [{}, 0, 0]
  const ds = data.map((d) => new Date(d)).sort((a, b) => a - b)
  const months = new Map()
  for (const d of ds) {
    const m = d.toISOString().slice(0, 7)
    months.set(m, (months.get(m) || 0) + 1)
  }
  let pause = 0
  for (let i = 1; i < ds.length; i++) pause = Math.max(pause, Math.floor((ds[i] - ds[i - 1]) / 86400000))
  const weeks = new Set(ds.map(isoWeek))
  return [Object.fromEntries([...months].sort((a, b) => pyCompare(a[0], b[0]))), pause, weeks.size]
}

export function extensions(files) {
  const c = new Map()
  for (const p of files) {
    const b = p.slice(p.lastIndexOf('/') + 1)
    const k = b.replace(/^\.+/, '').includes('.') ? b.slice(b.lastIndexOf('.') + 1).toLowerCase() : '(none)'
    c.set(k, (c.get(k) || 0) + 1)
  }
  return [...c].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([extension, count]) => ({ extension, count }))
}

/** Top level: folders first, then by name ignoring case, at most 12 */
export function topFolders(top) {
  return [...top]
    .sort((a, b) => {
      const presence = a.endsWith('/')
      const db = b.endsWith('/')
      if (presence !== db) return presence ? -1 : 1
      return pyCompare(a.toLowerCase(), b.toLowerCase())
    })
    .slice(0, 12)
}

// ---------- Fetching one repo ----------

const path = (gh, name) => `/repos/${gh.owner}/${encodeURIComponent(name)}`

async function commitPage(gh, name, sha, page) {
  const list = await gh.rest(`${path(gh, name)}/commits?sha=${sha}&per_page=${PAGE}&page=${page}`)
  return (list || []).map((c) => ({
    sha: c.sha,
    date: utcIso(c.commit?.author?.date || c.commit?.committer?.date),
    login: c.author?.login || null,
    name: c.commit?.author?.name || '',
    email: (c.commit?.author?.email || '').toLowerCase(),
    msg: (c.commit?.message || '').split('\n')[0],
  }))
}

// Pages 1..n in parallel; untilEnd: keep going while pages are full (in case the count was too low)
async function commitPages(gh, name, sha, n, cache, untilEnd) {
  const get = (s) => {
    if (!cache.has(s)) cache.set(s, commitPage(gh, name, sha, s))
    return cache.get(s)
  }
  const lists = await Promise.all(Array.from({ length: Math.max(1, n) }, (_, i) => get(i + 1)))
  while (untilEnd && lists[lists.length - 1].length === PAGE) lists.push(await get(lists.length + 1))
  return lists.flat()
}

async function tree(gh, name, sha) {
  const t = (await gh.rest(`${path(gh, name)}/git/trees/${sha}?recursive=1`)) || {}
  const files = []
  const top = []
  for (const e of t.tree || []) {
    if (e.type === 'blob') files.push(e.path)
    if (!e.path.includes('/')) top.push(e.type === 'tree' ? e.path + '/' : e.path)
  }
  return { files, top }
}

async function readme(gh, name) {
  const j = await gh.rest(`${path(gh, name)}/readme`)
  if (!j || !('content' in j)) return null
  return Buffer.from(j.content || '', 'base64').toString('utf8')
}

// Metadata that is fresh on every run
function metadata(meta) {
  return {
    name: meta.name,
    description: meta.description || null,
    language: meta.primaryLanguage?.name ?? null,
    created_at: meta.createdAt ?? null,
    last_push: meta.pushedAt ?? null,
    archived: meta.isArchived ?? false,
    homepage: meta.homepageUrl || null,
    topics: (meta.repositoryTopics?.nodes || []).map((n) => n.topic.name),
    default_branch: meta.defaultBranchRef?.name ?? '',
  }
}

const headOf = (meta) => (meta.isEmpty ? null : meta.defaultBranchRef?.target?.oid ?? null)

function emptyEntry(meta) {
  return {
    ...metadata(meta),
    commits: 0, first_commit: null, last_commit: null, last_words: null,
    commit_dates: [], commits_per_month: {}, longest_pause_days: 0, active_weeks: 0,
    authors: [], files: 0, top_folders: [], extensions: [], readme: null,
    recent_commits: [], source: 'empty',
  }
}

const emptyEntryFull = (meta) => ({ ...emptyEntry(meta), head_sha: null, author_groups: [], raw_version: RAW_VERSION })

const unchanged = (meta, old) =>
  Boolean(old && old.raw_version === RAW_VERSION && headOf(meta) && old.head_sha === headOf(meta) && Array.isArray(old.author_groups))

/**
 * Reads one repo (new or changed). With `old` (previous entry with head_sha) only the new commits
 * are fetched, provided the old head sits right behind them.
 * @param {object} gh client from githubClient()
 * @param {object} meta node from listRepos(), plus total = commit count at the head (from commitCounts)
 * @param {object} [old] previous entry
 * @param {object} [rules] author rules from authorRules()
 * @returns {Promise<{entry: object, mode: 'empty'|'full'|'incremental'}>}
 */
export async function fetchRepo(gh, meta, old, rules = STANDARD_RULES) {
  const e = emptyEntry(meta)
  const head = headOf(meta)
  if (!e.default_branch || !head) return { entry: emptyEntryFull(meta), mode: 'empty' }
  const total = meta.total ?? meta.defaultBranchRef.target.history?.totalCount ?? null
  const name = meta.name

  async function commits() {
    const cache = new Map()
    const d = total !== null && old?.head_sha && Number.isInteger(old.commits) ? total - old.commits : 0
    if (d > 0 && old.raw_version === RAW_VERSION && Array.isArray(old.author_groups) && Array.isArray(old.commit_dates)) {
      const list = await commitPages(gh, name, head, Math.ceil((d + 1) / PAGE), cache, false)
      if (list.length > d && list[d].sha === old.head_sha) return { mode: 'incremental', added: list.slice(0, d), top: list.slice(0, 10) }
    }
    const all = await commitPages(gh, name, head, Math.ceil((total ?? 0) / PAGE), cache, true)
    return { mode: 'full', all, top: all.slice(0, 10) }
  }

  const [c, b, text] = await Promise.all([commits(), tree(gh, name, head), readme(gh, name)])
  let data
  let groups
  if (c.mode === 'incremental') {
    data = old.commit_dates.concat(c.added.map((x) => x.date))
    groups = mergeGroups(authorGroups(c.added, rules), old.author_groups)
  } else {
    data = c.all.map((x) => x.date)
    groups = authorGroups(c.all, rules)
  }
  if (total !== null && total !== data.length) e.commits_link_header = total // count differs from what was read
  const sorted = [...data].sort()
  const [months, pause, weeks] = metrics(data)
  Object.assign(e, {
    commits: data.length,
    first_commit: sorted[0] ?? null,
    last_commit: sorted[sorted.length - 1] ?? null,
    last_words: c.top.length ? c.top[0].msg : null,
    commit_dates: sorted,
    commits_per_month: months,
    longest_pause_days: pause,
    active_weeks: weeks,
    authors: authorsFromGroups(groups, rules),
    files: b.files.length,
    top_folders: topFolders(b.top),
    extensions: extensions(b.files),
    readme: text ? firstChars(text, 1500) : null,
    recent_commits: c.top.map((x) => x.msg),
    source: 'api',
  })
  e.head_sha = head
  e.author_groups = groups
  e.raw_version = RAW_VERSION
  return { entry: e, mode: c.mode }
}

/**
 * Collects the raw data of all repos of the organisation or user from the configuration.
 * @param {{config: object, token: string, before?: object|object[], progress?: Function,
 *   fetch?: Function, parallel?: number, only?: string[], gh?: object}} options
 *   before = previous raw data (raw.json or its repos[]), only = names for tests
 * @returns {Promise<{repos: object[], fetched: string[], full: string[], incremental: string[],
 *   unchanged: number, error: {name: string, message: string}[], requests: number}>}
 */
export async function collect({ config, token, before, progress, fetch, parallel = 6, only, gh } = {}) {
  const k = normalize(config)
  if (!k.owner && !gh?.owner) throw new Error('config.owner missing (login of a GitHub organisation or user)')
  const client = gh ?? githubClient({ token, owner: k.owner, ownerType: k.ownerType, fetch, parallel })
  const rules = authorRules(k)
  const report = (step, done, total, text) => progress?.({ step, done, total, text })
  report('repos', 0, 1, 'Reading the repo list from GitHub.')
  const metas = (await listRepos(client, client.owner, { ownerType: client.ownerType, includeForks: k.includeForks })).filter((m) => !k.exclude.has(m.name) && (!only || only.includes(m.name)))
  report('repos', 1, 1, `${metas.length} repos found.`)

  const old = new Map(rawList(before).map((r) => [r.name, r]))
  const doneList = new Map()
  const toFetch = []
  for (const m of metas) {
    if (!headOf(m) || !metadata(m).default_branch) doneList.set(m.name, emptyEntryFull(m)) // empty repo, nothing to fetch
    else if (unchanged(m, old.get(m.name))) doneList.set(m.name, { ...old.get(m.name), ...metadata(m) })
    else toFetch.push(m)
  }

  report('commits', 0, toFetch.length, toFetch.length ? `Fetching commits for ${toFetch.length} changed repos.` : 'No new commits.')
  const numbers = toFetch.length ? await commitCounts(client, toFetch) : new Map()
  const full = []
  const incremental = []
  const error = []
  let done = 0
  await mapParallel(toFetch, parallel, async (m) => {
    const a = old.get(m.name)
    try {
      const { entry, mode } = await fetchRepo(client, { ...m, total: numbers.get(m.name) }, a, rules)
      doneList.set(m.name, entry)
      if (mode === 'incremental') incremental.push(m.name)
      else full.push(m.name)
    } catch (e) {
      if (e instanceof RateLimitError) throw e
      error.push({ name: m.name, message: e.message })
      if (a) doneList.set(m.name, { ...a, ...metadata(m) }) // old state stays, the next run tries again
    }
    done++
    report('commits', done, toFetch.length, `Commits of ${m.name} fetched.`)
  })

  const repos = metas
    .map((m) => doneList.get(m.name))
    .filter(Boolean)
    .sort((a, b) => pyCompare(a.name.toLowerCase(), b.name.toLowerCase()))
  return {
    repos,
    fetched: [...full, ...incremental].sort(),
    full: full.sort(),
    incremental: incremental.sort(),
    unchanged: metas.length - toFetch.length,
    error,
    requests: client.counter.requests,
  }
}
