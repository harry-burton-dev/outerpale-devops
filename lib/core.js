// outerpale-devops core: config, session scope, state, and reading the person's words.
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
  return {
    team: opt('team', 'OUT').toUpperCase(),
    // The only Linear workspace this plugin may write to (Outer-Pale).
    workspaceId: opt('linear_workspace_id', OUTERPALE_WORKSPACE_ID),
    workspaceName: opt('linear_workspace', 'Outer-Pale'),
    linearKey: opt('linear_api_key', process.env.LINEAR_API_KEY || ''),
  };
}

// ---------- session state, kept per machine, never in a repository ----------
const SEP = ' · ';
function home() { return path.join(os.homedir(), '.linear-link'); }
function stateFile(sid) { return path.join(home(), 'sessions', `${sid || 'unknown'}.json`); }
// The last session the hooks saw, for the CLI when it isn't told which.
function pointerFile() { return path.join(home(), 'last-session'); }
// scope: 'issue' | 'project' | 'initiative' | 'none' | null (not decided yet); ref: OUT-123 or a name.
function loadState(sid) {
  const blank = { scope: null, ref: null, desc: null, touched: [], asked: false, askedAt: 0 };
  let raw;
  try { raw = fs.readFileSync(stateFile(sid), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return blank; throw e; }
  return { ...blank, ...JSON.parse(raw) };
}
function saveState(sid, st) {
  const f = stateFile(sid);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(st, null, 2));
}

// ---------- scope from words ----------
function issueRe(team) { return `${team}-\\d+`; }
// The scope a prompt or an answer names, or null. An issue counts only when it opens
// the text or follows "switch to", "work on", "pick up"...; a passing mention doesn't.
function parseScope(text, team) {
  const s = String(text || '').trim();
  const I = issueRe(team);
  const lead = s.match(new RegExp(`^\\W*(?:[Ii]ssue\\s+)?(${I})\\b`));
  const verb = s.match(new RegExp(`\\b(?:[Ss]witch(?:ing)?\\s+to|[Mm]ov(?:e|ing)\\s+to|[Ss]tart(?:ing)?(?:\\s+on)?|[Ww]ork(?:ing)?\\s+on|[Pp]ick(?:ing)?\\s+up)\\s+(${I})\\b`));
  if (lead || verb) return { scope: 'issue', ref: (lead || verb)[1] };
  const named = s.split('\n')[0].match(/^\W*(project|initiative)\s*[:·-]\s*(.+?)\s*$/i);   // the first line only
  if (named) return { scope: named[1].toLowerCase(), ref: named[2].trim() };
  if (/^\W*(?:none|no (?:linear|scope|issue|project)|not (?:an? )?outer[\s-]?pale)\b/i.test(s)) return { scope: 'none', ref: null };
  return null;
}

// ---------- the person's words ----------
function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
// Harness wrappers that carry no words of the person's: dropped with their content.
const MACHINE = /<(agent-message|task-notification|system-reminder|side-sessions-event|ci-monitor-event|local-command-stdout|local-command-stderr|tools-used-before-summary)\b[^>]*>[\s\S]*?<\/\1>/g;
// Wakes and relays wrap the person's words in XML: keep <message from="human"> bodies,
// else <cited> and <note> text. A plain prompt comes back unchanged; one with no human words, empty.
function promptText(raw) {
  let t = String(raw || '');
  const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/);
  if (args) t = args[1];
  else if (/<command-name>/.test(t)) return '';
  t = t.replace(MACHINE, ' ').replace(/\[SYSTEM NOTIFICATION[^\]]*\]/g, ' ')
    .replace(/^\s*\[[^\]\n]*\]/, ' ')
    .replace(/^\s*\/[\w.-]+(?::[\w.-]+)?\s*$/, '');
  if (!/<(wake|relay|coordinator-relay|message|system-note)\b/.test(t)) return t.trim();
  const pick = re => [...t.matchAll(re)].map(m => m[1]);
  let parts = pick(/<message\b[^>]*\bfrom="human"[^>]*>([\s\S]*?)<\/message>/g);
  if (!parts.length) parts = pick(/<cited\b[^>]*>([\s\S]*?)<\/cited>/g).concat(pick(/<note\b[^>]*>([\s\S]*?)<\/note>/g));
  return decode(parts.join('\n').replace(/<[^>]+>/g, ' ')).trim();
}
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}
// A short description from the person's words: no slash command, markup, URL, path or issue ID.
const TAIL = /^(?:a|an|the|and|or|but|so|that|it|is|for|to|of|in|on|at|by|with|from|as|this)$/i;
function describe(text) {
  let t = String(text || '')
    .replace(/^\s*\/[\w.-]+(?::[\w.-]+)?(?=\s|$)/, ' ')
    .replace(/^\s*\[[^\]\n]*\]/, ' ')
    .replace(/<[^>\n]*>/g, ' ')
    .replace(/\bhttps?:\/\/([^\s/]+)\S*/g, '$1')
    .replace(/\S*[\\/]\S*[\\/]\S*/g, m => m.split(/[\\/]/).filter(Boolean).pop() || ' ');
  t = t.split(/[.!?\n](?:\s|$)/)[0].replace(/\b(?:[Ii]ssue\s+)?[A-Z]{2,5}-\d+\b:?/g, '');
  const words = t.replace(/^[\s:,.·-]+/, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 8);
  while (words.length > 3 && TAIL.test(words[words.length - 1])) words.pop();
  return words.length >= 3 ? clip(words.join(' '), 60) : null;
}
// "OUT-123 · description" or "<project or initiative> · description"; null when unscoped or none.
function buildTitle(st) {
  if (!st.ref || st.scope === 'none') return null;
  return `${clip(st.ref, 40)}${SEP}${clip(st.desc || 'Working', 60)}`;
}

// ---------- the scope answer (AskUserQuestion) ----------
// The latest answer in the session transcript, shaped like a PostToolUse input: the desktop
// app doesn't run PostToolUse for AskUserQuestion. Only what was written since byte `from` is read.
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
function answersOf(input) {
  const pick = o => (o && typeof o === 'object' && o.answers && typeof o.answers === 'object' ? Object.values(o.answers).join('\n') : '');
  const direct = pick(input.tool_input) || pick(input.tool_response);
  if (direct) return direct;
  const r = input.tool_response;
  const s = typeof r === 'string' ? r : Array.isArray(r) ? r.map(b => (b && b.text) || '').join('\n') : (r && r.text) || '';
  return [...s.matchAll(/"[^"]*"\s*=\s*"([^"]*)"/g)].map(m => m[1]).join('\n');
}
function awaitingScope(st) { return !!(st.asked && !st.scope); }

module.exports = { SEP, OUTERPALE_WORKSPACE_ID, config, stateFile, pointerFile, loadState, saveState, parseScope, promptText, clip, describe, buildTitle, transcriptSize, answerFromTranscript, answersOf, awaitingScope };
