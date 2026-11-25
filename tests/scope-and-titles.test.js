'use strict';
// Titles come only from the person's own words, and a new thread is asked,
// before any work, whether it needs an epic and whether it is Outer-Pale work at all.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../lib/core');

const RUN = path.join(__dirname, '..', 'hooks', 'run.js');
const LL = path.join(__dirname, '..', 'scripts', 'll.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opd-st-'));
const hso = r => (r && r.hookSpecificOutput) || {};
const HOME = tmp();

function project() {
  const root = tmp();
  const e = { ...process.env, HOME, USERPROFILE: HOME };
  execFileSync('node', [LL, 'open-epic', 'FE', 'Frontend redesign', 'P-OUT-60', '--root', root, '--session', 'setup'], { env: e });
  execFileSync('node', [LL, 'start-issue', 'OUT-401', 'Nav rail rebuild', '--root', root, '--session', 'setup'], { env: e });
  return root;
}
function hook(event, input) {
  const e = { ...process.env, HOME, USERPROFILE: HOME, LINEAR_API_KEY: '', LANGFUSE_HOST: '', CLAUDE_PROJECT_DIR: input.cwd };
  delete e.CLAUDE_PLUGIN_OPTION_ROOT; delete e.LINEAR_LINK_ROOT;
  const out = execFileSync('node', [RUN, event], { input: JSON.stringify(input), env: e }).toString();
  return out ? JSON.parse(out) : null;
}
const state = (root, sid) => C.loadState(root, sid);

// ---------- titles: real prompts that made bad titles ----------
const reg = { FE: { code: 'FE', issues: {} } };
const cases = [
  // [prompt as the hook received it, description wanted (null: none)]
  ['<agent-message from="a76b913ac8ce8ad4b">\n[Subagent hand-back] The text below is the final report. OUT-5 is mentioned.\n</agent-message>', null],
  ['<task-notification><task-id>x</task-id><status>completed</status></task-notification>', null],
  ['<system-reminder>Another session sent a message</system-reminder>', null],
  ['/anthropic-skills:deeper-tasks clean up the ADR Records in this repo', 'clean up the ADR Records in this repo'],
  ['<command-message>deeper-tasks:deeper-tasks</command-message>\n<command-name>/deeper-tasks:deeper-tasks</command-name>\n<command-args>Edit outer pale dev ops plugin so that it asks</command-args>', 'Edit outer pale dev ops plugin'],
  ['[Local: work on my computer in C:\\Users\\harry\\dev] fix the nav rail', 'fix the nav rail'],
  ['In C:\\Users\\harry\\Documents\\dev\\code-root\\outer-office fix the build script', 'In outer-office fix the build script'],
  ['what does this require https://electric.ax/docs/sync/ ie the server', 'what does this require electric.ax ie the server'],
  ['Set up a live dev server for the Setpiece app', 'Set up a live dev server'],
  ['Harry wants gstack installed on his own machine', 'Harry wants gstack installed on his own machine'],
];
for (const [prompt, want] of cases) {
  test(`description from ${JSON.stringify(prompt.slice(0, 50))}`, () => {
    assert.strictEqual(C.describe(C.promptText(prompt), reg), want);
  });
}

test('no built title ever carries markup, a slash command or a path', () => {
  for (const [prompt] of cases) {
    const d = C.describe(C.promptText(prompt), reg);
    const t = C.buildTitle({ epic: 'FE', issue: 'OUT-401', desc: d });
    assert.ok(C.schema('OUT').thread.test(t), t);
    assert.doesNotMatch(t, /[<>]|\/[\w-]+:|[A-Za-z]:\\/, t);
  }
});

test('a subagent report is not the person: it sets no issue, no title and asks nothing', () => {
  const root = project();
  const r = hook('prompt-submit', { session_id: 's1', cwd: root, prompt: cases[0][0] });
  assert.strictEqual(hso(r).sessionTitle, undefined);
  assert.doesNotMatch(hso(r).additionalContext || '', /OUT-5|AskUserQuestion/);
  assert.strictEqual(state(root, 's1').issue, null);
  assert.strictEqual(state(root, 's1').asked, false);
});

test('a placeholder title is replaced by the first words the person types', () => {
  const root = project();
  hook('prompt-submit', { session_id: 's2', cwd: root, prompt: '<wake reason="x"><system-note>linked</system-note></wake>' });
  const r = hook('prompt-submit', { session_id: 's2', cwd: root, prompt: 'FE rebuild the footer links' });
  assert.strictEqual(hso(r).sessionTitle, 'FE · rebuild the footer links');
});

// ---------- the epic question, before any work ----------
test('the first human prompt in an unfiled thread asks the epic question, once', () => {
  const root = project();
  const r = hook('prompt-submit', { session_id: 'q1', cwd: root, prompt: 'make the login page faster please' });
  const ctx = hso(r).additionalContext;
  assert.match(ctx, /before doing any work/i);
  assert.match(ctx, /AskUserQuestion/);
  assert.match(ctx, /"Not Outer-Pale work"/);
  assert.match(ctx, /"No epic"/);
  assert.match(ctx, /This folder is an Outer-Pale project/);
  assert.strictEqual(hso(r).sessionTitle, undefined, 'no UNFILED title before the person decides');
  const r2 = hook('prompt-submit', { session_id: 'q1', cwd: root, prompt: 'any update?' });
  assert.doesNotMatch(hso(r2).additionalContext || '', /AskUserQuestion/);
});

