// Small helpers for the API routes

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export const unauthorized = () => json({ error: 'Please sign in.' }, 401);

export async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

export const STALE_MS = 24 * 60 * 60 * 1000;
export function isStale(world, now = Date.now()) {
  const t = Date.parse(world?.as_of || '');
  return !Number.isFinite(t) || now - t > STALE_MS;
}
