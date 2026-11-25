#!/usr/bin/env node
// outerpale-devops hook dispatcher: node run.js <session-start|prompt-submit|pre-tool|post-tool|stop>
// Reads the hook input as JSON on stdin and prints the hook's JSON output.
// Any internal error fails open: the hook prints nothing and exits 0.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../lib/core');
const L = require('../lib/linear');
const W = require('../lib/workspace');
const T = require('../lib/telemetry');

function rules(cfg) {
  return `outerpale-devops: name the epic and issue you are working on (e.g. "FE ${cfg.team}-401"), say "no epic" to work unfiled, or "not Outer-Pale" if this isn't Outer-Pale work. ` +
    'Temporary outputs (plans, reviews, notes) are .md files in epics/<EPIC>-…/notes/ or the issue folder, never artifacts. ' +
    'Artifacts proper are published from epics/<EPIC>-…/artifacts/*.html or masters/; an unfiled thread uses unfiled/. ' +
    'Titles follow "EPIC · ISSUE · description". ' +
    `Linear is the ${cfg.workspaceName} workspace (team ${cfg.team}) only; writes to any other workspace are refused.`;
}
const STAND_ASIDE = 'outerpale-devops: not Outer-Pale work, so the plugin stands aside for this thread: no epic, and no title or folder rules. Linear writes still go to Outer-Pale only. Naming an epic or issue later files the thread.';
const MAX_EVENTS = 50; // kept until the next Langfuse send; oldest dropped if Langfuse is off
function note(st, name, extra) {
  st.events = [...(st.events || []), { name, at: new Date().toISOString(), ...extra }].slice(-MAX_EVENTS);
}

function out(obj) { if (obj) process.stdout.write(JSON.stringify(obj)); }

function pointer(root, sid) {
  try {
    const f = C.pointerFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, String(sid || ''));
  } catch {}
}

function registryLine(reg) {
  const codes = Object.values(reg).filter(e => e.status !== 'closed').map(e => `${e.code} (${e.name}${e.linear ? ', ' + e.linear : ''})`);
  return codes.length ? `Open epics: ${codes.join('; ')}.` : 'No epics exist yet: use the open-epic skill.';
}

// Put once, on the first prompt with the person's own words in an unfiled thread.
function askEpic(cfg, root, reg) {
  const open = Object.values(reg).filter(e => e.status !== 'closed').map(e => e.code);
  return 'outerpale-devops: before doing any work, judge whether this is Outer-Pale engineering ' +
    '(building, designing, specifying or running Outer-Pale products, code or infrastructure) or general use of Claude ' +
    '(a question, a personal task, setting up tools, writing unrelated to Outer-Pale). ' +
    (C.hasTree(root) ? 'This folder is an Outer-Pale project. ' : 'This folder is not an Outer-Pale project (no epics/ or masters/). ') +
    'Then make your first tool call one AskUserQuestion: state your judgement in the question, put your recommendation first, and offer ' +
    (open.length ? `"Use epic <CODE>" for the best-fitting open epic (${open.join(', ')}), ` : '') +
    '"Open a new epic", "No epic" and "Not Outer-Pale work". Do no other work until they answer. On "Open a new epic", run the open-epic skill.';
}

async function sessionStart(input, cfg, root) {
  const st = C.loadState(root, input.session_id);
  pointer(root, input.session_id);
  const reg = C.epics(root);
  const ctx = st.outOfScope ? [] : [rules(cfg), registryLine(reg)];
  const res = { hookSpecificOutput: { hookEventName: 'SessionStart' } };
  const t0 = !st.epic && input.session_title && input.session_title.match(C.schema(cfg.team).thread);
  if (t0 && t0.groups.epic) {
    st.epic = t0.groups.epic; st.issue = t0.groups.issue || null; st.desc = t0.groups.desc;
    C.saveState(root, input.session_id, st);
  }
  if (st.epic) {
    ctx.push(`This thread is on epic ${st.epic}${st.issue ? ', issue ' + st.issue : ''}.`);
    const want = C.buildTitle(st);
    if (input.session_title !== want) res.hookSpecificOutput.sessionTitle = want;
  }
  if (ctx.length) res.hookSpecificOutput.additionalContext = ctx.join(' ');
  return res;
}

