#!/usr/bin/env node
// The Linear bridge: a long-running loop (systemd user service) that
//   1. posts new scout findings to the ideas board as full idea cards (Ideation),
//   2. fleshes out ideas the owner typed themselves,
//   3. answers the owner's comments (and applies the actions they asked for),
//   4. reacts to state moves: Research → research job, Implement → build pipeline, Queued → nightly agent request,
//   5. watches builds, store review and nightly-agent results, and keeps the board in sync.
//
//   node bin/bridge.mjs            run forever
//   node bin/bridge.mjs --once     one tick
//   node bin/bridge.mjs --dry-run  one tick, no writes to Linear, no Claude
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/linear.mjs';
import { loadJson, saveJson, emptyState } from '../lib/state.mjs';
import { cardFromLead, cardFromGap, cardsFromIdeasMd, selectNewCards } from '../lib/ideas.mjs';
import { renderCard } from '../lib/card.mjs';
import { generateLogo, uploadToLinear } from '../lib/logo.mjs';
import { enrich, docsContext } from '../lib/enrich.mjs';
import { respond } from '../lib/respond.mjs';
import { notifySlack } from '../lib/notify.mjs';
import { run } from '../lib/sh.mjs';
import { pipelineStatus, unitName, launchPipeline, unitActive, storeState, pipelineDir, mergeFacts } from '../lib/pipeline-ctl.mjs';
import { runClaude } from '../lib/claude.mjs';
import { fill } from '../lib/enrich.mjs';
import { renderThread } from '../lib/respond.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ONCE = args.includes('--once') || args.includes('--dry-run');
const DRY = args.includes('--dry-run');
const home = (p) => p.replace(/^~(?=\/)/, homedir());
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cfg = JSON.parse(readFileSync(join(ROOT, 'config/factory.json'), 'utf8'));
const lin = JSON.parse(readFileSync(join(ROOT, 'data/linear.json'), 'utf8'));
const STATE_FILE = join(ROOT, 'data/bridge-state.json');
const state = loadJson(STATE_FILE, emptyState());
const save = () => { if (!DRY) saveJson(STATE_FILE, state); };
const IDEAS = lin.teams.ideas, APPS = lin.teams.apps;
const boardOf = (issue) => (issue.identifier.startsWith(`${APPS.key}-`) ? 'apps' : 'ideas');
const stateId = (board, name) => { const id = lin.teams[board].states[name]; if (!id) throw new Error(`no state ${name} on ${board}`); return id; };
const labelId = (name) => lin.labels[name];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
let docsCache = null, docsAt = 0;
const docs = () => { if (Date.now() - docsAt > 600_000) { docsCache = docsContext(cfg); docsAt = Date.now(); } return docsCache; };

const reg = (issue, extra = {}) => {
  const cur = state.issues[issue.id] || { identifier: issue.identifier, kind: 'other', firstSeen: new Date().toISOString() };
  state.issues[issue.id] = { ...cur, ...extra, identifier: issue.identifier, title: issue.title, board: boardOf(issue) };
  return state.issues[issue.id];
};
async function comment(issue, body) {
  log(`comment on ${issue.identifier}: ${body.slice(0, 80).replace(/\n/g, ' ')}`);
  if (DRY) return null;
  return L.createComment(issue.id, body);
}
async function move(issue, board, name, note) {
  log(`move ${issue.identifier} → ${name}`);
  if (DRY) return issue;
  const upd = await L.updateIssue(issue.id, { stateId: stateId(board, name) });
  reg(upd, { lastStateSeen: name });
  if (note) await comment(issue, note);
  return upd;
}

