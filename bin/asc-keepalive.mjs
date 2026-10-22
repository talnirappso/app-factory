#!/usr/bin/env node
// Daily: open App Store Connect in the owner's Chrome (Playwright extension) so the trusted Apple session
// stays fresh, and sign in again by prompts/apple-signin.md when it has lapsed — so a new app's console
// phase never finds Apple signed out. Slack only when something needs the owner.
//   node bin/asc-keepalive.mjs     (timer: infra/app-factory-asc-keepalive.timer)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude } from '../lib/claude.mjs';
import { notifySlack } from '../lib/notify.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config/factory.json'), 'utf8'));
const tokenFile = join(ROOT, 'secrets/playwright_extension_token');
const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '';
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);
if (!token) { await notifySlack(`:warning: app-factory ASC keepalive: no Playwright extension token in ${tokenFile}`, log); process.exit(1); }

const signin = readFileSync(join(ROOT, 'prompts/apple-signin.md'), 'utf8').replaceAll('{{CODE_ISSUE_ARG}}', '');
const prompt = `Keep the owner's App Store Connect session alive. You have the Playwright MCP attached to the owner's own Chrome.

- Open a NEW tab (don't touch the owner's tabs) at https://appstoreconnect.apple.com/apps and wait for it to settle.
- If the Apps list loads: that's \`signed_in\`. Close your tab. Done.
- If Apple's sign-in page shows: follow the procedure below; \`signed_in\` if you end on the Apps list, else \`needs_owner\` with the exact reason.
- If tabs die with "Target page, context or browser has been closed" repeatedly, other sessions are contending for the extension relay: \`kill -STOP\` the other \`node …playwright…--extension\` processes (not yours — find yours via \`pgrep -P\` from your claude pid), work, and ALWAYS \`kill -CONT\` them before finishing.
- Do nothing else in App Store Connect. Close your tab at the end.

${signin}`;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['status', 'detail'], properties: { status: { type: 'string', enum: ['signed_in', 'needs_owner'] }, detail: { type: 'string' } } };
const r = await runClaude({ ...cfg.claude, prompt, mode: 'agent', jsonSchema: SCHEMA, budgetUsd: 3, timeoutMs: 30 * 60_000, cwd: ROOT,
  mcpServers: { playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest', '--extension'], env: {} } }, env: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: token } });
const out = r.structured || { status: 'needs_owner', detail: `agent failed (${r.timedOut ? 'timeout' : `exit ${r.code}`})` };
log(`${out.status}: ${out.detail} ($${(r.costUsd || 0).toFixed(2)})`);
writeFileSync(join(ROOT, 'data/asc-session.json'), JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
if (out.status !== 'signed_in') await notifySlack(`:apple: App Store Connect session needs you: ${out.detail}\nNew apps' iOS records wait until it's fixed (sign Chrome in to appstoreconnect.apple.com and tick Trust).`, log);
process.exit(out.status === 'signed_in' ? 0 : 2);
