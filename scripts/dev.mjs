// Local preview: serves dist/ and runs the API function in-process. Usage: node scripts/dev.mjs [port]
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import report from '../netlify/functions/report.mjs';
import team from '../netlify/functions/team.mjs';
import admin from '../netlify/functions/admin.mjs';
import creative from '../netlify/functions/creative.mjs';
import business from '../netlify/functions/business.mjs';
import profile from '../netlify/functions/profile.mjs';
import billing from '../netlify/functions/billing.mjs';
import { cachePut, loadClients, latestKey } from '../netlify/lib/store.mjs';
import { demoReport } from '../netlify/lib/demo.mjs';
import { addDays } from '../netlify/lib/ads.mjs';

process.env.VPM_DEV = '1';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'dev';
process.env.BILLING_EDIT_PASSWORD = process.env.BILLING_EDIT_PASSWORD || 'bill';
// Sample 30-day data for each client so the team dashboard has something to show locally.
{
  const to = addDays(new Date().toISOString().slice(0, 10), -1);
  for (const days of [7, 30, 90]) loadClients({}).forEach((c, i) => { if (i % 4 !== 3) cachePut(latestKey(c.token, days), { saved_at: Date.now(), payload: demoReport(i % 2 ? 'demo' : 'demo-calls', addDays(to, -(days - 1)), to) }); });
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8888);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + port);
  const fn = { '/api/report': report, '/api/team': team, '/api/admin': admin, '/api/creative': creative, '/api/business': business, '/api/profile': profile, '/api/billing': billing }[url.pathname];
  if (fn) {
    const chunks = []; for await (const ch of req) chunks.push(ch);
    if (/[?&]slow=1/.test(req.headers.referer || '')) await new Promise((r) => setTimeout(r, 6000)); // preview the loading bar
    const r = await fn(new Request(url, { method: req.method, headers: { 'x-admin-key': req.headers['x-admin-key'] || '', 'x-billing-key': req.headers['x-billing-key'] || '', 'content-type': req.headers['content-type'] || 'application/json' }, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let name = url.pathname === '/' ? 'index.html' : { '/team': 'team.html', '/admin': 'admin.html', '/creative': 'creative.html', '/business': 'business.html', '/profile': 'profile.html', '/billing': 'billing.html' }[url.pathname] || url.pathname;
  if (!existsSync(join(root, 'dist', name)) && /^\/[A-Za-z0-9_-]+\/?$/.test(name)) name = 'index.html'; // clean links like /coach-by-chris-1613
  const f = join(root, 'dist', name);
  if (existsSync(f) && f.startsWith(join(root, 'dist'))) { res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' }); res.end(readFileSync(f)); }
  else { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log('preview on http://localhost:' + port));