// ---- 1. scout findings → idea cards ------------------------------------------------------
async function syncIdeas() {
  const cards = [];
  const rs = loadJson(home(cfg.scouts.redditState), null);
  if (rs) for (const l of Object.values(rs.leads || {})) cards.push({ ...cardFromLead(l), raw: l });
  const ss = loadJson(home(cfg.scouts.storeState), null);
  if (ss) for (const g of Object.values(ss.gaps || {})) cards.push({ ...cardFromGap(g), raw: g });
  const ideasMd = home(cfg.scouts.ideasFile);
  if (existsSync(ideasMd)) for (const c of cardsFromIdeasMd(readFileSync(ideasMd, 'utf8'))) cards.push({ ...c, raw: c.description });
  const postedToday = Object.values(state.ideas).filter((i) => (i.postedAt || '').startsWith(new Date().toISOString().slice(0, 10))).length;
  const room = Math.max(0, (cfg.scouts.maxPerDay || 8) - postedToday);
  const fresh = selectNewCards(cards, state.ideas, { minSignal: cfg.scouts.minSignal }).slice(0, Math.min(cfg.scouts.maxPerTick || 3, room));
  if (!fresh.length) return;
  log(`${fresh.length} new finding(s) to post (${cards.length} known)`);
  for (const c of fresh) {
    if (DRY) { log(`  would post: [${c.signal}] ${c.title}`); continue; }
    try {
      const { card, costUsd } = await enrich(cfg, { source: `${c.source} scout`, finding: c.description, docs: docs() });
      const dir = join(ROOT, 'data/cards', c.key.replace(/[^a-z0-9]+/gi, '-'));
      let logoUrl = null;
      try { const lg = await generateLogo({ prompt: card.logo_prompt, colors: card.logo_colors, name: card.app_name, outDir: dir }); logoUrl = await uploadToLinear(lg.file); }
      catch (e) { log(`  logo failed: ${e.message}`); }
      const description = renderCard(card, { source: `${c.source} scout`, key: c.key, signal: c.signal, date: today(), logoUrl, rawSection: c.description });
      const labelIds = [...c.labels, card.verdict === 'kill' ? null : null].filter(Boolean).map(labelId).filter(Boolean);
      const issue = await L.createIssue({ teamId: IDEAS.id, title: `${card.app_name} — ${card.tagline}`.slice(0, 200), description, stateId: stateId('ideas', 'Ideation'), labelIds, priority: card.verdict === 'build' ? 2 : c.priority });
      saveJson(join(dir, 'card.json'), { card, costUsd, issue: issue.identifier, key: c.key });
      state.ideas[c.key] = { issueId: issue.id, identifier: issue.identifier, source: c.source, signal: c.signal, verdict: card.verdict, postedAt: new Date().toISOString() };
      reg(issue, { kind: 'idea', key: c.key, lastStateSeen: 'Ideation', enriched: true });
      save();
      log(`  posted ${issue.identifier}: ${card.app_name} [${card.verdict}] ($${costUsd.toFixed(2)})`);
      await notifySlack(`:bulb: *${issue.identifier}* ${card.app_name} — ${card.tagline}\nverdict: ${card.verdict} · ${card.build_size.split(' ')[0]} · ${issue.url}`, log);
    } catch (e) {
      log(`  enrich/post failed for ${c.key}: ${e.message}`);
      state.ideas[c.key] = { failedAt: new Date().toISOString(), error: e.message.slice(0, 300), source: c.source, signal: c.signal, retries: (state.ideas[c.key]?.retries || 0) + 1 };
      if (state.ideas[c.key].retries >= 3) state.ideas[c.key].issueId = 'gave-up';
      save();
    }
  }
}

// ---- 2. the owner's own ideas / requests ---------------------------------------------------
async function enrichOwnIdea(issue) {
  const finding = `Title: ${issue.title}\n\n${issue.description || '(no description)'}`;
  const { card, costUsd } = await enrich(cfg, { source: 'the owner, typed on the board', finding, docs: docs() });
  const dir = join(ROOT, 'data/cards', `own-${issue.identifier}`);
  let logoUrl = null;
  try { const lg = await generateLogo({ prompt: card.logo_prompt, colors: card.logo_colors, name: card.app_name, outDir: dir }); logoUrl = await uploadToLinear(lg.file); }
  catch (e) { log(`  logo failed: ${e.message}`); }
  const description = renderCard(card, { source: 'your idea', key: `own:${issue.identifier}`, date: today(), logoUrl, rawSection: finding });
  const labelIds = [...new Set([...(issue.labels?.nodes || []).map((l) => l.id), labelId('idea'), labelId('your idea')])].filter(Boolean);
  const upd = await L.updateIssue(issue.id, { description, labelIds, title: issue.title.length < 12 || /^[a-z]/.test(issue.title) ? `${card.app_name} — ${card.tagline}`.slice(0, 200) : issue.title });
  saveJson(join(dir, 'card.json'), { card, costUsd, issue: issue.identifier });
  reg(upd, { kind: 'idea', key: `own:${issue.identifier}`, enriched: true, lastStateSeen: upd.state.name });
  await comment(issue, `I filled in the card from what you wrote (your original text is kept at the bottom). Verdict: **${card.verdict}** — ${card.why_verdict}\n\nComment to change anything, or move it to **Research** / **Implement**.`);
}

