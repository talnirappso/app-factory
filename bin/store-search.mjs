#!/usr/bin/env node
// Search the App Store + Google Play for a term and print what a user would find (used by the research agent).
//   node bin/store-search.mjs "ontario fishing regulations" [--country=ca] [--limit=15]
import { searchApple } from '../../reddit-scout/src/stores/apple.mjs';
import { searchPlay, detailsPlay } from '../../reddit-scout/src/stores/play.mjs';
const args = process.argv.slice(2);
const term = args.filter((a) => !a.startsWith('--')).join(' ');
const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const country = opt('country', 'ca'), limit = Number(opt('limit', 15));
if (!term) { console.error('usage: store-search.mjs "<term>" [--country=ca] [--limit=15]'); process.exit(1); }
const row = (a) => `| ${a.store} | ${a.title} | ${a.developer || ''} | ${a.installsText || (a.ratings ? `${a.ratings} ratings` : '?')} | ${a.rating?.toFixed?.(1) ?? '?'}★ | ${a.updated || '?'} | ${a.price ? 'paid' : 'free'}${a.hasAds ? '+ads' : ''}${a.hasIap ? '+iap' : ''} | ${a.url} |`;
console.log(`# "${term}" (${country})\n\n| store | app | developer | installs/ratings | rating | updated | price | url |\n|---|---|---|---|---|---|---|---|`);
try { for (const a of await searchApple(term, { country, limit })) console.log(row(a)); } catch (e) { console.log(`| apple | ERROR ${e.message} |`); }
try {
  const ids = await searchPlay(term, { country, limit });
  for (const id of ids) { try { console.log(row(await detailsPlay(id, { country }))); } catch (e) { console.log(`| play | ${id} | ERROR ${e.message} |`); } await new Promise((r) => setTimeout(r, 900)); }
} catch (e) { console.log(`| play | ERROR ${e.message} |`); }
