'use strict';
// 0.4.0: fixes from the usage review of 22 real sessions, and from running 0.3.0.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../lib/core');

const RUN = path.join(__dirname, '..', 'hooks', 'run.js');
const LL = path.join(__dirname, '..', 'scripts', 'll.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opd-im-'));
const hso = r => (r && r.hookSpecificOutput) || {};
const HOME = tmp();
function env(extra = {}) {
  const e = { ...process.env, HOME, USERPROFILE: HOME, LINEAR_API_KEY: '', LANGFUSE_HOST: '' };
  delete e.CLAUDE_PLUGIN_OPTION_ROOT; delete e.LINEAR_LINK_ROOT; delete e.CLAUDE_CODE_SESSION_ID;
  return { ...e, ...extra };
}
const ll = (root, args, extra) => execFileSync('node', [LL, ...args, '--root', root], { env: env(extra) }).toString();
function project() {
  const root = tmp();
  ll(root, ['open-epic', 'FE', 'Frontend redesign', 'https://linear.app/outer-pale/project/fe', '--session', 'setup']);
  ll(root, ['start-issue', 'OUT-401', 'Nav rail rebuild', '--session', 'setup']);
  return root;
}
function hook(event, input) {
  const out = execFileSync('node', [RUN, event], { input: JSON.stringify(input), env: env({ CLAUDE_PROJECT_DIR: input.cwd }) }).toString();
  return out ? JSON.parse(out) : null;
}
const epicDir = 'epics/FE-frontend-redesign';
const idx = root => path.join(root, epicDir, 'index.md');

// #1 the CLI acts on the session that runs it, not the last one any hook saw
test('ll uses CLAUDE_CODE_SESSION_ID before the shared pointer file', () => {
  const root = project();
  fs.mkdirSync(path.join(HOME, '.linear-link'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.linear-link', 'last-session'), 'someone-else');
  ll(root, ['use', 'FE', 'OUT-401'], { CLAUDE_CODE_SESSION_ID: 'mine' });
  assert.strictEqual(C.loadState(root, 'mine').issue, 'OUT-401');
  assert.strictEqual(C.loadState(root, 'someone-else').issue, null);
});

// #3 a thread's epic must exist in the tree it is writing to
test('an epic from another tree is dropped, so it cannot write epics/<other>-… here', () => {
  const root = project();
  C.saveState(root, 'x1', { ...C.loadState(root, 'x1'), epic: 'EA', issue: null, desc: 'EA work' });
  const w = hook('pre-tool', { session_id: 'x1', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'epics/EA-workbench/notes/a.md') } });
  assert.strictEqual(hso(w).permissionDecision, 'deny');
  C.saveState(root, 'x2', { ...C.loadState(root, 'x2'), epic: 'EA', issue: null, desc: 'EA work' });
  const r = hook('prompt-submit', { session_id: 'x2', cwd: root, prompt: 'carry on with the plan' });
  assert.match(hso(r).additionalContext, /EA is not an epic in this project/);
  assert.strictEqual(C.loadState(root, 'x2').epic, null);
});

// #4 issues listed in index.md count, even with no folder
test('issues are read from index.md as well as issue folders', () => {
  const root = project();
  fs.writeFileSync(idx(root), fs.readFileSync(idx(root), 'utf8').replace('## Issues\n', '## Issues\n- OUT-82: Sync engine\n'));
  const reg = C.epics(root);
  assert.ok('OUT-82' in reg.FE.issues);
  assert.strictEqual(C.epicOfIssue(reg, 'OUT-82'), 'FE');
  const r = hook('prompt-submit', { session_id: 'i1', cwd: root, prompt: 'OUT-82 build the sync queue' });
  assert.strictEqual(C.loadState(root, 'i1').epic, 'FE');
  assert.doesNotMatch(hso(r).additionalContext || '', /has no folder yet/);
});

