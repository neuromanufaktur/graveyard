// Inscriptions: prompt from the configuration (with and without mourners), answer checks,
// plain inscriptions without a model, and the rule that only new commits trigger a model call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { base } from '../server/pipeline/prepare.js'
import {
  needsNewEpitaph, claudeWriter, generate, factsEpitaph, mournersOf, updateEpitaphs, HAIKU, promptFor, check,
  writerFromEnv,
} from '../server/pipeline/epitaphs.js'

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))
const raw = read('./fixtures/raw.json')
const live = read('./fixtures/live.json')
const now = raw.as_of
const WITHOUT = { org: 'example-org' }
const WITH = {
  org: 'example-org',
  mourners: {
    promptGroup: 'from the night shift',
    members: {
      owl: { name: 'Owl', role: 'Watch', prompt: 'keeps watch, sees everything' },
      fox: { name: 'Fox', role: 'Archive' },
    },
  },
  epitaphs: { context: 'Example Org (small studio)', tone: 'dry.' },
}
const GERMAN = { ...WITH, language: 'de', epitaphs: { project: 'das Nachtprojekt von Example Org', tone: 'trocken.' } } // german-check: ignore (German prompt template under test)
const repos = (config = WITHOUT) => base({ raw, live, now, config })
const VALID = '{"inscription": "Here lies a test.", "cause_of_death": "New commits", "npc": {"who": "Owl", "text": "Seen."}}'
function counter(response = VALID) {
  const calls = []
  return { calls, write: async (p) => (calls.push(p), typeof response === 'function' ? response(p, calls.length) : response) }
}

test('prompt: project, tone and mourners from the configuration; without mourners no npc field', () => {
  const r = repos(WITH).find((x) => x.name === 'delta-bot')
  const withMourners = promptFor(r, WITH)
  assert.match(withMourners, /^You are writing an inscription for a Git repo for "graveyard", the night-time village where the repositories of Example Org \(small studio\) live and rest\. /)
  assert.match(withMourners, /\nTone: dry\. No slapstick/)
  assert.match(withMourners, /"npc": \{"who": "…", "text": "…"\}/)
  assert.ok(withMourners.endsWith('- npc: a comment by one mourner from the night shift, at most 100 characters, in their role: Owl (keeps watch, sees everything), Fox (Archive). Pick the person who has the most to say about this repo.'))
  assert.match(withMourners, /State of the repo: dead \(no push for 400 days, lies in the graveyard\)/)
  assert.match(withMourners, /"name": "delta-bot"/)
  const without = promptFor(repos().find((x) => x.name === 'delta-bot'), WITHOUT)
  assert.match(without, /of example-org live and rest\. The world/)
  assert.doesNotMatch(without, /npc/)
  assert.ok(without.endsWith('for living repos an empty string.'))
  assert.throws(() => promptFor(r, { org: 'x', epitaphs: { language: 'fr' } }), /not supported/)
})

test('prompt in German: template, field names and state names in the prompt language', () => {
  const r = repos(GERMAN).find((x) => x.name === 'delta-bot')
  const p = promptFor(r, GERMAN)
  assert.match(p, /^Du schreibst für das Nachtprojekt von Example Org eine Inschrift/) // german-check: ignore (German prompt template under test)
  assert.match(p, /\nTon: trocken\. Kein Klamauk/)
  assert.match(p, /\(seit 400 Tagen kein Push, liegt auf dem Friedhof\)/) // german-check: ignore (German prompt template under test)
  assert.match(p, /"tage_ohne_push": 400/)
  assert.match(p, /"npc": \{"wer": "…", "text": "…"\}/)
  const [fields, error] = check('{"inschrift": "Hier.", "todesursache": "x", "npc": {"wer": "Owl", "text": "Ja."}}', 'dead', mournersOf(GERMAN), GERMAN)
  assert.deepEqual(error, {})
  assert.deepEqual(fields, { inscription: 'Hier.', cause_of_death: 'x', npc: { who: 'Owl', text: 'Ja.' } })
})

test('answer check: mourner names from the configuration, none expected without mourners', () => {
  const [f1, e1] = check(VALID, 'dead', mournersOf(WITH))
  assert.deepEqual(e1, {})
  assert.deepEqual(f1.npc, { who: 'Owl', text: 'Seen.' })
  const [, e2] = check(VALID.replace('Owl', 'Bob'), 'dead', mournersOf(WITH))
  assert.equal(e2.npc, "npc.who 'Bob' not in ['Fox', 'Owl']")
  const [f3, e3] = check('{"inscription": "Here.", "cause_of_death": "x"}', 'dead', mournersOf(WITHOUT))
  assert.deepEqual(e3, {})
  assert.equal(f3.npc, undefined)
  const [f4] = check('```json\n{"inscription": "House.", "cause_of_death": "should be empty"}\n```', 'alive')
  assert.equal(f4.cause_of_death, '') // living repos have no cause of death
  const [, e5] = check('{"inscription": "With – dash", "cause_of_death": ""}', 'dead')
  assert.match(e5.inscription, /dash/)
  assert.ok(check('no json', 'dead')[1].json)
})

