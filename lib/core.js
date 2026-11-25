// outerpale-devops core: schema, config, state, epic registry, rules.
// No dependencies; Node 18+.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- config ----------
function opt(key, dflt) {
  const env = process.env;
  const v = env['CLAUDE_PLUGIN_OPTION_' + key.toUpperCase()] ?? env['CLAUDE_PLUGIN_OPTION_' + key];
  return v === undefined || v === '' ? dflt : v;
}
const OUTERPALE_WORKSPACE_ID = 'dca1918d-09ae-4f88-9f63-c6223b86893e';
function config() {
  const team = opt('team', 'OUT').toUpperCase();
  return {
    team,
    // The only Linear workspace this plugin may write to (Outer-Pale).
    workspaceId: opt('linear_workspace_id', OUTERPALE_WORKSPACE_ID),
    workspaceName: opt('linear_workspace', 'Outer-Pale'),
    langfuse: {
      host: String(opt('langfuse_host', process.env.LANGFUSE_HOST || '')).replace(/\/+$/, ''),
      publicKey: opt('langfuse_public_key', process.env.LANGFUSE_PUBLIC_KEY || ''),
      secretKey: opt('langfuse_secret_key', process.env.LANGFUSE_SECRET_KEY || ''),
      content: opt('telemetry_content', 'full'),
    },
    policy: opt('policy', 'block-outputs'),
    allowDocs: opt('allow_docs', '**/README.md,**/CLAUDE.md,**/AGENTS.md,**/CHANGELOG.md,docs/**,.claude/**,.linear-link/**')
      .split(',').map(s => s.trim()).filter(Boolean),
    linearKey: opt('linear_api_key', process.env.LINEAR_API_KEY || ''),
  };
}

// ---------- schema ----------
const SEP = ' · ';
const EPIC = '[A-Z][A-Z0-9]{1,5}';
function issueRe(team) { return `${team}-\\d+`; }
function schema(team) {
  const I = issueRe(team);
  return {
    // FE · OUT-401 · Nav rail rebuild   |   FE · Epic planning   |   UNFILED · Quick question
    thread: new RegExp(`^(?:(?<epic>${EPIC})${SEP}(?:(?<issue>${I})${SEP})?|UNFILED${SEP})(?![A-Z]{2,5}-\\d+${SEP})(?<desc>\\S.{1,58}\\S)$`, 'u'),
    // MASTER · Architecture   |   FE · OUT-401 · Nav rail options   |   UNFILED · Spike notes
    artifact: new RegExp(`^(?:MASTER${SEP}(?<master>\\S.{1,58}\\S)|UNFILED${SEP}(?<unfiled>\\S.{1,70}\\S)|(?<epic>${EPIC})${SEP}(?:(?<issue>${I})${SEP})?(?![A-Z]{2,5}-\\d+${SEP})(?<name>\\S.{1,70}\\S))$`, 'u'),
    // epics/FE-frontend-redesign
    epicDir: new RegExp(`^epics/(?<epic>${EPIC})-(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$`),
    // epics/FE-frontend-redesign/issues/OUT-401-nav-rail
    issueDir: new RegExp(`^epics/(?<epic>${EPIC})-[a-z0-9-]+/issues/(?<issue>${I})-(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)$`),
    // temporary outputs: markdown in the epic's notes/ or an issue folder
    noteFile: new RegExp(`^epics/(?<epic>${EPIC})-[a-z0-9-]+/(?:notes|decisions|issues/${I}-[a-z0-9-]+)/[a-z0-9][a-z0-9._-]*\\.md$`),
    // artifact sources
    artifactFile: new RegExp(`^(?:masters/[a-z0-9][a-z0-9._-]*\\.html|unfiled/[a-z0-9][a-z0-9._-]*\\.html|epics/(?<epic>${EPIC})-[a-z0-9-]+/artifacts/[a-z0-9][a-z0-9._-]*\\.html)$`),
    issueId: new RegExp(`\\b${I}\\b`, 'g'),
    // work done with no epic: unfiled/<file>.md or .html at the tree root
    unfiledFile: /^unfiled\/[a-z0-9][a-z0-9._-]*\.(?:md|html?)$/,
  };
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled';
}
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

