#!/usr/bin/env node
// Where did the week go? Reads Claude Code transcripts (~/.claude/projects/**/*.jsonl)
// changed in the last N days and counts the friction worth fixing.
//   node scripts/week-audit.js [--days 7] [--json] [--exclude <path substring>]...
// Reads only; streams each file, so a few hundred MB is fine.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1]) || 7;
const AS_JSON = args.includes('--json');
const EXCLUDE = args.filter((a, i) => args[i - 1] === '--exclude'); // path substrings to skip, e.g. this session's id
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const SINCE = Date.now() - DAYS * 86400e3;

const CORRECTION = /^(no\b|nope|don'?t\b|stop\b|wrong|that'?s (not|wrong)|actually\b|undo\b|revert\b|why did you|you (didn'?t|forgot|missed)|i said\b|not what i)/i;
const PATTERNS = {
  pluginRefusal: /PreToolUse:\w+ hook error: (?:endstate-ops|outerpale-devops): [^"]{0,120}/, // a tool call the plugin blocked
  unfiledNag: /this thread is UNFILED/,
  interrupted: /\[Request interrupted by user/,
  permissionRejected: /The user doesn't want to (proceed|take this action)|user rejected|Permission to use .* (was|has been) denied/i,
  otherHookError: /PreToolUse:\w+ hook error: (?!endstate-ops|outerpale-devops)[^"]{0,80}/,
  authExpired: /OAuth access token has expired|Failed to authenticate/,
};

function walk(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.name.endsWith('.jsonl') && fs.statSync(p).mtimeMs >= SINCE && !EXCLUDE.some(x => p.includes(x))) out.push(p);
  }
  return out;
}
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const top = (o, n = 10) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);

async function main() {
  const files = walk(ROOT);
  const s = {
    days: DAYS, files: files.length, sessions: 0, subagentFiles: 0, remoteSessions: 0, prompts: 0, corrections: 0,
    compactions: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, subagentOutput: 0 },
    byProject: {}, byModel: {}, tools: {}, toolErrors: {}, slash: {}, counts: {}, repeatedPrompts: {}, examples: {},
  };
  const promptSeen = {};
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const dir = rel.split(path.sep)[0];
    const isSub = rel.includes(`${path.sep}subagents${path.sep}`);
    let counted = isSub;
    if (isSub) s.subagentFiles++; else { s.sessions++; if (dir.startsWith('ssh-')) s.remoteSessions++; }
    const rl = readline.createInterface({ input: fs.createReadStream(f, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
      for (const [k, re] of Object.entries(PATTERNS)) if (re.test(line)) { inc(s.counts, k); if (!s.examples[k]) s.examples[k] = (line.match(re) || [''])[0].slice(0, 160); }
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!counted && e.cwd) { counted = true; inc(s.byProject, (dir.startsWith('ssh-') ? 'ssh:' : '') + e.cwd.replace(/^.*[\/](dev|code-root)[\/]/, '').replace(/[\/].claude[\/]worktrees[\/].*/, ' (worktree)')); }
      if (e.isCompactSummary || e.type === 'summary') s.compactions++;
      const m = e.message;
      if (!m) continue;
      if (e.type === 'assistant' && m.usage) {
        const u = m.usage;
        if (isSub) s.tokens.subagentOutput += u.output_tokens || 0;
        s.tokens.input += u.input_tokens || 0; s.tokens.output += u.output_tokens || 0;
        s.tokens.cacheRead += u.cache_read_input_tokens || 0; s.tokens.cacheWrite += u.cache_creation_input_tokens || 0;
        if (m.model) inc(s.byModel, m.model, u.output_tokens || 0);
        if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use') inc(s.tools, b.name.replace(/^mcp__[0-9a-f-]{36}__/, 'mcp__<connector>__'));
      }
      if (e.type === 'user' && !e.isMeta && !isSub) {
        const c = m.content;
        if (typeof c === 'string') {
          const cmd = c.match(/<command-name>\/?([^<]+)<\/command-name>/);
          if (cmd) { inc(s.slash, cmd[1].trim()); continue; }
          if (c.startsWith('<')) continue;
          s.prompts++;
          if (CORRECTION.test(c.trim())) s.corrections++;
          const key = c.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 70);
          if (key.length > 25) { promptSeen[key] = (promptSeen[key] || new Set()).add(rel.split(path.sep)[0] + rel.split(path.sep)[1]); }
        } else if (Array.isArray(c)) {
          for (const b of c) if (b.type === 'tool_result' && b.is_error) inc(s.toolErrors, String(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).replace(/\s+/g, ' ').slice(0, 70));
        }
      }
    }
  }
  for (const [k, set] of Object.entries(promptSeen)) if (set.size >= 3) s.repeatedPrompts[k] = set.size;
  if (AS_JSON) { console.log(JSON.stringify(s, null, 2)); return; }
  const M = n => (n / 1e6).toFixed(1) + 'M';
  console.log(`# Last ${DAYS} days of Claude Code\n`);
  console.log(`${s.sessions} sessions (${s.remoteSessions} over SSH), ${s.subagentFiles} subagent transcripts, ${s.prompts} prompts, ${s.compactions} compactions.`);
  console.log(`Tokens: ${M(s.tokens.output)} output (${M(s.tokens.subagentOutput)} by subagents), ${M(s.tokens.input)} input, ${M(s.tokens.cacheRead)} cache read, ${M(s.tokens.cacheWrite)} cache write.\n`);
  console.log('## Friction'); for (const [k, v] of top(s.counts, 20)) console.log(`- ${k}: ${v}   e.g. "${s.examples[k]}"`);
  console.log(`- corrections (prompts opening "no", "don't", "actually"…): ${s.corrections} of ${s.prompts}`);
  console.log('\n## Sessions by project'); for (const [k, v] of top(s.byProject)) console.log(`- ${k}: ${v}`);
  console.log('\n## Output tokens by model'); for (const [k, v] of top(s.byModel)) console.log(`- ${k}: ${M(v)}`);
  console.log('\n## Most-used tools'); for (const [k, v] of top(s.tools, 12)) console.log(`- ${k}: ${v}`);
  console.log('\n## Commonest tool errors'); for (const [k, v] of top(s.toolErrors, 8)) console.log(`- ${v}× ${k}`);
  console.log('\n## Slash commands'); for (const [k, v] of top(s.slash, 12)) console.log(`- /${k}: ${v}`);
  console.log('\n## Prompts typed in 3+ sessions (skill candidates)'); for (const [k, v] of top(s.repeatedPrompts, 10)) console.log(`- ${v} sessions: "${k}…"`);
}
main().catch(e => { console.error(e); process.exit(1); });
