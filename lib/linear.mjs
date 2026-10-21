// Minimal Linear GraphQL client (zero deps). The key lives in secrets/linear_api_key.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.linear.app/graphql';

export function apiKey() {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY.trim();
  const f = join(ROOT, 'secrets', 'linear_api_key');
  if (!existsSync(f)) throw new Error('no Linear key: put a personal API key in secrets/linear_api_key (chmod 0400)');
  return readFileSync(f, 'utf8').trim();
}

/** One GraphQL call. Throws on HTTP or GraphQL errors; retries 429/5xx a few times. */
export async function gql(query, variables = {}, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { Authorization: apiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      throw new Error(`Linear: ${e.message}`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = Number(res.headers.get('retry-after') || 0) * 1000 || 5000 * (attempt + 1);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`Linear HTTP ${res.status}: ${text.slice(0, 300)}`); }
    if (json.errors?.length) throw new Error(`Linear: ${json.errors.map((e) => e.message).join('; ').slice(0, 500)}`);
    return json.data;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const viewer = () => gql('{ viewer { id name email } }').then((d) => d.viewer);

export async function team(key) {
  const d = await gql('query($key:String!){ teams(filter:{key:{eq:$key}}) { nodes { id key name } } }', { key });
  const t = d.teams.nodes[0];
  if (!t) throw new Error(`Linear team ${key} not found`);
  return t;
}

export const states = (teamId) => gql('query($id:String!){ team(id:$id) { states { nodes { id name type position color description } } } }', { id: teamId }).then((d) => d.team.states.nodes);
export const labels = () => gql('{ issueLabels(first:100) { nodes { id name color team { id } } } }').then((d) => d.issueLabels.nodes);

export async function createState(teamId, { name, type, position, color, description }) {
  const d = await gql('mutation($input:WorkflowStateCreateInput!){ workflowStateCreate(input:$input) { workflowState { id name type position } } }',
    { input: { teamId, name, type, position, color, description } });
  return d.workflowStateCreate.workflowState;
}
export async function updateState(id, input) {
  const d = await gql('mutation($id:String!,$input:WorkflowStateUpdateInput!){ workflowStateUpdate(id:$id,input:$input) { workflowState { id name type position } } }', { id, input });
  return d.workflowStateUpdate.workflowState;
}
export async function createLabel(teamId, { name, color, description }) {
  const d = await gql('mutation($input:IssueLabelCreateInput!){ issueLabelCreate(input:$input) { issueLabel { id name } } }', { input: { name, color, description } });
  return d.issueLabelCreate.issueLabel;
}

const ISSUE_FIELDS = `id identifier title description url priority createdAt updatedAt
  state { id name type } labels { nodes { id name } } creator { id name } assignee { id }
  comments(last: 1) { nodes { id createdAt user { id } } }`;

export async function createIssue({ teamId, title, description, stateId, labelIds = [], priority }) {
  const d = await gql(`mutation($input:IssueCreateInput!){ issueCreate(input:$input) { success issue { ${ISSUE_FIELDS} } } }`,
    { input: { teamId, title, description, stateId, labelIds, priority } });
  return d.issueCreate.issue;
}
export async function updateIssue(id, input) {
  const d = await gql(`mutation($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id,input:$input) { success issue { ${ISSUE_FIELDS} } } }`, { id, input });
  return d.issueUpdate.issue;
}
export const getIssue = (id) => gql(`query($id:String!){ issue(id:$id) { ${ISSUE_FIELDS} } }`, { id }).then((d) => d.issue);

/** Team issues updated after `since` (ISO), oldest first, paged. */
export async function issuesUpdatedSince(teamKey, since, { max = 200 } = {}) {
  const out = [];
  let after = null;
  while (out.length < max) {
    const d = await gql(`query($key:String!,$since:DateTimeOrDuration!,$after:String){
      issues(first:50, after:$after, orderBy:updatedAt, filter:{ team:{key:{eq:$key}}, updatedAt:{gt:$since} }) {
        pageInfo { hasNextPage endCursor } nodes { ${ISSUE_FIELDS} } } }`, { key: teamKey, since, after });
    out.push(...d.issues.nodes);
    if (!d.issues.pageInfo.hasNextPage) break;
    after = d.issues.pageInfo.endCursor;
  }
  return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/** Team issues in one of the named states. */
export async function issuesInStates(teamKey, stateNames) {
  const d = await gql(`query($key:String!,$names:[String!]){
    issues(first:100, filter:{ team:{key:{eq:$key}}, state:{name:{in:$names}} }) { nodes { ${ISSUE_FIELDS} } } }`, { key: teamKey, names: stateNames });
  return d.issues.nodes;
}

export async function issueComments(issueId) {
  const d = await gql(`query($id:String!){ issue(id:$id) { comments(first:100) { nodes { id body createdAt user { id name } parent { id } } } } }`, { id: issueId });
  return d.issue.comments.nodes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Comments in the team created after `since`, oldest first. */
export async function commentsSince(teamKey, since) {
  const d = await gql(`query($key:String!,$since:DateTimeOrDuration!){
    comments(first:100, filter:{ issue:{team:{key:{eq:$key}}}, createdAt:{gt:$since} }) {
      nodes { id body createdAt user { id name } parent { id } issue { id identifier } } } }`, { key: teamKey, since });
  return d.comments.nodes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createComment(issueId, body, parentId) {
  const d = await gql('mutation($input:CommentCreateInput!){ commentCreate(input:$input) { comment { id createdAt } } }', { input: { issueId, body, parentId } });
  return d.commentCreate.comment;
}

export async function ensureTeam(key, name) {
  try { return await team(key); } catch { /* create */ }
  const d = await gql('mutation($input:TeamCreateInput!){ teamCreate(input:$input) { team { id key name } } }', { input: { key, name } });
  return d.teamCreate.team;
}

export async function updateTeam(id, input) {
  const d = await gql('mutation($id:String!,$input:TeamUpdateInput!){ teamUpdate(id:$id,input:$input) { team { id key name } } }', { id, input });
  return d.teamUpdate.team;
}
