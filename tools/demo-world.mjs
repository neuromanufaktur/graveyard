#!/usr/bin/env node
// Demo village: synthetic raw data for the invented organisation "tallowmoor" and the world built
// from it with the real pipeline (prepare.js). Everything is invented: repos, clients, people,
// sites (*.example), commit histories. Deterministic: a fixed seed per repo and a fixed point in
// time, so the same code always gives the same data/world.json.
//
// Inscriptions come from demo/epitaphs.<language>.json (key = repo name, fields inscription,
// cause, mourner: { who, text }); repos without an entry get the plain inscription from facts.
//
//   node tools/demo-world.mjs                  writes data/world.json (only while graveyard.config.json is the demo)
//   node tools/demo-world.mjs --fill-epitaphs  adds missing entries to the epitaph file, from facts
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { normalize } from '../server/config.js'
import { prepare, base } from '../server/pipeline/prepare.js'
import { factsEpitaph, LIVING } from '../server/pipeline/epitaphs.js'
import { authorGroups, authorRules, authorsFromGroups, extensions, metrics, topFolders, RAW_VERSION } from '../server/pipeline/collect.js'
import { pyCompare, pyLen, SCHEMA_VERSION } from '../server/pipeline/helpers.js'

export const DEMO_OWNER = 'tallowmoor'
export const AS_OF = '2026-10-31T22:00:00+00:00'
const SEED = 20261031
const DAY = 86400000

// ---------- the invented organisation ----------

// People who commit. Team names are aliased to the characters in graveyard.config.json.
const PEOPLE = {
  wren: { login: 'wren-hallowell', name: 'Wren Hallowell' },
  otis: { login: 'obrackwater', name: 'Otis Brackwater' },
  juno: { login: 'junotamsin', name: 'Juno Tamsin' },
  pim: { login: 'pimlarkspur', name: 'Pim Larkspur' }, // freelancer on client projects
  bex: { login: 'bexmorrow', name: 'Bex Morrow' }, // former intern, experiments
}
const BOT = { login: 'dependabot[bot]', name: 'dependabot[bot]' }

