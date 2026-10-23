#!/usr/bin/env node
// Execute one task from the OPS board as an unattended agent. Launched by the bridge as a transient unit.
//   node bin/task.mjs <issueId> [--resume]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/linear.mjs';
import { runClaude } from '../lib/claude.mjs';
import { loadJson, saveJson } from '../lib/state.mjs';
import { fill } from '../lib/enrich.mjs';
import { renderThread } from '../lib/respond.mjs';
import { notifySlack } from '../lib/notify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const issueId = process.argv.slice(2).find((a) => !a.startsWith('--'));
const RESUME = process.argv.includes('--resume');
if (!issueId) { console.error('usage: task.mjs <issueId> [--resume]'); process.exit(1); }
const cfg = JSON.parse(readFileSync(join(ROOT, 'config/factory.json'), 'utf8'));
const lin = JSON.parse(readFileSync(join(ROOT, 'data/linear.json'), 'utf8'));
const T = lin.teams.apps;
const issue = await L.getIssue(issueId);
const DIR = join(ROOT, 'data/tasks', issue.identifier);
mkdirSync(DIR, { recursive: true });
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); writeFileSync(join(DIR, 'task.log'), line + '\n', { flag: 'a' }); };
const comment = (b) => L.createComment(issue.id, b).catch((e) => log(`comment failed: ${e.message}`));
const move = (name) => L.moveIssue(issue.id, T.states[name], name, cfg.linear.owner).catch((e) => log(`move failed: ${e.message}`));
const st = loadJson(join(DIR, 'state.json'), { runs: 0, totalCost: 0 });
const resultFile = join(DIR, 'result.json');
const thread = await L.issueComments(issue.id);
const prompt = fill(readFileSync(join(ROOT, 'prompts/task.md'), 'utf8'), {
  IDENTIFIER: issue.identifier, TITLE: issue.title, URL: issue.url, DATE: new Date().toISOString().slice(0, 10),
  LABELS: issue.labels?.nodes?.map((l) => l.name).join(', ') || '—', DESCRIPTION: issue.description || '(no description)',
  THREAD: renderThread(thread, lin.me.id) || '(none)', WORK_DIR: DIR, RESULT_FILE: resultFile, FACTS: JSON.stringify(loadJson(join(DIR, 'facts.json'), {}), null, 2),
});
writeFileSync(join(DIR, `prompt-${st.runs + 1}.md`), prompt);
if (existsSync(resultFile)) writeFileSync(join(DIR, `result-${st.runs}.json`), readFileSync(resultFile)); 
await comment(`▶️ Running${RESUME ? ' (resumed with your answers)' : ''} — budget $${cfg.tasks.budgetUsd}, up to ${cfg.tasks.timeoutMin} min. I'll report here.`);
log(`task ${issue.identifier} run ${st.runs + 1}`);
const r = await runClaude({ ...cfg.claude, prompt, mode: 'agent', cwd: homedir() + '/git', addDirs: [DIR], budgetUsd: cfg.tasks.budgetUsd, timeoutMs: cfg.tasks.timeoutMin * 60_000,
  sessionId: RESUME ? st.session : undefined, resume: RESUME && !!st.session });
st.runs += 1; st.totalCost += r.costUsd || 0; st.session = r.sessionId; st.updatedAt = new Date().toISOString();
writeFileSync(join(DIR, `agent-${st.runs}.md`), r.result || '');
let res; try { res = JSON.parse(readFileSync(resultFile, 'utf8')); } catch { res = { status: 'failed', summary: `no result file (exit ${r.code}${r.timedOut ? ', timeout' : ''}). Agent's last words:\n\n${(r.result || '').slice(-1500)}` }; }
if (!['ok', 'blocked', 'failed'].includes(res.status)) res.status = 'failed';
st.last = res.status; saveJson(join(DIR, 'state.json'), st);
const icon = { ok: '✅', blocked: '🙋', failed: '⛔' }[res.status];
let body = `${icon} **${res.status}** (${Math.round(r.ms / 60_000)} min, $${(r.costUsd || 0).toFixed(2)})\n\n${res.summary || ''}`;
if (res.changed_repos?.length) body += `\n\n**Changed:** ${res.changed_repos.join('; ')}`;
if (res.needs_you?.length) body += `\n\n**🙋 For you:**\n${res.needs_you.map((x) => `- [ ] ${x}`).join('\n')}`;
if (res.status === 'blocked') body += `\n\n**Blocked on:** ${res.blocked_on || '(see above)'}\n\nAnswer here, then move the card back to **Running**.`;
if (res.status === 'failed') body += `\n\nMove back to **Running** to retry (I keep the session), or tell me what to change.`;
await comment(body);
await move(res.status === 'ok' ? 'Done' : 'Needs you');
if (res.status !== 'ok') await notifySlack(`:raising_hand: *${issue.identifier}* ${issue.title} — ${res.status}: ${(res.blocked_on || res.summary || '').slice(0, 200)}\n${issue.url}`, log);
log(`done: ${res.status}`);
