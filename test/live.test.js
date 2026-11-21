// Live check against a local server: reachable, parked, missing, errors, redirects, timeouts
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { liveCheck, liveChecks } from '../server/pipeline/live.js'

let server
let base
before(async () => {
  server = createServer((req, res) => {
    const html = (status, body, head = {}) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', server: 'Testserver', ...head })
      res.end(body)
    }
    if (req.url === '/ok') return html(200, '<html><head><TITLE lang="en">\n  Hello \n World </TITLE></head></html>')
    if (req.url === '/parked') return html(200, '<title>Willkommen</title><p>This domain is parked free of charge</p>')
    if (req.url === '/gone') return html(404, '<title>404</title>The deployment could not be found on Vercel.')
    if (req.url === '/broken') return html(500, 'Error')
    if (req.url === '/redirect') return html(302, '', { location: '/ok' })
    if (req.url === '/empty') return html(204, '')
    if (req.url === '/agent') return html(200, `<title>${req.headers['user-agent']}</title>`)
    if (req.url === '/slow') return setTimeout(() => html(200, '<title>too late</title>'), 1500)
    return html(404, '')
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => {
  server.closeAllConnections?.()
  server.close()
})

test('reachable, parked, 404 with pattern, 500, redirect, empty', async () => {
  assert.deepStrictEqual(await liveCheck(`${base}/ok`), {
    url: `${base}/ok`, status: 200, server: 'Testserver', title: 'Hello World', final_url: `${base}/ok`, ok: true, reason: null,
  })
  const parked = await liveCheck(`${base}/parked`)
  assert.equal(parked.ok, false)
  assert.equal(parked.reason, 'parked or 404 page: parked')
  assert.deepStrictEqual(await liveCheck(`${base}/gone`), {
    url: `${base}/gone`, status: 404, server: 'Testserver', title: '404', final_url: null, ok: false, reason: 'HTTP 404, deployment could not be found',
  })
  const broken = await liveCheck(`${base}/broken`)
  assert.equal(broken.reason, 'HTTP 500')
  const redirect = await liveCheck(`${base}/redirect`)
  assert.equal(redirect.ok, true)
  assert.equal(redirect.final_url, `${base}/ok`)
  const empty = await liveCheck(`${base}/empty`)
  assert.equal(empty.ok, true)
  assert.equal(empty.title, null)
  assert.equal((await liveCheck(`${base}/agent`)).title, 'Mozilla/5.0 (graveyard-livecheck)')
})

test('timeout and unreachable server give ok false with a reason', async () => {
  const slow = await liveCheck(`${base}/slow`, { timeoutMs: 200 })
  assert.equal(slow.ok, false)
  assert.match(slow.reason, /^TimeoutError: /)
  const free = createServer()
  await new Promise((ok) => free.listen(0, '127.0.0.1', ok))
  const port = free.address().port
  await new Promise((ok) => free.close(ok))
  const to = await liveCheck(`http://127.0.0.1:${port}/`)
  assert.equal(to.ok, false)
  assert.equal(to.status, null)
  assert.match(to.reason, /ECONNREFUSED/)
})

test('liveChecks: order as in the input, progress up to total', async () => {
  const steps = []
  const result = await liveChecks({ b: `${base}/ok`, a: `${base}/gone` }, { progress: (f) => steps.push(f) })
  assert.deepEqual(Object.keys(result), ['b', 'a'])
  assert.deepEqual([result.b.ok, result.a.ok], [true, false])
  assert.deepEqual(steps.at(-1), { step: 'live', done: 2, total: 2, text: steps.at(-1).text })
})
