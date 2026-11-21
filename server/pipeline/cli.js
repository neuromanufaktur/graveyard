#!/usr/bin/env node
// Local run of the pipeline:
//   GITHUB_TOKEN=… node server/pipeline/cli.js [--config <graveyard.config.json>] [--classification <classification.json>]
//     [--source <folder>] [--target <folder>] [--no-live]
// Reads raw.json, epitaphs.json and live.json from --source (default: data/ in the working
// directory) and writes raw.json, live.json, epitaphs.json and world.json to --target (default: --source).
// Without ANTHROPIC_API_KEY no inscription is rewritten; repos without one get a plain one from facts.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { refresh } from './refresh.js'
import { writerFromEnv } from './epitaphs.js'

const args = process.argv.slice(2)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const configFile = path.resolve(value('--config') ?? 'graveyard.config.json')
const classificationFile = value('--classification') ? path.resolve(value('--classification')) : null
const source = path.resolve(value('--source') ?? 'data')
const target = path.resolve(value('--target') ?? source)
const withoutLive = args.includes('--no-live')

async function read(file, standard = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return standard
    throw e
  }
}

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('GITHUB_TOKEN missing (a read-only token is enough).')
  process.exit(2)
}
const config = await read(configFile)
if (!config) {
  console.error(`Configuration not found: ${configFile}`)
  process.exit(2)
}
if (!process.env.ANTHROPIC_API_KEY) console.error('Note: ANTHROPIC_API_KEY missing. No inscription is rewritten; repos without one get a plain one from facts.')

const outcome = await refresh({
  config,
  token,
  write: writerFromEnv(config),
  before: { raw: await read(path.join(source, 'raw.json')), epitaphs: await read(path.join(source, 'epitaphs.json')) },
  classificationFile: classificationFile ? await read(classificationFile, {}) : {},
  liveFile: await read(path.join(source, 'live.json')),
  liveCheck: !withoutLive,
  now: new Date(),
  progress: (f) => console.error(`[${f.step}] ${f.done}/${f.total} ${f.text}`),
})

await mkdir(target, { recursive: true })
const files = [['raw.json', outcome.raw], ['epitaphs.json', outcome.epitaphs], ['world.json', outcome.world]]
if (!withoutLive) files.push(['live.json', outcome.live])
for (const [file, content] of files) await writeFile(path.join(target, file), JSON.stringify(content, null, 1))
console.error(`Written to ${target}: ${files.map(([d]) => d).join(', ')}`)
console.log(JSON.stringify(outcome.stats, null, 1))
