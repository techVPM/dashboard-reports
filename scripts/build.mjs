// Builds dist/index.html (for Netlify) and dist/ghl-embed.html (paste into a GoHighLevel custom code block).
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => readFileSync(join(root, 'src', f), 'utf8');
const css = rd('style.css');
const body = rd('body.html');
const js = ['core.js', 'insights.js', 'charts.js', 'views.js', 'app.js'].map(rd).join('\n');
const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Source+Sans+3:wght@400;600;700&display=swap">`;
// Browser tab icon. Drop the real VPM icon in public/ as favicon.png (square, 512x512 is ideal) and it is used instead.
const hasPng = existsSync(join(root, 'public', 'favicon.png'));
const icons = hasPng
  ? '<link rel="icon" type="image/png" href="/favicon.png">\n<link rel="apple-touch-icon" href="/favicon.png">'
  : '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
const script = (pre) => `<script>\n${pre}(function(){\n"use strict";\n${js}\n})();\n</script>`;

mkdirSync(join(root, 'dist'), { recursive: true });

// 1. Standalone page for Netlify.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Performance Report</title>
${icons}
${fonts}
<style>html,body{margin:0}</style>
<style>${css}</style>
</head>
<body>
${body}
${script('')}
</body>
</html>
`;
writeFileSync(join(root, 'dist', 'index.html'), page);
// Clean client links such as /coach-by-chris-1613. Two safety nets besides the rule in netlify.toml:
// a _redirects rule, and a 404.html that is the same report page (Netlify shows it for any unknown address).
writeFileSync(join(root, 'dist', '_redirects'), '/team  /team.html  200\n/admin  /admin.html  200\n/creative  /creative.html  200\n/business  /business.html  200\n/profile  /profile.html  200\n/:slug  /index.html  200\n');

// Team pages: the all-clients dashboard (/team) and the clients and goals editor (/admin).
const teamCss = rd('team.css');
// Tabs across the team pages. Business is admin-only (the page asks for the admin password).
const TABS = [
  ['team', '/team', 'All clients', 'Clients', '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>'],
  ['creative', '/creative', 'Creative Hub', 'Creative', '<rect x="2.5" y="4" width="15" height="12" rx="2"/><path d="M8.5 7.8v4.4l4-2.2z"/>'],
  ['business', '/business', 'Business', 'Business', '<path d="M3 16.5h14"/><path d="M5.5 13.5v-4M10 13.5v-8M14.5 13.5v-6"/>'],
  ['admin', '/admin', 'Clients and goals', 'Goals', '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>'],
];
const tabs = (on) => '<nav class="itabs" aria-label="Team pages">' + TABS.map(([k, h, l, sh, ic]) => `<a class="itab${k === on ? ' on' : ''}" href="${h}"${k === on ? ' aria-current="page"' : ''}><svg viewBox="0 0 20 20" aria-hidden="true">${ic}</svg><span class="lt">${l}</span><span class="st">${sh}</span></a>`).join('') + '</nav>';
const teamPage = (file) => rd(file).replace(/<!--TABS:(\w+)-->/, (_, k) => tabs(k));
for (const [file, title] of [['team.html', 'All Clients | VPM'], ['admin.html', 'Clients and Goals | VPM'], ['creative.html', 'Creative Hub | VPM'], ['business.html', 'Business | VPM'], ['profile.html', 'Client Profile | VPM']]) {
  writeFileSync(join(root, 'dist', file), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
${icons}
${fonts}
<style>html,body{margin:0}</style>
<style>${css}\n${teamCss}</style>
</head>
<body>
${teamPage(file)}
</body>
</html>
`);
}
writeFileSync(join(root, 'dist', '404.html'), page);

// 2. GoHighLevel snippet: same page, but it calls your Netlify API by full address.
const siteUrl = process.env.VPM_API_URL || (process.env.URL ? process.env.URL.replace(/\/$/, '') + '/api/report' : 'https://YOUR-SITE.netlify.app/api/report');
const embed = `${fonts}
<style>${css}</style>
${body}
${script(`window.VPM_API_URL=${JSON.stringify(siteUrl)};\n`)}
`;
writeFileSync(join(root, 'dist', 'ghl-embed.html'), embed);

if (existsSync(join(root, 'public'))) {
  // anything extra in /public (for example a logo) is copied as is
  for (const f of ['favicon.ico', 'favicon.svg', 'favicon.png']) if (existsSync(join(root, 'public', f))) copyFileSync(join(root, 'public', f), join(root, 'dist', f));
}
console.log('built dist/index.html (' + page.length + ' bytes) and dist/ghl-embed.html (' + embed.length + ' bytes)');
