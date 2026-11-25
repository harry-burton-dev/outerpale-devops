// Linear workspace guard: writes through any Linear connector go only to the
// configured workspace (Outer-Pale). A connector is trusted once its own
// get_workspace answer has been seen and matches; until then its writes are refused.
// Verified connectors are kept per machine in ~/.linear-link/linear-connectors.json.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// Tool names only Linear's connector has. A server that has called one of these
// (or get_workspace with a linear.app URL) is a Linear server from then on.
const LINEAR_ONLY = new Set([
  'save_issue', 'save_comment', 'save_project', 'save_document', 'save_milestone', 'save_initiative',
  'save_status_update', 'save_issue_label', 'save_project_label', 'save_initiative_label', 'save_release',
  'save_release_note', 'save_diff_comment', 'create_attachment', 'create_attachment_from_upload',
  'create_issue_label', 'create_initiative_label', 'share_issue', 'unshare_issue', 'merge_diff',
  'submit_diff_review', 'resolve_diff_thread', 'update_diff', 'prepare_attachment_upload', 'prepare_file_upload',
  'retire_issue_label', 'retire_project_label', 'retire_initiative_label', 'restore_issue_label',
  'restore_project_label', 'restore_initiative_label', 'delete_attachment', 'delete_diff_comment', 'delete_status_update',
]);
// Writes whose names other connectors share; guarded only on a known Linear server.
const SHARED_WRITES = new Set(['delete_comment', 'mark_notification']);

function file() { return path.join(os.homedir(), '.linear-link', 'linear-connectors.json'); }
function load() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } }
function save(known) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(known, null, 2));
}

function split(toolName) {
  const m = String(toolName || '').match(/^mcp__(.+)__([a-z_]+)$/);
  return m ? { server: m[1], tool: m[2] } : null;
}

// Returns null to allow, or { reason, event } to refuse.
function check(toolName, cfg) {
  const t = split(toolName);
  if (!t) return null;
  const known = load();
  const rec = known[t.server];
  const isWrite = LINEAR_ONLY.has(t.tool) || (rec && SHARED_WRITES.has(t.tool));
  if (!isWrite) return null;
  if (!rec) {
    return {
      reason: `this Linear connector (${t.server}) hasn't been checked yet. Call mcp__${t.server}__get_workspace first; writes are allowed only to the ${cfg.workspaceName} workspace.`,
      event: { name: 'linear-guard-unverified', server: t.server, tool: t.tool },
    };
  }
  if (rec.workspaceId !== cfg.workspaceId) {
    const good = Object.entries(known).filter(([, r]) => r.workspaceId === cfg.workspaceId).map(([s]) => s);
    return {
      reason: `this Linear connector writes to "${rec.name}", not ${cfg.workspaceName}. ${good.length ? `Use mcp__${good[0]}__${t.tool} instead.` : `Connect the ${cfg.workspaceName} workspace instead.`}`,
      event: { name: 'linear-guard-blocked', server: t.server, tool: t.tool, workspace: rec.name },
    };
  }
  return null;
}

// Text of an MCP tool response, whatever shape the hook was given.
function responseText(resp) {
  if (typeof resp === 'string') return resp;
  const items = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.content) ? resp.content : null);
  if (items) return items.map(i => (i && typeof i.text === 'string' ? i.text : JSON.stringify(i))).join('\n');
  return JSON.stringify(resp || '');
}

// After get_workspace: remember which workspace this connector is on.
function record(toolName, resp) {
  const t = split(toolName);
  if (!t || t.tool !== 'get_workspace') return null;
  const text = responseText(resp);
  let ws;
  try { ws = JSON.parse(text); } catch {
    const id = (text.match(/"id"\s*:\s*"([0-9a-f-]{36})"/) || [])[1];
    const name = (text.match(/"name"\s*:\s*"([^"]+)"/) || [])[1];
    const url = (text.match(/https:\/\/linear\.app\/[A-Za-z0-9_-]+/) || [])[0];
    ws = { id, name, url };
  }
  if (!ws || !ws.id || !/linear\.app/.test(ws.url || '')) return null;
  const known = load();
  known[t.server] = { workspaceId: ws.id, name: ws.name || ws.url, url: ws.url, checkedAt: new Date().toISOString() };
  save(known);
  return known[t.server];
}

module.exports = { check, record, responseText, LINEAR_ONLY };
