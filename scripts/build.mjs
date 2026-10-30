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
