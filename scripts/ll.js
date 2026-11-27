#!/usr/bin/env node
// outerpale-devops CLI, run by the plugin's skills through Bash.
//   ll scope issue <OUT-123> [--title "<issue title>"]
//   ll scope project "<name>" | ll scope initiative "<name>" | ll scope none
//   ll status                          this session's scope
// Options: --session <id> (default: $CLAUDE_CODE_SESSION_ID, else the last session the hooks saw).
'use strict';
const fs = require('fs');
const C = require('../lib/core');

const args = process.argv.slice(2);
function flag(n) { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; }
// The session running this command; the shared pointer is a last resort, since parallel sessions overwrite it.
let sid = flag('--session') || process.env.CLAUDE_CODE_SESSION_ID;
if (!sid) { try { sid = fs.readFileSync(C.pointerFile(), 'utf8').trim(); } catch { sid = 'unknown'; } }
const title = flag('--title');
const cfg = C.config();
const [cmd, kind, ref] = args;
function die(msg) { process.stderr.write(msg + '\n'); process.exit(1); }

const st = C.loadState(sid);
if (cmd === 'scope') {
  if (kind === 'issue' && !new RegExp(`^${cfg.team}-\\d+$`).test(ref || '')) die(`usage: ll scope issue <${cfg.team}-123> [--title "<title>"]`);
  if ((kind === 'project' || kind === 'initiative') && !ref) die(`usage: ll scope ${kind} "<name>"`);
  if (!['issue', 'project', 'initiative', 'none'].includes(kind)) die('usage: ll scope <issue|project|initiative|none> [<id or name>]');
  st.scope = kind; st.ref = kind === 'none' ? null : ref;
  if (title) st.desc = title;
  if (kind === 'issue' && !st.touched.includes(ref)) st.touched.push(ref);
  C.saveState(sid, st);
  console.log(kind === 'none' ? 'This session has no Linear scope.' : `This session is on the ${kind} ${ref}. Title: ${C.buildTitle(st)}`);
} else if (cmd === 'status') {
  console.log(st.scope ? `${st.scope}${st.ref ? ' ' + st.ref : ''}${C.buildTitle(st) ? ' (' + C.buildTitle(st) + ')' : ''}` : 'No scope yet.');
} else {
  die('usage: ll <scope|status> …');
}
