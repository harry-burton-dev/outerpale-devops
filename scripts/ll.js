#!/usr/bin/env node
// outerpale-devops CLI, run by the plugin's skills through Bash.
//   ll open-epic <CODE> "<Name>" [<Linear project id or URL>]
//   ll start-issue <ISSUE> "<Issue title>" [--epic CODE]
//   ll use [<EPIC>] [<ISSUE>]          set this thread's current epic/issue
//   ll status                          this thread's state and the open epics
//   ll close-issue <ISSUE>             print the close-out summary material
//   ll close-epic <CODE> --confirm     archive the epic folder
//   ll sweep [--json]                  local checks (Linear checks are done by the sweep skill)
// Options: --session <id> (default: $CLAUDE_CODE_SESSION_ID, else the last session the hooks saw), --root <dir>.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../lib/core');

const args = process.argv.slice(2);
function flag(n) { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; }
function bool(n) { const i = args.indexOf(n); if (i < 0) return false; args.splice(i, 1); return true; }
const root = path.resolve(flag('--root') || C.projectDir());
// The session running this command; the shared pointer is a last resort, since parallel threads overwrite it.
let sid = flag('--session') || process.env.CLAUDE_CODE_SESSION_ID;
if (!sid) { try { sid = fs.readFileSync(C.pointerFile(), 'utf8').trim(); } catch { sid = 'unknown'; } }
const epicArg = flag('--epic');
const json = bool('--json');
const confirm = bool('--confirm');
const cfg = C.config();
const sc = C.schema(cfg.team);
const [cmd, ...rest] = args;

function die(msg) { process.stderr.write(msg + '\n'); process.exit(1); }
function write(rel, text) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, text);
}
const today = new Date().toISOString().slice(0, 10);

function openEpic([code, name, linear]) {
  if (!code || !name) die('usage: ll open-epic <CODE> "<Name>" [<Linear project>]');
  code = code.toUpperCase();
  if (!new RegExp(`^${C.EPIC}$`).test(code)) die(`Epic code must be 2-6 capitals or digits, starting with a letter: ${code}`);
  const reg = C.epics(root);
  if (reg[code]) die(`Epic ${code} already exists at ${reg[code].dir}`);
  const dir = `epics/${code}-${C.slugify(name)}`;
  write(`${dir}/index.md`, `---\ncode: ${code}\nname: ${name}\nlinear_project: ${linear || ''}\nstatus: open\nopened: ${today}\n---\n\n# ${code} · ${name}\n\nLinear: ${linear || '(add the Linear project link)'}\n\n## Issues\n\n## Artifacts\n`);
  for (const sub of ['notes', 'issues', 'artifacts']) write(`${dir}/${sub}/.keep`, '');
  const st = C.loadState(root, sid); st.epic = code; st.issue = null; st.desc = name; C.saveState(root, sid, st);
  console.log(`Opened ${dir}. This thread is now on ${code}.`);
}

function startIssue([issue, title]) {
  if (!issue || !new RegExp(`^${cfg.team}-\\d+$`).test(issue)) die(`usage: ll start-issue <${cfg.team}-123> "<title>" [--epic CODE]`);
  const reg = C.epics(root);
  const st = C.loadState(root, sid);
  const epic = (epicArg || st.epic || C.epicOfIssue(reg, issue) || '').toUpperCase();
  if (!reg[epic]) die(`No open epic ${epic || '(none set)'}. Open one first or pass --epic.`);
  let dir = reg[epic].issues[issue] ? `${reg[epic].dir}/issues/${reg[epic].issues[issue]}` : `${reg[epic].dir}/issues/${issue}-${C.slugify(title || 'issue')}`;
  write(`${dir}/.keep`, '');
  const idx = path.join(root, reg[epic].dir, 'index.md');
  let t = fs.readFileSync(idx, 'utf8');
  if (!t.includes(`${issue} `) && !t.includes(`${issue}:`)) {
    t = t.replace(/(## Issues\s*\n)/, `$1- ${issue}: ${title || ''}\n`);
    fs.writeFileSync(idx, t);
  }
  st.epic = epic; st.issue = issue; st.desc = title || st.desc;
  if (!st.touched.includes(issue)) st.touched.push(issue);
  C.saveState(root, sid, st);
  console.log(`Thread is on ${epic} · ${issue}. Folder: ${dir}. Title will read "${C.buildTitle(st)}" from the next message.`);
}

function use([a, b]) {
  const st = C.loadState(root, sid);
  for (const v of [a, b].filter(Boolean)) {
    if (new RegExp(`^${cfg.team}-\\d+$`).test(v)) { if (st.issue !== v) { st.issue = v; if (!st.touched.includes(v)) st.touched.push(v); } }
    else st.epic = v.toUpperCase();
  }
  C.saveState(root, sid, st);
  console.log(`Thread is on ${C.buildTitle(st)}`);
}

function status() {
  const st = C.loadState(root, sid);
  const reg = C.epics(root);
  const o = { session: sid, title: C.buildTitle(st), state: st, epics: reg };
  console.log(json ? JSON.stringify(o, null, 2) : `Thread: ${o.title}\nIssues touched: ${st.touched.join(', ') || 'none'}\nEpics: ${Object.values(reg).map(e => `${e.code} ${e.status} (${Object.keys(e.issues).length} issues)`).join('; ') || 'none'}`);
}

function walk(dir, acc = []) {
  let ents = [];
  try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const r = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!['node_modules', '.git', 'archive'].includes(e.name) && !fs.existsSync(path.join(root, r, '.git'))) walk(r, acc); }
    else acc.push(r);
  }
  return acc;
}

