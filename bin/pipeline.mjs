#!/usr/bin/env node
// One new app, from idea card to store submission, as a chain of headless Claude phases with
// deterministic gates between them. Runs as a transient systemd user unit (launched by the bridge).
//
//   node bin/pipeline.mjs <linear issue id> [--only=research] [--resume] [--from=<phase>]
//
// State: data/pipelines/<PUC-n>/state.json (phases, costs), facts.json (shared memory: name, slug,
// bundle id, store ids… written by phases AND by the owner's answers on the board), <phase>.json
// (each phase's result), <phase>-prompt.md, <phase>-result.md, gates-<phase>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/linear.mjs';
import { runClaude } from '../lib/claude.mjs';
import { run, sh, tail } from '../lib/sh.mjs';
import { loadJson, saveJson } from '../lib/state.mjs';
import { fill } from '../lib/enrich.mjs';
import { renderThread } from '../lib/respond.mjs';
import { notifySlack } from '../lib/notify.mjs';
import { pipelineDir, mergeFacts } from '../lib/pipeline-ctl.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const issueId = args.find((a) => !a.startsWith('--'));
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const RESUME = args.includes('--resume'), ONLY = opt('only'), FROM = opt('from');
if (!issueId) { console.error('usage: pipeline.mjs <issueId> [--only=research] [--resume] [--from=phase]'); process.exit(1); }

const home = (p) => p.replace(/^~(?=\/)/, homedir());
const cfg = JSON.parse(readFileSync(join(ROOT, 'config/factory.json'), 'utf8'));
const lin = JSON.parse(readFileSync(join(ROOT, 'data/linear.json'), 'utf8'));
const IDEAS = lin.teams.ideas;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

const issue = await L.getIssue(issueId);
const DIR = pipelineDir(ROOT, issue);
mkdirSync(DIR, { recursive: true });
const LOG = join(DIR, 'pipeline.log');
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); try { writeFileSync(LOG, line + '\n', { flag: 'a' }); } catch { /* */ } };
const STATE = join(DIR, 'state.json');
const FACTS = join(DIR, 'facts.json');
const facts = () => loadJson(FACTS, {});