// ---------- project + epic registry ----------
// Where masters/, epics/ and .linear-link/ live: in the project's own git repo
// (ADR 0002). That is the nearest folder at or above the session's folder
// that holds epics/ or masters/. A project not yet moved into a repo still
// falls back to the Claude project's shared folder, then the session's folder.
const SHARED_DIRS = ['/mnt/project-files'];
function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function treeAbove(start) {
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (isDir(path.join(d, 'epics')) || isDir(path.join(d, 'masters'))) return d;
    if (d === path.dirname(d)) return null;
  }
}
function treesBelow(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => path.join(dir, e.name))
      .filter(d => isDir(path.join(d, 'epics')) || isDir(path.join(d, 'masters')));
  } catch { return []; }
}
function projectDir(input) {
  const explicit = opt('root', '') || process.env.LINEAR_LINK_ROOT;
  if (explicit) return path.resolve(explicit);
  for (const start of [input && input.cwd, process.env.CLAUDE_PROJECT_DIR, !input && process.cwd()]) {
    const tree = start && treeAbove(start);
    if (tree) return tree;
  }
  // A cloud session's folder often sits above its repos (/home/user/<repo>):
  // use the one folder directly below it that holds a tree, if there is exactly one.
  for (const start of [input && input.cwd, process.env.CLAUDE_PROJECT_DIR]) {
    const below = start ? treesBelow(start) : [];
    if (below.length === 1) return below[0];
  }
  const shared = SHARED_DIRS.find(isDir);
  if (shared) return shared;
  return process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
}
// The last session the hooks saw, for the CLI. Kept per machine, not in the
// shared root, so threads running at once don't overwrite each other's.
function pointerFile() { return path.join(os.homedir(), '.linear-link', 'last-session'); }

