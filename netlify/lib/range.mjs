import { addDays, daysBetween, todayIn } from './ads.mjs';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DAYS = 400;
export const PRESETS = [7, 30, 90];

// Presets end yesterday (a finished day). Custom ranges may include today.
export function resolveRange(params, tz, now) {
  const today = todayIn(tz);
  const yesterday = addDays(today, -1);
  let from = params.get('from');
  let to = params.get('to');
  if (from && to) {
    if (!ISO.test(from) || !ISO.test(to)) return { error: 'Dates must look like 2026-10-30.' };
    if (to > today) to = today;
    if (from > to) return { error: 'The start date must be before the end date.' };
    if (daysBetween(from, to) + 1 > MAX_DAYS) return { error: 'Please choose a range of ' + MAX_DAYS + ' days or fewer.' };
    return { from, to, today };
  }
  const n = parseInt(params.get('days') || params.get('r') || '30', 10);
  const days = Math.min(MAX_DAYS, Math.max(1, Number.isFinite(n) ? n : 30));
  return { from: addDays(yesterday, -(days - 1)), to: yesterday, today };
}

export function presetRange(days, tz) {
  const yesterday = addDays(todayIn(tz), -1);
  return { from: addDays(yesterday, -(days - 1)), to: yesterday };
}

// Cached reports are keyed by account, dates, and a fingerprint of the client's settings,
// so editing a client's targets, notes or conversion mapping shows up on the next load.
function fingerprint(client) {
  const s = JSON.stringify([client.name, client.outcomes, client.deal_value, client.conversion_field, client.labels, client.targets, client.notes, client.actions, client.term_groups, client.timezone, client.currency, client.last_change_date]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export const cacheKey = (client, from, to) => `${String(client.customer_id).replace(/\D/g, '')}/${fingerprint(client)}/${from}_${to}`;