export const PHASES = ['research', 'scaffold', 'features', 'review', 'assets', 'console', 'android', 'ios', 'stores', 'submit'];
const CODE_PHASES = new Set(['scaffold', 'features', 'assets', 'android', 'ios', 'stores', 'submit']);
// The only phase with a browser: the owner's logged-in Chrome via the Playwright extension, for the store/AdMob
// records the APIs can't create (Play app + declarations + SA grant, AdMob apps/units/GDPR row, ASC app record).
// Without PLAYWRIGHT_MCP_EXTENSION_TOKEN the extension waits for a click on its "connect" page (interactive shells get it
// from ~/.zshrc; this systemd unit doesn't), so it comes from secrets/ and goes in via the env, not the command line.
const BROWSER_PHASES = { console: { playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--extension'], env: {} } } };
const TOKEN_FILE = join(ROOT, 'secrets/playwright_extension_token');
const browserToken = () => process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN || (existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : '');
const mode = ONLY ? 'research' : 'full';
const phasesToRun = ONLY ? [ONLY] : PHASES;

let ps = loadJson(STATE, null);
if (!ps || (!RESUME && !FROM && ps.mode !== mode)) ps = { identifier: issue.identifier, issueId: issue.id, title: issue.title, mode, phase: phasesToRun[0], phases: {}, state: 'running', totalCost: 0, startedAt: new Date().toISOString() };
if (!RESUME && !FROM && ps.state !== 'running') { ps = { ...ps, mode, phase: phasesToRun[0], phases: {}, state: 'running', totalCost: 0, startedAt: new Date().toISOString(), blockedOn: null }; }
ps.mode = mode; ps.state = 'running'; ps.blockedOn = null; ps.updatedAt = new Date().toISOString();
if (FROM) ps.phase = FROM;
const saveState = () => { ps.updatedAt = new Date().toISOString(); saveJson(STATE, ps); };
saveState();

const stateId = (name) => IDEAS.states[name];
const comment = (body) => L.createComment(issue.id, body).catch((e) => log(`comment failed: ${e.message}`));
const move = async (name) => { await L.updateIssue(issue.id, { stateId: stateId(name) }).catch((e) => log(`move failed: ${e.message}`)); log(`→ ${name}`); };
const addLabel = async (name) => {
  const id = lin.labels[name]; if (!id) return;
  const cur = (await L.getIssue(issue.id)).labels.nodes.map((l) => l.id);
  if (!cur.includes(id)) await L.updateIssue(issue.id, { labelIds: [...cur, id] }).catch(() => {});
};
const min = (ms) => Math.round(ms / 60_000);

function phasePrompt(name) {
  const common = readFileSync(join(ROOT, 'prompts/phase-common.md'), 'utf8');
  const body = readFileSync(join(ROOT, `prompts/${name}.md`), 'utf8');
  const f = facts();
  const thread = renderThread(threadCache, lin.me.id);
  const phaseLog = Object.entries(ps.phases).map(([n, p]) => `- **${n}**: ${p.status}${p.summary ? ` — ${p.summary}` : ''}`).join('\n') || '- (first phase)';
  const vars = {
    IDENTIFIER: issue.identifier, TITLE: issue.title, URL: issue.url, CARD: issue.description || '(no card)', THREAD: thread || '(no comments yet)',
    FACTS: JSON.stringify(f, null, 2), WORK_DIR: DIR, REPO: f.repo || '(not created yet)', SLUG: f.slug || '(not chosen yet)', NAME: f.name || '(not chosen yet)',
    BUNDLE: f.bundle_id || (f.slug ? `win.talnirapps.${f.slug}` : '(not chosen yet)'), PHASE_LOG: phaseLog, DEVICE: cfg.pipeline.device, DATE: today(),
    RESULT_FILE: join(DIR, `${name}.json`), FACTS_FILE: FACTS, PHASE: name, MODE: mode, DOCS_DIR: home('~/git/new-app-docs'),
  };
  return fill(common, vars) + '\n\n' + fill(body, vars);
}

let threadCache = [];
async function refreshThread() { threadCache = await L.issueComments(issue.id).catch(() => threadCache); }

const RESULT_KEYS = ['status', 'summary'];
function readResult(name) {
  const f = join(DIR, `${name}.json`);
  if (!existsSync(f)) return { status: 'failed', summary: `the agent did not write ${f}` };
  try {
    const r = JSON.parse(readFileSync(f, 'utf8'));
    for (const k of RESULT_KEYS) if (!(k in r)) return { status: 'failed', summary: `${f} lacks "${k}"` };
    if (!['ok', 'blocked', 'failed', 'kill'].includes(r.status)) return { status: 'failed', summary: `${f}: bad status ${r.status}` };
    return r;
  } catch (e) { return { status: 'failed', summary: `${f} is not valid JSON: ${e.message}` }; }
}

async function runAgent(name, prompt, { readonly = false, session, resume = false, budgetKey = name, mcpServers } = {}) {
  const env = mcpServers ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: browserToken() } : {};
  const f = facts();
  const cwd = f.repo && existsSync(home(f.repo)) ? home(f.repo) : DIR;
  const p = cfg.pipeline.phases[budgetKey] || { budgetUsd: 30, timeoutMin: 120 };
  writeFileSync(join(DIR, `${name}-prompt.md`), prompt);
  log(`claude ${readonly ? 'readonly' : 'agent'} for ${name} (cwd ${cwd}, budget $${p.budgetUsd}, ${p.timeoutMin} min)`);
  const r = await runClaude({ ...cfg.claude, prompt, mode: readonly ? 'readonly' : 'agent', cwd,
    addDirs: [DIR, home('~/git/new-app-docs'), home('~/git/common'), home('~/git/lingopath'), home('~/git/reddit-scout'), home('~/git/app-factory')],
    budgetUsd: p.budgetUsd, timeoutMs: p.timeoutMin * 60_000, sessionId: session, resume, mcpServers, env });
  writeFileSync(join(DIR, `${name}-result.md`), r.result || '');
  ps.totalCost += r.costUsd || 0; saveState();
  log(`claude ${name}: exit ${r.code}${r.timedOut ? ' TIMEOUT' : ''}, $${(r.costUsd || 0).toFixed(2)}, ${min(r.ms)} min, ${r.turns} turns`);
  return r;
}

/** Deterministic checks after a code phase. */
async function gates(name) {
  const f = facts();
  const repo = f.repo && home(f.repo);
  const out = { ok: true, problems: [], checks: [] };
  if (!repo || !existsSync(repo)) { out.ok = false; out.problems.push('facts.repo missing or not a directory'); return out; }
  const check = async (label, cmd, timeoutMin = 25) => {
    const r = await sh(cmd, { cwd: repo, timeoutMs: timeoutMin * 60_000 });
    out.checks.push({ label, ok: r.code === 0, tail: tail(r.out + '\n' + r.err, 1500) });
    if (r.code !== 0) { out.ok = false; out.problems.push(`${label} failed (exit ${r.code}${r.timedOut ? ', timeout' : ''}):\n${tail(r.out + '\n' + r.err, 800)}`); }
  };
  await check('npm test', 'npm test');
  await check('typecheck', 'npx tsc --noEmit');
  await check('expo export', 'rm -rf /home/puca1/tmp-build/factory-export && npx expo export --platform ios --output-dir /home/puca1/tmp-build/factory-export >/dev/null 2>&1; code=$?; rm -rf /home/puca1/tmp-build/factory-export; exit $code', 25);
  const pats = (cfg.pipeline.gates.forbidden_patterns || []).join('|');
  if (pats) await check('forbidden strings', `! git grep -nIiE '${pats}' -- . ':!package-lock.json' ':!*.lock' || (echo 'forbidden pattern present'; exit 1)`, 2);
  await check('git clean', 'test -z "$(git status --porcelain)" || (git status --short; exit 1)', 1);
  await check('pushed', 'git fetch -q origin && test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" || (echo "HEAD not pushed to origin/main"; exit 1)', 3);
  if (name !== 'scaffold') await check('no UIBackgroundModes', `! grep -q UIBackgroundModes app.json || (echo 'UIBackgroundModes in app.json'; exit 1)`, 1);
  writeFileSync(join(DIR, `gates-${name}.json`), JSON.stringify(out, null, 2));
  return out;
}

const REVIEW_SCHEMA = { type: 'object', required: ['verdict', 'summary', 'findings'], properties: {
  verdict: { type: 'string', enum: ['ship', 'fix', 'block'] }, summary: { type: 'string' },
  findings: { type: 'array', items: { type: 'object', required: ['severity', 'summary'], properties: { severity: { type: 'string', enum: ['blocking', 'major', 'minor'] }, file: { type: 'string' }, summary: { type: 'string' }, why: { type: 'string' } } } } } };

async function reviewPhase() {
  const prompt = phasePrompt('review');
  const r = await runClaude({ ...cfg.claude, prompt, mode: 'readonly', cwd: home(facts().repo), addDirs: [DIR, home('~/git/new-app-docs')],
    budgetUsd: cfg.pipeline.phases.review.budgetUsd, timeoutMs: cfg.pipeline.phases.review.timeoutMin * 60_000, jsonSchema: REVIEW_SCHEMA });
  ps.totalCost += r.costUsd || 0; saveState();
  const rv = r.structured || { verdict: 'ship', summary: `review unavailable (${(r.err || '').slice(-200)})`, findings: [] };
  writeFileSync(join(DIR, 'review.json'), JSON.stringify(rv, null, 2));
  return rv;
}

async function fixRound(name, session, problems) {
  const prompt = `${phasePrompt('fix')}\n\n## What must be fixed now\n\n${problems}`;
  const r = await runAgent(`${name}-fix`, prompt, { session, resume: true, budgetKey: 'fix' });
  return r;
}

async function finishPhase(name, result, startedAt, extra = {}) {
  ps.phases[name] = { status: result.status, summary: String(result.summary || '').slice(0, 2000), at: new Date().toISOString(), minutes: min(Date.now() - startedAt), ...extra };
  saveState();
}

async function runPhase(name) {
  const t0 = Date.now();
  ps.phase = name; saveState();
  await refreshThread();
  const f0 = facts();
  // The owner answered a block on this phase ("go anyway") — skip re-running it.
  if (ps.phases[name]?.status === 'blocked' && f0.decision && /^(go|yes|proceed|continue|build)/i.test(String(f0.decision))) {
    log(`${name}: owner said "${f0.decision}" — continuing past the block`);
    await finishPhase(name, { status: 'ok', summary: `${ps.phases[name].summary}\n\nOwner decision: ${f0.decision}` }, t0);
    mergeFacts(ROOT, issue, { decision: null });
    return { status: 'ok' };
  }
  const idx = PHASES.indexOf(name) + 1;
  await comment(`▶️ **Phase ${idx}/${PHASES.length} — ${name}** started${ps.phases[name] ? ' (again)' : ''}.`);
  if (ps.totalCost > cfg.pipeline.totalBudgetUsd) {
    await finishPhase(name, { status: 'blocked', summary: `total budget cap reached ($${ps.totalCost.toFixed(0)} > $${cfg.pipeline.totalBudgetUsd})` }, t0);
    return { status: 'blocked', summary: ps.phases[name].summary };
  }

  let result;
  if (name === 'review') {
    let rv = await reviewPhase();
    const blocking = (x) => (x.findings || []).filter((q) => q.severity === 'blocking');
    if (rv.verdict !== 'ship' && blocking(rv).length) {
      log(`review: ${blocking(rv).length} blocking → fix round`);
      await fixRound('review', ps.phases.features?.session, `A fresh reviewer found these problems. Fix every BLOCKING item (and the major ones if cheap), make the gates green, commit and push.\n\n${JSON.stringify(rv, null, 2)}`);
      const g = await gates('review');
      if (!g.ok) { result = { status: 'failed', summary: `gates failed after the review fix round:\n${g.problems.join('\n')}` }; }
      else { rv = await reviewPhase(); result = blocking(rv).length ? { status: 'failed', summary: `still ${blocking(rv).length} blocking finding(s) after one fix round: ${blocking(rv).map((q) => q.summary).join(' | ')}` } : { status: 'ok', summary: `review verdict ${rv.verdict} after fixes: ${rv.summary}` }; }
    } else result = { status: 'ok', summary: `review verdict **${rv.verdict}**: ${rv.summary}${rv.findings?.length ? `\n${rv.findings.slice(0, 5).map((q) => `- ${q.severity}: ${q.summary}`).join('\n')}` : ''}` };
  } else if (BROWSER_PHASES[name] && !browserToken()) {
    result = { status: 'blocked', summary: 'The browser phase has no Playwright extension token, so it would hang on the extension\'s connect page.', blocked_on: `Put the token from the Playwright MCP Bridge extension's options page in ${TOKEN_FILE} (mode 0400), then move the card back to Building.` };
  } else {
    const r = await runAgent(name, phasePrompt(name), { mcpServers: BROWSER_PHASES[name] });
    result = readResult(name);
    if (result.facts && typeof result.facts === 'object') mergeFacts(ROOT, issue, result.facts);
    if (result.status === 'ok' && CODE_PHASES.has(name)) {
      let g = await gates(name);
      if (!g.ok) {
        log(`${name}: gates failed → one fix round`);
        await fixRound(name, r.sessionId, g.problems.join('\n\n'));
        g = await gates(name);
        if (!g.ok) result = { ...result, status: 'failed', summary: `gates still failing after one fix round:\n${g.problems.map((p) => p.split('\n')[0]).join('\n')}\n\n(agent said: ${result.summary})` };
      }
    }
    ps.phases[name] = { ...(ps.phases[name] || {}), session: r.sessionId };
  }
  await finishPhase(name, result, t0, { session: ps.phases[name]?.session, needs_you: result.needs_you || [] });
  const cost = `$${ps.totalCost.toFixed(0)} so far`;
  const icon = { ok: '✅', blocked: '🙋', failed: '⛔', kill: '🛑' }[result.status];
  let body = `${icon} **${name}** — ${result.status} (${min(Date.now() - t0)} min, ${cost})\n\n${result.summary || ''}`;
  if (result.needs_you?.length) body += `\n\n**🙋 For you (the build continues; do these before it needs them):**\n${result.needs_you.map((x) => `- [ ] ${x}`).join('\n')}`;
  if (result.status === 'blocked') body += `\n\n**Blocked on:** ${result.blocked_on || result.summary}\n\nAnswer here (I'll record what you say), then move the card back to **Building**.`;
  await comment(body);
  return result;
}

async function main() {
  log(`=== pipeline ${issue.identifier} "${issue.title}" mode=${mode} from=${ps.phase} resume=${RESUME} ===`);
  let start = Math.max(0, phasesToRun.indexOf(ps.phase));
  // A pipeline started before the console phase existed (or resumed past it) still needs its records made.
  const ci = phasesToRun.indexOf('console');
  if (ci >= 0 && start > ci && ps.phases.console?.status !== 'ok' && !facts().admob_android_app_id) { log('console phase never ran — running it first'); start = ci; }
  for (const name of phasesToRun.slice(start)) {
    // console is idempotent: rerun it while the App Store Connect record is still missing (e.g. Apple was signed out last time)
    const redoConsole = name === 'console' && !facts().asc_app_id;
    if (ps.phases[name]?.status === 'ok' && (RESUME || FROM) && !redoConsole) { log(`${name}: already ok, skipping`); continue; }
    const r = await runPhase(name);
    if (r.status === 'kill') {
      if (mode === 'research') { await addLabel('researched'); await move('Parked'); ps.state = 'done'; saveState(); return; }
      ps.state = 'paused'; ps.blockedOn = `research verdict: kill — ${r.summary.split('\n')[0]}`; saveState();
      await comment(`The research says **don't build this**. If you still want it, reply "go anyway" and move the card back to **Building**; otherwise move it to **Parked**.`);
      await move('Needs you'); return;
    }
    if (r.status === 'blocked' || r.status === 'failed') {
      ps.state = 'paused'; ps.blockedOn = r.blocked_on || r.summary?.split('\n')[0]; saveState();
      await move('Needs you');
      await notifySlack(`:raising_hand: *${issue.identifier}* ${issue.title} — ${name} ${r.status}: ${ps.blockedOn?.slice(0, 200)}\n${issue.url}`, log);
      return;
    }
    if (mode === 'research') {
      const f = facts();
      await addLabel('researched');
      const scorecard = existsSync(join(DIR, 'research.md')) ? readFileSync(join(DIR, 'research.md'), 'utf8') : r.summary;
      const cur = await L.getIssue(issue.id);
      const desc = (cur.description || '').replace(/\n## Research scorecard[\s\S]*?(?=\n## |\n---|$)/, '');
      await L.updateIssue(issue.id, { description: `${desc}\n\n## Research scorecard (${today()})\n${String(scorecard).slice(0, 12_000)}\n` }).catch((e) => log(`desc update failed: ${e.message}`));
      await move(f.verdict === 'kill' ? 'Parked' : 'Ideation');
      ps.state = 'done'; saveState();
      await notifySlack(`:microscope: *${issue.identifier}* researched — verdict ${f.verdict || '?'}: ${r.summary?.split('\n')[0]?.slice(0, 200)}\n${issue.url}`, log);
      return;
    }
  }
  ps.state = 'done'; ps.phase = 'done'; saveState();
  const f = facts();
  await move('Store review');
  await comment(`🚀 **Submitted.** App Store: ${f.asc_submission || 'submitted for review'} · Play: ${f.play_release || 'production rollout started'}.\nTotal: $${ps.totalCost.toFixed(0)}, ${min(Date.now() - Date.parse(ps.startedAt))} min since start. I'll watch both stores and move this to **Live** (or back to **Needs you** on a rejection).`);
  await notifySlack(`:rocket: *${issue.identifier}* ${f.name || issue.title} submitted to both stores ($${ps.totalCost.toFixed(0)}) — ${issue.url}`, log);
}

try { await main(); }
catch (e) {
  log(`FAILED: ${e.stack || e.message}`);
  ps.state = 'paused'; ps.blockedOn = `runner error in ${ps.phase}: ${e.message}`; saveState();
  await comment(`⛔ The build runner crashed during **${ps.phase}**: ${e.message.slice(0, 300)}\n\nI left everything on disk (${DIR}). Move back to **Building** to retry this phase.`);
  await move('Needs you');
  process.exit(2);
}
