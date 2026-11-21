// World building with invented repos from test/fixtures: states, thresholds, exclusion and
// classification from topics. The demo village has its own tests in demo.test.js.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { normalize, forBrowser } from '../server/config.js'
import { prepare, resurrectedAt, base, grave_tier, state } from '../server/pipeline/prepare.js'
import {
  EMPTY_CLASSIFICATION, classificationFromTopics, slug, topicValid, topicsFromClassification,
} from '../server/pipeline/classification.js'
import { updateEpitaphs } from '../server/pipeline/epitaphs.js'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const raw = read('./fixtures/raw.json')
const live = read('./fixtures/live.json')
const now = raw.as_of
const byName = (world) => Object.fromEntries(world.repos.map((r) => [r.name, r]))

// The fixtures through the pipeline, with plain inscriptions from facts (no model call)
async function fixtureWorld() {
  const config = { org: 'example-org' }
  const g = await updateEpitaphs({ repos: base({ raw, live, now, config }), write: null, now, config })
  return prepare({ raw, live, epitaphs: g.file, now, config })
}

test('configuration: neutral defaults, browser part without logins and prompts', () => {
  const k = normalize({ org: 'example-org' })
  assert.equal(k.brand, 'example-org')
  assert.equal(k.title, 'Graveyard of Repos')
  assert.deepEqual(k.team, {})
  assert.deepEqual(k.mourners.members, {})
  assert.equal(k.auth.provider, null)
  assert.equal(k.storage, 'none')
  assert.equal(k.exclude.size, 0)
  assert.equal(k.thresholds.deadDays, 90)
  assert.equal(normalize(k), k) // already normalised stays as it is

  const full = normalize({
    org: 'ottermere',
    team: { ana: { name: 'Ana', role: 'Dev', photo: 'photos/ana.jpg', logins: ['Ana', 'a.b'] } },
    mourners: { label: 'Crew', members: { owl: { name: 'Owl', role: 'Night watch', prompt: 'sees everything', accent: '#ffffff' } } },
    auth: { provider: 'github', allowedDomains: ['Example.COM'] },
    storage: 'upstash',
  })
  assert.deepEqual(full.team.ana.logins, ['ana', 'a.b'])
  assert.equal(full.mourners.members.owl.prompt, 'sees everything')
  assert.deepEqual(full.auth.domains, ['example.com'])
  const b = forBrowser(full)
  assert.equal(b.team.ana.logins, undefined)
  assert.equal(b.mourners.members.owl.prompt, undefined)
  assert.equal(b.auth, true)
  assert.equal(b.multiplayer, true)
  assert.throws(() => normalize({ org: 'x', auth: { provider: 'myspace' } }), /Unknown auth provider/)
})

test('states from invented repos cover every zone', async () => {
  const w = byName(await fixtureWorld())
  assert.equal(w['alpha-app'].state, 'alive')
  assert.equal(w['beta-tool'].state, 'sleeping')
  assert.equal(w['gamma-api'].state, 'hospice')
  assert.equal(w['gamma-api'].hospice_days_left, 40)
  assert.equal(w['delta-bot'].state, 'dead')
  assert.equal(w['buried-idea'].state, 'dead') // buried by hand although live
  assert.equal(w['zeta-archive'].state, 'buried')
  assert.equal(w['epsilon-v1'].state, 'ancestor')
  assert.equal(w['epsilon-v1'].successor, 'alpha-app')
  assert.equal(w['ottermere-portal'].state, 'client_active')
  assert.equal(w['ottermere-shop'].state, 'delivered')
  assert.equal(w['ottermere-shop'].client, 'Ottermere')
  assert.equal(w['omega-lab'].resurrected_at !== null, true)
  assert.equal(w['alpha-app'].live.ok, true)
  for (const r of Object.values(w)) assert.ok(r.inscription.length > 0 && r.inscription.length <= 140, r.name)
})

test('exclusion, client names and thresholds come from the configuration', () => {
  const config = { org: 'example-org', exclude: ['delta-bot'], clients: { ottermere: 'Ottermere Ltd.' }, thresholds: { deadDays: 45, aliveDays: 5 } }
  const w = byName(prepare({ raw, live, now, config }))
  assert.equal(w['delta-bot'], undefined)
  assert.equal(w['ottermere-shop'].client, 'Ottermere Ltd.')
  assert.equal(w['gamma-api'].state, 'dead') // 50 days > 45
  assert.equal(w['alpha-landing'].state, 'hospice') // 8 days > 5
  assert.equal(base({ raw, live, now, config }).length, raw.repos.length - 1)
})

