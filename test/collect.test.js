// collect.js against a GitHub stand-in: listing, exclusion, author rules from the configuration,
// incremental fetching, force pushes, rate limits and errors. No network.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authors, authorRules, githubClient, fetchRepo, RateLimitError, listRepos, collect,
} from '../server/pipeline/collect.js'

const config = {
  org: 'example-org',
  exclude: ['secret-repo'],
  authors: { aliases: { 'jane doe': 'Jane Q. Doe' }, bots: ['^release-robot$'] },
}

test('author rules: bots and aliases come from the configuration', () => {
  const c = (login, name) => ({ login, name, email: '', date: '2025-01-01T00:00:00Z', msg: 'm' })
  const list = [c('jdoe', 'Jane Doe'), c(null, 'release-robot'), c('dependabot[bot]', 'dependabot'), c('jdoe', 'Jane Doe'), c(null, 'Sam')]
  assert.deepEqual(authors(list, authorRules(config)).map((a) => [a.name, a.commits]), [['Jane Q. Doe', 2], ['Sam', 1]])
  // without configuration: only the built-in bot pattern, no aliases
  assert.deepEqual(authors(list).map((a) => [a.name, a.commits]), [['Jane Doe', 2], ['release-robot', 1], ['Sam', 1]])
})

// ---------- GitHub stand-in ----------

let clock = Date.UTC(2026, 0, 1)
const commit = (sha, parents, extra = {}) => ({
  sha, parents, date: new Date((clock += 3600_000)).toISOString().replace('.000Z', 'Z'),
  login: 'jdoe', name: 'Jane Doe', email: 'jane@example-org.ai', msg: `Commit ${sha}\n\nText`, ...extra,
})

// log as in git log: by date, newest first, parents only after children
function logOf(commits, head) {
  const off = []
  const seen = new Set([head])
  const queue = [commits.get(head)]
  while (queue.length) {
    queue.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    const c = queue.shift()
    off.push(c)
    for (const p of c.parents) {
      if (!seen.has(p)) {
        seen.add(p)
        queue.push(commits.get(p))
      }
    }
  }
  return off
}

// answer to the alias query from commitCounts()
function counts(query, formatNumber) {
  const data = {}
  for (const m of query.matchAll(/(r\d+): repository\(owner: "example-org", name: ("[^"]*")\) \{ object\(oid: ("[^"]*")\)/g)) {
    const n = formatNumber(JSON.parse(m[2]), JSON.parse(m[3]))
    data[m[1]] = n === null ? { object: null } : { object: { history: { totalCount: n } } }
  }
  return data
}

function fake() {
  const repos = new Map()
  const requests = []
  const disturbance = { status: null, filePath: null, headers: {} }
  const response = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', date: new Date(Date.UTC(2026, 10, 18)).toUTCString(), ...headers } })

  async function fetch(url, init = {}) {
    const u = new URL(url)
    requests.push(u.pathname)
    if (disturbance.status && u.pathname.includes(disturbance.filePath)) return response({ message: 'Disturbance' }, disturbance.status, disturbance.headers)
    if (u.pathname === '/graphql' && !JSON.parse(init.body).query.includes('organization')) {
      return response({ data: counts(JSON.parse(init.body).query, (name, oid) => {
        const r = repos.get(name)
        return r?.commits.get(oid) ? logOf(r.commits, oid).length : null
      }) })
    }
    if (u.pathname === '/graphql') {
      const nodes = [...repos.values()].map((r) => {
        const head = r.head && r.commits.get(r.head)
        return {
          name: r.name, description: r.description ?? null, createdAt: '2025-01-01T00:00:00Z', pushedAt: r.push ?? '2026-11-17T00:00:00Z',
          isArchived: false, isEmpty: !head, homepageUrl: null, primaryLanguage: { name: 'JavaScript' },
          repositoryTopics: { nodes: (r.topics || []).map((name) => ({ topic: { name } })) },
          defaultBranchRef: head ? { name: 'main', target: { oid: r.head } } : null,
        }
      })
      return response({ data: { organization: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } })
    }
    const m = u.pathname.match(/^\/repos\/example-org\/([^/]+)\/(.+)$/)
    const r = m && repos.get(decodeURIComponent(m[1]))
    if (!r) return response({ message: 'Not Found' }, 404)
    if (m[2] === 'commits') {
      const page = Number(u.searchParams.get('page') || 1)
      const per = Number(u.searchParams.get('per_page') || 30)
      const list = logOf(r.commits, u.searchParams.get('sha')).slice((page - 1) * per, page * per)
      return response(list.map((c) => ({
        sha: c.sha,
        commit: { author: { name: c.name, email: c.email, date: c.date }, committer: { date: c.date }, message: c.msg },
        author: c.login ? { login: c.login } : null,
      })))
    }
    if (m[2].startsWith('git/trees/')) return response({ tree: (r.tree || []).map((path) => ({ path: path.replace(/\/$/, ''), type: path.endsWith('/') ? 'tree' : 'blob' })) })
    if (m[2] === 'readme') return r.readme ? response({ content: Buffer.from(r.readme).toString('base64'), encoding: 'base64' }) : response({ message: 'Not Found' }, 404)
    return response({ message: 'Not Found' }, 404)
  }

  function repo(name, count, extra = {}) {
    const commits = new Map()
    let before = null
    for (let i = 0; i < count; i++) {
      const c = commit(`${name}-${i}`, before ? [before] : [], i % 3 ? {} : { login: null, name: 'Richard Roe', email: 'rroe@example-org.ai' })
      commits.set(c.sha, c)
      before = c.sha
    }
    const r = { name, commits, head: before, tree: ['src/', 'src/a.js', 'src/b.ts', 'README.md', '.gitignore'], readme: `# ${name}\n` + 'é'.repeat(2000), ...extra }
    repos.set(name, r)
    return r
  }
  function next(r, count, extra = {}) {
    for (let i = 0; i < count; i++) {
      const c = commit(`${r.name}-n${r.commits.size}`, [r.head], extra)
      r.commits.set(c.sha, c)
      r.head = c.sha
    }
  }
  return { fetch, repos, requests, disturbance, repo, next }
}

