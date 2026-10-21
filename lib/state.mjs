// Bridge memory: which idea keys are already on the board, which issue is which, poll cursors.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function loadJson(file, fallback) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; }
export function saveJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}
export const emptyState = () => ({
  cursors: { issues: new Date(Date.now() - 3600_000).toISOString(), comments: new Date().toISOString() },
  ideas: {},    // ideaKey -> { issueId, identifier, source, postedAt, signal }
  issues: {},   // issueId -> { identifier, key, kind: 'idea'|'request'|'other', lastStateSeen, lastReplyAt, enriched }
  pipelines: {},// issueId -> { unit, slug, startedAt, lastPhase }
});
