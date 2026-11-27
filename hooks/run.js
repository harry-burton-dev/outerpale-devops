#!/usr/bin/env node
// outerpale-devops hook dispatcher: node run.js <session-start|prompt-submit|pre-tool|post-tool>
// Reads the hook input as JSON on stdin and prints the hook's JSON output.
// Any internal error fails open (prints nothing, exits 0).
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../lib/core');
const L = require('../lib/linear');

function rules(cfg) {
  return `outerpale-devops: each session works on one Linear issue, project or initiative, or on none. ` +
    `One PR per issue, with the issue ID in the PR title (for example "${cfg.team}-123: …") and "Fixes ${cfg.team}-123" in its body; ` +
    'Linear links the PR and moves the issue when it merges. Design work has its own issue ("Design: …") in its project. ' +
    'Work runs through GSD: one Linear issue is one GSD phase. The issue holds the goal and acceptance criteria; the phase\'s plan is in .planning/ (committed), and scratch goes in .work/. ' +
    `Linear is the ${cfg.workspaceName} workspace (team ${cfg.team}).`;
}
const STAND_ASIDE = 'outerpale-devops: this session has no Linear scope, so the plugin stands aside: no title and no PR rule.';
function out(obj) { if (obj) process.stdout.write(JSON.stringify(obj)); }
function pointer(sid) {
  try { fs.mkdirSync(path.dirname(C.pointerFile()), { recursive: true }); fs.writeFileSync(C.pointerFile(), String(sid || '')); } catch {}
}
function scopeLine(st) {
  if (st.scope === 'issue') return `This session is on issue ${st.ref}.`;
  if (st.scope === 'project' || st.scope === 'initiative') return `This session is on the ${st.scope} ${st.ref}.`;
  return null;
}

// What to do once a session is on an issue. Said once per issue.
function startedOn(st) {
  return `outerpale-devops: this session is on ${st.ref}. Run the build-issue skill: it moves ${st.ref} to In Progress, posts this session's link on it, ` +
    `and finds its GSD phase (linked from the issue; its plan is the phase's PLAN.md in .planning/). Before opening its one PR (titled "${st.ref}: …"), run the outerpale-startup:intent-reviewer agent on the diff.`;
}
function scoped(st) {
  if (st.scope === 'issue') return startedOn(st);
  if (st.scope === 'none') return STAND_ASIDE;
  return `outerpale-devops: this session is on the ${st.scope} ${st.ref}. Design, roadmap and breakdown happen here (GSD's discuss and plan steps, then the break-down skill); ` +
    'any PR it opens belongs to an issue in it, such as its "Design: …" issue.';
}
function setScope(st, s) {
  st.scope = s.scope; st.ref = s.ref;
  const said = scoped(st);
  if (st.scope === 'issue') { if (st.touched.includes(st.ref)) return null; st.touched.push(st.ref); }
  return said;
}

async function sessionStart(input, cfg) {
  const st = C.loadState(input.session_id);
  pointer(input.session_id);
  if (!st.scope || st.scope === 'none') return null;          // unscoped: the build-issue skill sets the scope
  const res = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [rules(cfg), scopeLine(st)].filter(Boolean).join(' ') } };
  const want = C.buildTitle(st);
  if (want && input.session_title !== want) res.hookSpecificOutput.sessionTitle = want;
  return res;
}

async function promptSubmit(input, cfg) {
  const sid = input.session_id;
  pointer(sid);
  const prompt = C.promptText(input.prompt);
  const st = C.loadState(sid);
  const ctx = [];
  if (st.scope === 'none') return null;
  if (!prompt) return null;                               // no words of the person's: nothing to act on
  const named = C.parseScope(prompt, cfg.team);
  // A launch prompt (from an orchestrator) opens with its scope: "OUT-123 …", "Project: <name>", "Initiative: <name>".
  if (named && !st.scope && (named.scope === 'project' || named.scope === 'initiative')) {
    const s = setScope(st, named);
    if (s) ctx.push(s);
  }
  if (named && named.scope === 'issue' && named.ref !== st.ref) {
    const li = await L.issueTitle(cfg.linearKey, named.ref, cfg.workspaceId);
    st.desc = (li && li.title) || C.describe(prompt);
    const s = setScope(st, named);
    if (s) ctx.push(s);
  }
  if (!st.desc) st.desc = C.describe(prompt);
  C.saveState(sid, st);
  const res = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } };
  const want = C.buildTitle(st);
  if (want && input.session_title !== want) res.hookSpecificOutput.sessionTitle = want;
  if (ctx.length) res.hookSpecificOutput.additionalContext = ctx.join(' ');
  return res;
}

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `outerpale-devops: ${reason}` } };
}
// The title of a PR being opened, or null if this tool call doesn't open one.
function prTitle(name, ti) {
  if (/^mcp__.+__create_pull_request$/.test(name)) return String(ti.title || '');
  if (name === 'Bash' && /\bgh\s+pr\s+create\b/.test(ti.command || '')) {
    const m = String(ti.command).match(/(?:--title|-t)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|(\S+))/);
    return m ? (m[1] ?? m[2] ?? m[3]) : '';
  }
  return null;
}

async function preTool(input, cfg) {
  const name = input.tool_name;
  const st = C.loadState(input.session_id);

  // One PR per issue, with the issue ID in its title. An unscoped session has no PR rule.
  const title = prTitle(name, input.tool_input || {});
  if (title === null || !st.scope || st.scope === 'none') return null;
  const ids = title.match(new RegExp(`\\b${cfg.team}-\\d+\\b`, 'g')) || [];
  if (st.scope === 'issue' && !ids.includes(st.ref)) {
    return deny(`this session is on ${st.ref}: one PR per issue, so title it "${st.ref}: …" and put "Fixes ${st.ref}" in the body.${ids.length ? ` ${ids.join(', ')} is another issue: work it in its own session.` : ''}`);
  }
  if ((st.scope === 'project' || st.scope === 'initiative') && !ids.length) {
    return deny(`every PR belongs to an issue. Use this ${st.scope}'s issue for the work, such as "Design: …" for a design doc (create it in Linear if it doesn't exist), and title the PR "${cfg.team}-123: …".`);
  }
  return null;
}

async function postTool(input, cfg) {
  const st = C.loadState(input.session_id);
  // An artifact published while on an issue is linked from that issue.
  if (input.tool_name !== 'Artifact' || st.scope !== 'issue') return null;
  const ti = input.tool_input || {};
  if ((ti.action || 'publish') !== 'publish' || ti.asset) return null;
  const resp = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response || '');
  const url = (resp.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/) || [])[0];
  if (!url) return null;
  const title = ti.title || path.basename(ti.file_path || url);
  const ok = await L.attach(cfg.linearKey, st.ref, url, title, cfg.workspaceId);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ok
    ? `outerpale-devops: attached ${url} to ${st.ref} in Linear.`
    : `outerpale-devops: now attach ${url} to ${st.ref} in Linear (create_attachment, title "${title}").` } };
}

async function main() {
  const event = process.argv[2];
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = raw ? JSON.parse(raw) : {};
  if (!input) return;
  const fn = { 'session-start': sessionStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool, 'post-tool': postTool }[event];
  if (fn) out(await fn(input, C.config()));
}

// On an error the hook fails open.
if (require.main === module) {
  main().catch(err => { process.stderr.write(`outerpale-devops: ${(err && err.message) || String(err)}\n`); process.exit(0); });
}
module.exports = { sessionStart, promptSubmit, preTool, postTool };
