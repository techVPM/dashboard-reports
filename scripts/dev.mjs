// Local preview: serves dist/ and runs the API function in-process. Usage: node scripts/dev.mjs [port]
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import report from '../netlify/functions/report.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8888);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + port);
  if (url.pathname === '/api/report') {
    const r = await report(new Request(url, { method: req.method }));
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const f = join(root, 'dist', url.pathname === '/' ? 'index.html' : url.pathname);
  if (existsSync(f) && f.startsWith(join(root, 'dist'))) { res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' }); res.end(readFileSync(f)); }
  else { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log('preview on http://localhost:' + port));