// One line per repo. push: days since the last push, age: days from first to last commit,
// home/live: site and how the live check went, zombie: pause in days and commits after it.
const P = (name, o) => ({ name, ...o })
export const REPOS = [
  // products, with landing pages and predecessors
  P('gloam', { cat: 'product', lang: 'TypeScript', desc: 'Reading app that dims the page as the evening goes on', commits: 312, push: 1, age: 560, home: 'https://gloam.example', live: 'ok', who: ['wren', 'otis', 'juno'], words: 'Fade the reading light in over ten minutes' }),
  P('gloam-landing', { cat: 'product', lang: 'HTML', desc: 'Landing page for gloam', commits: 46, push: 6, age: 300, home: 'https://www.gloam.example', live: 'ok', who: ['juno', 'otis'], words: 'Swap the hero screenshot for the autumn release' }),
  P('gloam-api', { cat: 'product', lang: 'Go', desc: 'Sync and accounts for gloam', commits: 188, push: 3, age: 480, who: ['wren', 'otis'], words: 'Return 429 with Retry-After instead of 503' }),
  P('gloam-docs', { cat: 'product', lang: 'JavaScript', desc: 'Help centre and API docs for gloam', commits: 64, push: 8, age: 260, home: 'https://docs.gloam.example', live: 'ok', who: ['juno', 'wren'], words: 'Document the night mode schedule' }),
  P('gloam-v1', { cat: 'product', lang: 'JavaScript', desc: 'First version of gloam', commits: 74, push: 640, age: 260, archived: true, successor: 'gloam', who: ['wren', 'juno'], words: 'Point the README to the new gloam repo' }),
  P('ferrywell', { cat: 'product', lang: 'Rust', desc: 'Resumable file transfer for flaky hotel wifi', commits: 241, push: 2, age: 420, home: 'https://ferrywell.example', live: 'ok', who: ['wren', 'otis'], words: 'Resume uploads from the last confirmed chunk' }),
  P('ferrywell-gui', { cat: 'product', lang: 'TypeScript', desc: 'Desktop app for ferrywell', commits: 118, push: 5, age: 240, who: ['otis', 'juno'], words: 'Show transfer speed in the tray icon' }),
  P('ferrywell-landing', { cat: 'product', lang: 'HTML', desc: 'Landing page for ferrywell', commits: 23, push: 11, age: 150, home: 'https://www.ferrywell.example', live: 'ok', who: ['juno'], words: 'Add pricing table' }),
  P('ferrywell-legacy', { cat: 'product', lang: 'Python', desc: 'The original ferrywell prototype in Python', commits: 58, push: 700, age: 380, archived: true, successor: 'ferrywell', who: ['wren'], words: 'Archive: superseded by the Rust rewrite' }),
  P('hearthbook', { cat: 'product', lang: 'Kotlin', desc: 'Recipe book for families who share one kitchen', commits: 156, push: 4, age: 365, home: 'https://hearthbook.example', live: 'ok', who: ['otis', 'juno', 'wren'], words: 'Scale ingredient amounts when servings change' }),
  P('hearthbook-ios', { cat: 'product', lang: 'Swift', desc: 'hearthbook for the phone', commits: 92, push: 10, age: 210, who: ['otis', 'juno'], words: 'Keep the screen awake while cooking' }),
  P('hearthbook-landing', { cat: 'product', lang: 'HTML', desc: 'Landing page for hearthbook', commits: 31, push: 19, age: 200, home: 'https://www.hearthbook.example', live: 'ok', who: ['juno'], words: 'Translate the landing page to Dutch' }),
  P('hearthbook-proto', { cat: 'product', lang: 'Dart', desc: 'Clickable prototype of hearthbook', commits: 22, push: 520, age: 90, archived: true, successor: 'hearthbook', who: ['juno', 'otis'], words: 'Last prototype build before the Kotlin rewrite' }),
  P('lanternfish', { cat: 'product', lang: 'Swift', desc: 'Night sky companion for the phone', commits: 97, push: 64, age: 300, home: 'https://lanternfish.example', live: 'ok', who: ['otis', 'juno'], words: 'Bump build number for 2.3.1' }),
  P('lanternfish-landing', { cat: 'product', lang: 'HTML', desc: 'Landing page for lanternfish', commits: 18, push: 71, age: 120, home: 'https://www.lanternfish.example', live: 'ok', who: ['juno'], words: 'Add App Store badge' }),
  P('kettle-sync', { cat: 'product', lang: 'Python', desc: 'Keeps shared shopping lists in sync', commits: 133, push: 48, age: 400, home: 'https://kettle.example', live: 'ok', who: ['wren', 'bex'], words: 'Log sync conflicts instead of raising' }),
  P('kettle-classic', { cat: 'product', lang: 'Ruby', desc: 'Shopping list web app, the Rails years', commits: 61, push: 560, age: 300, archived: true, successor: 'kettle-sync', who: ['wren', 'otis'], words: 'Freeze gems before archiving' }),
  P('wickstat', { cat: 'product', lang: 'Elixir', desc: 'Tiny uptime dashboard', commits: 52, push: 38, age: 330, home: 'https://wickstat.example', live: 'ok', zombie: { pause: 140, after: 8 }, who: ['wren'], words: 'Upgrade Phoenix and fix the broken charts' }),
  P('moorwatch', { cat: 'product', lang: 'TypeScript', desc: 'Weather alerts for hikers', commits: 96, push: 210, age: 330, who: ['otis', 'wren', 'juno'], words: 'TODO: ask someone about the API pricing' }),
  P('moorwatch-landing', { cat: 'product', lang: 'HTML', desc: 'Landing page for moorwatch', commits: 14, push: 230, age: 60, who: ['juno'], words: 'Add newsletter form' }),

  // internal
  P('tallowmoor-handbook', { cat: 'internal', lang: null, desc: 'How we work', commits: 88, push: 5, age: 600, who: ['juno', 'wren', 'otis'], words: 'Add the on-call checklist' }),
  P('tallowmoor-website', { cat: 'internal', lang: 'HTML', desc: 'Our own website', commits: 54, push: 16, age: 480, home: 'https://tallowmoor.example', live: 'ok', who: ['juno', 'otis'], words: 'Add the autumn job posting' }),
  P('lamplighter', { cat: 'internal', lang: 'TypeScript', desc: 'Chat bot that announces deploys', commits: 73, push: 4, age: 300, who: ['wren', 'otis'], words: 'Mention the person who merged' }),
  P('infra', { cat: 'internal', lang: 'HCL', desc: 'Servers, DNS and databases as code', commits: 204, push: 2, age: 650, who: ['wren'], words: 'Raise the database disk to 40 GB' }),
  P('shipwright', { cat: 'internal', lang: 'Shell', desc: 'Release and rollback helpers', commits: 67, push: 9, age: 500, who: ['wren', 'otis'], words: 'Retry the health check three times before rollback' }),
  P('status-page', { cat: 'internal', lang: 'JavaScript', desc: 'Public status page', commits: 29, push: 95, age: 200, home: 'https://status.tallowmoor.example', live: 'ok', who: ['otis'], words: 'Add maintenance banner' }),
  P('dotfiles', { cat: 'internal', lang: 'Shell', desc: 'Shared editor and shell settings', commits: 43, push: 52, age: 400, who: ['otis', 'wren'], words: 'Switch prompt theme' }),
  P('design-tokens', { cat: 'internal', lang: 'TypeScript', desc: 'Colours, spacing and type scale for every app', commits: 37, push: 66, age: 180, home: 'https://tokens.tallowmoor.example', live: 'down', who: ['juno'], words: 'Export tokens as CSS variables' }),

  // experiments
  P('crow-cache', { cat: 'experiment', lang: 'Go', desc: 'In-memory cache with a sense of humour', commits: 64, push: 7, age: 420, zombie: { pause: 160, after: 11 }, who: ['wren', 'bex'], words: 'LRU eviction finally works' }),
  P('night-shift', { cat: 'experiment', lang: 'Python', desc: 'Runs jobs at sunset', commits: 21, push: 13, age: 40, who: ['bex'], words: 'Schedule jobs by sunset time' }),
  P('brambleboard', { cat: 'experiment', lang: 'TypeScript', desc: 'Kanban board that grows like a hedge', commits: 48, push: 41, age: 300, zombie: { pause: 120, after: 6 }, who: ['otis', 'juno'], words: 'Drag cards between lanes again' }),
  P('moss-render', { cat: 'experiment', lang: 'Rust', desc: 'Software renderer for soft shadows', commits: 77, push: 74, age: 220, who: ['wren'], words: 'Half-finished shadow pass' }),
  P('inkpot-cli', { cat: 'experiment', lang: 'Go', desc: 'Notes from the terminal', commits: 19, push: 8, age: 60, who: ['otis'], words: 'Add --dry-run' }),
  P('sundial-api', { cat: 'experiment', lang: 'Ruby', desc: 'Time zones as a service', commits: 26, push: 58, age: 150, home: 'https://sundial.example', live: 'parked', who: ['bex', 'wren'], words: 'Move time zone data to a gem' }),
  P('owl-pager', { cat: 'experiment', lang: 'Python', desc: 'Pages you at night, but quietly', commits: 3, push: 400, age: 2, who: ['bex'], words: 'first try' }),
  P('fog-machine', { cat: 'experiment', lang: 'JavaScript', desc: 'Particle fog for the browser', commits: 12, push: 300, age: 25, who: ['juno'], words: 'it works on my machine' }),
  P('midnight-chess', { cat: 'experiment', lang: 'TypeScript', desc: 'Chess engine that only plays after dark', commits: 34, push: 260, age: 70, who: ['otis', 'bex'], words: 'Engine now resigns politely' }),
  P('rune-parser', { cat: 'experiment', lang: 'Haskell', desc: 'Parser combinators, again', commits: 180, push: 450, age: 500, who: ['wren'], words: 'Rewrite the lexer, part 4' }),
  P('willow-ml', { cat: 'experiment', lang: 'Python', desc: 'Predicts when the willow loses its leaves', commits: 46, push: 20, age: 90, home: 'https://willow.example', live: 'ok', buried: true, who: ['bex', 'wren'], words: 'Train on the full dataset tonight' }),
  P('gravel-sh', { cat: 'experiment', lang: 'Shell', desc: 'A shell written in shell', commits: 15, push: 130, age: 30, buried: true, who: ['otis'], words: 'Remove the scary rm -rf' }),
  P('thimble-vm', { cat: 'experiment', lang: 'C', desc: 'The smallest virtual machine we could think of', commits: 4, push: 520, age: 3, who: ['wren'], words: 'Opcode table, half done' }),
  P('teacup-orm', { cat: 'experiment', lang: 'PHP', desc: 'An ORM that fits in a teacup', commits: 41, push: 15, age: 160, who: ['otis'], words: 'Add lazy loading for relations' }),
  P('magpie-scraper', { cat: 'experiment', lang: 'Python', desc: 'Collects shiny links', commits: 38, push: 9, age: 200, who: ['bex'], words: 'Respect robots.txt' }),
  P('candle-timer', { cat: 'experiment', lang: 'JavaScript', desc: 'Pomodoro timer that burns down', commits: 2, push: 800, age: 1, archived: true, who: ['juno'], words: 'Initial commit' }),
  P('puddle-db', { cat: 'experiment', lang: 'Rust', desc: 'Key value store, very shallow', commits: 9, push: 600, age: 20, archived: true, who: ['wren'], words: 'Persist pages to disk' }),
  P('hollow-icons', { cat: 'internal', lang: 'JavaScript', desc: 'Outline icon set', commits: 27, push: 470, age: 120, archived: true, who: ['juno'], words: 'Add 12 weather icons' }),
  P('sparrow-chat', { cat: 'product', lang: 'Elixir', desc: 'Group chat for small teams', commits: 210, push: 690, age: 540, archived: true, who: ['wren', 'otis', 'juno'], words: 'Shut down the public server' }),
  P('bellrope', { cat: 'experiment', lang: 'Lua', desc: 'Rings a bell on new mail', commits: 13, push: 540, age: 40, archived: true, who: ['otis'], words: 'Ring the bell on new mail' }),
  P('nightjar-wiki', { cat: 'internal', lang: 'Ruby', desc: 'The old team wiki', commits: 22, push: 900, age: 200, archived: true, who: ['juno', 'wren'], words: 'Read-only mode' }),

  // clients
  P('fernhollow-shop', { cat: 'client', client: 'fernhollow', lang: 'TypeScript', desc: 'Online shop for bread and pastries', commits: 142, push: 3, age: 210, home: 'https://shop.fernhollow.example', live: 'ok', who: ['otis', 'pim', 'juno'], words: 'Hide sold-out loaves after 2 pm' }),
  P('fernhollow-orders', { cat: 'client', client: 'fernhollow', lang: 'Python', desc: 'Pre-orders for the morning bake', commits: 76, push: 12, age: 160, who: ['wren', 'pim'], words: 'Print pre-orders at 4 am' }),
  P('fernhollow-website', { cat: 'client', client: 'fernhollow', lang: 'HTML', desc: 'Website of the bakery', commits: 39, push: 320, age: 60, home: 'https://www.fernhollow.example', live: 'ok', who: ['juno', 'pim'], words: 'Handover: add the editing guide' }),
  P('quillmere-tracking', { cat: 'client', client: 'quillmere', lang: 'Go', desc: 'Pallet tracking for the warehouse', commits: 118, push: 5, age: 420, zombie: { pause: 130, after: 14 }, who: ['wren', 'pim'], words: 'Track pallets per bay' }),
  P('quillmere-portal', { cat: 'client', client: 'quillmere', lang: 'TypeScript', desc: 'Customer portal for shipments', commits: 203, push: 150, age: 330, home: 'https://portal.quillmere.example', live: 'ok', who: ['otis', 'wren', 'pim'], words: 'Final release 1.8.0' }),
  P('quillmere-edi', { cat: 'client', client: 'quillmere', lang: 'Java', desc: 'EDI messages to and from carriers', commits: 57, push: 410, age: 140, who: ['wren'], words: 'Map ORDERS segments' }),
  P('saltgrove-booking', { cat: 'client', client: 'saltgrove', lang: 'PHP', desc: 'Appointment booking for eye tests', commits: 88, push: 240, age: 200, home: 'https://book.saltgrove.example', live: 'ok', who: ['otis', 'pim'], words: 'Send a reminder two days before' }),
  P('saltgrove-app', { cat: 'client', client: 'saltgrove', lang: 'Swift', desc: 'Try on frames with the camera', commits: 64, push: 20, age: 120, who: ['otis', 'juno'], words: 'Add frame try-on preview' }),
  P('tindervale-members', { cat: 'client', client: 'tindervale', lang: 'Ruby', desc: 'Member list and fees', commits: 71, push: 500, age: 260, who: ['wren', 'pim'], words: 'Export members for the annual meeting' }),
  P('tindervale-regatta', { cat: 'client', client: 'tindervale', lang: 'Dart', desc: 'Results app for the regatta', commits: 49, push: 26, age: 75, who: ['otis', 'juno'], words: 'Live lane times on the big screen' }),
  P('tindervale-site', { cat: 'client', client: 'tindervale', lang: 'HTML', desc: 'Website of the rowing club', commits: 17, push: 130, age: 30, home: 'https://www.tindervale.example', live: 'ok', who: ['juno'], words: 'Update season dates' }),
]

