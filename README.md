# Bill Status Tracker — starter kit

A widget for advocacy sites: paste a `<div>` per bill you're tracking into your
page, and it shows that bill's current status (Introduced, Passed, Enacted,
etc.) and history, kept fresh automatically. Originally built for the Hawai'i
Tax Fairness Coalition (hitaxfairness.org); this is a stripped-down copy with
just the tracker itself, meant to be adapted for a different organization and
a different state's legislature.

## If you're the org that received this repo

You don't need to write or edit any code yourself. The technical setup below
is meant to be handed to a developer, or to an AI coding assistant (Claude,
etc.) — point it at this repo and this README and it can do the adaptation
work. Your part is:

1. Have (or create) a GitHub account for your organization.
2. Have someone technical — or an AI assistant — go through "Adapting this
   for a different state's legislature" below.
3. Once it's adapted and tested, you (or whoever manages your website) paste
   the finished widget code into your site, the same way you'd paste in any
   embed code from another tool. That part takes five minutes; the adaptation
   before it is the real work.
4. In GitHub's settings for your copy of this repo, there are two one-time
   toggles a human needs to click (not something code can do) — see "One-time
   GitHub setup" below. If you're not sure how, ask whoever set up the GitHub
   account to do this with you once; it's two clicks in a settings page.

## Adapting this for a different state's legislature — do this, in order

1. **Read `scripts/status-rules.mjs` first.** Its header explains what it is.
   Everything in that file is Hawaii-specific; nothing else described below
   should need to change to make the *mechanism* work for a new state.