async function promptSubmit(input, cfg, root) {
  const sid = input.session_id;
  pointer(root, sid);
  const prompt = C.promptText(input.prompt);
  const reg = C.epics(root);
  const st = C.loadState(root, sid);
  // A forked or renamed thread with no saved state adopts the IDs in its title.
  const sc0 = C.schema(cfg.team);
  const t0 = !st.epic && input.session_title && input.session_title.match(sc0.thread);
  const ctx = [];
  if (st.desc && /[<>]/.test(st.desc)) st.desc = null;  // saved by a version that kept markup
  if (t0 && t0.groups.epic) {
    st.epic = t0.groups.epic; st.issue = t0.groups.issue || null; st.desc = t0.groups.desc;
    if (st.issue && !st.touched.includes(st.issue)) {
      st.touched.push(st.issue);
      ctx.push(`outerpale-devops: this thread (a fork or resumed copy) is on ${st.issue}. Post this thread's link as a comment on ${st.issue} in Linear unless it is already there.`);
    }
  }
  const gone = C.reconcile(st, reg);
  if (gone) ctx.push(`outerpale-devops: ${gone} is not an epic in this project (${Object.keys(reg).join(', ') || 'none open'}), so this thread is no longer on it. Name the epic to use here.`);
  if (C.awaitingScope(st)) { const said = applyAnswer(st, C.answerFromTranscript(input.transcript_path, st.askedAt || 0), reg, cfg); if (said) ctx.push(said); }
  const human = prompt !== '';
  const p = C.parsePrompt(prompt, reg, cfg.team);
  const prevIssue = st.issue;
  if (p.outOfScope && !st.outOfScope && !st.epic) {
    st.outOfScope = true; st.noEpic = false; st.epic = null; st.issue = null;
    note(st, 'not-outer-pale');
    C.saveState(root, sid, st);
    return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: STAND_ASIDE } };
  }
  // A stood-aside thread is filed again only by an issue ID or "epic <CODE>", not a stray two-letter word.
  if (st.outOfScope && (p.issue || (p.epic && new RegExp(`\\bepic\\s+${p.epic}\\b`, 'i').test(prompt)))) st.outOfScope = false;
  if (st.outOfScope) { C.saveState(root, sid, st); return null; }
  if (p.noEpic && !st.noEpic) {
    st.noEpic = true; st.epic = null; st.issue = null;
    note(st, 'no-epic-chosen');
    ctx.push('outerpale-devops: working without an epic, as asked. Write documents in unfiled/ and title artifacts "UNFILED · …". Name an epic at any time to file the thread.');
  }
  if ((p.epic || p.issue) && st.noEpic) st.noEpic = false;
  if (p.epic && p.epic !== st.epic) { if (!p.issue && st.epic) st.issue = null; st.epic = p.epic; note(st, 'epic-chosen', { epic: p.epic }); }
  if (p.issue && p.issue !== st.issue) {
    const owner = C.epicOfIssue(reg, p.issue);
    if (!st.epic && owner) st.epic = owner;
    if (owner && st.epic && owner !== st.epic) ctx.push(`${p.issue} is filed under epic ${owner}, not ${st.epic}. Confirm which epic before writing.`);
    st.issue = p.issue;
  }
  if (st.issue && st.issue !== prevIssue) {
    const li = await L.issueTitle(cfg.linearKey, st.issue, cfg.workspaceId);
    st.desc = (li && li.title) || C.describe(prompt, reg) || st.desc;
    if (!st.touched.includes(st.issue)) {
      st.touched.push(st.issue);
      ctx.push(`outerpale-devops: this thread has started on ${st.issue}. Post this thread's link as a comment on ${st.issue} in Linear (one line: "Thread started: <title> <link>") unless it is already there.`);
    }
    if (!reg[st.epic] || !(st.issue in reg[st.epic].issues)) ctx.push(`${st.issue} isn't listed in ${st.epic ? 'epic ' + st.epic : 'any epic'} yet: run the start-issue skill to add it.`);
  }
  if (st.issue && !st.touched.includes(st.issue)) {
    st.touched.push(st.issue);
    ctx.push(`outerpale-devops: this thread (a fork or resumed copy) is on ${st.issue}. Post this thread's link as a comment on ${st.issue} in Linear unless it is already there.`);
  }
  // The description comes only from the person's words; a placeholder is never saved.
  if (!st.desc && human) st.desc = C.describe(prompt, reg);

  // Respect a manual title that already fits the schema and the same IDs.
  const sc = C.schema(cfg.team);
  const cur = input.session_title;
  const m = cur && cur.match(sc.thread);
  if (m && (m.groups.epic || null) === st.epic && (m.groups.issue || null) === (st.issue || null)) st.desc = m.groups.desc;
  const want = C.buildTitle({ ...st, desc: st.desc || 'New thread' });
  const filed = !!(st.epic || st.noEpic);
  if (!filed && human && !st.asked && cfg.policy !== 'block') {
    st.asked = true; st.askedAt = C.transcriptSize(input.transcript_path);  // answers before this are old
    ctx.push(askEpic(cfg, root, reg));
  }
  C.saveState(root, sid, st);

  if (!filed && cfg.policy === 'block') {
    return { decision: 'block', reason: `outerpale-devops: name the epic first (${Object.keys(reg).join(', ') || 'none open: ask Claude to open one'}), for example "FE ${cfg.team}-401 …", say "no epic", or say "not Outer-Pale".` };
  }
  const res = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } };
  // An unfiled thread keeps the app's own title until the person decides.
  if (filed && cur !== want) res.hookSpecificOutput.sessionTitle = want;
  if (ctx.length) res.hookSpecificOutput.additionalContext = ctx.join(' ');
  return res;
}

