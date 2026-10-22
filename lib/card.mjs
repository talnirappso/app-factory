// The idea-card template: what every new-app idea on the board must contain, and how it renders.
export const STR = { type: 'string' };
const ARR = (items) => ({ type: 'array', items });

export const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['app_name', 'alt_names', 'tagline', 'tldr', 'summary', 'pain', 'audience', 'opportunity', 'demand_evidence', 'platforms', 'tech_stack',
    'market', 'upside', 'core_features', 'competitors', 'monetization', 'revenue_guess', 'localization', 'build_size', 'risks', 'logo_prompt', 'logo_colors', 'verdict', 'why_verdict', 'next_step', 'open_questions'],
  properties: {
    app_name: { ...STR, description: 'Proposed store name, ≤30 chars, leads with the device name, no trademark, no "<X>Prep"' },
    alt_names: ARR(STR),
    tagline: { ...STR, description: 'One line, ≤80 chars, what it does for whom' },
    tldr: { ...ARR(STR), description: 'TL;DR for the owner reading on a phone: exactly 4 plain-language lines, ≤20 words each, in this order — what it is and for whom; the pain it fixes; how it makes money and the realistic upside; build size and the verdict in a few words' },
    summary: { ...STR, description: '2–4 sentences: what the app is' },
    pain: { ...STR, description: 'The concrete pain: who feels it, when, what it costs them' },
    audience: { ...STR, description: 'Who exactly, where, rough size with the source or "not found"' },
    opportunity: { ...STR, description: 'Why an app wins here: gap, timing, what incumbents miss' },
    demand_evidence: ARR({ type: 'object', additionalProperties: false, required: ['fact', 'source'], properties: { fact: STR, source: { ...STR, description: 'URL or "reddit thread <id>" or "store listing"' } } }),
    market: { ...STR, description: 'Geography and size: e.g. "US + UK + CA + AU, ~20M dog owners who board their dogs; beachhead: Ontario"' },
    upside: { ...STR, description: 'Realistic upside if it works: monthly revenue at a believable share of the market, and what it takes to get there' },
    platforms: { ...STR, description: 'e.g. "iOS + Android (phone), offline-first, no backend" or "both + small FastAPI backend on the VPS"' },
    tech_stack: { ...STR, description: 'Expo SDK 56 + expo-router + … (state, storage, native modules, backend if any, data sources, ads SDK). Never Flutter.' },
    core_features: ARR({ type: 'object', additionalProperties: false, required: ['name', 'what', 'why_core'], properties: { name: STR, what: STR, why_core: STR } }),
    competitors: ARR({ type: 'object', additionalProperties: false, required: ['name', 'store', 'traction', 'gap'], properties: { name: STR, store: { ...STR, description: 'App Store / Play / both / web' }, traction: { ...STR, description: 'installs, ratings, rating, last update — or "unknown"' }, gap: { ...STR, description: 'what it gets wrong that we would get right' }, url: STR } }),
    monetization: { ...STR, description: 'ads / subscription / one-time unlock / B2B — and where in the flow' },
    revenue_guess: { ...STR, description: 'Honest order of magnitude with the reasoning, e.g. "CA$5–30/mo at 1k installs (banner + interstitial)"' },
    localization: { ...STR, description: 'Which store/app locales pay off and why (audience language, store search reach, ad eCPM / willingness to pay there), e.g. "en-US, en-GB, es-MX, pt-BR, de-DE, fr-FR, ja — the job is universal"; or "English only — content is Ontario law" with the reason' },
    build_size: { ...STR, description: 'S (≤1 week) / M (2–3 weeks) / L (1 month+) and the hardest part' },
    risks: ARR(STR),
    logo_prompt: { ...STR, description: 'Prompt for an image model: a flat, minimal app icon for this app, one symbol, no text' },
    logo_colors: { ...STR, description: 'Two hex colours for the icon gradient, e.g. "#0f766e #22d3ee"' },
    verdict: { type: 'string', enum: ['build', 'research first', 'park', 'kill'] },
    why_verdict: STR,
    next_step: STR,
    open_questions: ARR(STR),
  },
};

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ').trim();
const list = (a, f = (x) => esc(x)) => (a?.length ? a.map((x) => `- ${f(x)}`).join('\n') : '_none_');

const first = (s) => esc(s).split(/(?<=[.!?])\s/)[0];

