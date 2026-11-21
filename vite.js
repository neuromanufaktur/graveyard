// Vite plugin for a graveyard instance.
//  - serves the instance configuration to the browser as `virtual:graveyard/config` (photos as assets)
//  - fills the placeholders in index.html and login.html (login.html is shipped as it is, not bundled)
//  - runs the gatekeeper (middleware) and the API routes inside the dev server, so local
//    development behaves like the deployment. Without sign-in locally: GRAVEYARD_NO_AUTH=1
//    (only outside Vercel, see server/auth.js).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forBrowser, normalize, LANGUAGES } from './server/config.js';

const ENGINE = path.dirname(fileURLToPath(import.meta.url));
const VIRTUAL = 'virtual:graveyard/config';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {object} options
 * @param {string} options.config path to graveyard.config.json
 * @param {string} options.middleware path to the instance's middleware.js
 * @param {string} options.api folder with the instance's API routes (api/<name>.js)
 * @param {string} [options.outDir] build output (default: dist/ in the working directory)
 */
export function graveyard({ config: configPath, middleware, api, outDir = path.resolve('dist') }) {
  const configFile = path.resolve(configPath);
  const configFolder = path.dirname(configFile);
  const load = () => normalize(JSON.parse(readFileSync(configFile, 'utf8')));
  let k = load();

  function module() {
    const browser = forBrowser(k);
    const imports = [];
    const photos = [];
    for (const [id, p] of Object.entries(browser.team)) {
      if (!p.photo) continue;
      const file = path.resolve(configFolder, p.photo);
      imports.push(`import photo${imports.length} from ${JSON.stringify(file)};`);
      photos.push(`config.team[${JSON.stringify(id)}].photo = photo${photos.length};`);
    }
    return `${imports.join('\n')}\nconst config = ${JSON.stringify(browser)};\n${photos.join('\n')}\nexport default config;\n`;
  }

  function placeholders(html) {
    const a = k.auth;
    const L = LANGUAGES[k.language].login;
    const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, x) => (x in vars ? vars[x] : m));
    const domains = a.domains.map((d) => '@' + d).join(L.or);
    const texts = { denied: L.denied, failed: L.failed, signedOut: L.signedOut, wait: L.wait };
    const values = {
      lang: esc(LANGUAGES[k.language].meta.htmlLang),
      brand: esc(k.brand),
      title: esc(k.title),
      provider: esc(a.provider || ''),
      loginAccess: esc(L.access),
      loginButton: esc(fill(L.button, { provider: a.label })),
      loginTexts: JSON.stringify(texts).replace(/</g, '\\u003c'),
      access: domains ? esc(fill(L.domains, { domains })) : '',
    };
    return html.replace(/\{\{(\w+)\}\}/g, (m, x) => (x in values ? values[x] : m));
  }

  const loginPage = () => placeholders(readFileSync(path.join(ENGINE, 'login.html'), 'utf8'));

  async function asRequest(req, url) {
    const parts = [];
    if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req) parts.push(c);
    const headers = new Headers();
    for (const [key, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(key, Array.isArray(v) ? v.join(', ') : v);
    return new Request(url, { method: req.method, headers, body: parts.length ? Buffer.concat(parts) : undefined });
  }
  async function write(res, response) {
    res.statusCode = response.status;
    response.headers.forEach((v, key) => { if (key !== 'set-cookie') res.setHeader(key, v); });
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    if (!response.body) return res.end();
    for await (const part of response.body) res.write(part);
    res.end();
  }

  return {
    name: 'graveyard',
    config() {
      const input = { index: path.join(ENGINE, 'index.html') };
      return {
        root: ENGINE,
        envDir: process.cwd(),
        optimizeDeps: { entries: ['index.html'] },
        server: { fs: { allow: [ENGINE, configFolder, process.cwd()] } },
        build: { outDir, emptyOutDir: true, rollupOptions: { input } },
      };
    },
    resolveId(id) {
      if (id === VIRTUAL) return '\0' + VIRTUAL;
    },
    load(id) {
      if (id === '\0' + VIRTUAL) return module();
    },
    transformIndexHtml: { order: 'pre', handler: placeholders },
    // The login page is a standalone file with inline style and script; it only gets its placeholders
    generateBundle() {
      if (k.auth.provider) this.emitFile({ type: 'asset', fileName: 'login.html', source: loginPage() });
    },
    configureServer(server) {
      server.watcher.add(configFile);
      server.watcher.on('change', (file) => {
        if (path.resolve(file) !== configFile) return;
        k = load();
        const m = server.moduleGraph.getModuleById('\0' + VIRTUAL);
        if (m) server.moduleGraph.invalidateModule(m);
      });
      server.middlewares.use(async (req, res, next) => {
        try {
          if (req.url === '/login' || req.url.startsWith('/login?')) req.url = req.url.replace('/login', '/login.html');
          const url = new URL(req.url, `http://${req.headers.host}`);
          const request = await asRequest(req, url);
          const gatekeeper = (await server.ssrLoadModule(path.resolve(middleware))).default;
          const before = await gatekeeper(request.clone());
          if (before && !before.headers.get('x-middleware-next')) return write(res, before);
          if (url.pathname === '/login.html' && k.auth.provider) {
            res.setHeader('content-type', 'text/html; charset=utf-8');
            return res.end(loginPage());
          }
          if (url.pathname.startsWith('/api/')) {
            const name = url.pathname.slice(5).replace(/\/$/, '');
            if (!/^[a-z-]+$/.test(name)) return next();
            const module = await server.ssrLoadModule(path.join(path.resolve(api), `${name}.js`));
            const fn = module[req.method];
            if (!fn) { res.statusCode = 405; return res.end(); }
            return write(res, await fn(request));
          }
          next();
        } catch (e) { next(e); }
      });
    },
  };
}
