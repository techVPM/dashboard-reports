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
writeFileSync(join(root, 'dist', '_redirects'), '/team  /team.html  200\n/admin  /admin.html  200\n/:slug  /index.html  200\n');

// Team pages: the all-clients dashboard (/team) and the clients and goals editor (/admin).
const teamCss = rd('team.css');
for (const [file, title] of [['team.html', 'All Clients | VPM'], ['admin.html', 'Clients and Goals | VPM']]) {
  writeFileSync(join(root, 'dist', file), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
${fonts}
<style>html,body{margin:0}</style>
<style>${css}\n${teamCss}</style>
</head>
<body>
${rd(file)}
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
  for (const f of ['favicon.ico']) if (existsSync(join(root, 'public', f))) copyFileSync(join(root, 'public', f), join(root, 'dist', f));
}
console.log('built dist/index.html (' + page.length + ' bytes) and dist/ghl-embed.html (' + embed.length + ' bytes)');