// #5 passing mentions don't switch the issue; naming an epic keeps the issue
test('a passing issue mention does not switch the current issue', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'm1', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  hook('prompt-submit', { session_id: 'm1', cwd: root, prompt: 'this is blocked by OUT-82, keep going on the rail' });
  assert.strictEqual(C.loadState(root, 'm1').issue, 'OUT-401');
  hook('prompt-submit', { session_id: 'm1', cwd: root, prompt: 'now switch to OUT-402 please' });
  assert.strictEqual(C.loadState(root, 'm1').issue, 'OUT-402');
});
test('naming the epic after the issue keeps the issue', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'm2', cwd: root, prompt: 'OUT-90 fix the broken footer' });
  hook('prompt-submit', { session_id: 'm2', cwd: root, prompt: 'file it under FE' });
  const st = C.loadState(root, 'm2');
  assert.strictEqual(st.epic, 'FE'); assert.strictEqual(st.issue, 'OUT-90');
});

// #6 the permission template names the Linear connector actually in use
test('settings template allows the real Linear connector, not mcp__Linear__', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'templates', 'settings.json'), 'utf8');
  assert.doesNotMatch(t, /mcp__Linear__/);
  assert.match(t, /mcp__0d1dd885-10c9-4b72-b788-6d4ee138b01a__save_issue/);
});

// #7 notes are listed in index.md when written; sweep finds what's missing or foreign
test('writing a note adds it to the epic index once', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'n1', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  const f = path.join(root, epicDir, 'notes', 'plan.md');
  fs.writeFileSync(f, '# Plan');
  const input = { session_id: 'n1', cwd: root, tool_name: 'Write', tool_input: { file_path: f } };
  hook('post-tool', input); hook('post-tool', input);
  const t = fs.readFileSync(idx(root), 'utf8');
  assert.match(t, /## Notes\n- \[plan\.md\]\(notes\/plan\.md\)/);
  assert.strictEqual(t.split('notes/plan.md').length - 1, 1);
});
test('sweep flags artifact sources missing from the index, foreign Linear links and wrong-team issue folders', () => {
  const root = project();
  fs.writeFileSync(path.join(root, epicDir, 'artifacts', 'wireframes.html'), '<title>FE · Wireframes</title>');
  ll(root, ['open-epic', 'FP', 'Floor picker', 'https://linear.app/some-other-workspace/project/fp', '--session', 'setup']);
  fs.mkdirSync(path.join(root, 'epics/FP-floor-picker/issues/PER-396-floor'), { recursive: true });
  const out = JSON.parse(ll(root, ['sweep', '--json']));
  const kinds = out.map(f => f.kind);
  assert.ok(kinds.includes('artifact-not-indexed'), kinds.join());
  assert.ok(kinds.includes('linear-project-other-workspace'), kinds.join());
  assert.ok(kinds.includes('issue-other-team'), kinds.join());
  assert.ok(!out.some(f => f.kind === 'linear-project-other-workspace' && /FE-/.test(f.path)));
});

// #8 ADRs have a home in the schema
test('ADRs may be written in masters/decisions/ and an epic\'s decisions/', () => {
  const st = { epic: 'FE', issue: null, noEpic: false };
  const cfg = { ...C.config(), allowDocs: [] };
  assert.strictEqual(C.checkWrite('masters/decisions/0001-use-sqlite.md', st, cfg), null);
  assert.strictEqual(C.checkWrite(`${epicDir}/decisions/0002-nav-rail-state.md`, st, cfg), null);
});

// ---------- found running 0.3.0 ----------
// The desktop app doesn't run PostToolUse for AskUserQuestion, so the answer is read from the transcript.
function transcript(answer) {
  const f = path.join(tmp(), 't.jsonl');
  const q = 'This looks like Outer-Pale engineering. Which epic?';
  fs.writeFileSync(f, [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'AskUserQuestion', input: { questions: [{ question: q }] } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: `Your questions have been answered: "${q}"="${answer}".` }] }, toolUseResult: { questions: [{ question: q }], answers: { [q]: answer } } }),
  ].join('\n') + '\n');
  return f;
}
test('an answer only in the transcript still lifts the wait', () => {
  const root = project();
  hook('prompt-submit', { session_id: 't1', cwd: root, prompt: 'tidy the header spacing' });
  const w = hook('pre-tool', { session_id: 't1', cwd: root, transcript_path: transcript('No epic'), tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'a.js') } });
  assert.strictEqual(w, null);
  assert.strictEqual(C.loadState(root, 't1').noEpic, true);
});
test('a transcript with no answer keeps the wait', () => {
  const root = project();
  hook('prompt-submit', { session_id: 't2', cwd: root, prompt: 'tidy the header spacing' });
  const f = path.join(tmp(), 'empty.jsonl'); fs.writeFileSync(f, '');
  const w = hook('pre-tool', { session_id: 't2', cwd: root, transcript_path: f, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'a.js') } });
  assert.strictEqual(hso(w).permissionDecision, 'deny');
});
test('a description saved by an older version with markup is rebuilt from the person\'s words', () => {
  const root = project();
  C.saveState(root, 'd1', { ...C.loadState(root, 'd1'), noEpic: true, desc: '<agent-message from="aa3b"> [Subagent…' });
  const r = hook('prompt-submit', { session_id: 'd1', cwd: root, prompt: 'clean up the release notes' });
  assert.strictEqual(hso(r).sessionTitle, 'UNFILED · clean up the release notes');
});

