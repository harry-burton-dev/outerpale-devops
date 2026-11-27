#!/usr/bin/env node
// outerpale-devops hook dispatcher: node run.js <session-start|prompt-submit|pre-tool|post-tool|stop>
// Reads the hook input as JSON on stdin and prints the hook's JSON output.
// Any internal error fails open (prints nothing, exits 0), except before a Linear write, which it refuses.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../lib/core');
const L = require('../lib/linear');
const W = require('../lib/workspace');
const T = require('../lib/telemetry');

function rules(cfg) {
  return `outerpale-devops: each session works on one Linear issue, project or initiative, or on none. ` +
    `One PR per issue, with the issue ID in the PR title (for example "${cfg.team}-123: …") and "Fixes ${cfg.team}-123" in its body; ` +
    'Linear links the PR and moves the issue when it merges. Design work has its own issue ("Design: …") in its project. ' +
    'An issue\'s implementation plan is in its description. Finished design docs go in docs/design/; scratch, EGM working files and reviews in .work/. ' +
    `Linear is the ${cfg.workspaceName} workspace (team ${cfg.team}) only; writes to any other workspace are refused.`;
}
const STAND_ASIDE = 'outerpale-devops: this session has no Linear scope, so the plugin stands aside: no title and no PR rule. Linear writes still go to Outer-Pale only.';
const MAX_EVENTS = 50; // kept until the next Langfuse send; oldest dropped if Langfuse is off
function note(st, name, extra) {
  st.events = [...(st.events || []), { name, at: new Date().toISOString(), ...extra }].slice(-MAX_EVENTS);
}
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
  return `outerpale-devops: this session is on ${st.ref}. Run the start-issue skill: it moves ${st.ref} to In Progress, posts this session's link on it, ` +
    `and reads its implementation plan from the description. Open one PR for ${st.ref}, titled "${st.ref}: …".`;
}
function scoped(st) {
  if (st.scope === 'issue') return startedOn(st);
  if (st.scope === 'none') return STAND_ASIDE;
  return `outerpale-devops: this session is on the ${st.scope} ${st.ref}. Design work and breakdown happen here (break-down skill); ` +
    'any PR it opens belongs to an issue in it, such as its "Design: …" issue.';
}
function setScope(st, s) {
  st.scope = s.scope; st.ref = s.ref;
  note(st, 'scope-set', { scope: s.scope, ref: s.ref });
  const said = scoped(st);
  if (st.scope === 'issue') { if (st.touched.includes(st.ref)) return null; st.touched.push(st.ref); }
  return said;
}

const QUESTION = 'outerpale-devops: before doing any work, make your first tool call one AskUserQuestion asking which Linear issue, project or initiative this session is for. ' +
  'If it is quick, look up likely open issues and projects with the Linear connector first. Put your recommendation first, and label the options exactly ' +
  '"Issue OUT-123: <title>", "Project: <name>", "Initiative: <name>" and "None" (not Outer-Pale work, or no Linear scope). Do no other work until they answer.';

// The person's answer to the scope question; changes st and returns what to tell Claude.
function applyAnswer(st, input, cfg) {
  if (!input || !C.awaitingScope(st)) return null;
  const qs = (input.tool_input && input.tool_input.questions) || [];
  if (!qs.some(q => /\b(issue|project|initiative|scope)\b/i.test((q && q.question) || ''))) return null;
  const s = C.parseScope(C.answersOf(input), cfg.team);
  return s ? setScope(st, s) || scopeLine(st) : null;
}
function fromTranscript(st, input, cfg) {
  return C.awaitingScope(st) ? applyAnswer(st, C.answerFromTranscript(input.transcript_path, st.askedAt || 0), cfg) : null;
}

