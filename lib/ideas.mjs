// Turn scout findings into Linear idea cards. Pure functions.
const SIGNAL = { strong: 3, moderate: 2, weak: 1, pass: 0 };
const PRIORITY = { strong: 2, moderate: 3, weak: 4, pass: 0 }; // Linear: 1 urgent … 4 low, 0 none

export const strongEnough = (signal, min = 'moderate') => (SIGNAL[signal] ?? 0) >= (SIGNAL[min] ?? 2);
const esc = (s) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Reddit lead (reddit-scout data/state.json → leads[key]) → card. */
export function cardFromLead(l) {
  const ev = (l.evidence || []).slice(0, 6).map((e) => `- [${esc(e.title)}](${e.url}) — r/${e.sub}, ${e.date}, ${e.comments ?? '?'} comments\n  > ${cut(esc(e.quote), 300)}`).join('\n');
  return {
    key: `reddit:${l.key}`,
    source: 'reddit',
    signal: l.signal,
    title: cut(esc(l.name), 120),
    priority: PRIORITY[l.signal] ?? 0,
    labels: ['idea', 'reddit'],
    description: [
      `**Signal: ${l.signal}** · ${l.jurisdiction || 'global'} · mandatory: ${l.mandatory || 'unknown'} · seen ${l.nights || 1} night(s), last ${l.lastSeen}`,
      '', '## The pain and the opportunity', esc(l.name),
      '', '## Evidence (Reddit)', ev || '_none captured_',
      '', '## Competition seen', esc(l.competition) || '_none named_',
      '', '## Red flags', esc(l.redFlags) || '_none_',
      '', '## Suggested next step', esc(l.nextStep) || '_—_',
      '', '---', `_Reddit pain scout · lead key \`${l.key}\` · full history in ~/git/new-app-docs/reddit/LEADS.md_`,
    ].join('\n'),
  };
}

/** Store gap (reddit-scout data/store-state.json → gaps[key]) → card. */
export function cardFromGap(g) {
  const apps = (g.apps || []).slice(0, 8).map((a) => `- [${esc(a.title)}](${a.url}) (${a.store === 'play' ? 'Play' : 'App Store'}, ${esc(a.developer)}) — ${a.installs ? `${a.installs} installs` : `${a.ratings ?? '?'} ratings`}, ${a.rating?.toFixed?.(1) ?? a.rating ?? '?'}★, updated ${a.updated || '?'}`).join('\n');
  const complaints = (g.complaints || []).slice(0, 6).map((c) => `| ${esc(c.theme)} | ${esc(c.how_often)} | ${cut(esc(c.quote), 220)} |`).join('\n');
  return {
    key: `store:${g.key}`,
    source: 'store',
    signal: g.verdict,
    title: cut(esc(g.name), 120),
    priority: PRIORITY[g.verdict] ?? 0,
    labels: ['idea', 'store gap'],
    description: [
      `**Verdict: ${g.verdict}** · seen ${g.nights || 1} night(s), last ${g.lastSeen}`,
      '', '## Demand', esc(g.demand),
      '', '## Popular but badly served', apps || '_—_',
      '', '## What users complain about', complaints ? `| Complaint | How often | Quote |\n|---|---|---|\n${complaints}` : '_—_',
      '', '## The opportunity', esc(g.opportunity),
      '', '## Monetization', esc(g.monetization),
      '', '## Build size', esc(g.build),
      '', '## Risks', esc(g.risks),
      '', '## Suggested next step', esc(g.nextStep) || '_—_',
      '', '---', `_Store gap scout · gap key \`${g.key}\` · ~/git/new-app-docs/store-gaps/GAPS.md_`,
    ].join('\n'),
  };
}

/** Rows of the ranked table in new-app-docs/IDEAS.md → cards. */
export function cardsFromIdeasMd(md) {
  const out = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|(.+)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [candidate, why, name, watch] = cells;
    const plain = candidate.replace(/\*\*/g, '').replace(/\s*\(§[^)]*\)|\s*\(TODO[^)]*\)/g, '').trim();
    const key = `queue:${plain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`;
    out.push({
      key, source: 'queue', signal: 'moderate', title: cut(plain, 120), priority: 3, labels: ['idea', 'idea queue'],
      description: [
        `**From the ranked queue** (rank ${m[1]} in new-app-docs/IDEAS.md)`,
        '', '## Why', why, '', '## Name to ship', name, '', '## Watch out', watch,
        '', '_Every queue row now needs a non-quiz core (BUILD-GUIDE §0). Re-check both stores before building; the stores move._',
        '', '---', `_Idea queue · key \`${key}\`_`,
      ].join('\n'),
    });
  }
  return out;
}

/** Cards not yet on the board and strong enough to post, best first. */
export function selectNewCards(cards, posted, { minSignal = 'moderate' } = {}) {
  return cards
    .filter((c) => !posted[c.key])
    .filter((c) => strongEnough(c.signal, minSignal))
    .sort((a, b) => (SIGNAL[b.signal] ?? 0) - (SIGNAL[a.signal] ?? 0) || a.title.localeCompare(b.title));
}
