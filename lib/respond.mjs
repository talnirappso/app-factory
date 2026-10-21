// Reply to an owner comment with Claude; returns { reply, actions, costUsd }.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from './claude.mjs';
import { fill } from './enrich.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STR = { type: 'string' };
export const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reply', 'actions'],
  properties: {
    reply: STR,
    actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type'], properties: {
      type: { type: 'string', enum: ['move', 'update_card', 'set_title', 'set_facts', 'resume'] },
      state: STR, description: STR, title: STR, facts: { type: 'object', additionalProperties: true },
    } } },
  },
};

export function renderThread(comments, meId) {
  return comments.map((c) => `**${c.user?.id === meId ? 'Claude' : (c.user?.name || 'owner')}** (${c.createdAt.slice(0, 16).replace('T', ' ')}):\n${c.body}`).join('\n\n---\n\n');
}

export async function respond(cfg, { issue, board, comments, meId, docs, pipeline }) {
  const tpl = readFileSync(join(ROOT, 'prompts/respond.md'), 'utf8');
  const prompt = fill(tpl, {
    DOCS: docs, IDENTIFIER: issue.identifier, TITLE: issue.title, STATE: issue.state?.name, BOARD: board,
    LABELS: issue.labels?.nodes?.map((l) => l.name).join(', ') || '—', DESCRIPTION: issue.description || '_(empty)_',
    PIPELINE: pipeline || '_none_', THREAD: renderThread(comments, meId),
  });
  const r = await runClaude({ ...cfg.claude, prompt, mode: 'chat', tools: 'WebSearch,WebFetch', jsonSchema: RESPONSE_SCHEMA,
    budgetUsd: cfg.respond.budgetUsd, timeoutMs: cfg.respond.timeoutMin * 60_000, cwd: ROOT });
  if (!r.structured?.reply) throw new Error(`respond: no reply (${r.timedOut ? 'timeout' : `exit ${r.code}`}): ${(r.err || r.result || '').slice(-400)}`);
  return { reply: r.structured.reply, actions: r.structured.actions || [], costUsd: r.costUsd };
}