// Thread wakes and relays wrap the person's words in XML. Keep only what a
// person wrote: <message from="human"> bodies, else <cited> and <note> text.
// A plain prompt comes back unchanged; a wake with no human words comes back empty.
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
// Harness wrappers that carry no words of the person's: subagent reports,
// task and session events, reminders, command output. Dropped with their content.
const MACHINE = /<(agent-message|task-notification|system-reminder|side-sessions-event|ci-monitor-event|local-command-stdout|local-command-stderr|tools-used-before-summary)\b[^>]*>[\s\S]*?<\/\1>/g;
function promptText(raw) {
  let t = String(raw || '');
  const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/);
  if (args) t = args[1];                                  // a slash command: keep what was typed after it
  else if (/<command-name>/.test(t)) return '';           // a slash command with nothing typed after it
  t = t.replace(MACHINE, ' ').replace(/\[SYSTEM NOTIFICATION[^\]]*\]/g, ' ')
    .replace(/^\s*\[[^\]\n]*\]/, ' ')                     // [Local: …] harness prefix
    .replace(/^\s*\/[\w.-]+(?::[\w.-]+)?\s*$/, '');       // a bare /plugin:skill
  if (!/<(wake|relay|coordinator-relay|message|system-note)\b/.test(t)) return t.trim();
  const pick = re => [...t.matchAll(re)].map(m => m[1]);
  let parts = pick(/<message\b[^>]*\bfrom="human"[^>]*>([\s\S]*?)<\/message>/g);
  if (!parts.length) parts = pick(/<cited\b[^>]*>([\s\S]*?)<\/cited>/g).concat(pick(/<note\b[^>]*>([\s\S]*?)<\/note>/g));
  return decode(parts.join('\n').replace(/<[^>]+>/g, ' ')).trim();
}
// The epic a Claude project is named for: a thread wake carries
// <project … name="E03">, and the name may lead with the code ("E03 · Prove the host").
// Only an epic in this tree counts.
function projectEpic(raw, reg) {
  const m = String(raw || '').match(/<project\b[^>]*\bname="([^"]*)"/);
  if (!m) return null;
  const name = decode(m[1]).trim();
  return Object.keys(reg).find(c => new RegExp(`^${c}(?=$|[\\s·:,.-])`).test(name)) || null;
}
function readFrontmatter(file) {
  try {
    const t = fs.readFileSync(file, 'utf8');
    const m = t.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}
function epics(root) {
  const dir = path.join(root, 'epics');
  const out = {};
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return out; }
  const re = new RegExp(`^(${EPIC})-([a-z0-9-]+)$`);
  for (const n of names) {
    const m = n.match(re);
    if (!m) continue;
    const fm = readFrontmatter(path.join(dir, n, 'index.md'));
    // Issues listed under "## Issues" in index.md (value null: no folder yet), then issue folders.
    const issues = {};
    try {
      const sec = (fs.readFileSync(path.join(dir, n, 'index.md'), 'utf8').replace(/\r\n/g, '\n').match(/^## Issues[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1] || '';
      for (const im of sec.matchAll(/^\s*[-*]\s*\[?([A-Z]{2,5}-\d+)\b/gm)) issues[im[1]] = null;
    } catch {}
    try {
      for (const i of fs.readdirSync(path.join(dir, n, 'issues'))) {
        const im = i.match(/^([A-Z]{2,5}-\d+)-/);
        if (im) issues[im[1]] = i;
      }
    } catch {}
    out[m[1]] = { code: m[1], dir: `epics/${n}`, name: fm.name || m[2], linear: fm.linear_project || '', status: fm.status || 'open', issues };
  }
  return out;
}
function epicOfIssue(reg, issue) {
  for (const e of Object.values(reg)) if (issue in e.issues) return e.code;
  return null;
}

// ---------- session state ----------
function stateFile(root, sid) { return path.join(root, '.linear-link', 'sessions', `${sid || 'unknown'}.json`); }
function loadState(root, sid) {
  const blank = { epic: null, issue: null, desc: null, touched: [], noEpic: false, outOfScope: false, asked: false, events: [] };
  try { return { ...blank, ...JSON.parse(fs.readFileSync(stateFile(root, sid), 'utf8')) }; } catch { return blank; }
}
function saveState(root, sid, st) {
  const f = stateFile(root, sid);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(st, null, 2));
}

// Work out epic and issue named in a prompt. Issue IDs are detected by team
// prefix. Epic codes are only recognised when they exist in the registry and
// appear as a standalone token (e.g. "FE" or "epic FE"), never inside words.
// The person declines an epic: "no epic", "not in an epic", "skip the epic", "work unfiled".
const NO_EPIC = /\b(?:no epic|not (?:in |under )?an epic|without an? epic|skip (?:the )?epic|(?:work |keep (?:it )?|stay )unfiled)\b/i;
// The person says this isn't Outer-Pale engineering at all: the plugin stands aside.
// Only when the prompt or answer opens with it, so a passing mention doesn't count.
const OUT_OF_SCOPE = /^\W*(?:(?:this|it)(?:\s+is|'s)\s+)?not\s+(?:an?\s+)?outer[\s-]?pale\b/i;
function parsePrompt(text, reg, team) {
  const sc = schema(team);
  const issues = [...new Set(String(text).match(sc.issueId) || [])];
  let epic = null;
  for (const code of Object.keys(reg)) {
    if (new RegExp(`(^|[\\s(\\[])${code}(?=$|[\\s·:,.)\\]])`).test(text)) { epic = code; break; }
  }
  // The issue the thread is on: an ID that opens the prompt (after an epic code),
  // or follows "on", "switch to", "start", "work on", "pick up"... A passing mention
  // ("blocked by OUT-82") is in `issues` but doesn't switch the thread.
  const codes = Object.keys(reg).join('|');
  const lead = new RegExp(`^\\W*(?:(?:[Ee]pic\\s+)?(?:${codes || '(?!)'})\\W+)?(${issueRe(team)})\\b`);
  const verb = new RegExp(`\\b(?:[Ss]witch(?:ing)?\\s+to|[Mm]ov(?:e|ing)\\s+to|[Nn]ow(?:\\s+on)?|[Ss]tart(?:ing)?(?:\\s+on)?|[Ww]ork(?:ing)?\\s+on|[Pp]ick(?:ing)?\\s+up)\\s+(${issueRe(team)})\\b`);
  const coded = codes && new RegExp(`\\b(?:${codes})\\s+(${issueRe(team)})\\b`);   // "this is FE OUT-401"
  const s = String(text);
  const named = (s.match(lead) || s.match(verb) || (coded && s.match(coded)) || [])[1] || null;
  if (!epic && named) epic = epicOfIssue(reg, named);
  const unnamed = !epic && !issues.length;
  const outOfScope = unnamed && OUT_OF_SCOPE.test(text);
  return { epic, issue: named, issues, outOfScope, noEpic: unnamed && !outOfScope && NO_EPIC.test(text) };
}
// A thread's epic must be one of this tree's epics: state can come from a
// title or a run in another tree. Returns the dropped code, or null.
function reconcile(st, reg) {
  if (!st.epic || reg[st.epic]) return null;
  const gone = st.epic;
  st.epic = null; st.issue = null;
  return gone;
}
// The latest AskUserQuestion answer in the session transcript, shaped like a
// PostToolUse input; the desktop app doesn't run PostToolUse for that tool.
// Only the part written since byte `from` (when the question was asked) is read.
function transcriptSize(file) { try { return fs.statSync(file).size; } catch { return 0; } }
function answerFromTranscript(file, from = 0) {
  let lines = [];
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const len = Math.max(0, fs.fstatSync(fd).size - from);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, from);
      lines = buf.toString('utf8').split('\n');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"toolUseResult"') || !lines[i].includes('"answers"')) continue;
    try {
      const r = JSON.parse(lines[i]).toolUseResult;
      if (r && r.answers && typeof r.answers === 'object' && Array.isArray(r.questions)) return { tool_input: { questions: r.questions, answers: r.answers } };
    } catch {}
  }
  return null;
}
// The epic question was put to the person and they haven't answered it yet.
function awaitingScope(st) { return !!(st.asked && !st.epic && !st.noEpic && !st.outOfScope); }
// The answers from an AskUserQuestion result, as plain text.
function answersOf(input) {
  const pick = o => (o && typeof o === 'object' && o.answers && typeof o.answers === 'object' ? Object.values(o.answers).join('\n') : '');
  const direct = pick(input.tool_input) || pick(input.tool_response);
  if (direct) return direct;
  const r = input.tool_response;
  const s = typeof r === 'string' ? r : Array.isArray(r) ? r.map(b => (b && b.text) || '').join('\n') : (r && r.text) || '';
  return [...s.matchAll(/"[^"]*"\s*=\s*"([^"]*)"/g)].map(m => m[1]).join('\n');
}
function hasTree(root) { return isDir(path.join(root, 'epics')) || isDir(path.join(root, 'masters')); }

// A short thread description from the person's words: no slash command,
// bracketed prefix, markup, URL or full path; at most 8 words, not ending on a filler word.
const TAIL = /^(?:a|an|the|and|or|but|so|that|it|is|for|to|of|in|on|at|by|with|from|as|this)$/i;
function describe(text, reg) {
  let t = String(text || '')
    .replace(/^\s*\/[\w.-]+(?::[\w.-]+)?(?=\s|$)/, ' ')        // /plugin:skill
    .replace(/^\s*\[[^\]\n]*\]/, ' ')                          // [Local: …]
    .replace(/<[^>\n]*>/g, ' ')
    .replace(/\bhttps?:\/\/([^\s/]+)\S*/g, '$1')               // URL → host
    .replace(/\S*[\\/]\S*[\\/]\S*/g, m => m.split(/[\\/]/).filter(Boolean).pop() || ' '); // path → last part
  t = t.split(/[.!?\n](?:\s|$)/)[0].replace(/[A-Z]{2,5}-\d+/g, '');
  for (const code of Object.keys(reg || {})) t = t.replace(new RegExp(`(^|\\s)(epic\\s+)?${code}(?=\\s|$|[:,.])`, 'g'), ' ');
  const words = t.replace(/^[\s:,.·-]+/, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 8);
  while (words.length > 3 && TAIL.test(words[words.length - 1])) words.pop();
  return words.length >= 3 ? clip(words.join(' '), 60) : null;
}

function buildTitle(st) {
  const desc = clip(st.desc || 'Working', 60);
  if (!st.epic) return `UNFILED${SEP}${desc}`;
  return st.issue ? `${st.epic}${SEP}${st.issue}${SEP}${desc}` : `${st.epic}${SEP}${desc}`;
}

// ---------- path rules ----------
function globToRe(g) {
  let r = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { r += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') r += '[^/]*';
    else if (c === '?') r += '[^/]';
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${r}$`);
}
function rel(root, p) {
  const abs = path.resolve(root, p);
  const r = path.relative(root, abs).split(path.sep).join('/');
  if (r.startsWith('..')) return null;
  // A git repo cloned inside the tree (code/<repo>) keeps its own documents.
  for (let d = path.dirname(abs); d.length > path.resolve(root).length; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return null;
  }
  return r;
}
// Returns null when allowed, or a reason string when refused.
function checkWrite(relPath, st, cfg) {
  if (relPath === null) return null;                     // outside the project: not ours to police
  const ext = path.extname(relPath).toLowerCase();
  if (!['.md', '.html', '.htm'].includes(ext)) return null; // code and data are never blocked
  if (cfg.allowDocs.some(g => globToRe(g).test(relPath))) return null;
  const sc = schema(cfg.team);
  if (relPath.startsWith('masters/')) return null;
  if (relPath.startsWith('unfiled/')) {
    if (!st.noEpic) return 'unfiled/ is for work done with no epic. Name the epic, or say "no epic" to work unfiled.';
    return sc.unfiledFile.test(relPath) ? null : 'Unfiled outputs go directly in unfiled/, as .md or .html with a lowercase file name.';
  }
  if (relPath.startsWith('epics/')) {
    if (!st.epic) return `This thread has no epic yet, so it can't write ${relPath}. Name the epic (and issue) first, for example "FE ${cfg.team}-401", or say "no epic" and write in unfiled/.`;
    const m = relPath.match(new RegExp(`^epics/(${EPIC})-`));
    if (m && m[1] !== st.epic) return `${relPath} belongs to epic ${m[1]}, but this thread is on ${st.epic}. Switch epic first, or write inside epics/${st.epic}-…/.`;
    if (relPath.endsWith('/index.md')) return null;
    if (ext === '.md' && !sc.noteFile.test(relPath)) return `Temporary outputs go in epics/${st.epic}-…/notes/ or an issue folder epics/${st.epic}-…/issues/${cfg.team}-123-slug/, with a lowercase file name.`;
    if (ext !== '.md' && !sc.artifactFile.test(relPath)) return `Artifact sources (.html) go in epics/${st.epic}-…/artifacts/.`;
    return null;
  }
  return `Documents live in masters/ or the epic's folder, not ${relPath}. ${st.epic ? `Use epics/${st.epic}-…/notes/ for a temporary output.` : st.noEpic ? 'This thread has no epic: write it in unfiled/.' : 'Name the epic first, or say "no epic" to work in unfiled/.'}`;
}

function artifactTitle(want, st, isMaster) {
  const name = String(want || '').replace(/^(MASTER|UNFILED|[A-Z][A-Z0-9]{1,5})\s*·\s*([A-Z]{2,5}-\d+\s*·\s*)?/u, '').trim() || 'Untitled';
  if (isMaster) return `MASTER${SEP}${clip(name, 60)}`;
  if (!st.epic) return `UNFILED${SEP}${clip(name, 72)}`;
  return st.issue ? `${st.epic}${SEP}${st.issue}${SEP}${clip(name, 72)}` : `${st.epic}${SEP}${clip(name, 72)}`;
}

module.exports = { SEP, EPIC, OUTERPALE_WORKSPACE_ID, config, schema, slugify, clip, projectDir, pointerFile, promptText, projectEpic, epics, epicOfIssue, loadState, saveState, parsePrompt, awaitingScope, answersOf, answerFromTranscript, transcriptSize, reconcile, hasTree, describe, buildTitle, checkWrite, rel, artifactTitle, readFrontmatter, globToRe };
