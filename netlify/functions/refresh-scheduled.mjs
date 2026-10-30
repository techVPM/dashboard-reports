// Runs every day and asks the background function to refresh each client.
// Schedule is in UTC. 16:00 UTC = 10:00 am Mountain Daylight Time (summer), 9:00 am Mountain Standard Time (winter).
// Change the cron line below to "0 17 * * *" after daylight saving ends if you want 10 am all year.
import { loadClients } from '../lib/store.mjs';

export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const secret = process.env.REFRESH_SECRET;
  if (!base || !secret) {
    console.error('refresh: REFRESH_SECRET or site URL missing');
    return;
  }
  const clients = loadClients().filter((c) => c.token && c.customer_id && !c.disabled);
  // Background functions answer right away (202) and keep working for up to 15 minutes each.
  const results = await Promise.allSettled(
    clients.map((c) =>
      fetch(base + '/.netlify/functions/refresh-background', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-refresh-secret': secret },
        body: JSON.stringify({ token: c.token }),
        signal: AbortSignal.timeout(20000),
      }).then((r) => r.status)
    )
  );
  console.log('refresh queued for', clients.length, 'clients;', results.filter((r) => r.status === 'fulfilled').length, 'accepted');
};

export const config = { schedule: '0 16 * * *' };