function deny(reason) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `outerpale-devops: ${reason}` } };
}
function warn(text) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: `outerpale-devops: ${text}` } };
}
function htmlTitle(file) {
  try { const m = fs.readFileSync(file, 'utf8').match(/<title>([\s\S]*?)<\/title>/i); return m ? m[1].trim() : null; } catch { return null; }
}

async function preTool(input, cfg, root) {
  const st = C.loadState(root, input.session_id);
  const ti = input.tool_input || {};
  const soft = cfg.policy === 'unfiled';
  const refuse = r => (soft ? warn(r) : deny(r));
  const name = input.tool_name;
  const reg0 = C.epics(root);
  if (C.reconcile(st, reg0)) C.saveState(root, input.session_id, st);
  if (C.awaitingScope(st) && applyAnswer(st, C.answerFromTranscript(input.transcript_path, st.askedAt || 0), reg0, cfg)) C.saveState(root, input.session_id, st);

  // Linear writes go to the configured workspace only. Never softened by the unfiled policy.
  const guard = W.check(name, cfg);
  if (guard) {
    note(st, guard.event.name, guard.event);
    C.saveState(root, input.session_id, st);
    return deny(guard.reason);
  }
  if (st.outOfScope) return null;
  const publishing = name !== 'Artifact' || ((ti.action || 'publish') === 'publish' && !ti.asset);
  if (C.awaitingScope(st) && publishing && /^(Write|Edit|MultiEdit|NotebookEdit|Artifact)$|^mcp__.+__batch$/.test(name)) {
    return refuse('answer the epic question first. Ask the person with AskUserQuestion: use an epic, open a new epic, "No epic", or "Not Outer-Pale work".');
  }

  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(name)) {
    const p = ti.file_path || ti.notebook_path;
    if (!p || !C.hasTree(root)) return null;              // a folder with no Outer-Pale tree isn't policed
    const why = C.checkWrite(C.rel(root, p), st, cfg);
    return why ? refuse(why) : null;
  }

  const sc = C.schema(cfg.team);
  if (name === 'Artifact') {
    const action = ti.action || 'publish';
    if (action !== 'publish' || ti.asset) return null;
    if (!st.epic && !st.noEpic) return refuse('this thread has no epic, so it can\'t publish an artifact. Name the epic and issue first, or say "no epic" to publish from unfiled/.');
    if (ti.file_path) {
      const r = C.rel(root, ti.file_path);
      const home = st.epic ? `epics/${st.epic}-…/artifacts/*.html` : 'unfiled/*.html';
      if (r === null || !sc.artifactFile.test(r) || (!st.epic && r.startsWith('epics/')) || (st.epic && r.startsWith('unfiled/'))) {
        return refuse(`artifacts are published only from masters/*.html or ${home}. A plan, review or note is a temporary output: write it as .md in ${st.epic ? `epics/${st.epic}-…/notes/` : 'unfiled/'} instead.`);
      }
      const am = r.match(sc.artifactFile);
      if (am.groups && am.groups.epic && am.groups.epic !== st.epic) return refuse(`${r} belongs to epic ${am.groups.epic}; this thread is on ${st.epic}.`);
      const isMaster = r.startsWith('masters/');
      const cur = htmlTitle(path.resolve(root, ti.file_path)) || ti.title || '';
      const want = C.artifactTitle(cur, st, isMaster);
      if (cur !== want) return refuse(`set the page's <title> to "${want}" and publish again.`);
      return null;
    }
    if (ti.type_url) {
      const want = C.artifactTitle(ti.title || '', st, false);
      if (ti.title !== want && !sc.artifact.test(ti.title || '')) return refuse(`use title "${want}" (or "MASTER · …" for a live master) and create again.`);
    }
    return null;
  }

  if (/^mcp__.+__batch$/.test(name)) {
    const create = ti.container && ti.container.create;
    if (!create || !create.name) return null;
    if (!st.epic && !st.noEpic && !/^MASTER · /.test(create.name)) return refuse('this thread has no epic, so it can\'t create a doc. Name the epic and issue first, or say "no epic".');
    if (!sc.artifact.test(create.name)) {
      return refuse(`name the doc "${C.artifactTitle(create.name, st, false)}" (or "MASTER · …" for a live master). A plan, review or note should be a .md file in the epic's notes/ folder, not a doc.`);
    }
    return null;
  }
  return null;
}