2. **Confirm your state's legislature publishes per-bill machine-readable
   status** (RSS, JSON API, anything fetchable). Most don't. If none exists,
   the realistic path is a paid/free-tier aggregator (LegiScan, Open States)
   instead — that means rewriting `fetchBillStatus()` in
   `fetch-bill-status.mjs` to call that API, not just changing a URL. Don't
   proceed past this step assuming RSS exists; verify it first (fetch one
   known bill's feed URL directly and confirm you get real content back).
3. **Edit exactly one line**: `RSS_URL_TEMPLATE` near the top of
   `fetch-bill-status.mjs`, marked with a comment banner. It's a function
   `({year, type, number}) => url`.
4. **Rewrite `status-rules.mjs`** to match your state's phrasing:
   `getStatusBadge()` (what phrases mean "passed," "enacted," "deferred,"
   etc. — verify against REAL feed output, not assumptions; Hawaii's own
   feed, for example, signals a signed bill as "Act 024, on 05/21/2026 ...",
   never the words "signed" or "enacted"), `isHearingTitle()`,
   `toDescription()` (strips your legislature's own filler text),
   `extractHearingDate()` (only needs changing if hearing dates aren't in
   `M/D/YY` format). Test in isolation — these are pure functions, no
   network needed: `node -e "import('./scripts/status-rules.mjs').then(m => console.log(m.getStatusBadge('Passed Third Reading')))"`
5. **`bill-tracker.js` needs no edits.** It locates its own data file
   relative to wherever it was loaded from (see the `SELF_URL` comment near
   the top) — this is true regardless of what domain hosts your copy.
6. **Verify locally before touching the workflow**, in this order:
   - `node scripts/fetch-bill-status.mjs` — writes a real `data/bill-status.json`
     from your state's live feeds. Check it by eye first.
   - `python3 -m http.server 8000` from the repo root, then open
     `http://localhost:8000/demo.html` in a browser. Because `bill-tracker.js`
     self-locates, this works with **no file edits or query params** — it'll
     load the JSON you just generated from the same local server. Check the
     browser console for errors and confirm at least one tracker renders real
     status text, not "Error" or "N/A" for every bill.
7. **Only after step 6 passes**, push to GitHub and do the "One-time GitHub
   setup" below.
8. **Before pasting into your real CMS**, change the `<script src="bill-tracker.js">`
   and `<link href="bill-tracker.css">` in your page to the *absolute* GitHub
   Pages URL of your fork (e.g. `https://yourorg.github.io/yourrepo/bill-tracker.js`).
   A relative path works for local testing but 404s once pasted into
   Squarespace/WordPress/etc., because it resolves against *that* site's
   domain, not GitHub's. (This bit us once already building this — see git
   history if curious.)

If you get stuck, don't guess — the "Quick diagnostics" section at the
bottom of this file has copy-pasteable commands for each stage of the
pipeline, and will tell you which stage is actually broken.

## One-time GitHub setup (a human has to click these — code can't)

1. **Enable GitHub Pages**: repo Settings → Pages → Source: "Deploy from a
   branch" → Branch: `main`, folder `/ (root)` → Save. After a minute or two,
   the Pages URL at the top of that page is where `bill-tracker.js`,
   `bill-tracker.css`, and `data/bill-status.json` are actually served from.
2. **If this repo was forked (not created fresh)**: GitHub disables scheduled
   Actions workflows on forks by default. Go to the Actions tab → you'll see
   a banner to enable workflows → click it → confirm "Fetch bill status" is
   enabled. Also worth knowing: GitHub auto-disables scheduled workflows
   again after ~60 days with zero commits to the repo, so if the tracker
   quietly goes stale months from now, check here first
   (`gh workflow list` / Actions tab) before assuming the code broke.
3. **Test the schedule manually** once: Actions tab → "Fetch bill status" →
   Run workflow. Confirm it succeeds and `data/bill-status.json` gets a
   commit (or "no change" in the log, if the data was already current).

## What's in this repo

- `bill-tracker.js` — the widget. Reads `data/bill-status.json` and renders
  both the per-proposal mini trackers and the optional master summary table.
- `bill-tracker.css` — its styling, pulled out as its own file so it's easy
  to find and re-theme. (In the original Hawaii deployment this is inlined
  directly into the page instead — either works, see step 8 above for the
  script-src equivalent gotcha if you inline vs. link it.)
- `demo.html` — a minimal working example: two tracker cards plus the master
  table, with placeholder bill numbers. Replace this with your real page (or
  point `TRACKED_PAGES` in `fetch-bill-status.mjs` at wherever your real page
  lives in this repo).
- `scripts/fetch-bill-status.mjs` — runs in GitHub Actions, fetches each
  tracked bill's status, writes `data/bill-status.json`.
- `scripts/status-rules.mjs` — the ONE file that's entirely state-specific;
  see step 4 above.
- `.github/workflows/fetch-bill-status.yml` — the cron job (every 30 min).

## The bill-status pipeline

```
.github/workflows/fetch-bill-status.yml   (runs every 30 min, GitHub Actions)
  → scripts/fetch-bill-status.mjs
      - discovers which bills to track (see "Where the bill list lives")
      - fetches each bill's status (RSS_URL_TEMPLATE)
      - interprets each update via status-rules.mjs
      - writes data/bill-status.json — but ONLY if the content actually
        changed (see "Why the workflow doesn't spam commits" below)
  → commits data/bill-status.json to main
      → GitHub Pages republishes it at:
        https://<you>.github.io/<repo>/data/bill-status.json

bill-tracker.js   (loaded by <script src>, from GitHub Pages, even when the
                    embedding page is on a totally different domain)
  - locates that JSON relative to its OWN <script src> (document.currentScript),
    not the embedding page's origin — see the SELF_URL comment in the file.
    This means forking to a different GitHub Pages project needs zero edits
    here, and testing locally needs no file edits either (see the runbook
    above).
  - renders the per-proposal mini trackers AND the "Bill Status Tracker"
    summary table from it
```

Freshness is bounded by the 30-minute cron interval, not by anything in the
browser. If a bill's status seems stale, check whether the workflow is
actually running (`gh run list --workflow=fetch-bill-status.yml`) before
assuming the page is broken.

### Why the workflow doesn't spam commits

`fetch-bill-status.mjs` reads the *existing* `bill-status.json`, computes
the new content, and compares them **excluding the `generatedAt` field**
before deciding whether to write anything. Don't remove that comparison —
an earlier version stamped a fresh timestamp unconditionally, which made the
file differ on every single run even when nothing changed, and would have
committed every ~30 minutes forever.

## Where the bill list lives — this is the part you edit day-to-day

**There is no separate config file listing which bills to track.** The list
is discovered by scanning the tracked HTML page(s) — see `TRACKED_PAGES` in
`fetch-bill-status.mjs` — for two patterns:

1. `<div class="tfc-bill-tracker" data-tracker-id="..." data-issue-area="..."
   data-hb="..." data-sb="..." data-year="...">` — one per proposal card.
2. Client-side "policy toggle" JS objects with `hbNumbers: '...'` /
   `sbNumbers: '...'` pairs, for cards that let a user pick between two
   versions of a bill. See `discoverPolicyToggleBills` in
   `fetch-bill-status.mjs` if you need this — most orgs won't.

**To add a new bill to an existing proposal card:** add its number to the
`data-hb` or `data-sb` attribute (comma-separated for multiple bills).

**To add a whole new proposal card:** copy an existing `.tfc-card-wrapper`
block in `demo.html` (or your real page), give the tracker div a unique
`data-tracker-id`, and set `data-hb`/`data-sb`/`data-year`. Nothing else
needs to change — the next workflow run (or a manual
`gh workflow run fetch-bill-status.yml`) picks it up automatically.

**Don't hand-edit `data/bill-status.json`** — it's generated. Edits will be
overwritten within 30 minutes.

## Quick diagnostics

Work through these in order — each one isolates a different stage of the
pipeline, so stop at the first one that shows a problem:

1. **Is bill discovery finding the right bills?**
   `node scripts/fetch-bill-status.mjs` — prints each bill it fetches. Wrong
   count or missing bills means `discoverTrackers`/`discoverPolicyToggleBills`
   in `fetch-bill-status.mjs` isn't matching your HTML.
2. **Is the status-interpretation correct for what you got back?** Open the
   `data/bill-status.json` that step 1 just wrote and read a
   `bills.<BILL>.updates[0]` entry by eye. Wrong badge/description means
   `status-rules.mjs` needs adjusting for your legislature's phrasing.
3. **Does it render?** `python3 -m http.server 8000` from repo root, open
   `http://localhost:8000/demo.html`, check the browser console. No file
   edits needed — see the runbook above for why.
4. **Is the scheduled workflow actually running in CI?**
   `gh run list --workflow=fetch-bill-status.yml --limit 5`
5. **Is the published JSON fresh?**
   `curl -s https://<you>.github.io/<repo>/data/bill-status.json | jq .generatedAt`
6. **Force a refresh**: `gh workflow run fetch-bill-status.yml`
7. **Trackers render but show nothing / 404 in the console for bill-tracker.js
   or bill-tracker.css?** You're pasted into your real CMS with the relative
   `src`/`href` still in place — see step 8 of the adaptation checklist above.
