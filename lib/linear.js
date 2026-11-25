// Optional direct Linear access. Used only when a Linear API key is set,
// api.linear.app is reachable and the key belongs to the configured workspace;
// every caller falls back to asking Claude to use the Linear connector instead.
'use strict';

async function gql(key, query, variables) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({ query, variables }),
      signal: ctl.signal,
    });
    const j = await r.json();
    if (j.errors) throw new Error(j.errors[0].message);
    return j.data;
  } finally { clearTimeout(t); }
}

// A key for another workspace (a personal one, say) is never used.
async function inWorkspace(key, workspaceId) {
  const d = await gql(key, 'query{organization{id}}', {});
  return !!(d.organization && d.organization.id === workspaceId);
}

async function issueTitle(key, id, workspaceId) {
  if (!key) return null;
  try {
    if (!(await inWorkspace(key, workspaceId))) return null;
    const d = await gql(key, 'query($id:String!){issue(id:$id){title project{name}}}', { id });
    return d.issue ? { title: d.issue.title, project: d.issue.project && d.issue.project.name } : null;
  } catch { return null; }
}

async function attach(key, id, url, title, workspaceId) {
  if (!key) return false;
  try {
    if (!(await inWorkspace(key, workspaceId))) return false;
    const d = await gql(key, 'mutation($i:AttachmentCreateInput!){attachmentCreate(input:$i){success}}',
      { i: { issueId: id, url, title } });
    return !!(d.attachmentCreate && d.attachmentCreate.success);
  } catch { return false; }
}

module.exports = { issueTitle, attach };