test('outside an Outer-Pale tree the question says so', () => {
  const dir = tmp();
  const r = hook('prompt-submit', { session_id: 'q2', cwd: dir, prompt: 'help me plan a birthday dinner' });
  assert.match(hso(r).additionalContext, /not an Outer-Pale project/);
});

test('until the question is answered, writes wait (code included)', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'q3', cwd: root, prompt: 'make the login page faster please' });
  const r = hook('pre-tool', { session_id: 'q3', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'app.js') } });
  assert.strictEqual(hso(r).permissionDecision, 'deny');
  assert.match(hso(r).permissionDecisionReason, /epic question/);
});

const answer = (sid, root, a) => hook('post-tool', {
  session_id: sid, cwd: root, tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Is this Outer-Pale work, and does it need an epic?', options: [{ label: 'Open a new epic' }, { label: 'No epic' }, { label: 'Not Outer-Pale work' }] }] },
  tool_response: `User has answered your questions: "Is this Outer-Pale work, and does it need an epic?"="${a}". You can now continue.`,
});

test('answering "Not Outer-Pale work" stands the plugin aside', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'q4', cwd: root, prompt: 'help me write a birthday card' });
  const a = answer('q4', root, 'Not Outer-Pale work');
  assert.match(hso(a).additionalContext, /stands aside/);
  assert.strictEqual(state(root, 'q4').outOfScope, true);
  const w = hook('pre-tool', { session_id: 'q4', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'card.md') } });
  assert.strictEqual(w, null);
  const p = hook('prompt-submit', { session_id: 'q4', cwd: root, prompt: 'make it funnier' });
  assert.strictEqual(hso(p).sessionTitle, undefined);
  assert.strictEqual(hso(p).additionalContext, undefined);
});

test('answering "No epic" files the thread as UNFILED', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'q5', cwd: root, prompt: 'spike a quick cache idea' });
  answer('q5', root, 'No epic');
  assert.strictEqual(state(root, 'q5').noEpic, true);
  const p = hook('prompt-submit', { session_id: 'q5', cwd: root, prompt: 'go on' });
  assert.match(hso(p).sessionTitle, /^UNFILED · spike a quick cache idea$/);
});

test('answering "Use epic FE" puts the thread on FE', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'q6', cwd: root, prompt: 'tidy the header spacing' });
  answer('q6', root, 'Use epic FE');
  assert.strictEqual(state(root, 'q6').epic, 'FE');
});

test('typing "not outer pale" works too, and the Linear guard still holds', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'q7', cwd: root, prompt: 'this is not outer pale work, just help me sort my photos' });
  assert.strictEqual(state(root, 'q7').outOfScope, true);
  const r = hook('pre-tool', { session_id: 'q7', cwd: root, tool_name: 'mcp__x__save_issue', tool_input: { title: 'x' } });
  assert.strictEqual(hso(r).permissionDecision, 'deny');
});

// ---------- review findings ----------
test('a passing "not Outer Pale" never unfiles a filed thread', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'r1', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' });
  hook('prompt-submit', { session_id: 'r1', cwd: root, prompt: 'the footer says "not Outer Pale approved", remove that string' });
  const st = state(root, 'r1');
  assert.strictEqual(st.epic, 'FE'); assert.strictEqual(st.issue, 'OUT-401'); assert.strictEqual(st.outOfScope, false);
});

test('a mention mid-sentence does not skip the question', () => {
  const root = project();
  const r = hook('prompt-submit', { session_id: 'r2', cwd: root, prompt: 'Fix the login bug where users see a not Outer-Pale account error' });
  assert.match(hso(r).additionalContext, /AskUserQuestion/);
  assert.strictEqual(state(root, 'r2').outOfScope, false);
});

test('a stood-aside thread is filed again only by an issue ID or "epic <CODE>"', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'r3', cwd: root, prompt: 'not outer pale, help with my CV' });
  hook('prompt-submit', { session_id: 'r3', cwd: root, prompt: 'make the FE section of my CV shorter' });
  assert.strictEqual(state(root, 'r3').outOfScope, true);
  hook('prompt-submit', { session_id: 'r3', cwd: root, prompt: 'actually move this to epic FE please' });
  assert.strictEqual(state(root, 'r3').epic, 'FE');
});

test('an answer naming only an issue does not set epic null', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'r4', cwd: root, prompt: 'tidy the header spacing' });
  const a = answer('r4', root, 'OUT-999 is the ticket');
  assert.doesNotMatch(JSON.stringify(a || {}), /epic null/);
  assert.strictEqual(state(root, 'r4').epic, null);
});

test('an unrelated AskUserQuestion is not read as the epic answer', () => {
  const root = project();
  hook('prompt-submit', { session_id: 'r5', cwd: root, prompt: 'tidy the header spacing' });
  hook('post-tool', { session_id: 'r5', cwd: root, tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Which team owns the header?' }], answers: { 'Which team owns the header?': 'the FE team' } } });
  assert.strictEqual(state(root, 'r5').epic, null);
});

test('promptText: bracketed harness prefixes, bare slash commands and unterminated tags', () => {
  assert.strictEqual(C.parsePrompt(C.promptText('[Local: C:\\x\\FE OUT-77] fix the nav'), reg, 'OUT').issue, null);
  assert.strictEqual(C.promptText('<command-name>/outerpale-devops:sweep</command-name>'), '');
  assert.strictEqual(C.promptText('/outerpale-devops:sweep'), '');
  assert.match(C.promptText('FE explain how <system-reminder> tags get parsed for OUT-12'), /OUT-12/);
});
