'use strict';
// outerpale-devops 0.5.0: a session works on one Linear issue, project or initiative, or none.
// One PR per issue, with the issue ID in its title. Linear writes go to Outer-Pale only.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../lib/core');

const RUN = path.join(__dirname, '..', 'hooks', 'run.js');
const LL = path.join(__dirname, '..', 'scripts', 'll.js');
const OUTERPALE = 'dca1918d-09ae-4f88-9f63-c6223b86893e';
const LINEAR = 'mcp__0d1dd885-10c9-4b72-b788-6d4ee138b01a';
const PERSONAL = 'mcp__plugin_productivity_linear';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opd-'));
const hso = r => (r && r.hookSpecificOutput) || {};
const ctx = r => hso(r).additionalContext || '';

function env(home, extra = {}) {
  const e = { ...process.env, HOME: home, USERPROFILE: home, LINEAR_API_KEY: '', ...extra };
  for (const k of Object.keys(e)) if (k.startsWith('CLAUDE_PLUGIN_OPTION_') && !(k in extra)) delete e[k];
  delete e.CLAUDE_CODE_SESSION_ID;
  return e;
}
// One fake home and one fake repository per session.
function session() {
  const home = tmp(); const repo = tmp();
  execFileSync('git', ['init', '-q', repo]);
  const run = (event, input, extra) => {
    const out = execFileSync('node', [RUN, event], { input: JSON.stringify({ session_id: 's', cwd: repo, ...input }), env: env(home, extra) }).toString();
    return out ? JSON.parse(out) : null;
  };
  const ll = (...args) => execFileSync('node', [LL, ...args, '--session', 's'], { env: env(home) }).toString();
  const state = () => JSON.parse(fs.readFileSync(path.join(home, '.linear-link', 'sessions', 's.json'), 'utf8'));
  return { home, repo, run, ll, state };
}
const pr = (s, title, extra = {}) => s.run('pre-tool', { tool_name: 'mcp__github__create_pull_request', tool_input: { title, head: 'b', base: 'main', ...extra } });
const ghpr = (s, command) => s.run('pre-tool', { tool_name: 'Bash', tool_input: { command } });
const denied = r => hso(r).permissionDecision === 'deny';

