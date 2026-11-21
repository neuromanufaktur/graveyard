// Demo village (tools/demo-world.mjs): deterministic, covers every part of the village, and
// data/world.json is exactly what the generator builds. While graveyard.config.json belongs to
// another owner (your own village), the tests on data/world.json are skipped.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { normalize } from '../server/config.js'
import { AS_OF, DEMO_OWNER, REPOS, checkEpitaphs, demoConfig, demoLive, demoRaw, demoWorld, isDemo } from '../tools/demo-world.mjs'

const config = demoConfig()
const own = !isDemo(config)
const skip = own ? `graveyard.config.json belongs to ${normalize(config).owner}, not to the demo` : false
const world = own ? null : demoWorld(config)
const repos = world?.repos ?? []
const count = (f) => repos.filter(f).length
// as in src/util.js (browser module): resurrected and still around
const isZombie = (r) => !!r.resurrected_at && ['alive', 'sleeping', 'hospice', 'client_active'].includes(r.state)

test('deterministic: two runs give the same bytes, data/world.json is that output', { skip }, () => {
  const text = JSON.stringify(world, null, 1)
  assert.equal(JSON.stringify(demoWorld(config), null, 1), text)
  assert.equal(JSON.stringify(demoRaw(config)), JSON.stringify(demoRaw(config)))
  assert.equal(readFileSync(new URL('../data/world.json', import.meta.url), 'utf8'), text)
  assert.equal(world.as_of, AS_OF)
  assert.equal(demoRaw(config).org, DEMO_OWNER)
})

test('size: 50 to 60 repos, each exactly once', { skip }, () => {
  assert.ok(repos.length >= 50 && repos.length <= 60, String(repos.length))
  assert.equal(new Set(repos.map((r) => r.name)).size, repos.length)
  assert.equal(REPOS.length, repos.length)
})

test('every state at least three times', { skip }, () => {
  for (const s of ['alive', 'sleeping', 'client_active', 'delivered', 'hospice', 'dead', 'buried', 'ancestor']) {
    assert.ok(count((r) => r.state === s) >= 3, s)
  }
  assert.ok(count((r) => r.state === 'dead' && r.live?.ok) >= 1, 'buried by hand although the site is live')
})

test('at least three zombies, and only where the spec says so', { skip }, () => {
  const zombies = repos.filter(isZombie).map((r) => r.name).sort()
  assert.ok(zombies.length >= 3, zombies.join(', '))
  assert.deepEqual(zombies, REPOS.filter((s) => s.zombie).map((s) => s.name).sort())
})

test('three ancestors with a successor that lives in the village', { skip }, () => {
  const names = new Set(repos.map((r) => r.name))
  const ancestors = repos.filter((r) => r.state === 'ancestor')
  assert.ok(ancestors.length >= 3)
  for (const r of ancestors) assert.ok(r.successor && names.has(r.successor), r.name)
})

test('four clients with several projects each, display names from the configuration', { skip }, () => {
  const k = normalize(config)
  const perClient = {}
  for (const r of repos) if (r.client) perClient[r.client] = (perClient[r.client] || 0) + 1
  assert.equal(Object.keys(perClient).length, 4)
  for (const [c, n] of Object.entries(perClient)) assert.ok(n >= 2, c)
  assert.deepEqual(Object.keys(perClient).sort(), Object.values(k.clients).sort())
  for (const r of repos) if (r.client) assert.equal(r.category, 'client', r.name)
})

test('three pairs of product and landing page that share one place', { skip }, () => {
  const names = new Set(repos.map((r) => r.name))
  const LIVING = new Set(['alive', 'sleeping'])
  const DEAD = new Set(['dead', 'buried'])
  const pairs = repos.filter((r) => r.name.endsWith('-landing') && names.has(r.name.replace(/-landing$/, '')))
  const together = pairs.filter((l) => {
    const p = repos.find((r) => r.name === l.name.replace(/-landing$/, ''))
    return (LIVING.has(p.state) && LIVING.has(l.state)) || (DEAD.has(p.state) && DEAD.has(l.state))
  })
  assert.ok(together.length >= 3, together.map((r) => r.name).join(', '))
})

test('every grave tier in the graveyard, several languages, every category', { skip }, () => {
  const graves = repos.filter((r) => r.state === 'dead' || r.state === 'buried')
  for (const t of ['cross', 'stone', 'marble', 'mausoleum']) assert.ok(graves.some((r) => r.grave_tier === t), t)
  assert.ok(new Set(repos.map((r) => r.language).filter(Boolean)).size >= 8)
  for (const c of ['product', 'client', 'experiment', 'internal']) assert.ok(count((r) => r.category === c) >= 3, c)
})

test('believable histories: commits, months, authors from the team, last words', { skip }, () => {
  const team = new Set(Object.values(normalize(config).team).map((p) => p.name))
  for (const r of repos) {
    assert.ok(r.commits >= 2, r.name)
    assert.ok(r.first_commit <= r.last_commit, r.name)
    assert.equal(Object.values(r.commits_per_month).reduce((a, b) => a + b, 0), r.commits, r.name)
    assert.ok(r.last_words && r.last_words.length > 1, r.name)
    assert.ok(r.authors.length >= 1, r.name)
    assert.ok(!r.authors.some((a) => /bot/.test(a)), r.name)
  }
  assert.ok(repos.filter((r) => r.authors.some((a) => team.has(a))).length > repos.length * 0.8)
  assert.ok(new Set(repos.map((r) => r.last_words)).size > repos.length * 0.9)
})

test('inscriptions: from the epitaph file or from facts, within the limits', { skip }, () => {
  const mourners = new Set(Object.values(normalize(config).mourners.members).map((m) => m.name))
  for (const r of repos) {
    assert.ok(r.inscription.length > 0 && [...r.inscription].length <= 140, r.name)
    assert.ok([...r.cause_of_death].length <= 80, r.name)
    if (['alive', 'sleeping', 'client_active'].includes(r.state)) assert.equal(r.cause_of_death, '', r.name)
    if (r.npc.who) assert.ok(mourners.has(r.npc.who), r.name)
  }
})

test('epitaph file check: unknown repo, length, mourner and dashes are reported', () => {
  const base = [{ name: 'gloam' }]
  assert.doesNotThrow(() => checkEpitaphs({ $comment: 'x', gloam: { inscription: 'Fine.' } }, base, config))
  assert.throws(() => checkEpitaphs({ nope: { inscription: 'x' } }, base, config), /nope: no such repo/)
  assert.throws(() => checkEpitaphs({ gloam: { inscription: 'x'.repeat(141) } }, base, config), /1 to 140 characters/)
  assert.throws(() => checkEpitaphs({ gloam: { inscription: 'a – b' } }, base, config), /dash or an emoji/)
  assert.throws(() => checkEpitaphs({ gloam: { inscription: 'x', mourner: { who: 'Nobody', text: 'hi' } } }, base, config), /mourner.who "Nobody"/)
})

test('demo sites are invented: only the reserved .example domain', () => {
  for (const e of Object.values(demoLive().live)) assert.match(new URL(e.url).hostname, /\.example$/)
})
