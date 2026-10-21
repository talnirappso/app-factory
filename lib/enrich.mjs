// One Claude call: raw scout finding (or the owner's own words) → the full idea card.
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from './claude.mjs';
import { CARD_SCHEMA } from './card.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = (p) => p.replace(/^~(?=\/)/, homedir());
export const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));

/** Concatenated playbook excerpts for prompts (capped per file). */
export function docsContext(cfg, { perFile = 12_000, files } = {}) {
  return (files || cfg.docs).map(home).filter(existsSync)
    .map((f) => `### ${f.replace(homedir(), '~')}\n${readFileSync(f, 'utf8').slice(0, perFile)}`).join('\n\n');
}

export async function enrich(cfg, { source, finding, docs }) {
  const tpl = readFileSync(join(ROOT, 'prompts/enrich.md'), 'utf8');
  const prompt = fill(tpl, { DOCS: docs, SOURCE: source, FINDING: finding });
  const r = await runClaude({ ...cfg.claude, prompt, mode: 'chat', tools: 'WebSearch,WebFetch', jsonSchema: CARD_SCHEMA,
    budgetUsd: cfg.enrich?.budgetUsd || 4, timeoutMs: (cfg.enrich?.timeoutMin || 15) * 60_000, cwd: ROOT });
  if (!r.structured) throw new Error(`enrich: no card (${r.timedOut ? 'timeout' : `exit ${r.code}`}): ${(r.err || r.result || '').slice(-400)}`);
  return { card: r.structured, costUsd: r.costUsd };
}
