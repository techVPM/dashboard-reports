// Made-up billing sheet for the local preview, laid out like the real month tabs (header on row 6).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const HEAD = ['', 'Client Name', 'Billing POC', 'Start Date', 'Service Category', 'Monthly Ad Spend ', 'Invoice Amount ', 'Invoice Status', 'Invoice Date', 'Payment Status', 'Invoice Notes', 'Payment Method', 'Status', 'Referral Partner (10%)', 'Additional Notes'];
const $ = (n) => '$' + n.toLocaleString('en-US');
const d = (ym, day) => `${Number(ym.slice(5, 7))}/${day}/${ym.slice(0, 4)}`;

function tab(ym, rows, totals) {
  return [
    ['', '', 'Monthly Summary'],
    ['', 'VPM GHL Transactions', 'Total Active Clients: ', String(totals.active), 'Total Client Ad Spend: ', $(totals.spend), 'Average Monthly Client Value:', '', 'New Clients', String(totals.new || 0)],
    ['', 'VPM Client Pipeline', 'Total Revenue Invoice: ', $(rows.reduce((s, r) => s + (r[6] || 0), 0)), 'Average Client Ad Spend:', '', 'Total Ad Spend % Change: ', '', 'Lost Clients', '0'],
    [], [], HEAD,
    ...rows.map((r) => r.map((c, i) => (i === 6 ? $(c) : i === 5 && typeof c === 'number' ? $(c) : c))),
  ];
}

// A sample next-year sheet with a January tab, for trying the year change in the preview.
export function demoNextYear(now = Date.now()) {
  const cur = demoBillingTabs(now)[1];
  const y = new Date(now).getUTCFullYear() + 1;
  const values = cur.values.map((r) => r.map((c) => (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c) ? `1/${c.split('/')[1]}/${y}` : c)));
  return [{ title: 'Dashboard', values: [['Revenue Dashboard']] }, { title: 'January', values, links: cur.links }];
}

export function demoBillingTabs(now = Date.now()) {
  const t = new Date(now), y = t.getUTCFullYear(), m = t.getUTCMonth();
  const ym = (k) => { const x = new Date(Date.UTC(y, m + k, 15)); return x.toISOString().slice(0, 7); };
  const prev = ym(-1), cur = ym(0), next = ym(1);
  const rowsPrev = [
    ['1', 'Northwind Coaching', 'Dana Price', '', 'Ads Management', 6200, 5000, 'Paid', d(prev, 1), 'Paid', '', 'GHL/Stripe', 'Active'],
    ['', '', '', '', 'Video Production', '', 5000, 'Paid', d(prev, 12), 'Paid', 'Payment 2 of 3', 'GHL/Stripe'],
    ['2', 'Bluebird Dental', 'Sam Ortiz', '', 'Ads Management', 3100, 4000, 'Paid', d(prev, 3), 'Paid', '', 'GHL/Stripe', 'Active'],
    ['3', 'Summit Roofing', 'Lee Grant', '', 'Ads Management', 9800, 5000, 'Paid', d(prev, 2), 'Paid', '', 'GHL/Stripe', 'Active'],
    ['4', 'Harbor Legal', 'Kim Wu', '', 'Ads Management', 0, 5000, 'Needs Discussion', d(prev, 16), 'Unpaid', 'Paused ads, talk about pricing', 'Bill', 'Active'],
    ['5', 'Cedar Fitness', 'Ari Cole', '', 'Ads Management', 1500, 2500, 'Paid', d(prev, 5), 'Paid', 'Half month', 'GHL/Stripe', 'Active'],
    ['6', 'Partner Org', 'Pat Jones', '', 'Ads Management', 0, 0, 'Do Not Send', '', 'Paid', '', 'Quickbooks', 'Active'],
  ];
  const rowsCur = [
    ['1', 'Northwind Coaching', 'Dana Price', '', 'Ads Management', 6400, 5000, 'Paid', d(cur, 1), 'Paid', '', 'GHL/Stripe', 'Active'],
    ['', '', '', '', 'Video Production', '', 5000, 'Wait', d(cur, 2), 'Unpaid', 'Payment 3 of 3, charge on delivery', 'GHL/Stripe'],
    ['2', 'Bluebird Dental', 'Sam Ortiz', '', 'Ads Management', 3300, 4000, 'Invoice Sent', d(cur, 1), 'Card Declined', 'Auto charge if not paid in 5 days', 'GHL/Stripe', 'Active'],
    ['3', 'Summit Roofing', 'Lee Grant', '', 'Ads Management', 12000, 5000, 'Invoice Sent', d(cur, 2), 'Unpaid', '', 'GHL/Stripe', 'Active'],
    ['4', 'Harbor Legal', 'Kim Wu', '', 'Ads Management', 0, 2500, 'Paid', d(cur, 2), 'Paid', 'New rate, 6 months at $2,500', 'Bill', 'Active'],
    ['5', 'Cedar Fitness', 'Ari Cole', '', 'Ads Management', 1800, 5000, 'Paid', d(cur, 3), 'Paid', '', 'GHL/Stripe', 'Active'],
    ['', '', '', '', '', '', '', '', '', '', 'note for the CSM: final charge after the shoot'],
    ['6', 'Partner Org', 'Pat Jones', '', 'Ads Management', 2100, 0, 'Do Not Send', '–', 'Unpaid', '', 'Quickbooks', 'Active'],
    ['7', 'Maple Home Services', 'Jo Reyes', '', 'Video Production', '', 10000, 'Wait', d(cur, 5), 'Unpaid', '', 'GHL/Stripe', 'New'],
  ];
  // the Billing POC cells link to a (made-up) GHL contact, like the real sheet
  const links = (rows) => { const L = {}; rows.forEach((r, i) => { if (r[1]) L[`${7 + i}:3`] = 'https://app.gohighlevel.com/v2/location/DEMO/contacts/detail/demo' + r[0]; }); return L; };
  // next month: a copy of last month, the way the team starts a new tab
  return [
    { title: MONTHS[Number(prev.slice(5)) - 1], month: prev, values: tab(prev, rowsPrev, { active: 6, spend: 20600 }), links: links(rowsPrev) },
    { title: MONTHS[Number(cur.slice(5)) - 1], month: cur, values: tab(cur, rowsCur, { active: 7, spend: 25600, new: 1 }), links: links(rowsCur) },
    { title: MONTHS[Number(next.slice(5)) - 1], month: next, values: tab(prev, rowsPrev, { active: 6, spend: 20600 }), links: links(rowsPrev) },
  ];
}