test('second attempt after an invalid answer, valid fields are collected', async () => {
  const r = repos(WITH).find((x) => x.name === 'delta-bot')
  const { write, calls } = counter((p, n) =>
    n === 1 ? '{"inscription": "Here lies X.", "cause_of_death": "x", "npc": {"who": "Bob", "text": "y"}}' : '{"inscription": "", "npc": {"who": "Fox", "text": "Filed."}}')
  const { result, calls: n, reason } = await generate(r, write, WITH)
  assert.equal(n, 2)
  assert.ok(calls[1].endsWith("\n\nYour last attempt was invalid: npc.who 'Bob' not in ['Fox', 'Owl']. Follow the rules exactly."))
  assert.deepStrictEqual(result, { inscription: 'Here lies X.', cause_of_death: 'x', npc: { who: 'Fox', text: 'Filed.' } })
  assert.equal(reason, null)
})

test('without a writer: plain inscriptions from facts for every repo, no model call', async () => {
  const result = await updateEpitaphs({ repos: repos(), write: null, now })
  assert.equal(result.calls, 0)
  assert.equal(result.facts.length, raw.repos.length)
  const e = result.file.repos['delta-bot']
  assert.equal(e.source, 'facts')
  assert.equal(e.hash, null) // stays due, so a model rewrites it once a key is there
  assert.match(e.inscription, /^delta-bot\. 9 commits/)
  assert.equal(e.cause_of_death, 'No push for 400 days')
  assert.equal(result.file.repos['buried-idea'].cause_of_death, 'Buried by hand')
  assert.equal(result.file.repos['alpha-app'].cause_of_death, '')
  assert.equal(factsEpitaph(repos(GERMAN).find((x) => x.name === 'delta-bot'), GERMAN).cause_of_death, 'Seit 400 Tagen kein Push') // german-check: ignore (German prompt template under test)
  assert.equal(writerFromEnv(WITHOUT, {}), null)
  assert.equal(typeof writerFromEnv(WITHOUT, { ANTHROPIC_API_KEY: 'sk-test' }), 'function')
  for (const r of repos()) assert.ok(factsEpitaph(r).inscription.length <= 140)
})

test('only new commits trigger the model: first run writes all, second none, one new commit exactly one', async () => {
  const a = counter()
  const first = await updateEpitaphs({ repos: repos(WITH), write: a.write, now, config: WITH })
  assert.equal(a.calls.length, raw.repos.length)
  const b = counter()
  const later = '2027-01-01T00:00:00Z' // time passes, states change
  await updateEpitaphs({ repos: base({ raw, live, now: later, config: WITH }), before: first.file, beforeRaw: raw, write: b.write, now: later, config: WITH })
  assert.equal(b.calls.length, 0)
  const updated = structuredClone(raw)
  const r = updated.repos.find((x) => x.name === 'gamma-api')
  r.commits += 1
  r.head_sha = 'sha-new'
  const c = counter()
  const third = await updateEpitaphs({ repos: base({ raw: updated, live, now, config: WITH }), before: first.file, beforeRaw: raw, write: c.write, now, config: WITH })
  assert.equal(c.calls.length, 1)
  assert.match(c.calls[0], /"name": "gamma-api"/)
  assert.deepEqual(third.written, ['gamma-api'])
})

test('needsNewEpitaph: head SHA before count, fallback to old raw data', () => {
  const entry = { inscription: 'x', hash: 'h', commits: 3, last_commit: 'a', head_sha: 's1' }
  assert.equal(needsNewEpitaph(entry, { commits: 3, last_commit: 'a', head_sha: 's1' }).due, false)
  assert.equal(needsNewEpitaph(entry, { commits: 3, last_commit: 'a', head_sha: 's2' }).due, true)
  assert.equal(needsNewEpitaph({ inscription: 'x', hash: 'h' }, { commits: 4, last_commit: 'b' }, { commits: 3, last_commit: 'a' }).reason, 'new commits')
  assert.equal(needsNewEpitaph({ inscription: '', hash: 'h' }, {}).reason, 'no valid epitaph')
})

test('claudeWriter: SDK call with a stand-in, text of the answer back', async () => {
  let request
  const fetch = async (url, init) => {
    request = { url: String(url), body: JSON.parse(init.body) }
    return new Response(JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: HAIKU, stop_reason: 'end_turn', stop_details: null,
      content: [{ type: 'text', text: '{"inscription": ' }, { type: 'text', text: '"A"}' }], usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  assert.equal(await claudeWriter({ apiKey: 'sk-test', fetch })('Hello'), '{"inscription": "A"}')
  assert.match(request.url, /\/v1\/messages$/)
  assert.equal(request.body.model, HAIKU)
})
