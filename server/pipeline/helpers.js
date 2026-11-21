// Small helpers for the pipeline. Where JavaScript counts or sorts differently, they follow
// Python's string semantics (code points instead of UTF-16 units, whitespace, time format) so the
// stored data stays stable.
import { createHash } from 'node:crypto'

// Whitespace as in Python's str.isspace()
const PY_WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
/** Version of the data contract (world.json, raw.json, epitaphs.json, live.json), see engine/DATA.md */
export const SCHEMA_VERSION = 1

export const PY_WS_CLASS = `[${PY_WS}]`
const EDGE = new RegExp(`^${PY_WS_CLASS}+|${PY_WS_CLASS}+$`, 'g')

/** Python str.strip() without argument */
export const pyStrip = (s) => String(s).replace(EDGE, '')

/** Python s[:n] (counts code points) */
export function firstChars(s, n) {
  let i = 0
  for (let k = 0; i < s.length && k < n; k++) {
    const c = s.charCodeAt(i)
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00
    i += pair ? 2 : 1
  }
  return s.slice(0, i)
}

/** Python len(s) */
export function pyLen(s) {
  let k = 0
  for (const _ of s) k++
  return k
}

/** Python string comparison (by code points) for sort() */
export function pyCompare(a, b) {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)
    const cb = b.codePointAt(j)
    if (ca !== cb) return ca < cb ? -1 : 1
    i += ca > 0xffff ? 2 : 1
    j += cb > 0xffff ? 2 : 1
  }
  if (i < a.length) return 1
  if (j < b.length) return -1
  return 0
}

/** Python f-string rendering (None, True, False) */
export function py(x) {
  if (x === null || x === undefined) return 'None'
  if (x === true) return 'True'
  if (x === false) return 'False'
  return String(x)
}

/** Python str(x or "") for values from JSON */
export function pyStr(x) {
  if (x === null || x === undefined || x === false || x === 0 || x === '') return ''
  if (Array.isArray(x)) return x.length ? JSON.stringify(x) : ''
  if (typeof x === 'object') return Object.keys(x).length ? JSON.stringify(x) : ''
  return py(x)
}

/** json.dumps(list, ensure_ascii=False) for a flat list (separator ", ") */
export const pyJsonList = (parts) => '[' + parts.map((x) => JSON.stringify(x === undefined ? null : x)).join(', ') + ']'

export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

export function asDate(x) {
  const d = x instanceof Date ? new Date(x.getTime()) : new Date(x)
  if (Number.isNaN(d.getTime())) throw new Error(`not a valid point in time: ${x}`)
  return d
}

/** ISO time in UTC with seconds and offset, e.g. 2025-01-31T23:10:20+00:00 */
export const isoSeconds = (x) => asDate(x).toISOString().slice(0, 19) + '+00:00'

/** Any ISO time as 2025-01-31T23:10:20Z (fractions of a second dropped) */
export const utcIso = (s) => asDate(s).toISOString().slice(0, 19) + 'Z'

/** Whole days from a to b, rounded down */
export const daysBetween = (a, b) => Math.floor((asDate(b) - asDate(a)) / 86400000)

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** At most max tasks at the same time */
export function limiter(max) {
  let active = 0
  const wait = []
  const next = () => {
    while (active < max && wait.length) {
      const { fn, ok, reject } = wait.shift()
      active++
      Promise.resolve()
        .then(fn)
        .then(ok, reject)
        .finally(() => {
          active--
          next()
        })
    }
  }
  return (fn) =>
    new Promise((ok, reject) => {
      wait.push({ fn, ok, reject })
      next()
    })
}

/** fn for all elements, at most max at a time, results in input order */
export function mapParallel(list, max, fn) {
  const run = limiter(max)
  return Promise.all(list.map((x, i) => run(() => fn(x, i))))
}

/** List of repo entries from raw.json, from repos[] or from an object keyed by name */
export function rawList(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (Array.isArray(raw.repos)) return raw.repos
  return Object.values(raw)
}

export const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

/** Object with keys sorted case-insensitively by code point */
export function sortedByName(obj) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => pyCompare(a[0].toLowerCase(), b[0].toLowerCase())))
}
