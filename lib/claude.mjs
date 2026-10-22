// Headless Claude Code. One call = one `claude -p` process.
//   mode 'agent'   : full tools, --dangerously-skip-permissions (unattended builds; same posture as the nightly agents)
//   mode 'readonly': Read/Grep/Glob only
//   mode 'chat'    : no file access; optional web tools (comment replies, idea cards)
// MCP servers are off unless `mcpServers` is given (only the pipeline's `console` phase gets the browser).
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { run } from './sh.mjs';

const home = (p) => p.replace(/^~(?=\/)/, homedir());

export async function runClaude({ bin, model, effort = 'medium', cwd, prompt, mode = 'chat', tools, addDirs = [], budgetUsd, timeoutMs = 600_000, jsonSchema, sessionId, resume, env = {}, mcpServers }) {
  const id = sessionId || randomUUID();
  const args = ['-p', '--output-format', 'json', '--model', model, '--effort', effort, '--strict-mcp-config', '--setting-sources', 'user'];
  if (mcpServers) args.push('--mcp-config', JSON.stringify({ mcpServers }));
  if (resume) args.push('--resume', id); else args.push('--session-id', id);
  if (mode === 'agent') args.push('--dangerously-skip-permissions');
  else if (mode === 'readonly') args.push('--tools', 'Read,Grep,Glob', '--permission-mode', 'default', '--no-session-persistence');
  else args.push('--tools', tools || '', '--permission-mode', 'default', '--no-session-persistence');
  if (mode === 'chat' && tools) args.push('--allowedTools', tools);
  for (const d of addDirs) args.push('--add-dir', d);
  if (budgetUsd) args.push('--max-budget-usd', String(budgetUsd));
  if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));
  const res = await run(home(bin), args, { cwd, input: prompt, timeoutMs, env: { APP_FACTORY: '1', ...env } });
  let obj = null;
  try { obj = JSON.parse(res.out); } catch { /* maybe a stream */ }
  if (!obj && res.out) for (const l of res.out.trim().split('\n').reverse()) { try { obj = JSON.parse(l); break; } catch { /* */ } }
  const result = typeof obj?.result === 'string' ? obj.result : (res.out || '');
  let structured = obj?.structured_output ?? null;
  if (structured == null && jsonSchema) structured = extractJson(result);
  return { ok: res.code === 0 && !obj?.is_error, result, structured, costUsd: obj?.total_cost_usd ?? 0, turns: obj?.num_turns ?? null, ms: res.ms, sessionId: id, err: res.err, timedOut: res.timedOut, code: res.code };
}

export function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fence ? fence[1] : text;
  const start = c.search(/[[{]/);
  if (start < 0) return null;
  const open = c[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < c.length; i++) {
    const ch = c[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) { try { return JSON.parse(c.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