function appendIndex(root, st, title, url, isMaster) {
  const reg = C.epics(root);
  const file = isMaster ? path.join(root, 'masters', 'index.md') : (reg[st.epic] ? path.join(root, reg[st.epic].dir, 'index.md') : null);
  if (!file) return null;
  let t = '';
  try { t = fs.readFileSync(file, 'utf8'); } catch {}
  if (t.includes(url)) return file;
  if (!/^## Artifacts\s*$/m.test(t)) t = t.replace(/\s*$/, '\n\n## Artifacts\n');
  const line = `- [${title}](${url})${st.issue && !isMaster ? ' · ' + st.issue : ''} · ${new Date().toISOString().slice(0, 10)}`;
  t = t.replace(/(## Artifacts\s*\n)/, `$1${line}\n`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, t);
  return file;
}

// The person's answer to the epic question.
// Changes st and returns what to tell Claude, or null when the answer isn't one.
function applyAnswer(st, input, reg, cfg) {
  if (!input || !C.awaitingScope(st)) return null;
  const qs = (input.tool_input && input.tool_input.questions) || [];
  if (!qs.some(q => /epic|outer[\s-]?pale/i.test((q && q.question) || ''))) return null; // no epic question in it
  const text = C.answersOf(input);
  const p = C.parsePrompt(text, reg, cfg.team);
  let said;
  if (p.outOfScope) { st.outOfScope = true; note(st, 'not-outer-pale'); said = STAND_ASIDE; }
  else if (p.epic) {
    st.epic = p.epic; note(st, 'epic-chosen', { epic: st.epic });
    said = `outerpale-devops: this thread is now on epic ${st.epic}. Run start-issue for the issue you work on.`;
  } else if (p.noEpic) { st.noEpic = true; note(st, 'no-epic-chosen'); said = 'outerpale-devops: working without an epic. Write documents in unfiled/ and title artifacts "UNFILED · …".'; }
  else return null;                                       // "Open a new epic" or an issue alone: the skills file the thread
  return said;
}
function scopeAnswer(input, cfg, root) {
  const st = C.loadState(root, input.session_id);
  const said = applyAnswer(st, input, C.epics(root), cfg);
  if (!said) return null;
  C.saveState(root, input.session_id, st);
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: said } };
}

// A note written in an epic is listed under "## Notes" in its index.md, once.
function indexNote(input, root) {
  const p = (input.tool_input || {}).file_path;
  const r = p && C.rel(root, p);
  const m = r && r.match(/^(epics\/[A-Z][A-Z0-9]{1,5}-[a-z0-9-]+)\/((?:notes|decisions|issues\/[^/]+)\/[^/]+\.md)$/);
  if (!m) return null;
  const file = path.join(root, m[1], 'index.md');
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  if (raw.includes(`](${m[2]})`)) return null;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';       // keep the file's own line endings
  let t = raw.replace(/\r\n/g, '\n');
  if (!/^## Notes[ \t]*$/m.test(t)) t = t.replace(/\s*$/, '\n\n## Notes\n');
  else if (!t.endsWith('\n')) t += '\n';
  t = t.replace(/(^## Notes[ \t]*\n)/m, `$1- [${path.basename(m[2])}](${m[2]})\n`);
  fs.writeFileSync(file, eol === '\n' ? t : t.replace(/\n/g, eol));
  return null;
}

async function postTool(input, cfg, root) {
  if (input.tool_name === 'AskUserQuestion') return scopeAnswer(input, cfg, root);
  if (input.tool_name === 'Write') return indexNote(input, root);
  const ws = W.record(input.tool_name, input.tool_response);
  if (ws) {
    const ok = ws.workspaceId === cfg.workspaceId;
    return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ok
      ? `outerpale-devops: this connector is on ${cfg.workspaceName}; its Linear writes are allowed.`
      : `outerpale-devops: this connector is on "${ws.name}", not ${cfg.workspaceName}. Its Linear writes will be refused.` } };
  }
  const st = C.loadState(root, input.session_id);
  const ti = input.tool_input || {};
  const resp = typeof input.tool_response === 'string' ? input.tool_response : JSON.stringify(input.tool_response || '');
  const url = (resp.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/) || [])[0];
  if (!url) return null;
  let title;
  let isMaster = false;
  if (input.tool_name === 'Artifact') {
    if ((ti.action || 'publish') !== 'publish' || ti.asset) return null;
    title = (ti.file_path && htmlTitle(path.resolve(root, ti.file_path))) || ti.title || url;
  } else {
    const create = ti.container && ti.container.create;
    if (!create) return null;
    title = create.name;
  }
  isMaster = /^MASTER · /.test(title);
  const file = appendIndex(root, st, title, url, isMaster);
  const ctx = [];
  if (file) ctx.push(`outerpale-devops: recorded "${title}" in ${C.rel(root, file)}.`);
  if (st.issue && !isMaster) {
    const ok = await L.attach(cfg.linearKey, st.issue, url, title, cfg.workspaceId);
    ctx.push(ok ? `Attached it to ${st.issue} in Linear.` : `Now attach ${url} to ${st.issue} in Linear (create_attachment, title "${title}").`);
  }
  if (!ctx.length) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: ctx.join(' ') } };
}

// Stop: send the new turns to Langfuse. Says nothing to Claude.
async function stop(input, cfg, root) {
  const st = C.loadState(root, input.session_id);
  try {
    if (await T.flush(cfg, input, st)) C.saveState(root, input.session_id, st);
  } catch (err) {
    process.stderr.write(`outerpale-devops: Langfuse send failed: ${err.message}\n`);
  }
  return null;
}

async function main() {
  const event = process.argv[2];
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const input = raw ? JSON.parse(raw) : {};
  const cfg = C.config();
  const root = C.projectDir(input);
  const fn = { 'session-start': sessionStart, 'prompt-submit': promptSubmit, 'pre-tool': preTool, 'post-tool': postTool, stop }[event];
  if (!fn) return;
  out(await fn(input, cfg, root));
}

if (require.main === module) {
  main().catch(err => { process.stderr.write(`outerpale-devops: ${err.message}\n`); process.exit(0); });
}
module.exports = { sessionStart, promptSubmit, preTool, postTool, stop };