const onlyData = ({ source, ...r }) => r

test('unchanged: only the GraphQL list, fresh metadata, empty and excluded repo handled', async () => {
  const gh = fake()
  gh.repo('alpha', 250)
  gh.repo('beta', 7)
  gh.repo('secret-repo', 3)
  gh.repos.set('empty.ai', { name: 'empty.ai', commits: new Map(), head: null })
  const first = await collect({ config, token: 't', fetch: gh.fetch })
  assert.deepEqual(first.repos.map((r) => r.name), ['alpha', 'beta', 'empty.ai'])
  assert.deepEqual(first.full, ['alpha', 'beta'])
  const alpha = first.repos[0]
  assert.equal(alpha.commits, 250)
  assert.equal(alpha.last_words, 'Commit alpha-249')
  assert.equal(alpha.recent_commits.length, 10)
  assert.equal(alpha.readme.length, ('# alpha\n').length + 1492)
  assert.deepEqual(alpha.top_folders, ['src/', '.gitignore', 'README.md'])
  assert.deepEqual(alpha.authors.map((a) => [a.name, a.commits]), [['Jane Q. Doe', 166], ['Richard Roe', 84]])
  assert.equal(first.repos[2].source, 'empty')
  assert.equal(first.repos[2].default_branch, '')
  gh.repos.get('beta').description = 'described anew'
  gh.repos.get('beta').topics = ['graveyard-product']
  gh.requests.length = 0
  const second = await collect({ config, token: 't', fetch: gh.fetch, before: { repos: first.repos } })
  assert.equal(second.requests, 1)
  assert.deepEqual(gh.requests, ['/graphql'])
  assert.deepEqual(second.fetched, [])
  assert.equal(second.unchanged, 3)
  assert.equal(second.repos[1].description, 'described anew')
  assert.deepEqual(second.repos[1].topics, ['graveyard-product'])
  assert.deepStrictEqual(onlyData({ ...second.repos[0] }), onlyData({ ...first.repos[0] }))
})

test('new commits: fetched incrementally, result the same as fetched fresh', async () => {
  const gh = fake()
  gh.repo('alpha', 340)
  gh.repo('beta', 5)
  const before = await collect({ config, token: 't', fetch: gh.fetch })
  gh.next(gh.repos.get('alpha'), 120, { login: 'sam-x', name: 'Sam', email: 'sam@example-org.ai' })
  gh.next(gh.repos.get('beta'), 1)
  gh.requests.length = 0
  const incr = await collect({ config, token: 't', fetch: gh.fetch, before: before.repos })
  assert.deepEqual(incr.incremental, ['alpha', 'beta'])
  // list, count, alpha 2 commit pages, beta 1, tree and README each
  assert.equal(incr.requests, 1 + 1 + 2 + 1 + 2 * 2)
  const fresh = await collect({ config, token: 't', fetch: gh.fetch })
  assert.deepStrictEqual(incr.repos, fresh.repos)
  assert.equal(incr.repos[0].commits, 460)
  assert.equal(incr.repos[0].authors[0].name, 'Jane Q. Doe')
})

