// STATE-SPECIFIC. Everything in this file encodes how the Hawaii State Legislature
// phrases bill-status updates in its RSS feed titles (e.g. "passed third reading",
// "carried over", "with Representative(s) ... voting"). Adapting this whole system
// for a different state's legislature means rewriting the functions in THIS file —
// nothing else in tax-fairness/scripts/ or tax-fairness/bill-tracker.js should need
// to change for that. See tax-fairness/README.md.
//
// Each function takes plain strings (a raw RSS item title, or text derived from one)
// and returns plain data — no fetching, no I/O — so a different state's rules can be
// dropped in and tested (`node -e`) without touching the fetch/discovery logic.

// A raw RSS <item><title> looks like "3/12/26 HB2306: Passed First Reading." — this
// strips the leading date/bill-number prefix and trims incidental roll-call detail
// ("with Representative(s) X, Y voting no") that isn't meaningful status.
export function toDescription(title) {
  const parts = title.split(': ');
  let desc = parts.length > 1 ? parts.slice(1).join(': ') : title;
  desc = desc.replace(/\s*with\s+Representative\(s\)[^.]*\./g, '');
  desc = desc.replace(/\s*with\s+Senator\(s\)[^.]*\./g, '');
  desc = desc.replace(/\s*voting\s+[^.]*\./g, '');
  return desc.replace(/\s+/g, ' ').trim();
}

// Maps a cleaned description to a short badge {text, class}. `class` values
// (enacted/passed/progress/deferred/hearing/referred/new/update) are what
// bill-tracker.js's tfc-badge-{class} CSS expects — keep them in sync with the
// .tfc-badge-* rules in wealth_taxes_squarespace.html if you add a new one.
export function getStatusBadge(description) {
  const desc = description.toLowerCase();
  // Real phrasing when a bill is signed is "Act 024, on 05/21/2026 (Gov. Msg. No. 1124)."
  // — capitol.hawaii.gov never actually sends "signed by governor" or "became law".
  if (/^act\s+\d+/.test(desc) || desc.includes('signed by governor') || desc.includes('became law')) {
    return { text: 'Passed', class: 'enacted' };
  }
  if (desc.includes('passed third reading') && desc.includes('transmitted')) return { text: 'Passed Chamber', class: 'passed' };
  if (desc.includes('passed third reading')) return { text: 'Passed', class: 'passed' };
  if (desc.includes('passed second reading')) return { text: 'Second Reading', class: 'progress' };
  if (desc.includes('passed first reading')) return { text: 'First Reading', class: 'progress' };
  if (desc.includes('carried over')) return { text: 'Carried Over', class: 'deferred' };
  if (desc.includes('deferred')) return { text: 'Deferred', class: 'deferred' };
  if (desc.includes('hearing')) return { text: 'Hearing', class: 'hearing' };
  if (desc.includes('referred to')) return { text: 'Referred', class: 'referred' };
  if (desc.includes('recommitted')) return { text: 'Recommitted', class: 'referred' };
  if (desc.includes('reported from')) return { text: 'Reported', class: 'progress' };
  if (desc.includes('introduced')) return { text: 'Introduced', class: 'new' };
  return { text: 'Update', class: 'update' };
}

export function isHearingTitle(titleLower) {
  return ['hearing', 'scheduled', 'notice', 'decision', 'public', 'hold'].some((kw) => titleLower.includes(kw));
}

export function isDeferredTitle(titleLower) {
  return titleLower.includes('deferred') || titleLower.includes('carried over');
}

// Hearing titles sometimes embed the hearing's date (e.g. "Notice of Hearing on
// 3/15/26"). Returns a Date at midnight, or null if none found / unparseable.
// The M/D/YY(YY) format itself isn't Hawaii-specific, just the surrounding phrasing
// isHearingTitle() looks for.
export function extractHearingDate(title) {
  const dateMatch = title.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/);
  if (!dateMatch) return null;
  const parts = dateMatch[1].split(/[-/]/);
  if (parts.length !== 3) return null;
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const year = parts[2].length === 2 ? 2000 + parseInt(parts[2], 10) : parseInt(parts[2], 10);
  const date = new Date(year, month, day);
  date.setHours(0, 0, 0, 0);
  return date;
}
