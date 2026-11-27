'use strict';
process.env.OUTERPALE_SHARED_DIRS = ''; // never fall back to a real /mnt/project-files
// 0.4.2: a thread in a project named for an epic is filed on it, and the tree is found from a folder above the repo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../lib/core');

const RUN = path.join(__dirname, '..', 'hooks', 'run.js');
const LL = path.join(__dirname, '..', 'scripts', 'll.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opd-pe-'));
const hso = r => (r && r.hookSpecificOutput) || {};
const HOME = tmp();
function env(extra = {}) {
  const e = { ...process.env, HOME, USERPROFILE: HOME, LINEAR_API_KEY: '', LANGFUSE_HOST: '' };
  delete e.CLAUDE_PLUGIN_OPTION_ROOT; delete e.LINEAR_LINK_ROOT; delete e.CLAUDE_CODE_SESSION_ID; delete e.CLAUDE_PROJECT_DIR;
  return { ...e, ...extra };
}
// A folder holding one repo with epic E03, as a cloud session sees /home/user/set-piece-project.
function workspace() {
  const top = tmp();
  const root = path.join(top, 'set-piece-project');
  fs.mkdirSync(root);
  execFileSync('node', [LL, 'open-epic', 'E03', 'Prove the host', 'https://linear.app/outer-pale/project/e03', '--session', 'setup', '--root', root], { env: env() });
  return { top, root };
}
function hook(event, input) {
  const out = execFileSync('node', [RUN, event], { input: JSON.stringify(input), env: env() }).toString();
  return out ? JSON.parse(out) : null;
}
const wake = (name, words) => `<wake reason="mention"><project id="chan_1" name="${name}" type="project"><thread ts="t1"><message trigger="true" from="human" trust="principal" author="H" id="m1">${words}</message></thread></project></wake>`;

test('the tree is found in the one repo below the session folder', () => {
  const { top, root } = workspace();
  assert.strictEqual(C.projectDir({ cwd: top }), root);
  fs.mkdirSync(path.join(top, 'other', 'epics'), { recursive: true });   // two candidates: not guessed
  assert.notStrictEqual(C.projectDir({ cwd: top }), root);
});

test('a project named for an epic files the thread on it, with no question', () => {
  const { top, root } = workspace();
  const r = hook('prompt-submit', { session_id: 'p1', cwd: top, prompt: wake('E03', 'Set up the nightly build for the host') });
  const ctx = hso(r).additionalContext || '';
  assert.match(ctx, /on epic E03, taken from the project's name/);
  assert.doesNotMatch(ctx, /AskUserQuestion/);
  assert.strictEqual(C.loadState(root, 'p1').epic, 'E03');
  assert.match(hso(r).sessionTitle, /^E03 · /);
  const w = hook('pre-tool', { session_id: 'p1', cwd: top, tool_name: 'Write', tool_input: { file_path: path.join(root, 'epics', 'E03-prove-the-host', 'notes', 'run.md') } });
  assert.strictEqual(hso(w).permissionDecision, undefined);
});

test('a name that leads with the code counts; other names and unknown codes do not', () => {
  const reg = { E03: {}, E04: {} };
  assert.strictEqual(C.projectEpic(wake('E03 · Prove the host', 'x'), reg), 'E03');
  assert.strictEqual(C.projectEpic(wake('E05', 'x'), reg), null);
  assert.strictEqual(C.projectEpic(wake('Setpiece', 'x'), reg), null);
  assert.strictEqual(C.projectEpic(wake('E030', 'x'), reg), null);
  assert.strictEqual(C.projectEpic('plain prompt about E03', reg), null);
});

test('a thread already waiting on the question is filed by the next wake', () => {
  const { top, root } = workspace();
  hook('prompt-submit', { session_id: 'p2', cwd: top, prompt: 'Set up the nightly build for the host' });
  assert.ok(C.loadState(root, 'p2').asked);
  hook('prompt-submit', { session_id: 'p2', cwd: top, prompt: wake('E03', 'carry on please') });
  assert.strictEqual(C.loadState(root, 'p2').epic, 'E03');
});

test('the person\'s words still win: "no epic", "not Outer-Pale" and another epic', () => {
  const { top, root } = workspace();
  execFileSync('node', [LL, 'open-epic', 'E04', 'Chassis packages', 'https://linear.app/outer-pale/project/e04', '--session', 'setup', '--root', root], { env: env() });
  hook('prompt-submit', { session_id: 'n1', cwd: top, prompt: wake('E03', 'no epic, just a quick look') });
  assert.strictEqual(C.loadState(root, 'n1').epic, null);
  assert.ok(C.loadState(root, 'n1').noEpic);
  hook('prompt-submit', { session_id: 'n2', cwd: top, prompt: wake('E03', 'not Outer-Pale work, a personal question') });
  assert.ok(C.loadState(root, 'n2').outOfScope);
  hook('prompt-submit', { session_id: 'n3', cwd: top, prompt: wake('E03', 'epic E04 package the chassis') });
  assert.strictEqual(C.loadState(root, 'n3').epic, 'E04');
});