test('force push and merge of older commits: everything fresh, result still correct', async () => {
  const gh = fake()
  const a = gh.repo('alpha', 30)
  const b = gh.repo('beta', 30)
  const before = await collect({ config, token: 't', fetch: gh.fetch })
  // alpha: head replaced by a different commit (amend)
  const oldHead = a.commits.get(a.head)
  const fallback = commit('alpha-amend', oldHead.parents)
  a.commits.set(fallback.sha, fallback)
  a.head = fallback.sha
  // beta: feature branch with commits older than the old head gets merged
  const baseSha = 'beta-20'
  const branch = []
  for (let i = 0; i < 3; i++) {
    const c = { ...commit(`beta-f${i}`, [branch.at(-1)?.sha ?? baseSha]), date: `2025-06-0${i + 1}T00:00:00Z` }
    b.commits.set(c.sha, c)
    branch.push(c)
  }
  const merge = commit('beta-merge', [b.head, branch.at(-1).sha])
  b.commits.set(merge.sha, merge)
  b.head = merge.sha
  const updated = await collect({ config, token: 't', fetch: gh.fetch, before: before.repos })
  assert.deepEqual(updated.full, ['alpha', 'beta'])
  assert.deepEqual(updated.incremental, [])
  assert.deepStrictEqual(updated.repos, (await collect({ config, token: 't', fetch: gh.fetch })).repos)
  assert.equal(updated.repos[1].commits, 34)
})

test('rate limit: short wait and carry on, a long block aborts with RateLimitError', async () => {
  const gh = fake()
  gh.repo('alpha', 3)
  const pauses = []
  let once = true
  const withBrake = async (url, init) => {
    if (String(url).endsWith('/readme') && once) {
      once = false
      return new Response('{"message": "slow down"}', { status: 429, headers: { 'retry-after': '2' } })
    }
    return gh.fetch(url, init)
  }
  const ok = await collect({ config, gh: githubClient({ token: 't', org: config.org, fetch: withBrake, sleep: async (ms) => pauses.push(ms) }) })
  assert.equal(ok.repos[0].commits, 3)
  assert.equal(ok.repos[0].readme.startsWith('# alpha'), true)
  assert.deepEqual(pauses, [2000])
  const client = githubClient({ token: 't', org: config.org, fetch: gh.fetch, sleep: async (ms) => pauses.push(ms) })
  gh.disturbance.status = 403
  gh.disturbance.filePath = '/graphql'
  gh.disturbance.headers = { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.UTC(2026, 10, 18, 1) / 1000) }
  await assert.rejects(listRepos(client), RateLimitError)
})

test('an error in one repo does not abort: the old state stays, the error is reported', async () => {
  const gh = fake()
  gh.repo('alpha', 3)
  gh.repo('beta', 3)
  const before = await collect({ config, token: 't', fetch: gh.fetch })
  gh.next(gh.repos.get('beta'), 2)
  gh.disturbance.status = 500
  gh.disturbance.filePath = '/beta/git/trees'
  const client = githubClient({ token: 't', org: config.org, fetch: gh.fetch, sleep: async () => {} })
  const result = await collect({ config, gh: client, before: before.repos })
  assert.equal(result.error.length, 1)
  assert.equal(result.error[0].name, 'beta')
  assert.equal(result.repos[1].commits, 3) // alter Stand
  assert.equal(result.repos[1].head_sha, before.repos[1].head_sha) // the next run tries again
})

test('fetchRepo with an older head gives the state of that time (for the live test)', async () => {
  const gh = fake()
  const a = gh.repo('alpha', 12)
  const client = githubClient({ token: 't', org: config.org, fetch: gh.fetch })
  const [meta] = await listRepos(client)
  const old = { ...meta, defaultBranchRef: { ...meta.defaultBranchRef, target: { oid: 'alpha-4', history: { totalCount: null } } } }
  const { entry, mode } = await fetchRepo(client, old, null)
  assert.equal(mode, 'full')
  assert.equal(entry.commits, 5)
  assert.equal(entry.head_sha, 'alpha-4')
  assert.equal(a.head, 'alpha-11')
})