/** The TL;DR lines: the card's own, or (cards written before the field existed) built from its other fields. */
export function tldrLines(c) {
  if (c.tldr?.length) return c.tldr.map(esc);
  return [
    `${first(c.tagline || c.summary)}`,
    `Pain: ${first(c.pain)}`,
    `Money: ${first(c.revenue_guess || c.monetization)}${c.upside ? ` Upside: ${first(c.upside)}` : ''}`,
    `Build: ${first(c.build_size)} Verdict: **${c.verdict}**.`,
  ];
}

export const renderTldr = (c) => ['## TL;DR', tldrLines(c).map((l) => `- ${l}`).join('\n')].join('\n');

/** Put the TL;DR block right under the tagline (the first `_…_` line after the `# ` title), else under the title. */
export function insertTldr(desc, block) {
  const lines = desc.split('\n');
  const title = lines.findIndex((l) => l.startsWith('# '));
  let at = lines.findIndex((l, i) => i > title && /^_.+_$/.test(l.trim()));
  if (at < 0) at = title;
  lines.splice(at + 1, 0, '', block);
  return lines.join('\n');
}

/** Markdown for the Linear description. `meta` = { source, key, signal, date, logoUrl, rawSection } */
export function renderCard(c, meta = {}) {
  const feats = (c.core_features || []).map((f, i) => `${i + 1}. **${esc(f.name)}** — ${esc(f.what)} _(${esc(f.why_core)})_`).join('\n');
  const comp = c.competitors?.length
    ? `| App | Store | Traction | Their gap |\n|---|---|---|---|\n${c.competitors.map((x) => `| ${x.url ? `[${esc(x.name)}](${x.url})` : esc(x.name)} | ${esc(x.store)} | ${esc(x.traction)} | ${esc(x.gap)} |`).join('\n')}`
    : '_No direct competitor found — verify on both stores before believing it._';
  const ev = list(c.demand_evidence, (e) => `${esc(e.fact)} — ${/^https?:/.test(e.source) ? `[source](${e.source})` : esc(e.source)}`);
  return [
    meta.logoUrl ? `![logo](${meta.logoUrl})\n` : '',
    `# ${esc(c.app_name)}`,
    `_${esc(c.tagline)}_`,
    '',
    renderTldr(c),
    '',
    `**Verdict: ${c.verdict}** — ${esc(c.why_verdict)}`,
    '',
    '## What it is', esc(c.summary),
    '', '## The pain', esc(c.pain),
    '', '## Who it is for', esc(c.audience),
    '', '## Market and upside', `${esc(c.market)}\n\n**Upside:** ${esc(c.upside)}`,
    '', '## The opportunity', esc(c.opportunity),
    '', '## Demand evidence', ev,
    '', '## Core features (non-quiz, the daily job)', feats || '_—_',
    '', '## Competitors', comp,
    '', '## Platforms', esc(c.platforms),
    '', '## Tech stack', esc(c.tech_stack),
    '', '## Monetization', esc(c.monetization), '', `**Revenue guess:** ${esc(c.revenue_guess)}`,
    '', '## Localization', esc(c.localization || '_not assessed_'),
    '', '## Build size', esc(c.build_size),
    '', '## Risks', list(c.risks),
    '', '## Names', `Proposed: **${esc(c.app_name)}**. Alternates: ${(c.alt_names || []).map(esc).join(', ') || '—'}. Only App Store Connect decides whether a name is free.`,
    '', '## Open questions', list(c.open_questions),
    '', '## Next step', esc(c.next_step),
    '',
    '---',
    '**How to use this card:** comment to discuss (Claude answers). Move to **Research** for a sourced scorecard, or to **Implement** to build and ship it to both stores unattended.',
    meta.rawSection ? `\n<details><summary>Raw scout finding</summary>\n\n${meta.rawSection}\n\n</details>` : '',
    `\n_${esc(meta.source || 'app-factory')} · key \`${meta.key || ''}\` · ${meta.signal ? `signal ${esc(meta.signal)} · ` : ''}${meta.date || ''}_`,
  ].filter((l) => l !== null).join('\n');
}

/** Short Slack/notification line for a card. */
export const cardLine = (c) => `${c.app_name} — ${c.tagline} [${c.verdict}; ${c.build_size.split(' ')[0]}]`;
