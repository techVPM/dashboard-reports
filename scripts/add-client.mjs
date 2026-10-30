// Adds a client to clients.json with a fresh private link token.
// Usage: node scripts/add-client.mjs "Client Name" 123-456-7890 [America/Denver]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, customer, tz] = process.argv.slice(2);
if (!name || !customer) { console.log('Usage: node scripts/add-client.mjs "Client Name" 123-456-7890 [America/Denver]'); process.exit(1); }
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'clients.json');
const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const token = randomBytes(24).toString('base64url');
list.push({ token, name, customer_id: customer, timezone: tz || 'America/Denver', outcomes: { calls: ['Booked Call'] }, labels: {}, targets: {}, notes: [], actions: [], term_groups: {} });
writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
console.log('Added ' + name + '. Private link ends with:  ?k=' + token);
console.log('Next: open clients.json, set the conversion action names under "outcomes", then commit and deploy.');
