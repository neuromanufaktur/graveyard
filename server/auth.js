// Sign-in via Auth.js. The provider and the allowed e-mail domains come from the configuration;
// without a provider the village is open and every visitor is an anonymous guest.
//
// A valid account at the provider is not enough on its own: the e-mail domain must be on the
// allow list, otherwise anyone with an account at that provider could get in.
//
// GRAVEYARD_NO_AUTH=1 skips sign-in for local visual checks. It only works outside Vercel
// and outside production builds. Never weaken the checks below for testing.

import { Auth } from '@auth/core'
import GitHub from '@auth/core/providers/github'
import GitLab from '@auth/core/providers/gitlab'
import Google from '@auth/core/providers/google'
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id'
import { normalize } from './config.js'

const PROVIDER = { 'microsoft-entra-id': MicrosoftEntraID, github: GitHub, google: Google, gitlab: GitLab }

export const NO_AUTH =
  process.env.GRAVEYARD_NO_AUTH === '1' && !process.env.VERCEL && process.env.NODE_ENV !== 'production'

const GUEST = Object.freeze({ email: 'guest', name: 'Guest', figure: null, anonymous: true })

function providerFor(id) {
  const prefix = `AUTH_${id.toUpperCase().replace(/-/g, '_')}_`
  const env = process.env
  const options = { clientId: env[prefix + 'ID'], clientSecret: env[prefix + 'SECRET'] }
  if (env[prefix + 'ISSUER']) options.issuer = env[prefix + 'ISSUER']
  return PROVIDER[id](options)
}

const cache = new WeakMap()

/**
 * Sign-in helpers for one instance.
 * @param {object} rawConfig raw or normalised configuration
 */
export function auth(configRaw) {
  const k = normalize(configRaw)
  if (cache.has(k)) return cache.get(k)
  const { provider, domains } = k.auth
  const open = !provider

  function domainAllowed(email) {
    if (typeof email !== 'string') return false
    const domain = email.split('@')[1]?.toLowerCase()
    return !!domain && domains.includes(domain)
  }

  // Login e-mail -> own character in the village. Unknown people choose one themselves.
  function figureFor(email) {
    const part = String(email || '').split('@')[0].split('+')[0].toLowerCase()
    for (const p of Object.values(k.team)) if (p.logins.includes(part)) return p.id
    return null
  }

  function displayName(email, name) {
    const f = figureFor(email)
    if (f) return k.team[f].name
    return String(name || email || '').split(/[\s@]+/)[0].slice(0, 24)
  }

  // Default identity for local checks without sign-in: first team member at the first allowed domain
  function devEmail() {
    const first = Object.values(k.team)[0]
    return `${first?.logins[0] || 'dev'}@${domains[0] || 'localhost'}`
  }

  let authConfigCache = null
  function authConfig() {
    if (authConfigCache) return authConfigCache
    authConfigCache = {
      basePath: '/api/auth',
      trustHost: true,
      secret: process.env.AUTH_SECRET,
      providers: [providerFor(provider)],
      pages: { signIn: '/login', error: '/login' },
      session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
      callbacks: {
        // Runs before every session is created
        signIn({ profile }) {
          return domainAllowed(profile?.email ?? profile?.preferred_username)
        },
        jwt({ token, profile }) {
          if (profile) {
            token.email = String(profile.email ?? profile.preferred_username ?? '').toLowerCase()
            token.name = profile.name || token.name
          }
          return token
        },
        session({ session, token }) {
          session.user = { email: token.email, name: token.name, figure: figureFor(token.email) }
          return session
        },
      },
    }
    return authConfigCache
  }

  // Auth.js answers everything below /api/auth/* itself (sign-in, callback, sign-out, session, CSRF)
  function authResponse(request) {
    if (open) return new Response('Not found', { status: 404 })
    return Auth(request, authConfig())
  }

  // Who is asking? { email, name, figure } or null. Asks Auth.js with the same configuration,
  // without network traffic; the domain is checked a second time here.
  async function session(request) {
    if (open) return GUEST
    if (NO_AUTH) {
      const m = /(?:^|;\s*)dev_me=([^;]+)/.exec(request.headers.get('cookie') || '')
      const email = m ? decodeURIComponent(m[1]) : devEmail()
      return domainAllowed(email) ? { email, name: displayName(email), figure: figureFor(email) } : null
    }
    if (!process.env.AUTH_SECRET) return null
    const url = new URL('/api/auth/session', request.url)
    const response = await Auth(new Request(url, { headers: { cookie: request.headers.get('cookie') || '' } }), authConfig())
    const s = await response.json().catch(() => null)
    const u = s?.user
    return u?.email && domainAllowed(u.email) ? { email: u.email, name: displayName(u.email, u.name), figure: figureFor(u.email) } : null
  }

  const a = { open, domainAllowed, figureFor, displayName, authConfig, authResponse, session }
  cache.set(k, a)
  return a
}
