# VPM Live Client Reports

Live, client-facing Google Ads reports for Video Power Marketing.

- Reads Google Ads **directly through the VPM manager account (MCC)** using the Google Ads API. No connector, so no limit on how many client accounts you can report on.
- Refreshes every client **once a day around 10 am Mountain**, so the first visit each morning loads instantly.
- Clients pick **Last 7 days, Last 30 days, Last 90 days or a custom range** on the report. Any range is fetched live and saved for a few hours.
- Each client gets a **private link**. No client login.
- Includes the week-by-week table, best campaigns, ads, videos, audiences, keywords and search terms, plus plain-English insights and recommended actions that write themselves from the numbers.
- Runs on **Netlify** today. The same page can be pasted into a **GoHighLevel** page later (see Part 7).

You can preview the whole thing with sample data before any Google credentials exist.

---

## How it fits together

```
Client opens  https://reports.yoursite.com/?k=THEIR-PRIVATE-KEY
      |
      v
  Report page (public/dist)  --->  /api/report  (Netlify function)
                                      |   checks the key in clients.json
                                      |   uses the saved copy if it is fresh
                                      v   otherwise asks Google Ads (through your MCC)
                                  Google Ads API

Every day ~10 am MT:  refresh-scheduled  ->  refresh-background (one per client)
                      saves the 7, 30 and 90 day versions so the first visit is instant
```

Your Google credentials live only in Netlify settings. They are never sent to the browser.

---

## Part 1. Put the project on GitHub (5 minutes)