// ---------- deterministic randomness ----------

function hash32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]

// ---------- commit history ----------

const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z'
const NOW = Date.parse(AS_OF)

// n points in time from start to end, gaps random but never longer than cap (so a repo only
// looks resurrected where the spec says so)
function spread(r, n, start, end, cap) {
  if (n === 1) return [end]
  const w = Array.from({ length: n - 1 }, () => -Math.log(1 - r() * 0.999))
  let gaps = w.map((x) => x)
  const span = end - start
  for (let round = 0; round < 50; round++) {
    const sum = gaps.reduce((a, b) => a + b, 0)
    gaps = gaps.map((g) => (g / sum) * span)
    const over = gaps.filter((g) => g > cap)
    if (!over.length || cap * gaps.length < span) break
    gaps = gaps.map((g) => Math.min(g, cap * 0.9))
  }
  const out = [start]
  for (const g of gaps) out.push(out[out.length - 1] + g)
  out[out.length - 1] = end
  return out.map(Math.round)
}

function commitTimes(spec, r) {
  const end = NOW - spec.push * DAY - Math.floor(r() * 5 * 3600_000)
  const start = end - spec.age * DAY
  const cap = 60 * DAY
  if (!spec.zombie) return spread(r, spec.commits, start, end, cap)
  const { pause, after } = spec.zombie
  const afterSpan = Math.min(after * 3, 40) * DAY
  const before = spread(r, spec.commits - after, start, end - afterSpan - pause * DAY, cap)
  const later = spread(r, after, end - afterSpan, end, cap)
  return [...before, ...later]
}

