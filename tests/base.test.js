'use strict';
// Rules endstate-ops 0.2.0 added on top of linear-link 0.1.2, kept by outerpale-devops.
// The rules it keeps are proven by plugin.test.js, which is linear-link's suite, unchanged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../lib/core');

const RUN = path.join(__dirname, '..', 'hooks', 'run.js');
const LL = path.join(__dirname, '..', 'scripts', 'll.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'eo-'));
const hso = r => (r && r.hookSpecificOutput) || {};

// A project folder with an open epic FE and issue OUT-401, as a git repo would hold it.
function project() {
  const root = tmp();
  execFileSync('node', [LL, 'open-epic', 'FE', 'Frontend redesign', 'P-OUT-60', '--root', root, '--session', 'setup']);
  execFileSync('node', [LL, 'start-issue', 'OUT-401', 'Nav rail rebuild', '--root', root, '--session', 'setup']);
  fs.mkdirSync(path.join(root, 'masters'), { recursive: true });
  return root;
}
// Unlike linear-link's harness, no explicit root: the plugin must find the tree itself.
function hook(event, input, env = {}) {
  const h = tmp();
  const e = { ...process.env, CLAUDE_PROJECT_DIR: input.cwd, HOME: h, USERPROFILE: h, LINEAR_API_KEY: '', ...env };
  delete e.CLAUDE_PLUGIN_OPTION_ROOT; delete e.LINEAR_LINK_ROOT;
  const outp = execFileSync('node', [RUN, event], { input: JSON.stringify(input), env: e }).toString();
  return outp ? JSON.parse(outp) : null;
}

// ---------- ADR 0002: the tree lives in the project's git repo ----------
test('root: the nearest folder above the session that holds epics/ wins over the session folder', () => {
  const root = project();
  const deep = path.join(root, 'code', 'augur-kit', 'src');
  fs.mkdirSync(deep, { recursive: true });
  const env = { ...process.env };
  try {
    delete process.env.CLAUDE_PLUGIN_OPTION_ROOT; delete process.env.LINEAR_LINK_ROOT;
    process.env.CLAUDE_PROJECT_DIR = deep;
    assert.strictEqual(C.projectDir({ cwd: deep }), root);
  } finally { process.env = env; }
});

test('a session inside a code repo is policed against the project tree above it', () => {
  const root = project();
  const deep = path.join(root, 'code', 'augur-kit');
  fs.mkdirSync(deep, { recursive: true });
  hook('prompt-submit', { session_id: 'r1', cwd: deep, prompt: 'FE OUT-401 rebuild the nav rail' });
  assert.ok(fs.existsSync(path.join(root, '.linear-link/sessions/r1.json')), 'state is kept in the project tree');
  const w = p => hook('pre-tool', { session_id: 'r1', cwd: deep, tool_name: 'Write', tool_input: { file_path: p } });
  assert.equal(hso(w(path.join(root, 'review.md'))).permissionDecision, 'deny');
  assert.equal(w(path.join(root, 'epics/FE-frontend-redesign/notes/plan.md')), null);
  assert.equal(w(path.join(os.tmpdir(), 'elsewhere', 'note.md')), null, 'files outside the tree are not policed');
});

// ---------- Claude Docs under any server name ----------
test('a Claude Doc is held to the schema whatever the connector is called', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'd1', cwd: root, prompt: 'FE OUT-401 write the spec' });
  const tool = 'mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__batch';
  const mk = name => hook('pre-tool', { session_id: 'd1', cwd: root, tool_name: tool, tool_input: { container: { kind: 'project', create: { name } }, batch: [] } });
  assert.equal(hso(mk('Plan')).permissionDecision, 'deny');
  assert.equal(mk('FE · OUT-401 · Nav rail spec'), null);
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const ev of ['PreToolUse', 'PostToolUse']) {
    assert.ok(new RegExp(`^(?:${hooks[ev][0].matcher})$`).test(tool), `${ev} matcher covers ${tool}`);
    assert.ok(new RegExp(`^(?:${hooks[ev][0].matcher})$`).test('mcp__Claude_Docs__batch'), `${ev} matcher still covers the old name`);
  }
});

test('the plugin is outerpale-devops 0.4.1, keeps linear-link\'s state folder, and has a Stop hook', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(m.name, 'outerpale-devops');
  assert.equal(m.version, '0.4.1');
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.ok(hooks.Stop, 'a Stop hook is wired');
  const root = project();
  const r = hook('prompt-submit', { session_id: 'n1', cwd: root, prompt: 'quick question about css grid' });
  assert.match(hso(r).additionalContext, /^outerpale-devops: before doing any work/);
  assert.ok(fs.existsSync(path.join(root, '.linear-link/sessions/n1.json')));
});

// ---------- code repos cloned inside the tree keep their own documents ----------
test('a git repo nested in the tree is not policed, by the write hook or by sweep', () => {
  const root = project();
  const repo = path.join(root, 'code', 'augur');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.changeset'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.changeset', 'fix.md'), 'x');
  fs.writeFileSync(path.join(root, 'review.md'), 'x');
  hook('prompt-submit', { session_id: 'g1', cwd: repo, prompt: 'FE OUT-401 rebuild the nav rail' });
  const w = p => hook('pre-tool', { session_id: 'g1', cwd: repo, tool_name: 'Write', tool_input: { file_path: p } });
  assert.equal(w(path.join(repo, '.changeset', 'new.md')), null);
  assert.equal(w(path.join(repo, 'docs', 'guide.md')), null);
  assert.equal(hso(w(path.join(root, 'code', 'loose.md'))).permissionDecision, 'deny', 'code/ itself is still in the tree');
  const f = JSON.parse(execFileSync('node', [LL, 'sweep', '--json', '--root', root]).toString());
  assert.ok(f.some(x => x.kind === 'stray-file' && x.path === 'review.md'));
  assert.ok(!f.some(x => x.path && x.path.startsWith('code/augur/')), 'nothing inside the nested repo is reported');
});
