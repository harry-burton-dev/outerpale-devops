'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../lib/core');

const RUN = path.join(__dirname, '..', 'hooks', 'run.js');
const LL = path.join(__dirname, '..', 'scripts', 'll.js');
const sc = C.schema('OUT');

// ---------- schema fixtures ----------
const good = {
  thread: ['FE · OUT-401 · Nav rail rebuild', 'FE · Epic planning', 'UNFILED · Quick question', 'KG · OUT-351 · Build the knowledge graph service'],
  artifact: ['MASTER · Architecture', 'FE · OUT-401 · Nav rail options', 'FE · Frontend inventory'],
  epicDir: ['epics/FE-frontend-redesign', 'epics/KG-knowledge-graph'],
  issueDir: ['epics/FE-frontend-redesign/issues/OUT-401-nav-rail'],
  noteFile: ['epics/FE-frontend-redesign/notes/plan.md', 'epics/FE-frontend-redesign/issues/OUT-401-nav-rail/review-1.md'],
  artifactFile: ['masters/architecture.html', 'epics/FE-frontend-redesign/artifacts/nav-rail-options.html'],
};
const bad = {
  thread: ['Untitled design', 'OUT-401 Nav rail', 'fe · OUT-401 · Nav rail', 'FE - OUT-401 - Nav rail', 'FE · OUT-401 · ', 'FE · ABC-1 · Wrong team', 'FE · x'],
  artifact: ['Nav rail options', 'Untitled', 'MASTER Architecture', 'FE · ABC-12 · Wrong team'],
  epicDir: ['epics/fe-frontend', 'epics/FE', 'epics/FE-Frontend_Redesign'],
  issueDir: ['epics/FE-frontend-redesign/issues/401-nav', 'epics/FE-frontend-redesign/OUT-401-nav'],
  noteFile: ['epics/FE-frontend-redesign/plan.md', 'epics/FE-frontend-redesign/notes/Plan.md', 'notes/plan.md'],
  artifactFile: ['epics/FE-frontend-redesign/notes/plan.html', 'reports/x.html', 'masters/x.md'],
};
for (const k of Object.keys(good)) {
  test(`schema ${k}: accepts good examples`, () => { for (const s of good[k]) assert.ok(sc[k].test(s), s); });
  test(`schema ${k}: rejects bad examples`, () => { for (const s of bad[k]) assert.ok(!sc[k].test(s), s); });
}

// ---------- hook harness ----------
function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'll-'));
  execFileSync('node', [LL, 'open-epic', 'FE', 'Frontend redesign', 'P-OUT-60', '--root', root, '--session', 'setup']);
  execFileSync('node', [LL, 'start-issue', 'OUT-401', 'Nav rail rebuild', '--root', root, '--session', 'setup']);
  fs.mkdirSync(path.join(root, 'masters'), { recursive: true });
  return root;
}
function hook(event, input, env = {}) {
  const outp = execFileSync('node', [RUN, event], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: input.cwd, CLAUDE_PLUGIN_OPTION_ROOT: input.cwd, HOME: input.cwd, USERPROFILE: input.cwd, LINEAR_API_KEY: '', ...env },
  }).toString();
  return outp ? JSON.parse(outp) : null;
}
const hso = r => (r && r.hookSpecificOutput) || {};