const MESSAGES = {
  feature: ['Add CSV export', 'Add dark mode', 'Add pagination to the list view', 'Add health check endpoint', 'Add keyboard shortcuts',
    'Add offline cache', 'Add search', 'Add settings page', 'Support time zones', 'Add retry on timeout', 'Add empty state', 'Add onboarding screens'],
  fix: ['Fix flaky test', 'Fix time zone offset in reports', 'Fix typo in README', 'Fix login redirect loop', 'Fix off-by-one in pagination',
    'Fix crash on empty input', 'Fix memory leak in the worker', 'Fix rounding of totals', 'Fix layout on small screens', 'Fix race in the sync queue'],
  chore: ['Update README', 'Refactor config loading', 'Remove dead code', 'Tidy up imports', 'Rename helpers', 'Update CI', 'Pin the runtime version',
    'Split the main module', 'Move constants to one place', 'Add tests for the parser'],
  wip: ['wip', 'more wip', 'tweak', 'try again', 'small fixes', 'cleanup'],
}
const KINDS = ['feature', 'feature', 'fix', 'fix', 'fix', 'chore', 'chore', 'wip']
const BUMPS = { TypeScript: 'vite', JavaScript: 'express', Python: 'requests', Ruby: 'rack', PHP: 'guzzle', Go: 'x/net', Rust: 'serde', Kotlin: 'ktor', Dart: 'http', Elixir: 'phoenix' }

