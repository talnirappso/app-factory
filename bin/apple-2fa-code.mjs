#!/usr/bin/env node
// Ask the owner for Apple's 6-digit sign-in code and wait for it.
// Posts to Slack and as a Linear comment (on --issue, or on a new APP-board issue), then polls that
// issue's comments for a 6-digit number. Prints the code on stdout; exit 1 after --minutes (default 15).
//   node bin/apple-2fa-code.mjs [--issue=PUC-5] [--minutes=15]
import * as L from '../lib/linear.mjs';
import { notifySlack } from '../lib/notify.mjs';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const minutes = Number(arg('minutes', 15));
const err = (m) => process.stderr.write(m + '\n');
const since = new Date().toISOString();
const ask = `🔐 Apple sent a 6-digit sign-in code to your iPhone. Reply here with just the code (within ${minutes} min) so the agent can finish signing in to App Store Connect.`;

let issue;
if (arg('issue')) issue = await L.getIssue(arg('issue'));
else {
  const t = await L.team('APP');
  issue = await L.createIssue({ teamId: t.id, title: 'Apple sign-in code needed (App Store Connect)', description: 'Opened by the app-factory agent. It closes itself once the code is used.', priority: 1 });
}
await L.createComment(issue.id, ask);
await notifySlack(`${ask}\n${issue.url}`, err);
err(`asked on ${issue.identifier}; waiting up to ${minutes} min`);

const deadline = Date.now() + minutes * 60_000;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 15_000));
  const cs = await L.issueComments(issue.id).catch(() => []);
  const hit = cs.filter((c) => c.createdAt > since && !c.body.includes('Apple sent a 6-digit')).map((c) => c.body.match(/\b(\d{3})\s?(\d{3})\b/)).find(Boolean);
  if (hit) {
    await L.createComment(issue.id, '✅ Got the code, signing in.');
    if (!arg('issue')) await L.updateIssue(issue.id, { stateId: (await L.states(issue.team?.id || (await L.team('APP')).id)).find((s) => s.type === 'completed')?.id }).catch(() => {});
    process.stdout.write(hit[1] + hit[2] + '\n');
    process.exit(0);
  }
}
await L.createComment(issue.id, '⌛ No code arrived in time; the agent stopped. It will try again on the next run.');
err('timed out'); process.exit(1);