1. Go to github.com and create a **private** repository called `vpm-live-reports`.
2. Upload every file from this folder (drag and drop works on GitHub's "uploading an existing file" page). Do not upload `node_modules`.

> Keep the repository private. `clients.json` contains each client's private link key.

## Part 2. Create the Netlify site and preview with sample data (5 minutes)

1. In Netlify choose **Add new site, Import an existing project, GitHub** and pick `vpm-live-reports`.
2. Leave the build settings as they are (they come from `netlify.toml`). Click **Deploy**.
3. When it finishes, open `https://YOUR-SITE.netlify.app/?k=demo`.

You should see the full report with sample data. `?k=demo` shows a client with leads, calls and revenue. `?k=demo-calls` shows a client that only tracks booked calls (like Coach by Chris). Try the date buttons at the top.

## Part 3. Connect Google Ads (the one technical step)

**What changed at Google (September 2026).** Google retired developer tokens on September 9, 2026. You no longer get a token from the MCC, and the **API Center inside Google Ads is deprecated** (view only, it can no longer be used to apply for or change access). Access to the Google Ads API now belongs to the **Google Cloud project** that owns your OAuth client, and you manage it in **Google Cloud Console**. Sources: [Google's developer token page](https://developers.google.com/google-ads/api/docs/api-policy/developer-token) and the walkthrough at [slobodan-jelisavac.com](https://www.slobodan-jelisavac.com/en/blog/google-ads-api-basic-access-guide).

This project already works this way. It does not need a developer token. It signs in with OAuth and calls the API through your MCC.

### 3a. Pick the Google Cloud project

If Brandon's weekly report generator already uses an OAuth client, use the Cloud project that owns it (ask him which one). The project number is the first part of the client ID (the digits before the first dash). Using the same project keeps any access Google already carried over. A different project starts at Test access and cannot read live accounts until it is approved.

### 3b. Turn on the API and request access

1. In [Google Cloud Console](https://console.cloud.google.com), select that project and open **APIs and services, Library**. Search for **Google Ads API** and click **Enable**. This gives Test access only, which works on test accounts, not real ones.
2. Open the **Google Ads API** page for the project (**Overview**), expand **Upgrade access level** and click **Apply for access**. You need the Owner, Editor, Quota Administrator or Service Usage Admin role on the project.
3. Choose a level:

| Level | Daily operations | Notes |
|---|---|---|
| Test | 15,000 | Test accounts only. Real accounts fail with `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` |
| Explorer | 2,880 | Real accounts, mostly automatic approval. Good for a first pilot of a few clients |
| Basic | 15,000 (reported by third parties, Google's page does not state a number) | Automatic after brand verification. This is the one to aim for |
| Standard | Higher | Manual review (about 10 business days). Only worth it if you outgrow Basic |

4. **Brand verification** is required for new Basic and Standard applications. In Cloud Console go to **APIs and services, OAuth consent screen**, fill in the app name, support email and contact details, set the audience to **External** and the status to **In production** (even though it is an internal tool), complete the Branding tab (home page, privacy policy, terms, authorized domains), click **Verify branding**, then **Publish branding** within 7 days. Use a business email on your own domain and a company website that loads, because Google looks at those.
5. Setting the status to **In production** also stops refresh tokens from expiring after 7 days, which happens to apps left in Testing.

Google says its own sign-in for new refresh tokens now needs a passkey on the Google account (from August 5, 2026). Existing refresh tokens keep working.

### 3c. Netlify settings

Site configuration, Environment variables:

| Netlify setting | What it is |
|---|---|
| `GOOGLE_ADS_CLIENT_ID` | OAuth client ID from the Cloud project in 3a |
| `GOOGLE_ADS_CLIENT_SECRET` | OAuth client secret from that project |
| `GOOGLE_ADS_REFRESH_TOKEN` | Refresh token for a Google user who has access to the MCC. It must be created with an OAuth client from that same project |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | `5506283927` (the VPM MCC, dashes optional). Sent as the `login-customer-id` header so one login reaches every client under the MCC |
| `REFRESH_SECRET` | Make up a long random password. It lets the daily job call itself, and lets you force a refresh |
| `GOOGLE_ADS_API_VERSION` | Optional. Defaults to `v25`. Google retires each version about a year after release, so check the [sunset dates page](https://developers.google.com/google-ads/api/docs/sunset-dates) twice a year and bump this (`v26` is out) |
| `REFRESH_PRESETS` | Optional. Which views refresh every morning, for example `30` or `7,30`. Default is all of 7, 30 and 90. See the next section |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | **Leave this empty or delete it.** It is ignored by Google today and Google has said future API versions will not accept it |

If your old settings include the developer token, just delete it.

### 3d. How many operations this uses

Google counts a report request as 1 operation no matter how many rows come back, and fetching more pages of the same request costs nothing. One full refresh of one client is about 25 requests per date range.

| Refresh setup | Operations per client per day | Clients on Explorer (2,880) | Clients on Basic (15,000) |
|---|---|---|---|
| Default (7, 30 and 90 day views) | about 75 | about 38 | about 200 |
| `REFRESH_PRESETS=30` | about 25 | about 115 | about 600 |

Date ranges nobody has opened yet, and custom ranges, are fetched when someone clicks them (about 25 each) and then saved. The limit is a rolling 24 hours, not a midnight reset. If you hit it, the report keeps showing the last saved numbers with a "last updated" note.

### 3e. Check it works

After saving the settings, go to **Deploys, Trigger deploy, Deploy site**. Then open a client link with `&fresh=1&s=YOUR_REFRESH_SECRET` added to the end. If something is wrong, the page tells you the real reason (for example "the Google Cloud project only has Test access"). Remove those extra bits from the link before sending it to a client.

Google has listed two known problems on its side: brand verification being rejected for projects on a free trial or with suspended billing, and some freshly upgraded projects getting `AUTHORIZATION_ERROR` on live accounts while a fix rolls out. Both show up in the message above.

## Part 4. Add clients

Open `clients.json`. Each client is one block (see `clients.example.json` for every option):

```json
{
  "token": "coach-by-chris-1613",
  "name": "Coach by Chris",
  "customer_id": "683-045-1613",
  "timezone": "America/New_York",
  "outcomes": { "calls": ["Booked Call"] }
}
```

- `token`: the client's link key. We use the client name in lowercase with dashes, then the last 4 digits of their Google Ads ID, for example `coach-by-chris-1613`. Use only lowercase letters, numbers and dashes. If you have Node on your computer, `node scripts/add-client.mjs "Client Name" 123-456-7890` writes a new block with this key for you.
  - These links are easy to guess, because the client name is public and there are only 10,000 possible endings. If a report is sensitive, add a few random letters to the end of that client's `token` (for example `sandler-7469-k3f9`).
- `customer_id`: the client's Google Ads account ID.
- `timezone`: the time zone set on the client's Google Ads account.
- `outcomes`: **this is the important one.** It says which Google conversion actions count as a result. Use the exact names from the account's Goals, Conversions list. You can use any of `leads`, `calls`, `deals`. Anything not listed (logins, extra video views and so on) is still shown as "Conversions (Google)" but is not counted as a result. The report calls out the gap for you.
  - If you leave `outcomes` out, every Google conversion counts as a lead.
- `deal_value`: optional. Average sale value. If `deals` are listed, revenue and ROAS use the real conversion value when Google has one, otherwise deals times this number.
- `targets`: optional. `cpl`, `cpc` (cost per booked call), `roas`, `breakeven`. Without targets the report compares campaigns with the account's own average.
- `notes`: optional. Text that shows at the top of the Insights page as "From your Video Power Marketing team".
- `actions`: optional. Your own recommended actions. They are listed first.
- `term_groups`: optional. Groups of search terms (regular expressions) such as brand searches. Adds a "Search terms by theme" table and insight.
- `last_change_date`: optional. Date of the last account change (YYYY-MM-DD). Shows the "Day X of 14" waiting clock.
- `disabled: true` turns a client's link off without deleting it.

These clients are already in `clients.json`:

| Client | Google Ads ID | Link |
|---|---|---|
| Ampleo | 724-430-0373 | `/ampleo-0373` |
| Axomo | 659-889-1580 | `/axomo-1580` |
| Coach by Chris | 683-045-1613 | `/coach-by-chris-1613` |
| EO Utah | 582-765-1852 | `/eo-utah-1852` |
| Real Property Management | 959-824-4421 | `/real-property-management-4421` |
| Mattress Makers | 160-436-9653 | `/mattress-makers-9653` |
| Sandler | 306-924-7469 | `/sandler-7469` |
| The Scalable Company | 626-453-7074 | `/the-scalable-company-7074` |

Put your site address in front, for example `https://vpm-dashboard.netlify.app/coach-by-chris-1613`. Only Coach by Chris has its booked-call settings so far. The others count every Google conversion as a result until you add `outcomes` for them. Time zones default to Mountain, except Coach by Chris and Real Property Management, which are Eastern.

To change clients without redeploying, you can instead paste the whole list into a Netlify setting called `CLIENTS_JSON`. If that setting exists it is used instead of the file.

## Part 5. The daily 10 am refresh

Nothing to do. Netlify runs `refresh-scheduled` every day at 17:00 UTC, which is 10:00 am Mountain Standard Time (November to March). In March, when daylight saving starts, change `0 17 * * *` to `0 16 * * *` in `netlify/functions/refresh-scheduled.mjs` to keep it at 10 am.

To test it, open the site in Netlify, go to **Functions, refresh-scheduled** and use **Run now**. Then check the logs of `refresh-background`. Scheduled functions only run on the production deploy.

To force one client to reload right now: open
`https://YOUR-SITE.netlify.app/THEIR-KEY?fresh=1&s=YOUR-REFRESH_SECRET`

## Part 6. Give clients their link

`https://YOUR-SITE.netlify.app/THEIR-KEY`, for example `https://vpm-dashboard.netlify.app/sandler-7469`. The older `?k=THEIR-KEY` style still works too.

If a clean link ever shows "Page not found", the build also writes a `_redirects` file and a `404.html` that send any single-word path to the report. Check the Netlify deploy log, section **Redirect rules**, for a line with `/:slug`. The `?k=` link is the fallback while you check.

To use a VPM address such as `reports.videopower.org`: in Netlify, **Domain management, Add a domain**, then add the CNAME record Netlify shows you at your DNS provider.

The link opens on the Overview. They can bookmark it. The date buttons, campaign filter and every table sort work without reloading.

## Part 7. Put it in GoHighLevel instead

After a deploy, Netlify also builds `dist/ghl-embed.html`. It is the same report in the same format as the sample you sent, already pointed at your Netlify API. Open it, copy everything, and paste it into a **Custom HTML/JS** element on a GHL page. Share that page with `?k=THEIR-KEY` added to the page link. Nothing else changes: the data still comes from Netlify.

(If you build somewhere other than Netlify, set an environment variable `VPM_API_URL` to `https://YOUR-SITE/api/report` before running `node scripts/build.mjs`.)

## What the report shows

- **Overview**: headline numbers with change versus the previous period, the trend chart with a 30 day outlook, the top insights, which campaigns to scale or fix, and the next steps.
- **Week by week**: cost, CTR, CPC, conversions, cost per conversion, conversion rate (conversions divided by clicks), plus your results, with the best and weakest full weeks marked. Charts for results and cost per result, day of week, and spend by hour.
- **Trends and outlook**: a spend slider that shows the likely effect of a budget change.
- **Campaigns**: ranked by performance, click through for each campaign's audiences, videos, ads, keywords and searches.
- **Audiences**: audience segments, plus cost per result by age, gender and device.
- **Videos**, **Ads and searches**: creative, keywords, search terms (and themes), landing pages.
- **Insights and actions**: what the numbers mean, recommended actions ranked High, Medium and Low, and things worth knowing (tracking gaps, revenue not connected, data delays).

## Version notes

- **1.3**: clean links backed up with `_redirects` and `404.html`; more vertical spacing; client name above the page title; "Updated" time under the client name in the menu; the video popup works again (the site now sends a referrer, which YouTube requires, `Referrer-Policy` in `netlify.toml`); clicking an ad opens its landing page in a popup; keywords and search terms show 8 per page, ads show 10 per page.
- **1.2**: video popup, wins and grouped insights, paging, client list, clean links.

## Known limits (good next steps)

- Some websites refuse to be shown inside a popup. The landing page popup then stays blank and the "Open landing page in a new window" button is the fallback.
- Per-video results come from Google's video report (YouTube and Demand Gen). Performance Max does not break results out by video.
- Revenue and ROAS need closed sales sent back to Google as offline conversions (for example from GoHighLevel). Until then results are counted in leads or booked calls.
- Insights are rule based. A natural next step is a nightly Claude-written summary that you approve before clients see it.
- Custom date ranges are fetched live and take a few seconds the first time. Netlify's standard function limit is 10 seconds, which is enough for most accounts. If a very large account times out, raise the function timeout in Netlify (up to 26 seconds on paid plans) and the parts that finished are still shown.
- Client details live in `clients.json` today. A Google Sheet as the master list (as Brandon planned) is a small add-on.

## Troubleshooting

| You see | Likely cause |
|---|---|
| "This report link is not valid" | Wrong or missing `?k=` key, or the client is `disabled` |
| "The report is not set up yet" | One of the Google settings in Part 3c is missing |
| "The report data could not be loaded" | Check Netlify, Logs, Functions, `report`. Add `&fresh=1&s=YOUR_REFRESH_SECRET` to the link to see the real reason. Common causes: the Cloud project is still on Test access (Part 3b), the daily operations limit was hit (Part 3d), the refresh token expired or was made with a different Cloud project, the Google user lost MCC access, or the API version was retired (bump `GOOGLE_ADS_API_VERSION`) |
| Numbers look low or "no results" | The `outcomes` names do not match the conversion action names exactly (not case sensitive, but spelling and spaces matter) |
| Some tables say "Some detail could not be loaded" | A breakdown timed out. It fills in on the next daily refresh |

## For developers

- `npm install`, then `node scripts/build.mjs` and `node scripts/dev.mjs` for a local preview at http://localhost:8888/?k=demo
- `npm test` runs the backend tests (the Google Ads calls are mocked).
- Page source is in `src/` (`core.js` data model, `insights.js` findings and actions, `charts.js`, `views.js`, `app.js`). `scripts/build.mjs` stitches it into `dist/index.html` and `dist/ghl-embed.html`.
- Google Ads queries live in `netlify/lib/ads.mjs`.