test('prompt naming epic and issue sets the title', () => {
  const root = project();
  const r = hook('prompt-submit', { session_id: 's1', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail please' });
  assert.equal(hso(r).sessionTitle, 'FE · OUT-401 · rebuild the nav rail please');
  assert.match(hso(r).additionalContext, /Post this thread's link as a comment on OUT-401/);
});

test('switching issue mid-thread updates the title and asks for start-issue', () => {
  const root = project();
  hook('prompt-submit', { session_id: 's2', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  const r = hook('prompt-submit', { session_id: 's2', cwd: root, prompt: 'now OUT-402 polish the footer layout', session_title: 'FE · OUT-401 · rebuild the nav rail' });
  assert.equal(hso(r).sessionTitle, 'FE · OUT-402 · now polish the footer layout');
  assert.match(hso(r).additionalContext, /OUT-402 isn.t listed in epic FE yet/);
  const st = JSON.parse(fs.readFileSync(path.join(root, '.linear-link/sessions/s2.json'), 'utf8'));
  assert.deepEqual(st.touched, ['OUT-401', 'OUT-402']);
});

test('a schema-fitting manual title with the same IDs is kept', () => {
  const root = project();
  hook('prompt-submit', { session_id: 's3', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  const r = hook('prompt-submit', { session_id: 's3', cwd: root, prompt: 'carry on', session_title: 'FE · OUT-401 · Nav rail, keyboard pass' });
  assert.equal(hso(r).sessionTitle, undefined);
});

test('a drifted title is put back', () => {
  const root = project();
  hook('prompt-submit', { session_id: 's4', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  const r = hook('prompt-submit', { session_id: 's4', cwd: root, prompt: 'carry on', session_title: 'Nav rail work' });
  assert.equal(hso(r).sessionTitle, 'FE · OUT-401 · rebuild the nav rail');
});

test('a thread with no epic keeps its title and is asked the epic question', () => {
  const root = project();
  const r = hook('prompt-submit', { session_id: 's5', cwd: root, prompt: 'quick question about css grid' });
  assert.equal(hso(r).sessionTitle, undefined);
  assert.match(hso(r).additionalContext, /before doing any work/);
});

test('policy block refuses an unfiled prompt', () => {
  const root = project();
  const r = hook('prompt-submit', { session_id: 's6', cwd: root, prompt: 'quick question about css grid' }, { CLAUDE_PLUGIN_OPTION_POLICY: 'block' });
  assert.equal(r.decision, 'block');
});

test('resume re-asserts the title from saved state', () => {
  const root = project();
  hook('prompt-submit', { session_id: 's7', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  const r = hook('session-start', { session_id: 's7', cwd: root, source: 'resume', session_title: 'something else' });
  assert.equal(hso(r).sessionTitle, 'FE · OUT-401 · rebuild the nav rail');
});

test('a fork with no saved state adopts the IDs in its title and logs itself', () => {
  const root = project();
  const s = hook('session-start', { session_id: 'f1', cwd: root, source: 'fork', session_title: 'FE · OUT-401 · Nav rail rebuild' });
  assert.equal(hso(s).sessionTitle, undefined);
  const r = hook('prompt-submit', { session_id: 'f1', cwd: root, prompt: 'try the compact variant', session_title: 'FE · OUT-401 · Nav rail rebuild' });
  assert.equal(hso(r).sessionTitle, undefined);
  assert.match(hso(r).additionalContext, /Post this thread's link as a comment on OUT-401/);
});

function onFE(root, sid) { hook('prompt-submit', { session_id: sid, cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' }); }
const epicDir = 'epics/FE-frontend-redesign';

test('writes: notes allowed, strays refused, code untouched', () => {
  const root = project(); onFE(root, 'w');
  const w = p => hook('pre-tool', { session_id: 'w', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, p), content: 'x' } });
  assert.equal(w(`${epicDir}/notes/plan.md`), null);
  assert.equal(w(`${epicDir}/issues/OUT-401-nav-rail-rebuild/review.md`), null);
  assert.equal(w('src/app.ts'), null);
  assert.equal(w('README.md'), null);
  assert.equal(w('masters/architecture.html'), null);
  assert.equal(hso(w('plan.md')).permissionDecision, 'deny');
  assert.equal(hso(w('epics/KG-graph/notes/a.md')).permissionDecision, 'deny');
  assert.equal(hso(w(`${epicDir}/plan.md`)).permissionDecision, 'deny');
});

test('unfiled thread: documents refused under block-outputs, warned under unfiled', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'u', cwd: root, prompt: 'quick question about css grid' });
  const input = { session_id: 'u', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, `${epicDir}/notes/a.md`) } };
  assert.equal(hso(hook('pre-tool', input)).permissionDecision, 'deny');
  const soft = hso(hook('pre-tool', input, { CLAUDE_PLUGIN_OPTION_POLICY: 'unfiled' }));
  assert.equal(soft.permissionDecision, undefined);
  assert.match(soft.additionalContext, /epic question/);
});

test('artifact: temporary outputs refused, title enforced, good publish allowed', () => {
  const root = project(); onFE(root, 'a');
  const pub = file => hook('pre-tool', { session_id: 'a', cwd: root, tool_name: 'Artifact', tool_input: { file_path: path.join(root, file) } });
  fs.mkdirSync(path.join(root, epicDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, epicDir, 'notes', 'plan.md'), '# plan');
  assert.match(hso(pub(`${epicDir}/notes/plan.md`)).permissionDecisionReason, /temporary output/);
  fs.writeFileSync(path.join(root, epicDir, 'artifacts', 'opts.html'), '<title>Nav rail options</title>');
  assert.match(hso(pub(`${epicDir}/artifacts/opts.html`)).permissionDecisionReason, /"FE · OUT-401 · Nav rail options"/);
  fs.writeFileSync(path.join(root, epicDir, 'artifacts', 'opts.html'), '<title>FE · OUT-401 · Nav rail options</title>');
  assert.equal(pub(`${epicDir}/artifacts/opts.html`), null);
  fs.writeFileSync(path.join(root, 'masters', 'architecture.html'), '<title>Architecture</title>');
  assert.match(hso(pub('masters/architecture.html')).permissionDecisionReason, /"MASTER · Architecture"/);
});

test('Claude Doc creation must be named to the schema', () => {
  const root = project(); onFE(root, 'd');
  const mk = name => hook('pre-tool', { session_id: 'd', cwd: root, tool_name: 'mcp__Claude_Docs__batch', tool_input: { container: { kind: 'project', create: { name } }, batch: [] } });
  assert.equal(hso(mk('Plan')).permissionDecision, 'deny');
  assert.equal(mk('FE · OUT-401 · Nav rail spec'), null);
  assert.equal(mk('MASTER · Decision log'), null);
});

test('after publish: index records the artifact and Claude is asked to attach it', () => {
  const root = project(); onFE(root, 'p');
  fs.mkdirSync(path.join(root, epicDir, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, epicDir, 'artifacts', 'opts.html'), '<title>FE · OUT-401 · Nav rail options</title>');
  const r = hook('post-tool', { session_id: 'p', cwd: root, tool_name: 'Artifact', tool_input: { file_path: path.join(root, epicDir, 'artifacts/opts.html') }, tool_response: 'Published https://claude.ai/artifact/AbC123xyz' });
  assert.match(hso(r).additionalContext, /attach https:\/\/claude\.ai\/artifact\/AbC123xyz to OUT-401/);
  const idx = fs.readFileSync(path.join(root, epicDir, 'index.md'), 'utf8');
  assert.match(idx, /- \[FE · OUT-401 · Nav rail options\]\(https:\/\/claude\.ai\/artifact\/AbC123xyz\) · OUT-401/);
  hook('post-tool', { session_id: 'p', cwd: root, tool_name: 'Artifact', tool_input: { file_path: path.join(root, epicDir, 'artifacts/opts.html') }, tool_response: 'Published https://claude.ai/artifact/AbC123xyz' });
  assert.equal(fs.readFileSync(path.join(root, epicDir, 'index.md'), 'utf8').match(/AbC123xyz/g).length, 1);
});

test('sweep finds stray documents and unfiled threads', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'z', cwd: root, prompt: 'quick question about css grid' });
  fs.writeFileSync(path.join(root, 'review.md'), 'x');
  const f = JSON.parse(execFileSync('node', [LL, 'sweep', '--json', '--root', root]).toString());
  assert.ok(f.some(x => x.kind === 'stray-file' && x.path === 'review.md'));
  assert.ok(f.some(x => x.kind === 'unfiled-thread' && x.session === 'z'));
  assert.ok(!f.some(x => x.path && x.path.endsWith('index.md') && x.kind === 'stray-file'));
});

test('close-epic archives only with --confirm', () => {
  const root = project();
  assert.throws(() => execFileSync('node', [LL, 'close-epic', 'FE', '--root', root], { stdio: 'pipe' }));
  execFileSync('node', [LL, 'close-epic', 'FE', '--confirm', '--root', root]);
  assert.ok(fs.existsSync(path.join(root, 'archive', epicDir, 'index.md')));
  assert.match(fs.readFileSync(path.join(root, 'archive', epicDir, 'index.md'), 'utf8'), /status: closed/);
});

// ---------- 0.1.1: shared root and wake prompts ----------
test('root: an explicit option wins, else the session folder', () => {
  const env = { ...process.env };
  try {
    process.env.CLAUDE_PLUGIN_OPTION_ROOT = '/tmp/ll-explicit';
    assert.strictEqual(C.projectDir({ cwd: '/x' }), path.resolve('/tmp/ll-explicit'));
    delete process.env.CLAUDE_PLUGIN_OPTION_ROOT; delete process.env.LINEAR_LINK_ROOT;
    process.env.CLAUDE_PROJECT_DIR = '/tmp/ll-proj';
    const want = fs.existsSync('/mnt/project-files') ? '/mnt/project-files' : '/tmp/ll-proj';
    assert.strictEqual(C.projectDir({ cwd: '/x' }), want);
  } finally { process.env = env; }
});

test('promptText keeps only the person\'s words from a wake', () => {
  const wake = '<wake reason="mention"><project><thread><message trigger="true" from="human" trust="principal" author="H" id="m1">FE OUT-401 fix the nav &amp; footer</message></thread></project><system-note>Thread state: OUT-999</system-note></wake>';
  assert.strictEqual(C.promptText(wake), 'FE OUT-401 fix the nav & footer');
  assert.strictEqual(C.promptText('<wake reason="thread-computer-status"><system-note>status=linked</system-note></wake>'), '');
  assert.strictEqual(C.promptText('<relay from="coordinator"><cited author="user">please test it</cited><note>Thread code LL.</note></relay>'), 'please test it\nThread code LL.');
  assert.strictEqual(C.promptText('plain words OUT-1'), 'plain words OUT-1');
});

test('a wake with no human words does not become the thread title', () => {
  const root = project();
  const r = hook('prompt-submit', { session_id: 'w1', cwd: root, prompt: '<wake reason="thread-computer-status"><system-note>status=linked</system-note></wake>' });
  assert.strictEqual(hso(r).sessionTitle, undefined);
  const r2 = hook('prompt-submit', { session_id: 'w2', cwd: root, prompt: '<wake reason="mention"><message from="human" author="H">FE OUT-401 rebuild the nav rail</message><system-note>OUT-999 noise</system-note></wake>' });
  assert.strictEqual(hso(r2).sessionTitle, 'FE · OUT-401 · rebuild the nav rail');
});