function commits(spec, r) {
  const times = commitTimes(spec, r)
  const team = spec.who.map((k) => PEOPLE[k])
  const weights = team.map((_, i) => 1 / (i + 1.3))
  const total = weights.reduce((a, b) => a + b, 0)
  const author = () => {
    let x = r() * total
    for (let i = 0; i < team.length; i++) if ((x -= weights[i]) < 0) return team[i]
    return team[team.length - 1]
  }
  const bump = BUMPS[spec.lang]
  const list = times.map((t, i) => {
    let who = author()
    let msg
    if (i === 0) msg = 'Initial commit'
    else if (i === times.length - 1) msg = spec.words
    else if (bump && spec.commits >= 30 && r() < 0.06) {
      who = BOT
      const v = 1 + Math.floor(r() * 9)
      msg = `Bump ${bump} from ${v}.${Math.floor(r() * 10)}.0 to ${v}.${Math.floor(r() * 10) + 1}.0`
    } else msg = pick(r, MESSAGES[pick(r, KINDS)])
    return { sha: createHash('sha1').update(`${spec.name}:${i}`).digest('hex'), date: iso(t), login: who.login, name: who.name, email: '', msg }
  })
  return list.reverse() // newest first, as GitHub lists them
}

// ---------- files ----------

const LANGS = {
  TypeScript: { ext: ['ts', 'ts', 'tsx'], dirs: ['src', 'src/lib', 'test'], files: ['package.json', 'package-lock.json', 'tsconfig.json'] },
  JavaScript: { ext: ['js'], dirs: ['src', 'test'], files: ['package.json', 'package-lock.json'] },
  Go: { ext: ['go'], dirs: ['cmd', 'internal', 'pkg'], files: ['go.mod', 'go.sum', 'Makefile'] },
  Rust: { ext: ['rs'], dirs: ['src', 'benches', 'tests'], files: ['Cargo.toml', 'Cargo.lock'] },
  Python: { ext: ['py'], dirs: ['app', 'tests'], files: ['pyproject.toml', 'requirements.txt'] },
  Kotlin: { ext: ['kt'], dirs: ['app/src/main', 'app/src/test'], files: ['build.gradle.kts', 'settings.gradle.kts', 'gradlew'] },
  Swift: { ext: ['swift'], dirs: ['Sources', 'Tests'], files: ['Package.swift'] },
  Dart: { ext: ['dart'], dirs: ['lib', 'test'], files: ['pubspec.yaml', 'pubspec.lock'] },
  Ruby: { ext: ['rb', 'erb'], dirs: ['app', 'lib', 'spec'], files: ['Gemfile', 'Gemfile.lock', 'Rakefile'] },
  PHP: { ext: ['php'], dirs: ['src', 'tests'], files: ['composer.json', 'composer.lock'] },
  Elixir: { ext: ['ex', 'exs'], dirs: ['lib', 'test'], files: ['mix.exs', 'mix.lock'] },
  Haskell: { ext: ['hs'], dirs: ['src', 'test'], files: ['package.yaml', 'stack.yaml'] },
  Java: { ext: ['java'], dirs: ['src/main/java', 'src/test/java'], files: ['pom.xml'] },
  C: { ext: ['c', 'h'], dirs: ['src', 'include'], files: ['Makefile'] },
  Lua: { ext: ['lua'], dirs: ['src'], files: ['rockspec'] },
  Shell: { ext: ['sh'], dirs: ['bin', 'lib'], files: [] },
  HCL: { ext: ['tf'], dirs: ['modules', 'envs/prod', 'envs/staging'], files: ['versions.tf'] },
  HTML: { ext: ['html', 'css', 'js', 'svg'], dirs: ['assets', 'pages'], files: ['index.html'] },
  null: { ext: ['md'], dirs: ['guides', 'onboarding', 'decisions'], files: [] },
}
const WORDS = ['auth', 'cache', 'config', 'export', 'feed', 'format', 'jobs', 'layout', 'list', 'mail', 'model', 'queue', 'render', 'router',
  'search', 'session', 'settings', 'store', 'sync', 'theme', 'upload', 'user', 'worker', 'clock', 'parser', 'report', 'billing', 'events']

