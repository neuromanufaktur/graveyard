// Sign-in, gatekeeper and API routes: open village without storage, closed village without a session.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auth } from '../server/auth.js'
import { api } from '../server/api/index.js'
import { gatekeeper } from '../server/gatekeeper.js'

const dataFolder = new URL('../data/', import.meta.url)
const OPEN = { config: { org: 'example-org' }, dataFolder }
const TO = {
  config: {
    org: 'example-org',
    team: { ana: { name: 'Ana', logins: ['ana', 'a.n'] }, ben: { name: 'Ben' } },
    auth: { provider: 'github', label: 'GitHub', allowedDomains: ['example.com'] },
    storage: 'upstash',
  },
  dataFolder,
}
const request = (path, init) => new Request('http://127.0.0.1' + path, init)

test('sign-in rules: allowed domains, character from the login, display name', () => {
  const a = auth(TO.config)
  assert.equal(a.open, false)
  assert.equal(a.domainAllowed('ana@example.com'), true)
  assert.equal(a.domainAllowed('ana@EXAMPLE.com'), true)
  assert.equal(a.domainAllowed('ana@example.com.evil.org'), false)
  assert.equal(a.domainAllowed(undefined), false)
  assert.equal(a.figureFor('A.N+test@example.com'), 'ana')
  assert.equal(a.figureFor('ben@example.com'), 'ben')
  assert.equal(a.figureFor('carla@example.com'), null)
  assert.equal(a.displayName('ana@example.com', 'Whatever'), 'Ana')
  assert.equal(a.displayName('carla@example.com', 'Carla Lopez'), 'Carla')
})

test('open village: gatekeeper lets everything through, the world comes from data/, nothing is shared', async () => {
  const mw = gatekeeper(OPEN)
  const r = await mw(request('/'))
  assert.equal(r.headers.get('x-middleware-next'), '1')
  assert.equal((await mw(request('/api/auth/session'))).status, 404) // no Auth.js without a provider
  const routes = api(OPEN)
  const world = await (await routes.world.GET(request('/api/world'))).json()
  assert.equal(world.me, null)
  assert.equal(world.stale, false)
  assert.ok(world.repos.length > 5)
  assert.deepEqual(world.tribute, {})
  assert.deepEqual(await (await routes.presence.POST(request('/api/presence', { method: 'POST', body: '{"figure":"guest","x":1,"z":1}' }))).json(), { others: [], tribute: {} })
  assert.equal((await routes.tribute.POST(request('/api/tribute', { method: 'POST', body: '{"repo":"delta-bot","kind":"candle"}' }))).status, 404)
  const cur = await (await routes.refresh.POST(request('/api/refresh', { method: 'POST' }))).json()
  assert.equal(cur.reason, 'no storage')
})

test('closed village without a session: pages redirect to /login, API answers 401, login stays open', async () => {
  const mw = gatekeeper(TO)
  const page = await mw(request('/'))
  assert.equal(page.status, 302)
  assert.equal(page.headers.get('location'), 'http://127.0.0.1/login')
  const deep = await mw(request('/src/main.js?x=1'))
  assert.equal(deep.headers.get('location'), 'http://127.0.0.1/login?next=%2Fsrc%2Fmain.js%3Fx%3D1')
  assert.equal((await mw(request('/api/world'))).status, 401)
  assert.equal((await mw(request('/login'))).headers.get('x-middleware-next'), '1')
  assert.equal((await api(TO).world.GET(request('/api/world'))).status, 401)
})