// ---------- review of 0.4.0 ----------
test('only switching phrases, a leading ID or a known epic code switch the issue', () => {
  const reg = { FE: { code: 'FE', issues: {} } };
  const issue = p => C.parsePrompt(p, reg, 'OUT').issue;
  for (const p of ['this depends on OUT-82', 'related to OUT-82, keep going', 'similar to OUT-82', 'PR OUT-82 broke CI',
    'OK OUT-82 is blocked too', 'see the issue OUT-82 for context', 'work on out-82']) assert.strictEqual(issue(p), null, p);
  for (const p of ['OUT-82 build it', 'FE OUT-82 build it', 'ok this is FE OUT-82', 'now OUT-82 please', 'switch to OUT-82', 'work on OUT-82', 'pick up OUT-82']) assert.strictEqual(issue(p), 'OUT-82', p);
});
test('an epic answer written before the question was asked is ignored', () => {
  const root = project();
  const f = transcript('No epic');                         // an old answer already in the file
  hook('prompt-submit', { session_id: 't3', cwd: root, transcript_path: f, prompt: 'tidy the header spacing' });
  const w = hook('pre-tool', { session_id: 't3', cwd: root, transcript_path: f, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'a.js') } });
  assert.strictEqual(hso(w).permissionDecision, 'deny');
  fs.appendFileSync(f, fs.readFileSync(transcript('No epic'), 'utf8'));   // the new answer
  assert.strictEqual(hook('pre-tool', { session_id: 't3', cwd: root, transcript_path: f, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'a.js') } }), null);
});
test('a transcript answer with no questions attached is ignored', () => {
  const root = project();
  hook('prompt-submit', { session_id: 't4', cwd: root, prompt: 'tidy the header spacing' });
  const f = path.join(tmp(), 'q.jsonl');
  fs.writeFileSync(f, JSON.stringify({ toolUseResult: { answers: { 'Which colour?': 'No epic' } } }) + '\n');
  hook('pre-tool', { session_id: 't4', cwd: root, transcript_path: f, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'a.js') } });
  assert.strictEqual(C.loadState(root, 't4').noEpic, false);
});
test('index.md with Windows line endings: issues are read, notes are added in the same style', () => {
  const root = project();
  const crlf = fs.readFileSync(idx(root), 'utf8').replace('## Issues\n', '## Issues\n- OUT-82: Sync\n').replace(/## Artifacts\n?$/, '## Notes').replace(/\r?\n/g, '\r\n');
  fs.writeFileSync(idx(root), crlf);
  assert.ok('OUT-82' in C.epics(root).FE.issues);
  hook('prompt-submit', { session_id: 'c1', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  const f = path.join(root, epicDir, 'notes', 'x.md'); fs.writeFileSync(f, '# x');
  hook('post-tool', { session_id: 'c1', cwd: root, tool_name: 'Write', tool_input: { file_path: f } });
  const t = fs.readFileSync(idx(root), 'utf8');
  assert.match(t, /## Notes\r\n- \[x\.md\]\(notes\/x\.md\)/);
  assert.doesNotMatch(t.replace(/\r\n/g, ''), /\n/, 'no bare LF mixed in');
});

// ---------- vault removed, history moved ----------
test('the vault is gone: no module, no option', () => {
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'lib', 'vault.js')));
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(!('vault' in m.userConfig));
  assert.ok(!('vault' in C.config()));
});
test('version is 0.4.2 and history lives in CHANGELOG.md', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.strictEqual(m.version, '0.4.2');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /What changed from/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8'), /0\.4\.0/);
});
