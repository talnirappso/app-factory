import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardFromLead, cardFromGap, cardsFromIdeasMd, selectNewCards } from '../lib/ideas.mjs';
import { renderCard } from '../lib/card.mjs';
import { extractJson } from '../lib/claude.mjs';

test('reddit lead → card with evidence and key', () => {
  const c = cardFromLead({ key: 'sweep', name: 'Street sweeping tickets → alert app', jurisdiction: 'Calgary', signal: 'moderate', mandatory: 'no', nights: 1, lastSeen: '2026-10-21',
    evidence: [{ url: 'https://r/x', title: 'T', sub: 'Calgary', date: '2026-10-01', comments: 49, quote: 'we got a ticket' }], competition: 'none', redFlags: 'small', nextStep: 'check stores' });
  assert.equal(c.key, 'reddit:sweep');
  assert.ok(c.description.includes('> we got a ticket'));
  assert.deepEqual(c.labels, ['idea', 'reddit']);
  assert.equal(c.priority, 3);
});

test('store gap → card with complaint table', () => {
  const c = cardFromGap({ key: 'fish', name: 'Fishing regs', verdict: 'strong', nights: 2, lastSeen: '2026-10-21', demand: '500K', apps: [{ store: 'play', title: 'Fish Rules', developer: 'FR', url: 'u', installs: '500,000+', rating: 3.2, updated: '2026-10' }],
    complaints: [{ theme: 'crash', how_often: '20/57', quote: 'spins | freezes' }], opportunity: 'o', monetization: 'm', build: 'M', risks: 'r', nextStep: 'n' });
  assert.equal(c.key, 'store:fish');
  assert.ok(c.description.includes('| crash | 20/57 | spins \\| freezes |'));
  assert.equal(c.priority, 2);
});

test('IDEAS.md ranked rows become queue cards', () => {
  const md = '| Rank | Candidate |\n|---:|---|\n| 1 | **Quebec MAPAQ food hygiene** (§18 #9) | why | "Name" | watch |\n| x | not a row |';
  const cards = cardsFromIdeasMd(md);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].key, 'queue:quebec-mapaq-food-hygiene');
  assert.equal(cards[0].title, 'Quebec MAPAQ food hygiene');
});

test('selectNewCards skips posted and weak, strongest first', () => {
  const cards = [{ key: 'a', signal: 'weak', title: 'a' }, { key: 'b', signal: 'strong', title: 'b' }, { key: 'c', signal: 'moderate', title: 'c' }, { key: 'd', signal: 'strong', title: 'd' }];
  assert.deepEqual(selectNewCards(cards, { d: { issueId: 'x' } }).map((c) => c.key), ['b', 'c']);
  assert.deepEqual(selectNewCards(cards, {}, { minSignal: 'weak' }).map((c) => c.key), ['b', 'd', 'c', 'a']);
});

test('renderCard includes every template section and the logo', () => {
  const card = { app_name: 'Tide Keeper', alt_names: ['Tidewise'], tagline: 'tides for small boats', summary: 's', pain: 'p', audience: 'a', market: 'US', upside: '$5k/mo', opportunity: 'o',
    demand_evidence: [{ fact: 'f', source: 'https://x' }], platforms: 'both', tech_stack: 'Expo SDK 56', core_features: [{ name: 'Log', what: 'w', why_core: 'y' }],
    competitors: [{ name: 'Tides', store: 'both', traction: '1M', gap: 'ads', url: 'https://u' }], monetization: 'ads', revenue_guess: 'CA$5', build_size: 'M — maps', risks: ['4.3(a)'],
    logo_prompt: 'x', logo_colors: '#000 #fff', verdict: 'build', why_verdict: 'because', next_step: 'n', open_questions: ['q'] };
  const md = renderCard(card, { logoUrl: 'https://logo', source: 'test', key: 'k', date: '2026-10-21' });
  for (const h of ['## What it is', '## The pain', '## Who it is for', '## Market and upside', '## The opportunity', '## Demand evidence', '## Core features', '## Competitors', '## Platforms', '## Tech stack', '## Monetization', '## Build size', '## Risks', '## Names', '## Open questions', '## Next step']) assert.ok(md.includes(h), h);
  assert.ok(md.startsWith('![logo](https://logo)'));
  assert.ok(md.includes('[Tides](https://u)'));
});

test('extractJson finds a fenced object', () => {
  assert.deepEqual(extractJson('text ```json\n{"a":[1,2]}\n``` more'), { a: [1, 2] });
  assert.equal(extractJson('nothing'), null);
});
