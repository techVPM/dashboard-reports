// Password check for the team dashboard and the admin page.
// Uses ADMIN_PASSWORD, or REFRESH_SECRET if ADMIN_PASSWORD has not been set.
import { timingSafeEqual } from 'node:crypto';

export function adminPassword(env = process.env) {
  return String(env.ADMIN_PASSWORD || env.REFRESH_SECRET || '').trim();
}
function same(want, got) {
  if (!want || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function isAdmin(req, env = process.env) {
  return same(adminPassword(env), String(req.headers.get('x-admin-key') || '').trim());
}
// The creative hub also accepts CREATIVE_PASSWORD, so the creative team does not need the admin password.
export function isCreative(req, env = process.env) {
  const got = String(req.headers.get('x-admin-key') || '').trim();
  return isAdmin(req, env) || same(String(env.CREATIVE_PASSWORD || '').trim(), got);
}
export const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