// An apps-board issue is a *nightly request* when it carries an app label (and not `now`); otherwise it is a *task* Claude runs itself.
function appOf(issue) { return (issue.labels?.nodes || []).map((l) => l.name.toLowerCase()).find((n) => cfg.nightlyAgents[n]) || null; }
function isNightly(issue) { return !!appOf(issue) && !(issue.labels?.nodes || []).some((l) => l.name.toLowerCase() === 'now'); }

async function triageAppRequest(issue) {
  if (!isNightly(issue)) return triageTask(issue);
  const app = appOf(issue), agent = cfg.nightlyAgents[app];
  await comment(issue, `Logged for **${app}**. Move it to **Ready** and the nightly agent attempts it on its next run (${agent.when}). I'll comment here with what it did; if it can't be done unattended, it lands in **Needs you**. Add the label \`now\` instead if you want me to do it right away as a task (no nightly gates/deploy).`);
  reg(issue, { kind: 'request', app, lastStateSeen: issue.state.name });
}

async function triageTask(issue) {
  const rec = reg(issue, { kind: 'task', lastStateSeen: issue.state.name });
  const comments = await L.issueComments(issue.id);
  const prompt = fill(readFileSync(join(ROOT, 'prompts/task-triage.md'), 'utf8'), {
    IDENTIFIER: issue.identifier, TITLE: issue.title, LABELS: issue.labels?.nodes?.map((l) => l.name).join(', ') || '—',
    DESCRIPTION: issue.description || '(no description)', THREAD: renderThread(comments, lin.me.id) || '(none)',
  });
  const r = await runClaude({ ...cfg.claude, prompt, mode: 'readonly', cwd: home('~/git'), budgetUsd: cfg.tasks.triageBudgetUsd, timeoutMs: cfg.tasks.triageTimeoutMin * 60_000 });
  const plan = r.result?.trim() || `_I couldn't draft a plan (${r.timedOut ? 'timeout' : `exit ${r.code}`}). Move it to **Ready** anyway and I'll work it out while running._`;
  await comment(issue, `${plan}\n\n_Move to **Ready** to run it (budget $${cfg.tasks.budgetUsd}, up to ${cfg.tasks.timeoutMin} min)._`);
  rec.triaged = true;
}

// ---- 3. comments ---------------------------------------------------------------------------
async function applyActions(issue, board, actions, rec) {
  for (const a of actions) {
    try {
      if (a.type === 'move' && a.state) {
        if (!lin.teams[board].states[a.state]) { log(`  ignored move to unknown state ${a.state}`); continue; }
        await move(issue, board, a.state);
      } else if (a.type === 'update_card' && a.description) {
        if (!DRY) await L.updateIssue(issue.id, { description: a.description });
        log(`  card updated (${a.description.length} chars)`);
      } else if (a.type === 'set_title' && a.title) {
        if (!DRY) await L.updateIssue(issue.id, { title: a.title.slice(0, 200) });
      } else if (a.type === 'set_facts' && a.facts && Object.keys(a.facts).length) {
        if (!DRY) mergeFacts(ROOT, issue, a.facts);
        log(`  facts: ${Object.keys(a.facts).join(', ')}`);
      } else if (a.type === 'resume') {
        if (board === 'ideas') {
          await move(issue, board, 'Building');
          if (!DRY) await launchPipeline(ROOT, issue, { resume: true }, log);
          rec.lastStateSeen = 'Building';
        } else if (!isNightly(issue)) {
          await move(issue, board, 'Running');
          if (!DRY) await launchPipeline(ROOT, issue, { resume: true, script: 'bin/task.mjs' }, log);
          rec.lastStateSeen = 'Running';
        }
      }
    } catch (e) { log(`  action ${a.type} failed: ${e.message}`); }
  }
}

