// Gatekeeper in front of everything the village serves: page, images, data.
// Only the login page and Auth.js itself are open. The API routes check the session again.
// Without a sign-in provider in the configuration everything is open.

import { next } from '@vercel/functions'
import { auth } from './auth.js'

const OPEN = /^\/(login(\.html)?|login-[\w-]+\.(jpg|webp)|favicon\.(ico|svg))$/

/**
 * Routing middleware for one instance.
 * @param {{config: object}} instance
 */
export function gatekeeper({ config }) {
  const a = auth(config)
  return async function middleware(request) {
    const { pathname, search } = new URL(request.url)
    if (pathname.startsWith('/api/auth/')) return a.authResponse(request)
    if (a.open || OPEN.test(pathname)) return next()
    if (await a.session(request)) return next()
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Please sign in.' }), {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    const target = new URL('/login', request.url)
    if (pathname !== '/' && pathname !== '/index.html') target.searchParams.set('next', pathname + search)
    return new Response(null, { status: 302, headers: { location: target.toString(), 'cache-control': 'no-store' } })
  }
}