async function sessionStart(input, cfg) {
  const st = C.loadState(input.session_id);
  pointer(input.session_id);
  if (st.scope === 'none') return null;
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
  const said = fromTranscript(st, input, cfg);
  if (said) ctx.push(said);
  if (st.scope === 'none') { C.saveState(sid, st); return ctx.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx.join(' ') } } : null; }
  if (!prompt) return null;                               // no words of the person's: nothing to act on
  const named = C.parseScope(prompt, cfg.team);
  if (named && named.scope === 'issue' && named.ref !== st.ref) {
    const li = await L.issueTitle(cfg.linearKey, named.ref, cfg.workspaceId);
    st.desc = (li && li.title) || C.describe(prompt);
    const s = setScope(st, named);
    if (s) ctx.push(s);
  }
  if (!st.desc) st.desc = C.describe(prompt);
  if (!st.scope && !st.asked) {
    st.asked = true; st.askedAt = C.transcriptSize(input.transcript_path);  // answers before this are old
    ctx.push(QUESTION);
  }
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
  // Linear writes go to the configured workspace only. Checked before any state work, so a failure there can't skip it.
  const guard = W.check(name, cfg);
  if (guard) {
    try {
      const gst = C.loadState(input.session_id);
      note(gst, guard.event.name, guard.event);
      C.saveState(input.session_id, gst);
    } catch (err) {
      process.stderr.write(`outerpale-devops: couldn't record the Linear refusal: ${err.message}\n`);
    }
    return deny(guard.reason);
  }
  const st = C.loadState(input.session_id);
  if (fromTranscript(st, input, cfg)) C.saveState(input.session_id, st);

  // One PR per issue, with the issue ID in its title.
  const title = prTitle(name, input.tool_input || {});
  if (title === null || st.scope === 'none') return null;
  if (C.awaitingScope(st)) return deny('answer the scope question first: which Linear issue, project or initiative is this session for?');
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
  if (input.tool_name === 'AskUserQuestion') {
    const said = applyAnswer(st, input, cfg);
    if (!said) return null;
    C.saveState(input.session_id, st);
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: said } };
  }
  const ws = W.record(input.tool_name, input.tool_response);
  if (ws) {
    const ok = ws.workspaceId === cfg.workspaceId;
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ok
      ? `outerpale-devops: this connector is on ${cfg.workspaceName}; its Linear writes are allowed.`
      : `outerpale-devops: this connector is on "${ws.name}", not ${cfg.workspaceName}. Its Linear writes will be refused.` } };
  }
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

// Stop: send the new turns to Langfuse. Says nothing to Claude.
async function stop(input, cfg) {
  const st = C.loadState(input.session_id);
  try {
    if (await T.flush(cfg, input, st)) C.saveState(input.session_id, st);
  } catch (err) {
    process.stderr.write(`outerpale-devops: Langfuse send failed: ${err.message}\n`);
  }
  return null;
}

async function main(state) {
  const event = process.argv[2];
  state.event = event;
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  state.raw = raw;
  const input = raw ? JSON.parse(raw) : {};
  if (!input) return;
  const fn = { 'session-start': sessionStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool, 'post-tool': postTool, stop }[event];
  if (fn) out(await fn(input, C.config()));
}

// On an error the hook fails open, except that a Linear write is refused (fails closed).
// The tool name is read from the raw input, so input that won't parse is still judged.
function onError(state, err, done) {
  const msg = (err && err.message) || String(err);
  process.stderr.write(`outerpale-devops: ${msg}\n`);
  const tool = (String(state.raw || '').match(/"tool_name"\s*:\s*"([^"]+)"/) || [])[1];
  if (state.event !== 'pre-tool' || !W.isLinearWrite(tool)) return done();
  process.stdout.write(JSON.stringify(deny(`the hook failed (${msg}), so this Linear write is refused: the workspace guard couldn't be trusted to run. Fix the error and try again.`)), done);
}

if (require.main === module) {
  const state = {};
  main(state).catch(err => onError(state, err, () => process.exit(0)));  // exit once the refusal is written
}
module.exports = { sessionStart, promptSubmit, preTool, postTool, stop };
