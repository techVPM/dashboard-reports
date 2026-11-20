// Background function: writes one checkpoint report for the client journey (can take up to a minute).
import { getClients, resolveClient } from '../lib/store.mjs';
import { runReport } from './journey.mjs';

export default async (req) => {
  if (!process.env.REFRESH_SECRET || req.headers.get('x-refresh-secret') !== process.env.REFRESH_SECRET) return new Response('forbidden', { status: 403 });
  const { token, days } = await req.json().catch(() => ({}));
  const all = await getClients();
  const client = resolveClient(all.find((c) => c.token === token), all);
  if (!client) return;
  const r = await runReport(client, Number(days));
  console.log('journey report', client.name, days, r.status, r.error || '');
};
