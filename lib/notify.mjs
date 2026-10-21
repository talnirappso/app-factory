// Slack incoming webhook (secrets/slack_webhook_url). Graceful-off; never throws.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPORTED_EXIT = 2;
function url() {
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL.trim();
  const f = join(ROOT, 'secrets/slack_webhook_url');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}
export async function notifySlack(text, log = console.log) {
  const u = url();
  if (!u) { log('slack: no webhook configured'); return false; }
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return true;
  } catch (e) { log(`slack failed: ${e.message}`); return false; }
}
