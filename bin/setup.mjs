#!/usr/bin/env node
// Idempotent: make the Linear team's workflow + labels match config/factory.json, save ids to data/linear.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../lib/linear.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config/factory.json'), 'utf8'));

const me = await L.viewer();
console.log(`Linear: ${me.name} <${me.email}>`);
const out = { me, teams: {}, labels: {}, savedAt: new Date().toISOString() };
for (const [role, tc] of Object.entries(cfg.linear.teams)) {
const t = await L.ensureTeam(tc.key, tc.name);
if (t.name !== tc.name) { await L.updateTeam(t.id, { name: tc.name }).catch((e) => console.warn(`  ⚠ rename team: ${e.message}`)); t.name = tc.name; }
console.log(`team ${t.key} (${t.name}) — ${role}`);

// ---- workflow states: rename the defaults into our flow, create the missing ones ----
let existing = await L.states(t.id);
const byName = () => new Map(existing.map((s) => [s.name.toLowerCase(), s]));
for (const want of tc.states) {
  const cur = byName().get(want.name.toLowerCase()) || (want.renameFrom && byName().get(want.renameFrom.toLowerCase()));
  if (cur) {
    const patch = {};
    if (cur.name !== want.name) patch.name = want.name;
    if (cur.position !== want.position) patch.position = want.position;
    if (want.description && cur.description !== want.description) patch.description = want.description;
    if (want.color && cur.color?.toLowerCase() !== want.color.toLowerCase()) patch.color = want.color;
    if (Object.keys(patch).length) { try { await L.updateState(cur.id, patch); console.log(`state ${cur.name} → ${want.name} (${JSON.stringify(patch)})`); } catch (e) { console.warn(`  ⚠ ${cur.name} → ${want.name}: ${e.message} (patch ${JSON.stringify(patch)})`); } }
    else console.log(`state ${want.name} ok`);
    if (cur.type !== want.type) console.warn(`  ⚠ ${want.name} has type ${cur.type}, wanted ${want.type} (type can't be changed; delete and re-run if it matters)`);
  } else {
    const s = await L.createState(t.id, want);
    console.log(`state ${s.name} created (${s.type})`);
  }
  existing = await L.states(t.id);
}

// ---- labels (workspace-wide) ----
let labels = await L.labels();
for (const want of tc.labels) {
  if (labels.find((l) => l.name.toLowerCase() === want.name.toLowerCase())) { console.log(`label ${want.name} ok`); continue; }
  const l = await L.createLabel(t.id, want);
  console.log(`label ${l.name} created`);
}
labels = await L.labels();

out.teams[role] = { id: t.id, key: t.key, name: t.name, states: Object.fromEntries((await L.states(t.id)).map((s) => [s.name, s.id])) };
}
out.labels = Object.fromEntries((await L.labels()).map((l) => [l.name, l.id]));
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data/linear.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`saved data/linear.json: ${Object.keys(out.teams).join(', ')}; ${Object.keys(out.labels).length} labels`);
