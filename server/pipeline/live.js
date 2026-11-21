// Live check of the sites: 8 s timeout, in parallel.
// ok means: a 2xx answer and no sign of a parked or missing page.
import { firstChars, mapParallel, PY_WS_CLASS, pyStrip } from './helpers.js'

export const PARKED_PATTERN = new RegExp(
  'for sale|domain kaufen|domain zu verkaufen|diese domain|parked|parking|sedo|godaddy|dan\\.com|' + // german-check: ignore (German parking pages)
    'hugedomains|buy this domain|domain is available|DEPLOYMENT_NOT_FOUND|404: NOT_FOUND|' +
    'deployment could not be found|this domain is not configured|coming soon|location\\.href="/lander"',
  'i',
)
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i
const WHITESPACE = new RegExp(`${PY_WS_CLASS}+`, 'g')
const AGENT = 'Mozilla/5.0 (graveyard-livecheck)'

function titleOf(body) {
  const m = TITLE.exec(body)
  return m ? firstChars(pyStrip(m[1].replace(WHITESPACE, ' ')), 200) : null
}

function errorText(e) {
  const c = e?.cause
  const name = e?.name === 'TimeoutError' || c?.name === 'TimeoutError' ? 'TimeoutError' : c?.code || c?.name || e?.name || 'Error'
  return `${name}: ${firstChars(String(c?.message || e?.message || e), 120)}`
}

// Reads at most max bytes; every chunk of data extends the timeout (like a socket read timeout)
async function read(res, max, next) {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const parts = []
  let n = 0
  try {
    while (n < max) {
      const { done, value } = await reader.read()
      if (done) break
      next()
      parts.push(value)
      n += value.length
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  return Buffer.concat(parts).subarray(0, max).toString('utf8')
}

/** Checks one URL. Result like an entry in live.json. */
export async function liveCheck(url, { fetch: f = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const result = { url, status: null, server: null, title: null, final_url: null, ok: false, reason: null }
  const ctrl = new AbortController()
  const abort = () => ctrl.abort(new DOMException(`no answer after ${timeoutMs / 1000} s`, 'TimeoutError'))
  let clock = setTimeout(abort, timeoutMs)
  const next = () => {
    clearTimeout(clock)
    clock = setTimeout(abort, timeoutMs)
  }
  try {
    const res = await f(url, { headers: { 'user-agent': AGENT }, redirect: 'follow', signal: ctrl.signal })
    result.status = res.status
    result.server = res.headers.get('server')
    if (res.status < 200 || res.status >= 300) {
      // error status: no final_url, patterns only in the body
      let body = ''
      try {
        body = await read(res, 50_000, next)
      } catch {
        body = ''
      }
      const m = PARKED_PATTERN.exec(body)
      result.reason = `HTTP ${res.status}` + (m ? `, ${m[0]}` : '')
      result.title = titleOf(body)
      return result
    }
    result.final_url = res.url || url
    const body = await read(res, 200_000, next)
    result.title = titleOf(body)
    const park = PARKED_PATTERN.exec((result.title || '') + ' ' + firstChars(body, 20_000))
    if (!park) result.ok = true
    else result.reason = `parked or 404 page: ${park[0]}`
    return result
  } catch (e) {
    result.reason = errorText(e)
    return result
  } finally {
    clearTimeout(clock)
  }
}

/**
 * Checks all URLs in parallel.
 * @param {Record<string, string>} urls repo name -> URL
 * @returns {Promise<Record<string, object>>} repo name -> result, in the order of urls
 */
export async function liveChecks(urls, { fetch, parallel = 12, timeoutMs = 8000, progress } = {}) {
  const pairs = Object.entries(urls)
  let done = 0
  progress?.({ step: 'live', done: 0, total: pairs.length, text: `Checking ${pairs.length} sites.` })
  const results = await mapParallel(pairs, parallel, async ([name, url]) => {
    const result = await liveCheck(url, { fetch, timeoutMs })
    done++
    progress?.({ step: 'live', done, total: pairs.length, text: `${name} ${result.ok ? 'is reachable' : 'does not answer properly'}.` })
    return [name, result]
  })
  return Object.fromEntries(results)
}
