// What the bridge needs to know about a build pipeline without running it: its state file,
// its systemd unit, launching/resuming it, and the store status of the app it produced.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { run } from './sh.mjs';
import { loadJson, saveJson } from './state.mjs';

const home = (p) => p.replace(/^~(?=\/)/, homedir());
export const pipelineDir = (root, issue) => join(root, 'data/pipelines', issue.identifier);
export const unitName = (issue) => `app-factory-${issue.identifier.toLowerCase()}`;

export function pipelineStatus(root, issue) {
  const f = join(pipelineDir(root, issue), 'state.json');
  if (!existsSync(f)) return null;
  const ps = loadJson(f, null);
  if (!ps) return null;
  const done = Object.entries(ps.phases || {}).map(([n, p]) => `${n}: ${p.status}${p.summary ? ` — ${String(p.summary).slice(0, 160).replace(/\n/g, ' ')}` : ''}`).join('\n');
  ps.summary = `mode ${ps.mode}, state **${ps.state}**, current phase **${ps.phase}**, cost so far $${(ps.totalCost || 0).toFixed(2)}${ps.repo ? `, repo ${ps.repo}` : ''}${ps.blockedOn ? `\nblocked on: ${ps.blockedOn}` : ''}\n${done}`;
  return ps;
}

export function unitActive(issue) {
  const r = spawnSync('systemctl', ['--user', 'is-active', unitName(issue)], { encoding: 'utf8' });
  return r.stdout.trim() === 'active' || r.stdout.trim() === 'activating';
}

export async function launchPipeline(root, issue, { only, resume, script = 'bin/pipeline.mjs' } = {}, log = console.log) {
  const unit = unitName(issue);
  if (unitActive(issue)) { log(`${unit} already running`); return false; }
  spawnSync('systemctl', ['--user', 'reset-failed', unit], { encoding: 'utf8' });
  const args = ['--user', `--unit=${unit}`, '--collect', '--quiet', `--property=WorkingDirectory=${root}`,
    `--setenv=PATH=${process.env.HOME}/.local/bin:${process.env.PATH}`, `--setenv=HOME=${process.env.HOME}`,
    '/usr/bin/node', join(root, script), issue.id];
  if (only) args.push(`--only=${only}`);
  if (resume) args.push('--resume');
  const r = await run('systemd-run', args, { timeoutMs: 30_000 });
  if (r.code !== 0) { log(`launch ${unit} failed: ${(r.err || r.out).slice(-300)}`); throw new Error(`systemd-run: ${(r.err || r.out).slice(-200)}`); }
  log(`launched ${unit}${only ? ` (--only=${only})` : ''}${resume ? ' (resume)' : ''}`);
  return true;
}

export function mergeFacts(root, issue, facts) {
  const dir = pipelineDir(root, issue);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'facts.json');
  const cur = loadJson(f, {});
  saveJson(f, { ...cur, ...facts, _updatedAt: new Date().toISOString() });
  return loadJson(f, {});
}

/** Live store state for a built app, via the nightly engine's asc.py / play.py. */
export async function storeState(root, issue) {
  const facts = loadJson(join(pipelineDir(root, issue), 'facts.json'), {});
  if (!facts.asc_app_id && !facts.play_package) return null;
  const scripts = join(root, '../common/nightly-agent/scripts');
  const out = { asc: null, play: null, errors: [] };
  if (facts.asc_app_id) {
    const r = await run('python3', ['-I', join(scripts, 'asc.py'), 'state', '--app', String(facts.asc_app_id), '--key-id', 'TU7KTA57MK'], { timeoutMs: 120_000 });
    if (r.code === 0) { try { out.asc = JSON.parse(r.out); } catch { out.errors.push('asc: bad json'); } } else out.errors.push(`asc: ${(r.err || '').slice(-200)}`);
  }
  if (facts.play_package && facts.play_sa_json && existsSync(home(facts.play_sa_json))) {
    const r = await run('python3', ['-I', join(scripts, 'play.py'), 'state', '--package', facts.play_package, '--sa', home(facts.play_sa_json)], { timeoutMs: 120_000 });
    if (r.code === 0) { try { out.play = JSON.parse(r.out); } catch { out.errors.push('play: bad json'); } } else out.errors.push(`play: ${(r.err || '').slice(-200)}`);
  }
  return out;
}