async function pollComments() {
  const since = state.cursors.comments;
  const all = [];
  for (const t of [IDEAS, APPS]) all.push(...(await L.commentsSince(t.key, since)));
  const byIssue = new Map();
  for (const c of all) {
    if (c.user?.id === lin.me.id) continue; // my own replies
    if (/^\s*>\s*_?\(no reply\)/i.test(c.body) || /^\s*\/quiet\b/i.test(c.body)) continue;
    byIssue.set(c.issue.id, c);
  }
  for (const [issueId, last] of byIssue) {
    const issue = await L.getIssue(issueId);
    const board = boardOf(issue);
    const rec = reg(issue);
    const comments = await L.issueComments(issueId);
    log(`reply needed on ${issue.identifier} (${board}): "${last.body.slice(0, 60).replace(/\n/g, ' ')}"`);
    if (DRY) continue;
    try {
      const ps = pipelineStatus(ROOT, issue);
      const { reply, actions, costUsd } = await respond(cfg, { issue, board, comments, meId: lin.me.id, docs: docs(), pipeline: ps ? ps.summary : null });
      await L.createComment(issueId, reply, last.parent?.id || undefined);
      rec.lastReplyAt = new Date().toISOString();
      log(`  replied ($${costUsd.toFixed(2)}), ${actions.length} action(s)`);
      await applyActions(issue, board, actions, rec);
    } catch (e) {
      log(`  reply failed: ${e.message}`);
      await L.createComment(issueId, `_I couldn't answer this one automatically (${e.message.slice(0, 160)}). I'll try again on your next comment._`).catch(() => {});
    }
  }
  if (all.length) state.cursors.comments = all.at(-1).createdAt;
  save();
}

// ---- 4. state moves ------------------------------------------------------------------------
async function pollIssues() {
  const since = state.cursors.issues;
  const issues = [];
  for (const t of [IDEAS, APPS]) issues.push(...(await L.issuesUpdatedSince(t.key, since)));
  for (const issue of issues) {
    const board = boardOf(issue);
    const known = state.issues[issue.id];
    const rec = reg(issue);
    const st = issue.state.name;
    if (!known) {
      // Created by the owner (the bridge registers its own issues when it creates them).
      if (issue.creator?.id === lin.me.id && !issue.description) continue;
      log(`new ${board} issue ${issue.identifier} "${issue.title}" in ${st}`);
      if (DRY) continue;
      if (board === 'ideas' && !rec.enriched && ['Ideation', 'Research', 'Implement'].includes(st)) await enrichOwnIdea(issue).catch((e) => log(`  enrich failed: ${e.message}`));
      if (board === 'apps') await triageAppRequest(issue).catch((e) => log(`  triage failed: ${e.message}`));
    }
    if (rec.lastStateSeen !== st) {
      log(`${issue.identifier}: ${rec.lastStateSeen || '∅'} → ${st}`);
      rec.lastStateSeen = st;
      if (DRY) continue;
      try { await onStateChange(issue, board, st, rec); } catch (e) { log(`  state handler failed: ${e.message}`); }
    }
  }
  if (issues.length) state.cursors.issues = issues.at(-1).updatedAt;
  save();
}

async function onStateChange(issue, board, st, rec) {
  if (board === 'ideas') {
    if (st === 'Research') {
      if (unitActive(issue)) return;
      await comment(issue, '🔬 Research started: both stores, demand and volume, name/trademark, official sources, 4.3(a) concept test. Usually 30–60 min; the scorecard lands here and the card goes back to **Ideation** (or **Parked** on a kill).');
      await launchPipeline(ROOT, issue, { only: 'research' }, log);
    } else if (st === 'Implement') {
      if (unitActive(issue)) return;
      await move(issue, board, 'Building', '🏗️ Build started. Phases: research → scaffold → features → review → assets → Android (incl. the OnePlus 6 test) → iOS → store listings → submit. Each phase posts here. Anything only you can do (console-only steps) comes as a checklist; the build keeps going until it truly needs it.');
      await launchPipeline(ROOT, issue, {}, log);
      rec.lastStateSeen = 'Building';
    } else if (st === 'Building') {
      // Owner moved it back from Needs you: resume where it stopped.
      if (!unitActive(issue) && pipelineStatus(ROOT, issue)) await launchPipeline(ROOT, issue, { resume: true }, log);
    } else if (st === 'Parked' || st === 'Live') {
      if (rec.key) state.ideas[rec.key] = { ...(state.ideas[rec.key] || {}), issueId: issue.id, identifier: issue.identifier, [st.toLowerCase() + 'At']: new Date().toISOString() };
    }
  } else if (board === 'apps') {
    if (isNightly(issue)) {
      await syncRequests();
      if (st === 'Ready' && !rec.app) await triageAppRequest(issue);
    } else if (st === 'Ready') {
      if (unitActive(issue)) return;
      await move(issue, board, 'Running');
      await launchPipeline(ROOT, issue, { script: 'bin/task.mjs' }, log);
      rec.lastStateSeen = 'Running';
    } else if (st === 'Running') {
      // moved back from Needs you by the owner → resume with their answers
      if (!unitActive(issue) && existsSync(join(ROOT, 'data/tasks', issue.identifier, 'state.json'))) await launchPipeline(ROOT, issue, { resume: true, script: 'bin/task.mjs' }, log);
    }
  }
}

