// Reads the saved (cached) report for a client and a preset range (7, 30 or 90 days).
import { cacheGet, latestKey } from './store.mjs';
import { presetRange, cacheKey } from './range.mjs';

export const PRE = [7, 30, 90];
export async function savedReport(c, days) {
  let hit = await cacheGet(latestKey(c.token, days));
  if (!hit) { const { from, to } = presetRange(days, c.timezone); hit = await cacheGet(cacheKey(c, from, to)); }
  return hit && hit.payload ? hit : null;
}
