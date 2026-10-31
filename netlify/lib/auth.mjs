// Password check for the team dashboard and the admin page.
// Uses ADMIN_PASSWORD, or REFRESH_SECRET if ADMIN_PASSWORD has not been set.
import { timingSafeEqual } from 'node:crypto';

export function adminPassword(env = process.env) {
  return String(env.ADMIN_PASSWORD || env.REFRESH_SECRET || '').trim();
}
export function isAdmin(req, env = process.env) {
  const want = adminPassword(env);
  const got = String(req.headers.get('x-admin-key') || '').trim();
  if (!want || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