// ---------- the contract, said at the start ----------
test('session start states the contract and the workspace in a scoped session, and nothing in an unscoped one', () => {
  const s = session();
  assert.equal(s.run('session-start', {}), null, 'an unscoped session hears nothing');
  s.ll('scope', 'issue', 'OUT-7');
  const c = ctx(s.run('session-start', {}));
  assert.match(c, /^outerpale-devops: /);
  assert.match(c, /one Linear issue, project or initiative/);
  assert.match(c, /one PR per issue/i);
  assert.match(c, /Outer-Pale workspace \(team OUT\) only/);
  assert.match(c, /\.planning\//);
  assert.doesNotMatch(c, /EGM|docs\/design/);
});

// ---------- scope ----------
test('a prompt that opens with an issue ID puts the session on that issue', () => {
  const s = session();
  const r = s.run('prompt-submit', { prompt: 'OUT-401 rebuild the nav rail' });
  assert.equal(s.state().scope, 'issue');
  assert.equal(s.state().ref, 'OUT-401');
  assert.equal(hso(r).sessionTitle, 'OUT-401 · rebuild the nav rail');
  assert.match(ctx(r), /build-issue/);
  assert.match(ctx(r), /GSD phase/);
  assert.match(ctx(r), /PLAN\.md/);
  assert.match(ctx(r), /intent-reviewer/);
});

test('a passing mention of an issue does not set the scope', () => {
  for (const p of ['this depends on OUT-82', 'PR OUT-82 broke CI', 'see OUT-82 for context']) assert.equal(C.parseScope(p, 'OUT'), null, p);
  for (const p of ['OUT-82 build it', 'switch to OUT-82', 'work on OUT-82', 'pick up OUT-82', 'Issue OUT-82: Nav rail']) assert.deepEqual(C.parseScope(p, 'OUT'), { scope: 'issue', ref: 'OUT-82' }, p);
});

test('a launch prompt whose first line names a project or initiative sets the scope, so an orchestrated session is not asked', () => {
  const s = session();
  const r = s.run('prompt-submit', { prompt: 'Project: Webhooks\nBreak the approved design into issues.' });
  assert.equal(s.state().scope, 'project');
  assert.equal(s.state().ref, 'Webhooks');
  assert.doesNotMatch(ctx(r), /AskUserQuestion/);
  const t = session();
  t.run('prompt-submit', { prompt: 'Initiative: Platform v2\nDraft the roadmap.' });
  assert.equal(t.state().scope, 'initiative');
  assert.equal(t.state().ref, 'Platform v2');
  const u = session();
  u.run('prompt-submit', { prompt: 'OUT-401 rebuild the nav rail' });
  u.run('prompt-submit', { prompt: 'Project: Webhooks\nsomething else' });
  assert.equal(u.state().ref, 'OUT-401', 'a later prompt does not move a scoped session to a project');
});

test('an unscoped session is not asked the scope question: the plugin stands aside', () => {
  const s = session();
  assert.equal(ctx(s.run('prompt-submit', { prompt: 'tidy the header spacing' })), '');
  assert.equal(ctx(s.run('prompt-submit', { prompt: 'and the footer' })), '');
  assert.equal(s.state().scope, null);
  assert.ok(!denied(pr(s, 'Tidy the header')), 'no issue needed for a PR');
});

test('a subagent report is not the person: it sets nothing and asks nothing', () => {
  const s = session();
  const r = s.run('prompt-submit', { prompt: '<agent-message from="a1">OUT-5 done, see the PR</agent-message>' });
  assert.equal(r, null);
});

test('"ll scope none" stands the plugin aside, but the Linear guard still holds', () => {
  const s = session(); s.ll('scope', 'none');
  assert.equal(s.run('prompt-submit', { prompt: 'OUT-5 set up my dotfiles' }), null);
  assert.equal(s.state().scope, 'none');
  assert.ok(!denied(pr(s, 'Tidy dotfiles')));
  assert.ok(denied(s.run('pre-tool', { tool_name: `${LINEAR}__save_issue`, tool_input: {} })));
});

test('build-issue replaces start-issue, and it asks for the issue and records it', () => {
  const skills = path.join(__dirname, '..', 'skills');
  assert.ok(!fs.existsSync(path.join(skills, 'start-issue')));
  const md = fs.readFileSync(path.join(skills, 'build-issue', 'SKILL.md'), 'utf8');
  assert.match(md, /^name: build-issue$/m);
  assert.match(md, /AskUserQuestion/);
  assert.match(md, /ll\.js scope issue/);
});

test('the ll CLI sets and shows the scope', () => {
  const s = session();
  assert.match(s.ll('scope', 'issue', 'OUT-7', '--title', 'Retry rules'), /OUT-7 · Retry rules/);
  assert.equal(s.state().ref, 'OUT-7');
  assert.match(s.ll('status'), /issue OUT-7/);
  s.ll('scope', 'project', 'Webhooks');
  assert.equal(s.state().scope, 'project');
});

// ---------- one PR per issue ----------
test('an issue session opens PRs only with its issue ID in the title', () => {
  const s = session(); s.run('prompt-submit', { prompt: 'OUT-401 rebuild the nav rail' });
  const bad = pr(s, 'Rebuild the nav rail');
  assert.ok(denied(bad));
  assert.match(hso(bad).permissionDecisionReason, /OUT-401/);
  assert.ok(denied(pr(s, 'OUT-402: something else')), 'another issue is refused');
  assert.equal(pr(s, 'OUT-401: Rebuild the nav rail'), null);
  assert.ok(denied(ghpr(s, 'gh pr create --title "Rebuild nav" --body x')));
  assert.equal(ghpr(s, 'gh pr create --title "OUT-401 Rebuild nav" --body "Fixes OUT-401"'), null);
  assert.equal(ghpr(s, 'git push -u origin HEAD'), null, 'other commands are not PRs');
});

test('a project or initiative session opens PRs only for an issue (design work has its own)', () => {
  const s = session(); s.ll('scope', 'project', 'Webhooks');
  const bad = pr(s, 'Webhooks design doc');
  assert.ok(denied(bad));
  assert.match(hso(bad).permissionDecisionReason, /Design: /);
  assert.equal(pr(s, 'OUT-9: Webhooks design doc'), null);
});

test('state lives in ~/.linear-link, never in the repository', () => {
  const s = session();
  s.run('prompt-submit', { prompt: 'OUT-401 rebuild the nav rail' });
  assert.ok(fs.existsSync(path.join(s.home, '.linear-link', 'sessions', 's.json')));
  assert.equal(execFileSync('git', ['-C', s.repo, 'status', '--porcelain']).toString(), '');
});

test('an artifact published in an issue session is attached to the issue', () => {
  const s = session(); s.run('prompt-submit', { prompt: 'OUT-401 rebuild the nav rail' });
  const r = s.run('post-tool', { tool_name: 'Artifact', tool_input: { file_path: 'nav.html' }, tool_response: 'Published https://claude.ai/code/artifact/abc123' });
  assert.match(ctx(r), /attach https:\/\/claude\.ai\/code\/artifact\/abc123 to OUT-401/);
});

// ---------- the person's words ----------
test('promptText keeps only the person\'s words, and titles carry no markup', () => {
  const wake = '<wake reason="mention"><message from="human" author="H">OUT-401 fix the nav &amp; footer</message><system-note>OUT-999</system-note></wake>';
  assert.equal(C.promptText(wake), 'OUT-401 fix the nav & footer');
  assert.equal(C.promptText('<wake reason="x"><system-note>status=linked</system-note></wake>'), '');
  assert.equal(C.promptText('plain words OUT-1'), 'plain words OUT-1');
  assert.equal(C.buildTitle({ scope: 'issue', ref: 'OUT-1', desc: C.describe('/plugin:skill fix <b>it</b> in C:\\a\\b\\nav.tsx now') }), 'OUT-1 · fix it in nav.tsx now');
  assert.equal(C.buildTitle({ scope: 'none' }), null);
});

// ---------- the Linear workspace guard (kept from 0.4) ----------
const wsResponse = (id, name, slug) => [{ type: 'text', text: JSON.stringify({ id, name, url: `https://linear.app/${slug}` }) }];

test('guard: an unchecked connector cannot write; after get_workspace shows Outer-Pale it can; a personal one stays blocked', () => {
  const s = session();
  assert.match(hso(s.run('pre-tool', { tool_name: `${LINEAR}__save_issue`, tool_input: {} })).permissionDecisionReason, /get_workspace first/);
  assert.match(ctx(s.run('post-tool', { tool_name: `${LINEAR}__get_workspace`, tool_input: {}, tool_response: wsResponse(OUTERPALE, 'Outer-Pale', 'outer-pale') })), /writes are allowed/);
  assert.equal(s.run('pre-tool', { tool_name: `${LINEAR}__save_issue`, tool_input: {} }), null);
  assert.match(ctx(s.run('post-tool', { tool_name: `${PERSONAL}__get_workspace`, tool_input: {}, tool_response: wsResponse('11111111-2222-4333-8444-555555555555', 'Harry personal', 'harry') })), /will be refused/);
  const r = s.run('pre-tool', { tool_name: `${PERSONAL}__save_comment`, tool_input: {} });
  assert.match(hso(r).permissionDecisionReason, new RegExp(`Use ${LINEAR}__save_comment instead`));
  for (const t of ['mcp__gmail__delete_draft', `${LINEAR}__list_issues`]) assert.equal(s.run('pre-tool', { tool_name: t, tool_input: {} }), null, t);
});

// State that can be read but not saved: a directory where the session file should be. Works as root too.
function unsavable(s) { fs.mkdirSync(path.join(s.home, '.linear-link', 'sessions', 's.json', 'x'), { recursive: true }); }

test('guard: a hook error refuses Linear writes and names the error, and lets everything else through', () => {
  const s = session();
  s.run('post-tool', { tool_name: `${LINEAR}__get_workspace`, tool_input: {}, tool_response: wsResponse(OUTERPALE, 'Outer-Pale', 'outer-pale') });
  unsavable(s);
  const r = s.run('pre-tool', { tool_name: `${LINEAR}__save_issue`, tool_input: {} });
  assert.ok(denied(r));
  assert.match(hso(r).permissionDecisionReason, /hook failed \(.*EISDIR.*\)/);
  for (const t of ['Read', `${LINEAR}__get_issue`]) assert.equal(s.run('pre-tool', { tool_name: t, tool_input: {} }), null, t);
  const raw = input => execFileSync('node', [RUN, 'pre-tool'], { input, env: env(tmp()) }).toString();
  assert.match(hso(JSON.parse(raw(`{"tool_name":"${LINEAR}__save_issue","tool_input":`))).permissionDecisionReason, /hook failed/);
  assert.equal(raw('{"tool_name":"Read","tool_input":'), '');
});

test('hooks.json covers the guard, the PR gate and artifacts', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const covers = (ev, name) => hooks[ev].some(h => new RegExp(`^(?:${h.matcher || '.*'})$`).test(name));
  for (const t of [`${LINEAR}__save_issue`, `${LINEAR}__create_attachment`, 'mcp__github__create_pull_request', 'Bash']) assert.ok(covers('PreToolUse', t), t);
  for (const t of [`${LINEAR}__get_workspace`, 'Artifact']) assert.ok(covers('PostToolUse', t), t);
});

// ---------- no telemetry of its own: Claude Code's OpenTelemetry export does that ----------
test('the plugin sends no telemetry: no Stop hook, no Langfuse settings, no event log in state', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.equal(hooks.Stop, undefined);
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'lib', 'telemetry.js')));
  const manifest = fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'plugin.json'), 'utf8');
  assert.doesNotMatch(manifest, /langfuse|telemetry/i);
  assert.equal(C.config().langfuse, undefined);
  const s = session(); s.run('prompt-submit', { prompt: 'OUT-401 rebuild the nav rail' });
  assert.equal(s.state().events, undefined);
});