function closeIssue([issue]) {
  if (!issue) die('usage: ll close-issue <ISSUE>');
  const reg = C.epics(root);
  const epic = C.epicOfIssue(reg, issue);
  const folder = epic && reg[epic].issues[issue];         // null: listed in index.md, no folder yet
  const files = folder ? walk(`${reg[epic].dir}/issues/${folder}`).filter(f => !f.endsWith('.keep')) : [];
  const idx = epic ? fs.readFileSync(path.join(root, reg[epic].dir, 'index.md'), 'utf8') : '';
  const arts = idx.split('\n').filter(l => l.startsWith('- [') && l.includes(issue));
  const threads = fs.readdirSync(path.join(root, '.linear-link', 'sessions')).filter(f => {
    try { return JSON.parse(fs.readFileSync(path.join(root, '.linear-link', 'sessions', f), 'utf8')).touched.includes(issue); } catch { return false; }
  }).map(f => f.replace(/\.json$/, ''));
  const o = { issue, epic, files, artifacts: arts, threads };
  console.log(json ? JSON.stringify(o, null, 2) : `Close-out for ${issue} (${epic || 'no epic'})\nThreads: ${threads.join(', ') || 'none recorded'}\nArtifacts:\n${arts.join('\n') || '  none'}\nFiles:\n${files.map(f => '  ' + f).join('\n') || '  none'}`);
}

function closeEpic([code]) {
  const reg = C.epics(root);
  code = (code || '').toUpperCase();
  if (!reg[code]) die(`No epic ${code}`);
  if (!confirm) die(`Check in Linear that every issue in ${code} is Done or Canceled, then run again with --confirm.`);
  const from = path.join(root, reg[code].dir);
  const idx = path.join(from, 'index.md');
  fs.writeFileSync(idx, fs.readFileSync(idx, 'utf8').replace(/^status: .*$/m, `status: closed\nclosed: ${today}`));
  const to = path.join(root, 'archive', reg[code].dir);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  console.log(`Archived ${reg[code].dir} to archive/${reg[code].dir}. Move its artifacts in the Claude project's folders by hand if they are filed there.`);
}

function sweep() {
  const reg = C.epics(root);
  const findings = [];
  const any = { epic: 'X', issue: null };
  for (const f of walk('')) {
    if (/\.(md|html?)$/i.test(f)) {
      const m = f.match(new RegExp(`^epics/(${C.EPIC})-`));
      const why = C.checkWrite(f, m ? { epic: m[1] } : any, cfg);
      if (why && !(f.startsWith('epics/') && f.endsWith('/index.md'))) findings.push({ kind: 'stray-file', path: f, why });
    }
  }
  const wsSlug = C.slugify(cfg.workspaceName);
  const byLinear = {};
  for (const e of Object.values(reg)) {
    if (e.status === 'closed') findings.push({ kind: 'closed-not-archived', path: e.dir });
    if (!e.linear) findings.push({ kind: 'epic-without-linear-project', path: `${e.dir}/index.md` });
    else {
      if (/linear\.app\//.test(e.linear) && !e.linear.includes(`linear.app/${wsSlug}/`)) findings.push({ kind: 'linear-project-other-workspace', path: `${e.dir}/index.md`, why: e.linear });
      (byLinear[e.linear] = byLinear[e.linear] || []).push(e.code);
    }
    for (const [id, folder] of Object.entries(e.issues)) {
      if (!id.startsWith(`${cfg.team}-`)) findings.push({ kind: 'issue-other-team', path: folder ? `${e.dir}/issues/${folder}` : `${e.dir}/index.md`, why: `${id} is not a ${cfg.team} issue` });
    }
    const idx = fs.readFileSync(path.join(root, e.dir, 'index.md'), 'utf8');
    let arts = [];
    try { arts = fs.readdirSync(path.join(root, e.dir, 'artifacts')).filter(f => /\.html?$/.test(f)); } catch {}
    for (const a of arts) {
      const title = ((fs.readFileSync(path.join(root, e.dir, 'artifacts', a), 'utf8').match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
      if (!title || !idx.includes(`[${title}]`)) findings.push({ kind: 'artifact-not-indexed', path: `${e.dir}/artifacts/${a}`, why: 'published? it has no line under ## Artifacts' });
    }
    for (const l of idx.split('\n').filter(x => x.startsWith('- ['))) {
      const t = (l.match(/^- \[(.*?)\]/) || [])[1];
      if (t && !sc.artifact.test(t)) findings.push({ kind: 'artifact-title', path: e.dir, title: t });
    }
  }
  for (const [link, codes] of Object.entries(byLinear)) if (codes.length > 1) findings.push({ kind: 'linear-project-shared', path: codes.join(', '), why: link });
  let sessions = [];
  try { sessions = fs.readdirSync(path.join(root, '.linear-link', 'sessions')); } catch {}
  for (const f of sessions) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(root, '.linear-link', 'sessions', f), 'utf8'));
      if (!s.epic) findings.push({ kind: 'unfiled-thread', session: f.replace(/\.json$/, ''), title: C.buildTitle(s) });
    } catch {}
  }
  console.log(json ? JSON.stringify(findings, null, 2) : (findings.length ? findings.map(x => `- ${x.kind}: ${x.path || x.session} ${x.why || x.title || ''}`).join('\n') : 'Sweep: nothing found.'));
}

const cmds = { 'open-epic': openEpic, 'start-issue': startIssue, use, status, 'close-issue': closeIssue, 'close-epic': closeEpic, sweep };
if (!cmds[cmd]) die('commands: ' + Object.keys(cmds).join(', '));
cmds[cmd](rest);