function fileList(spec, r) {
  const L = LANGS[spec.lang] ?? LANGS.null
  const files = new Set(['README.md', '.gitignore', ...L.files])
  if (r() < 0.6) files.add('LICENSE')
  if (spec.commits > 20) files.add('.github/workflows/ci.yml')
  const n = Math.max(3, Math.min(260, Math.round(4 + spec.commits * (0.35 + r() * 0.5))))
  for (let guard = 0; files.size < n && guard < n * 20; guard++) {
    const w = pick(r, WORDS) + (r() < 0.4 ? '-' + pick(r, WORDS) : '')
    files.add(`${pick(r, L.dirs)}/${w}.${pick(r, L.ext)}`)
  }
  return [...files].sort()
}

// ---------- raw data, live check ----------

function topics(spec) {
  const t = ['graveyard-' + spec.cat]
  if (spec.client) t.push('graveyard-client-' + spec.client)
  if (spec.successor) t.push('graveyard-successor-' + spec.successor)
  if (spec.buried) t.push('graveyard-buried')
  return t
}

function rawEntry(spec, config) {
  const r = rng(SEED ^ hash32(spec.name))
  const list = commits(spec, r)
  const files = fileList(spec, r)
  const dates = list.map((c) => c.date).sort()
  const groups = authorGroups(list, authorRules(config))
  const [months, pause, weeks] = metrics(dates)
  const top = [...new Set(files.map((f) => (f.includes('/') ? f.split('/')[0] + '/' : f)))]
  const last = Date.parse(dates[dates.length - 1])
  return {
    name: spec.name,
    description: spec.desc,
    language: spec.lang,
    created_at: iso(Date.parse(dates[0]) - Math.floor(r() * 2 * DAY)),
    last_push: iso(spec.archived ? last : last + Math.floor(r() * 600_000)),
    archived: !!spec.archived,
    homepage: spec.home ?? null,
    topics: topics(spec),
    default_branch: 'main',
    commits: list.length,
    first_commit: dates[0],
    last_commit: dates[dates.length - 1],
    last_words: list[0].msg,
    commit_dates: dates,
    commits_per_month: months,
    longest_pause_days: pause,
    active_weeks: weeks,
    authors: authorsFromGroups(groups, authorRules(config)),
    files: files.length,
    top_folders: topFolders(top),
    extensions: extensions(files),
    readme: `# ${spec.name}\n\n${spec.desc}.\n`,
    recent_commits: list.slice(0, 10).map((c) => c.msg),
    source: 'api',
    head_sha: list[0].sha,
    author_groups: groups,
    raw_version: RAW_VERSION,
  }
}

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))

