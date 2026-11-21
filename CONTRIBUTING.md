# Contributing

Thanks for helping. Issues and pull requests are welcome; for larger changes please open an issue
first so we can agree on the direction.

## Development

```sh
npm ci
npm run dev          # http://127.0.0.1:8765 with the demo village
npm test             # node --test, no network
npm run build
```

Node 20.19 or newer (see `engines` in `package.json`).

- `npm run demo` rebuilds `data/world.json` from `tools/demo-world.mjs`. Commit the result together
  with the change that caused it; `test/demo.test.js` checks that both match.
- `npm run screenshots` renders the images in `docs/images/` from a running dev server (needs
  Playwright, see the top of `tools/screenshots.mjs`).
- `npm run pipeline` reads a real organisation or user (`GITHUB_TOKEN`, read-only is enough). Do not
  commit what it writes for your own village to this repository.

## Tests

Every change to the pipeline or the server comes with a test in `test/`. Tests run offline:
GitHub and Claude are replaced by small stand-ins (see `test/collect.test.js` and
`test/owner.test.js`).

## No real data

Fixtures, the demo village, screenshots and examples use invented names only: no real
organisations, people, clients, domains, commit messages or inscriptions, and no anonymised copies
of real data either. Sites use the reserved `.example` domain. If you found a bug with your own
village, reduce it to an invented example before you attach anything.

## Style

Plain JavaScript (ES modules), no build step for the server. Comments explain what the code does
and why, in English.