test('state, grave tier and resurrection at the boundaries', () => {
  const cls = { category: 'product', buried: false, successor: null }
  assert.equal(state({ archived: false }, { ...cls, buried: true }, true, 1), 'dead')
  assert.equal(state({ archived: true }, { ...cls, successor: 'alpha-app' }, false, 500), 'ancestor')
  assert.equal(state({ archived: true }, cls, true, 1), 'buried')
  assert.equal(state({ archived: false }, { ...cls, category: 'client' }, false, 89), 'client_active')
  assert.equal(state({ archived: false }, { ...cls, category: 'client' }, false, 90), 'delivered')
  assert.equal(state({ archived: false }, cls, false, 29), 'alive')
  assert.equal(state({ archived: false }, cls, true, 30), 'sleeping')
  assert.equal(state({ archived: false }, cls, false, 89), 'hospice')
  assert.equal(state({ archived: false }, cls, false, 90), 'dead')
  assert.deepEqual([4, 5, 19, 20, 49, 50].map((n) => grave_tier(n)), ['cross', 'stone', 'stone', 'marble', 'marble', 'mausoleum'])
  assert.equal(grave_tier(3, [[2, 'cross']]), 'mausoleum')
  assert.equal(resurrectedAt(['2025-01-01T00:00:00Z', '2025-04-01T00:00:00Z']), '2025-04-01')
  assert.equal(resurrectedAt(['2025-01-01T00:00:01Z', '2025-04-01T00:00:00Z']), null)
  assert.equal(resurrectedAt(['2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z'], 30), '2025-02-01')
  assert.equal(resurrectedAt([]), null)
})

test('classification: topics first, then the file, then the default; live_url from file or homepage', () => {
  const file = { 'old-site': { category: 'client', client: 'Pellbrook', successor: null, buried: false, live_url: 'https://old.example.org' } }
  const allNames = new Set(['alpha-app', 'beta.tool', 'old-site'])
  assert.deepEqual(classificationFromTopics([], 'old-site', { file }), file['old-site'])
  assert.deepEqual(classificationFromTopics(['javascript', 'product'], 'old-site', { file }), file['old-site']) // foreign topics do not count
  assert.deepEqual(classificationFromTopics([], 'new-repo', { homepage: 'https://new.example.org' }), { ...EMPTY_CLASSIFICATION, live_url: 'https://new.example.org' })
  const e = classificationFromTopics(['graveyard-experiment', 'graveyard-buried'], 'old-site', { file, homepage: 'https://other.example.org' })
  assert.deepEqual(e, { category: 'experiment', client: null, successor: null, buried: true, live_url: 'https://old.example.org' })
  const k = (t, o = {}) => classificationFromTopics(t, 'x', { file, allNames, ...o })
  assert.equal(k(['graveyard-client-pellbrook']).client, 'Pellbrook') // name from the file
  assert.equal(k(['graveyard-client-pellbrook'], { clients: { pellbrook: 'Pellbrook Inc.' } }).client, 'Pellbrook Inc.') // configuration wins
  assert.equal(k(['graveyard-client-larchwick-labs']).client, 'Larchwick Labs') // derived from the slug
  assert.equal(k(['graveyard-client-larchwick-labs']).category, 'client')
  assert.equal(k(['graveyard-experiment', 'graveyard-product', 'graveyard-client']).category, 'client')
  assert.equal(k(['graveyard-successor-beta-tool']).successor, 'beta.tool')
  assert.equal(k(['graveyard-successor-missing']).successor, null)
})

test('topics round trip and validity', () => {
  const e = { category: 'client', client: 'Larchwick Labs', successor: 'beta.tool', buried: true, live_url: null }
  const t = topicsFromClassification(e)
  assert.deepEqual(t, ['graveyard-client', 'graveyard-client-larchwick-labs', 'graveyard-buried', 'graveyard-successor-beta-tool'])
  for (const x of t) assert.ok(topicValid(x), x)
  assert.deepEqual(classificationFromTopics(t, 'x', { allNames: ['beta.tool'] }), e)
  assert.equal(slug('Crème 𝔸G'), 'cr-me--g')
  assert.equal(topicValid('-x'), false)
  assert.equal(topicValid('a'.repeat(51)), false)
})