/** The demo configuration (graveyard.config.json while it still belongs to the demo) */
export const demoConfig = () => read('../graveyard.config.json')
export const isDemo = (config) => normalize(config).owner === DEMO_OWNER

/** Synthetic raw.json of the demo organisation */
export function demoRaw(config = demoConfig()) {
  const repos = REPOS.map((s) => rawEntry(s, config)).sort((a, b) => pyCompare(a.name.toLowerCase(), b.name.toLowerCase()))
  return { schema_version: SCHEMA_VERSION, as_of: AS_OF, org: DEMO_OWNER, repos }
}

/** Synthetic live.json: every repo with a site, answered the way the spec says */
export function demoLive() {
  const live = {}
  const TITLE = (s) => s.name.replace(/-landing$/, '').replace(/^./, (c) => c.toUpperCase())
  for (const s of [...REPOS].sort((a, b) => pyCompare(a.name, b.name))) {
    if (!s.home) continue
    const ok = { url: s.home, status: 200, server: 'demo', title: TITLE(s), final_url: s.home + '/', ok: true, reason: null }
    if (s.live === 'down') live[s.name] = { ...ok, status: 404, title: null, final_url: null, ok: false, reason: 'HTTP 404' }
    else if (s.live === 'parked') live[s.name] = { ...ok, title: 'This domain is parked', ok: false, reason: 'parked or 404 page: parked' }
    else live[s.name] = ok
  }
  return { schema_version: SCHEMA_VERSION, as_of: AS_OF, live }
}

// ---------- inscriptions ----------

const FORBIDDEN = /[–—\u{1F000}-\u{1FAFF}☀-➿]/u
const epitaphFile = (config) => new URL(`../demo/epitaphs.${normalize(config).language}.json`, import.meta.url)

