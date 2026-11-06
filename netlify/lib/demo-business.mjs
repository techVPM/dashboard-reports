// Made-up GoHighLevel data for the local preview and tests. No real clients.
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();
export function demoBusiness(now = Date.now()) {
  const people = [
    ['Northwind Coaching', 14, null, 5000], ['Bluebird Dental', 9, null, 6500], ['Summit Roofing', 4, null, 4000],
    ['Harbor Law', 2, null, 5000], ['Cedar Fitness', 0.6, null, 3000], ['Atlas Realty', 11, 3, 5000],
    ['Pine Labs', 7, 5, 4500], ['Orchard Wellness', 6, 2.5, 3500], ['Granite Supply', 13, 8, 5000],
    ['Maple Events', 3, 1.5, 0],
  ];
  const fields = [{ id: 'fs', name: 'Client Start Date' }, { id: 'fe', name: 'Client End Date' }, { id: 'fr', name: 'Monthly Retainer' }, { id: 'fw', name: 'Churn Reason' }];
  const contacts = [], invoices = [];
  people.forEach(([name, ago, endedAgo, fee], i) => {
    const id = 'c' + i, start = now - ago * 30.44 * DAY, end = endedAgo != null ? now - endedAgo * 30.44 * DAY : null;
    contacts.push({ id, name: 'Owner ' + (i + 1), company: name, tags: end ? ['former client'] : ['client'], fields: { fs: iso(start).slice(0, 10), ...(end ? { fe: iso(end).slice(0, 10), fw: ['Budget cut', 'Went in-house', 'Results'][i % 3] } : {}), ...(fee ? { fr: String(fee) } : {}) } });
    const stop = end || now;
    if (!fee) { invoices.push({ id: 'v' + i, status: 'paid', total: 9000, paid: 9000, due: 0, issued: iso(start), paid_at: iso(start), live: true, contact_id: id, company: name, items: [{ name: 'Video production', amount: 9000 }] }); return; }
    let k = 0;
    for (let t = start; t <= stop; t += 30.44 * DAY, k++) invoices.push({ id: 'v' + i + '-' + k, number: String(100 + i * 20 + k), status: 'paid', total: fee + (k ? 0 : 5000), paid: fee + (k ? 0 : 5000), due: 0, issued: iso(t), paid_at: iso(t + DAY), recurring: true, live: true, contact_id: id, company: name, items: [{ name: 'Ads Management (Monthly)', amount: fee }].concat(k ? [] : [{ name: 'Campaign Setup', amount: 5000 }]) });
    if (!end && i === 1) invoices.push({ id: 'od', number: '199', status: 'sent', total: fee, paid: 0, due: fee, issued: iso(now - 20 * DAY), due_date: iso(now - 5 * DAY), live: true, contact_id: id, company: name, items: [] });
    if (!end && i === 3) invoices.push({ id: 'up', number: '200', status: 'sent', total: fee, paid: 0, due: fee, issued: iso(now), due_date: iso(now + 6 * DAY), live: true, contact_id: id, company: name, items: [] });
  });
  return { fields, contacts, invoices, warnings: [] };
}
