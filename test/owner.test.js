// Owner of the village: GitHub organisation or user, detected via the API or forced in the
// configuration, with the deprecated alias org. Against a small GitHub stand-in, no network.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalize } from '../server/config.js'
import { collect, githubClient, listRepos, ownerTypeOf } from '../server/pipeline/collect.js'

const ACCOUNTS = {
  'example-org': { type: 'Organization', repos: [['site', false], ['tools', false], ['upstream-fork', true]] },
  'example-user': { type: 'User', repos: [['dotfiles', false], ['notes', false], ['someone-elses-lib', true]] },
}

function standIn() {
  const queries = []
  const paths = []
  const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const node = ([name, fork]) => ({
    name, description: null, createdAt: '2026-01-01T00:00:00Z', pushedAt: '2026-01-02T00:00:00Z', isArchived: false, isEmpty: true,
    homepageUrl: null, primaryLanguage: null, repositoryTopics: { nodes: [] }, defaultBranchRef: null, _fork: fork,
  })
  async function fetch(url, init = {}) {
    const u = new URL(url)
    paths.push(u.pathname)
    if (u.pathname !== '/graphql') return response({ message: 'Not Found' }, 404)
    const { query, variables } = JSON.parse(init.body)
    queries.push(query)
    if (query.includes('repositoryOwner')) {
      const a = ACCOUNTS[variables.login]
      return response({ data: { repositoryOwner: a ? { __typename: a.type, login: variables.login } : null } })
    }
    const root = query.includes('user(login') ? 'user' : 'organization'
    const a = ACCOUNTS[variables.org]
    const matches = a && (root === 'user') === (a.type === 'User')
    if (!matches) return response({ data: { [root]: null }, errors: undefined })
    const nodes = a.repos.filter(([, fork]) => !(query.includes('isFork: false') && fork)).map(node)
    nodes.forEach((n) => delete n._fork)
    return response({ data: { [root]: { repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } })
  }
  return { fetch, queries, paths }
}

const names = (repos) => repos.map((r) => r.name)

test('configuration: owner, the deprecated alias org, ownerType and includeForks', () => {
  const alias = normalize({ org: 'example-org' })
  assert.equal(alias.owner, 'example-org')
  assert.equal(alias.org, 'example-org')
  assert.equal(alias.ownerType, 'org') // the alias stands for an organisation, no detection needed
  assert.equal(alias.brand, 'example-org')
  const owner = normalize({ owner: 'example-user' })
  assert.equal(owner.owner, 'example-user')
  assert.equal(owner.org, 'example-user')
  assert.equal(owner.ownerType, null) // detected on the first run
  assert.equal(owner.includeForks, null)
  assert.equal(normalize({ owner: 'x', ownerType: 'user', includeForks: true }).ownerType, 'user')
  assert.equal(normalize({ owner: 'x', org: 'x' }).ownerType, null)
  assert.throws(() => normalize({ owner: 'a', org: 'b' }), /disagree; keep only owner/)
  assert.throws(() => normalize({ owner: 'a', ownerType: 'team' }), /ownerType must be one of org, user/)
  assert.throws(() => normalize({ owner: 'a', includeForks: 'yes' }), /includeForks must be true or false/)
  assert.throws(() => normalize({ owner: 42 }), /config.owner must be a string/)
})

test('user: detected via the API, only own repos, no forks', async () => {
  const gh = standIn()
  const s = await collect({ config: { owner: 'example-user' }, token: 't', fetch: gh.fetch })
  assert.deepEqual(names(s.repos), ['dotfiles', 'notes'])
  assert.ok(gh.queries[0].includes('repositoryOwner'))
  const list = gh.queries[1]
  assert.ok(list.includes('user(login: $org)'))
  assert.ok(list.includes('ownerAffiliations: [OWNER]'))
  assert.ok(list.includes('isFork: false'))
  assert.equal(s.requests, 2)
})

test('user with includeForks: forks are part of the village', async () => {
  const gh = standIn()
  const s = await collect({ config: { owner: 'example-user', includeForks: true }, token: 't', fetch: gh.fetch })
  assert.deepEqual(names(s.repos), ['dotfiles', 'notes', 'someone-elses-lib'])
  assert.ok(!gh.queries[1].includes('isFork'))
})

test('organisation: detected via the API, forks included unless includeForks is false', async () => {
  const gh = standIn()
  const s = await collect({ config: { owner: 'example-org' }, token: 't', fetch: gh.fetch })
  assert.deepEqual(names(s.repos), ['site', 'tools', 'upstream-fork'])
  assert.ok(gh.queries[1].includes('organization(login: $org)'))
  assert.ok(!gh.queries[1].includes('ownerAffiliations'))
  const without = standIn()
  const t = await collect({ config: { owner: 'example-org', includeForks: false }, token: 't', fetch: without.fetch })
  assert.deepEqual(names(t.repos), ['site', 'tools'])
})

test('alias org and a forced ownerType skip the detection request', async () => {
  const gh = standIn()
  const s = await collect({ config: { org: 'example-org' }, token: 't', fetch: gh.fetch })
  assert.deepEqual(names(s.repos), ['site', 'tools', 'upstream-fork'])
  assert.equal(gh.queries.length, 1)
  assert.ok(!gh.queries[0].includes('repositoryOwner'))
  const user = standIn()
  await collect({ config: { owner: 'example-user', ownerType: 'user' }, token: 't', fetch: user.fetch })
  assert.equal(user.queries.length, 1)
  assert.ok(user.queries[0].includes('user(login: $org)'))
})

test('clear errors: unknown login, wrong forced type, no owner at all', async () => {
  const gh = standIn()
  await assert.rejects(collect({ config: { owner: 'nobody-here' }, token: 't', fetch: gh.fetch }), /"nobody-here" not found \(neither an organisation nor a user\)/)
  await assert.rejects(
    collect({ config: { owner: 'example-user', ownerType: 'org' }, token: 't', fetch: standIn().fetch }),
    /organisation "example-user" not found or no access \(ownerType "org" is set in the configuration; leave it out to detect the type\)/,
  )
  await assert.rejects(collect({ config: {}, token: 't', fetch: gh.fetch }), /config.owner missing/)
  const client = githubClient({ token: 't', owner: 'example-user', fetch: standIn().fetch })
  assert.equal(await ownerTypeOf(client), 'user')
  assert.deepEqual(names(await listRepos(client)), ['dotfiles', 'notes'])
  assert.equal(client.ownerType, 'user') // remembered for the rest of the run
})
