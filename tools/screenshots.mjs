#!/usr/bin/env node
// Screenshots of a running village for the docs: desktop and phone, each with the opening view,
// the character choice, the map and the detail card of one repo. Writes JPEG files to
// docs/images/ and fails when the page logs errors.
//
//   npm run dev                                   (in a second terminal)
//   node tools/screenshots.mjs [--url http://127.0.0.1:8765] [--out docs/images] [--repo rune-parser] [--only desktop|phone] [--software]
//
// Needs Playwright with Chromium, which is not a dependency of the engine:
//   npm i --no-save playwright && npx playwright install chromium
// or point PLAYWRIGHT at an installed module (path to playwright/index.mjs) and CHROME at a
// Chromium or Chrome binary. WebGL uses the GPU (Metal on macOS); --software switches to
// SwiftShader for machines without one, which renders at about one frame per second, so the
// camera moves too slowly for the waits below.
// JPEG at quality 90: the blurred night scene bands badly with palette PNGs (256 colours).
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (name, standard) => (args.includes(name) ? args[args.indexOf(name) + 1] : standard)
const URL_ = value('--url', 'http://127.0.0.1:8765').replace(/\/$/, '')
const OUT = path.resolve(value('--out', path.join(ENGINE, 'docs/images')))
const REPO = value('--repo', 'rune-parser')
const ONLY = value('--only', null)
const GL = args.includes('--software')
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])]

async function playwright() {
  const tries = [process.env.PLAYWRIGHT && pathToFileURL(process.env.PLAYWRIGHT).href, 'playwright', 'playwright-core'].filter(Boolean)
  for (const t of tries) {
    try {
      const m = await import(t)
      return m.chromium ?? m.default?.chromium
    } catch { /* next */ }
  }
  console.error('Playwright not found. Install it with: npm i --no-save playwright && npx playwright install chromium')
  process.exit(2)
}

const DEVICES = [
  { name: 'desktop', options: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true } },
]
// Messages of the software renderer, not of the village
const NOISE = /GL Driver Message|GPU stall due to ReadPixels|WebGL: CONTEXT_LOST/

const chromium = await playwright()
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: GL,
})
mkdirSync(OUT, { recursive: true })
const errors = []
const written = []

for (const device of DEVICES.filter((d) => !ONLY || d.name === ONLY)) {
  const context = await browser.newContext(device.options)
  await context.addInitScript(() => { try { localStorage.setItem('graveyard.help', '1') } catch { /* private mode */ } })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`[${device.name}] console: ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`[${device.name}] page: ${e.message}`))
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${device.name}] HTTP ${r.status()} ${r.url()}`) })
  const shot = async (n, label) => {
    const file = path.join(OUT, `${device.name}-${n}-${label}.jpg`)
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 })
    written.push(file)
  }

  await page.goto(URL_ + '/', { waitUntil: 'load' })
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 120_000 })
  await page.waitForTimeout(4500) // the loading veil fades, then the camera flies in over the whole board
  await shot(1, 'start')
  await page.waitForSelector('.choice:not([hidden])', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await shot(2, 'choice')
  await page.click('.choice .cards button')
  await page.waitForTimeout(3500)
  if (device.options.isMobile) await page.click('[data-k="map"]')
  else await page.keyboard.press('m')
  await page.waitForTimeout(3500)
  await shot(3, 'map')
  const point = page.locator('.mapPoint', { hasText: REPO }).first()
  if (!(await point.count())) errors.push(`[${device.name}] no point for ${REPO} on the map`)
  else {
    await point.dispatchEvent('click')
    await page.waitForTimeout(3500)
    await shot(4, 'detail')
  }
  await context.close()
}
await browser.close()

let total = 0
for (const f of written) {
  const size = statSync(f).size
  total += size
  console.log(`${path.relative(process.cwd(), f)}  ${Math.round(size / 1024)} KB`)
}
console.log(`${written.length} images, ${(total / 1024 / 1024).toFixed(2)} MB`)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('no console errors')
