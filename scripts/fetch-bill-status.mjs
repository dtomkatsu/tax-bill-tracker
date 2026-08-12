#!/usr/bin/env node
// Fetches bill status RSS and writes data/bill-status.json. Bill numbers are NOT
// hardcoded here — they're discovered from data-tracker-id/data-hb/data-sb/
// data-year/data-issue-area attributes in the tracked HTML pages (see TRACKED_PAGES
// below). See README.md for the full picture.
//
// Porting this to a different state's legislature: this file needs at most the ONE
// edit marked below (RSS_URL_TEMPLATE). The rules for how to interpret that
// legislature's RSS content (what phrasing means "passed," "deferred," etc.) belong
// in status-rules.mjs, not here — see that file's header.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { toDescription, getStatusBadge, isHearingTitle, isDeferredTitle, extractHearingDate } from './status-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Repo-relative path(s) to the HTML page(s) you actually embed trackers in. Keep a
// copy of that page's HTML in this repo (mirroring whatever you paste into your CMS)
// so this script can scan it — see "Where the bill list lives" in README.md.
const TRACKED_PAGES = [
  'demo.html',
];

const OUTPUT_PATH = path.join(REPO_ROOT, 'data/bill-status.json');

// ---- The one line to change for a different legislature ----
// Must produce a URL to that bill's status feed given (year, type, number). Most
// state legislatures do NOT publish per-bill RSS — check first. If none exists, the
// realistic replacement is an aggregator API (e.g. LegiScan, Open States), which means
// rewriting fetchBillStatus() below to call it instead, not just this template.
const RSS_URL_TEMPLATE = ({ year, type, number }) =>
  `https://www.capitol.hawaii.gov/sessions/session${year}/rss/${type}${number}.xml`;
// ---------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15000;

function discoverTrackers(html) {
  const trackers = [];
  const blockRe = /<div\s+class="tfc-bill-tracker[^"]*"\s+([^>]*)>/g;
  let match;
  while ((match = blockRe.exec(html))) {
    const attrs = match[1];
    const get = (name) => {
      const m = attrs.match(new RegExp(`data-${name}="([^"]*)"`));
      return m ? m[1] : '';
    };
    const trackerId = get('tracker-id');
    if (!trackerId) continue;
    trackers.push({
      trackerId,
      issueArea: get('issue-area') || trackerId,
      year: get('year') || '2026',
      hbNumbers: get('hb').split(',').map((s) => s.trim()).filter(Boolean),
      sbNumbers: get('sb').split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  return trackers;
}

// Some cards may have a client-side "policy options" toggle that swaps a tracker's
// data-hb/data-sb to an alternate bill when the user picks a different option (see
// the capGainsPolicies-style pattern in the original Hawaii page this was ported
// from). Those alternate bill numbers live in small JS config objects, not in a
// data-tracker-id block, so they need their own discovery pass or their status never
// gets fetched. Safe to ignore if you don't use that pattern.
function discoverPolicyToggleBills(html, defaultYear) {
  const bills = [];
  const configRe = /hbNumbers:\s*'([^']*)'[\s\S]{0,40}?sbNumbers:\s*'([^']*)'/g;
  let match;
  while ((match = configRe.exec(html))) {
    const [, hb, sb] = match;
    if (hb) bills.push({ type: 'HB', number: hb, year: defaultYear });
    if (sb) bills.push({ type: 'SB', number: sb, year: defaultYear });
  }
  return bills;
}

async function loadTrackers() {
  const all = [];
  const extraBills = [];
  for (const relPath of TRACKED_PAGES) {
    const html = await readFile(path.join(REPO_ROOT, relPath), 'utf8');
    all.push(...discoverTrackers(html));
    extraBills.push(...discoverPolicyToggleBills(html, '2026'));
  }
  return { trackers: all, extraBills };
}

function uniqueBills(trackers, extraBills) {
  const seen = new Map();
  for (const t of trackers) {
    for (const number of t.hbNumbers) addBill(seen, 'HB', number, t.year);
    for (const number of t.sbNumbers) addBill(seen, 'SB', number, t.year);
  }
  for (const b of extraBills) addBill(seen, b.type, b.number, b.year);
  return [...seen.values()];
}

function addBill(map, type, number, year) {
  const key = `${type}${number}_${year}`;
  if (!map.has(key)) map.set(key, { type, number, year });
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Minimal RSS <item><title>/<pubDate> extraction — avoids adding an XML-parsing dependency.
function parseRssItems(xmlText) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xmlText))) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const pubDate = extractTag(block, 'pubDate');
    if (!title || !pubDate) continue;
    items.push({ title: decodeEntities(title), pubDate });
  }
  return items;
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

