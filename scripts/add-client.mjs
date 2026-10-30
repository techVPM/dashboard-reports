// Adds a client to clients.json. The link key is the client name plus the last 4 digits of the Google Ads ID, like coach-by-chris-1613.
// Usage: node scripts/add-client.mjs "Client Name" 123-456-7890 [America/Denver]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, customer, tz] = process.argv.slice(2);
if (!name || !customer) { console.log('Usage: node scripts/add-client.mjs "Client Name" 123-456-7890 [America/Denver]'); process.exit(1); }
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'clients.json');
const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const token = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-' + customer.replace(/\D/g, '').slice(-4);
if (list.some((c) => c.token === token)) { console.log('A client with the link key ' + token + ' already exists.'); process.exit(1); }
list.push({ token, name, customer_id: customer, timezone: tz || 'America/Denver', labels: {}, targets: {}, notes: [], actions: [], term_groups: {} });
writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
console.log('Added ' + name + '. Link: https://YOUR-SITE.netlify.app/' + token);
console.log('Next: open clients.json, add the conversion action names under "outcomes" (optional), then commit and deploy.');