function readEpitaphs(config) {
  try {
    return JSON.parse(readFileSync(epitaphFile(config), 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return {}
    throw e
  }
}

/**
 * Checks the hand-written entries: known repo, lengths and characters as for model answers,
 * mourner from the configuration. Throws with every problem listed.
 */
export function checkEpitaphs(file, repos, config) {
  const names = new Set(repos.map((r) => r.name))
  const mourners = new Set(Object.values(normalize(config).mourners.members).map((m) => m.name))
  const problems = []
  for (const [name, e] of Object.entries(file)) {
    if (name.startsWith('$')) continue
    const p = (text) => problems.push(`${name}: ${text}`)
    if (!names.has(name)) { p('no such repo in the demo'); continue }
    const ins = e.inscription ?? ''
    if (!ins || pyLen(ins) > 140) p(`inscription needs 1 to 140 characters (has ${pyLen(ins)})`)
    if (pyLen(e.cause ?? '') > 80) p(`cause needs at most 80 characters (has ${pyLen(e.cause)})`)
    const m = e.mourner
    if (m && (m.who || m.text)) {
      if (!mourners.has(m.who)) p(`mourner.who "${m.who}" is not one of ${[...mourners].join(', ')}`)
      if (!m.text || pyLen(m.text) > 100) p(`mourner.text needs 1 to 100 characters (has ${pyLen(m.text ?? '')})`)
    }
    for (const [field, text] of [['inscription', ins], ['cause', e.cause], ['mourner.text', m?.text]]) {
      if (text && FORBIDDEN.test(text)) p(`${field} contains a dash or an emoji`)
    }
  }
  if (problems.length) throw new Error(`demo/epitaphs file:\n  ${problems.join('\n  ')}`)
}

// Entry from the file in the format of epitaphs.json, otherwise the plain inscription from facts
function epitaphFor(r, entry, config) {
  if (!entry) return factsEpitaph(r, config)
  return {
    inscription: entry.inscription,
    cause_of_death: LIVING.has(r.state) ? '' : entry.cause ?? '',
    npc: { who: entry.mourner?.who ?? '', text: entry.mourner?.text ?? '' },
  }
}

/** Placeholder entry from facts, for --fill-epitaphs */
function placeholder(r, i, config) {
  const f = factsEpitaph(r, config)
  const mourners = Object.values(normalize(config).mourners.members).map((m) => m.name)
  const text = `${r.commits} commits. Last words: "${r.last_words}"`
  return {
    inscription: f.inscription,
    cause: f.cause_of_death,
    mourner: mourners.length ? { who: mourners[i % mourners.length], text: text.length <= 100 ? text : `${r.commits} commits.` } : undefined,
  }
}

/** The demo world as the game loads it (data/world.json) */
export function demoWorld(config = demoConfig()) {
  const raw = demoRaw(config)
  const live = demoLive()
  const repos = base({ raw, live, now: AS_OF, config })
  const file = readEpitaphs(config)
  checkEpitaphs(file, repos, config)
  const epitaphs = { repos: Object.fromEntries(repos.map((r) => [r.name, epitaphFor(r, file[r.name], config)])) }
  return prepare({ raw, live, epitaphs, now: AS_OF, config })
}

/** Adds an entry from facts for every repo the epitaph file does not have yet; never overwrites */
export function fillEpitaphs(config = demoConfig()) {
  const file = readEpitaphs(config)
  const repos = base({ raw: demoRaw(config), live: demoLive(), now: AS_OF, config })
  let added = 0
  repos.forEach((r, i) => {
    if (file[r.name]) return
    file[r.name] = placeholder(r, i, config)
    added++
  })
  const head = Object.entries(file).filter(([k]) => k.startsWith('$'))
  const body = Object.entries(file).filter(([k]) => !k.startsWith('$')).sort((a, b) => pyCompare(a[0], b[0]))
  writeFileSync(epitaphFile(config), JSON.stringify(Object.fromEntries([...head, ...body]), null, 1) + '\n')
  return added
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const config = demoConfig()
  if (!isDemo(config)) {
    console.error(`graveyard.config.json belongs to "${normalize(config).owner}", not to the demo (${DEMO_OWNER}); data/world.json is left alone.`)
    process.exit(2)
  }
  if (process.argv.includes('--fill-epitaphs')) console.log(`${fillEpitaphs(config)} entries added to demo/epitaphs.${normalize(config).language}.json`)
  writeFileSync(new URL('../data/world.json', import.meta.url), JSON.stringify(demoWorld(config), null, 1))
  console.log('data/world.json written')
}
