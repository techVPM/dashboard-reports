// Builds and saves the Business page snapshot (GoHighLevel). Used by the daily refresh and the Refresh button.
import { fetchAll, computeBusiness } from './ghl.mjs';
import { cacheGet, cachePut, getClients } from './store.mjs';
import { demoBusiness } from './demo-business.mjs';

export const BUSINESS_KEY = 'business/latest';

export async function buildBusiness({ env = process.env, fetchFn = fetch, now = Date.now() } = {}) {
  const reportClients = await getClients(env).catch(() => []);
  if (env.VPM_DEV && !env.GHL_TOKEN) return computeBusiness({ ...demoBusiness(now, reportClients.filter((c) => !c.disabled)), now, reportClients });
  const data = await fetchAll({ env, fetchFn });
  return computeBusiness({ ...data, now, reportClients });
}

export async function refreshBusiness(opts = {}) {
  const snap = await buildBusiness(opts);
  await cachePut(BUSINESS_KEY, { saved_at: Date.now(), snap });
  return snap;
}

export async function savedBusiness() {
  const hit = await cacheGet(BUSINESS_KEY);
  return hit && hit.snap ? hit : null;
}