// ---- 5. apps board ↔ nightly agents ----------------------------------------------------------
async function syncRequests() {
  const queued = (await L.issuesInStates(APPS.key, ['Ready', 'Running'])).filter(isNightly);
  for (const [app, agent] of Object.entries(cfg.nightlyAgents)) {
    const mine = queued.filter((i) => (i.labels?.nodes || []).some((l) => l.name.toLowerCase() === app));
    const dir = home(agent.dataDir);
    if (!existsSync(dir)) continue;
    const reqs = mine.map((i) => ({ id: i.identifier, issueId: i.id, title: i.title, body: (i.description || '').slice(0, 4000), url: i.url, labels: (i.labels?.nodes || []).map((l) => l.name), priority: i.priority }));
    const f = join(dir, 'requests.json');
    const prev = existsSync(f) ? readFileSync(f, 'utf8') : '';
    const next = JSON.stringify(reqs, null, 2) + '\n';
    if (prev !== next) { writeFileSync(f, next); log(`requests for ${app}: ${reqs.length}`); }
    for (const i of mine) { const r = reg(i, { kind: 'request', app }); r.queuedFor = app; }
  }
  save();
}

async function pollNightlyResults() {
  for (const [app, agent] of Object.entries(cfg.nightlyAgents)) {
    const dir = home(agent.dataDir);
    if (!existsSync(dir)) continue;
    const nights = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
    for (const n of nights.slice(-3)) {
      const f = join(dir, n, 'report.json');
      if (!existsSync(f)) continue;
      const seenKey = `${app}:${n}`;
      if (state.nightsSeen?.[seenKey]) continue;
      let rep; try { rep = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
      const summary = JSON.parse(existsSync(join(dir, n, 'summary.json')) ? readFileSync(join(dir, n, 'summary.json'), 'utf8') : '{}');
      if (summary.status === 'running') continue;
      state.nightsSeen = state.nightsSeen || {}; state.nightsSeen[seenKey] = true;
      const done = rep.requests_done || [], blocked = rep.requests_blocked || [];
      for (const id of done) {
        const issue = (await L.issuesInStates(APPS.key, ['Ready', 'Running'])).find((i) => i.identifier === id);
        if (!issue) continue;
        await move(issue, 'apps', 'Done', `✅ Done by the ${app} nightly agent on ${n}: **${rep.title || ''}** — ${rep.summary || ''}\n\nShipped: ${(summary.outcomes || []).join('; ') || 'see the nightly report'}.`);
      }
      for (const b of blocked) {
        const id = typeof b === 'string' ? b : b.id;
        const issue = (await L.issuesInStates(APPS.key, ['Ready', 'Running'])).find((i) => i.identifier === id);
        if (!issue) continue;
        await move(issue, 'apps', 'Needs you', `🙋 The ${app} nightly agent could not do this unattended (${n}): ${typeof b === 'string' ? '' : b.reason || ''}\n\nTell me what to do here, or move it back to **Ready** to retry.`);
      }
      save();
    }
  }
}

// ---- 6. builds and store review ---------------------------------------------------------------
async function pollPipelines() {
  const active = await L.issuesInStates(IDEAS.key, ['Building', 'Research', 'Store review']);
  for (const issue of active) {
    const ps = pipelineStatus(ROOT, issue);
    const st = issue.state.name;
    if (st === 'Building' || st === 'Research') {
      if (unitActive(issue)) continue;
      if (!ps) continue; // launched but not started yet (or launch failed — the handler logged it)
      if (ps.state === 'running' && !unitActive(issue) && Date.now() - Date.parse(ps.updatedAt || 0) > 180_000) {
        // The unit died without finishing its phase (OOM, reboot, kill).
        await comment(issue, `⚠️ The build process stopped unexpectedly during **${ps.phase}** (unit ${unitName(issue)} is gone). Resuming from that phase.`);
        await launchPipeline(ROOT, issue, { resume: true }, log);
      }
    } else if (st === 'Store review') {
      const key = `storecheck:${issue.id}`;
      if (Date.now() - (state.timers?.[key] || 0) < (cfg.storeCheckMinutes || 30) * 60_000) continue;
      state.timers = state.timers || {}; state.timers[key] = Date.now(); save();
      try {
        const s = await storeState(ROOT, issue);
        if (!s) continue;
        const liveIos = s.asc?.live_version, liveAndroid = s.play?.production?.status === 'completed';
        const rejected = s.asc?.versions?.find((v) => /REJECTED|DEVELOPER_REJECTED|METADATA_REJECTED/.test(v.state));
        if (rejected) await move(issue, 'ideas', 'Needs you', `⛔ App Store: version ${rejected.version} is **${rejected.state}**. Read the message in App Store Connect → Resolution Center, paste the reviewer's text here and tell me how to proceed (change the app, resubmit, or park). Android: ${liveAndroid ? 'live' : s.play?.production?.status || 'unknown'}.`);
        else if (liveIos && liveAndroid) await move(issue, 'ideas', 'Live', `🎉 Live on both stores: App Store ${liveIos}, Play production completed. Next: AdMob "Add store" for both apps and check app-ads.txt; then the nightly agent pattern can take over.`);
        else if (Date.now() - (state.timers[`storenote:${issue.id}`] || 0) > 24 * 3600_000) {
          state.timers[`storenote:${issue.id}`] = Date.now();
          await comment(issue, `⏳ Still in review — App Store: ${s.asc?.pending_review || s.asc?.live_version || 'unknown'}; Play production: ${s.play?.production?.status || 'unknown'}.`);
        }
      } catch (e) { log(`store check ${issue.identifier}: ${e.message}`); }
    }
  }
}

async function pollTasks() {
  for (const issue of (await L.issuesInStates(APPS.key, ['Running'])).filter((i) => !isNightly(i))) {
    if (unitActive(issue)) continue;
    const f = join(ROOT, 'data/tasks', issue.identifier, 'state.json');
    const st = loadJson(f, null);
    if (!st) continue;
    if (st.last && Date.now() - Date.parse(st.updatedAt || 0) > 180_000 && !state.taskNudged?.[issue.id]) {
      state.taskNudged = state.taskNudged || {}; state.taskNudged[issue.id] = true; save();
      await comment(issue, '⚠️ The task process stopped without reporting (reboot or kill). Move the card to **Ready** to run it again.');
      await move(issue, 'apps', 'Needs you');
    }
  }
}

// ---- main loop --------------------------------------------------------------------------------
async function tick() {
  const t0 = Date.now();
  for (const [name, fn] of [['issues', pollIssues], ['comments', pollComments], ['pipelines', pollPipelines], ['tasks', pollTasks], ['nightly', pollNightlyResults], ['ideas', syncIdeas]]) {
    try { await fn(); } catch (e) { log(`${name}: ${e.message}`); }
  }
  state.lastTick = new Date().toISOString(); save();
  if (Date.now() - t0 > 5000) log(`tick ${Math.round((Date.now() - t0) / 1000)}s`);
}

mkdirSync(join(ROOT, 'data'), { recursive: true });
// First run: adopt whatever is already on the boards without acting on it (Linear's onboarding issues, old cards).
if (!state.adopted) {
  for (const t of [IDEAS, APPS]) for (const i of await L.issuesUpdatedSince(t.key, '2000-01-01T00:00:00.000Z', { max: 500 })) {
    reg(i, { kind: 'other', adopted: true, enriched: true, lastStateSeen: i.state.name });
  }
  state.adopted = true; save();
  log(`adopted ${Object.keys(state.issues).length} existing issue(s) without acting on them`);
}
log(`bridge up (${DRY ? 'dry-run' : ONCE ? 'once' : `every ${cfg.linear.pollSeconds}s`}) — boards ${IDEAS.key} (ideas) + ${APPS.key} (apps), as ${lin.me.name}`);
if (ONCE) { await tick(); process.exit(0); }
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
while (!stopping) { await tick(); await sleep(cfg.linear.pollSeconds * 1000); }