async function fetchBillStatus(type, number, year) {
  const rssUrl = RSS_URL_TEMPLATE({ year, type, number });
  try {
    const response = await fetchWithTimeout(rssUrl, FETCH_TIMEOUT_MS);
    if (!response.ok) {
      return { error: `HTTP ${response.status}` };
    }
    const xmlText = await response.text();
    if (!xmlText.includes('<rss') && !xmlText.includes('<item>')) {
      return { error: 'invalid RSS response' };
    }

    const rawItems = parseRssItems(xmlText)
      .map((item) => ({
        title: item.title,
        description: toDescription(item.title),
        date: new Date(item.pubDate).toISOString(),
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    let hasScheduledHearing = false;
    let hasHadHearing = false;
    let isDeferred = false;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const item of rawItems) {
      const titleLower = item.title.toLowerCase();
      if (isHearingTitle(titleLower)) {
        hasHadHearing = true;
        const hearingDate = extractHearingDate(item.title);
        if (hearingDate && hearingDate >= now) hasScheduledHearing = true;
      }
    }
    if (rawItems.length > 0) {
      isDeferred = isDeferredTitle(rawItems[0].title.toLowerCase());
    }

    const updates = rawItems.map((item) => ({
      ...item,
      badge: getStatusBadge(item.description),
    }));

    return {
      updates,
      hasScheduledHearing,
      hasHadHearing,
      isDeferred,
      isAlive: !isDeferred && hasHadHearing,
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function readExistingContent() {
  try {
    const parsed = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    const { generatedAt, source, ...content } = parsed;
    return content;
  } catch {
    return null; // first run, or file is missing/corrupt — treat as "no prior content"
  }
}

async function main() {
  const { trackers, extraBills } = await loadTrackers();
  const bills = uniqueBills(trackers, extraBills);

  if (bills.length === 0) {
    // Discovery scans HTML structure with regexes (see discoverTrackers /
    // discoverPolicyToggleBills above) — 0 results almost certainly means that
    // structure changed, not that there are genuinely no bills. Fail loudly
    // instead of silently overwriting bill-status.json with an empty result.
    console.error('::error::Discovered 0 bills to track — the HTML structure this script scans probably changed. Leaving bill-status.json untouched.');
    process.exit(1);
  }

  const billStatus = {};
  for (const bill of bills) {
    const key = `${bill.type}${bill.number}`;
    console.log(`Fetching ${key} (${bill.year})...`);
    billStatus[key] = { type: bill.type, number: bill.number, year: bill.year, ...(await fetchBillStatus(bill.type, bill.number, bill.year)) };
  }

  const content = {
    trackers: trackers.map((t) => ({
      trackerId: t.trackerId,
      issueArea: t.issueArea,
      year: t.year,
      hbNumbers: t.hbNumbers,
      sbNumbers: t.sbNumbers,
    })),
    bills: billStatus,
  };

  // generatedAt would make the file differ on every single run even when no
  // bill's status actually changed, turning a 30-minute cron into a commit
  // every 30 minutes forever. Only touch the file (and bump the timestamp)
  // when the actual content differs from what's already there.
  const existing = await readExistingContent();
  if (existing && JSON.stringify(existing) === JSON.stringify(content)) {
    console.log('No change in bill status content — leaving bill-status.json untouched.');
    return;
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'capitol.hawaii.gov RSS, fetched via GitHub Actions',
    ...content,
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`Wrote ${OUTPUT_PATH} (${bills.length} bills, ${trackers.length} trackers)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
