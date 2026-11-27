'use strict';
process.env.OUTERPALE_SHARED_DIRS = ''; // never fall back to a real /mnt/project-files
// What outerpale-devops 0.3.0 adds: Outer-Pale only, a "no epic" mode, and Langfuse.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync, execFile } = require('child_process');
const C = require('../lib/core');

const RUN = path.join(__dirname, '..', 'hooks', 'run.js');
const LL = path.join(__dirname, '..', 'scripts', 'll.js');
const OUTERPALE = 'dca1918d-09ae-4f88-9f63-c6223b86893e';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'opd-'));
const hso = r => (r && r.hookSpecificOutput) || {};

function project() {
  const root = tmp();
  execFileSync('node', [LL, 'open-epic', 'FE', 'Frontend redesign', 'P-OUT-60', '--root', root, '--session', 'setup']);
  execFileSync('node', [LL, 'start-issue', 'OUT-401', 'Nav rail rebuild', '--root', root, '--session', 'setup']);
  return root;
}
// One fake home per test, so connector checks don't leak between tests.
function env(home, extra = {}) {
  const e = { ...process.env, HOME: home, USERPROFILE: home, LINEAR_API_KEY: '', LANGFUSE_HOST: '', LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '', ...extra };
  delete e.CLAUDE_PLUGIN_OPTION_ROOT; delete e.LINEAR_LINK_ROOT;
  return e;
}
function hook(event, input, home, extra) {
  const outp = execFileSync('node', [RUN, event], { input: JSON.stringify(input), env: { ...env(home, extra), CLAUDE_PROJECT_DIR: input.cwd } }).toString();
  return outp ? JSON.parse(outp) : null;
}
function hookAsync(event, input, home, extra) {
  return new Promise((resolve, reject) => {
    const p = execFile('node', [RUN, event], { env: { ...env(home, extra), CLAUDE_PROJECT_DIR: input.cwd } }, (err, stdout, stderr) => (err ? reject(err) : resolve({ stdout, stderr })));
    p.stdin.end(JSON.stringify(input));
  });
}

// ---------- the name and the workspace ----------
test('defaults: team OUT, the Outer-Pale workspace, and rules that say so', () => {
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_PLUGIN_OPTION_')) delete process.env[k];
    const cfg = C.config();
    assert.equal(cfg.team, 'OUT');
    assert.equal(cfg.workspaceId, OUTERPALE);
  } finally { process.env = saved; }
  const root = project();
  const ctx = hso(hook('session-start', { session_id: 'a1', cwd: root }, tmp())).additionalContext;
  assert.match(ctx, /^outerpale-devops: /);
  assert.match(ctx, /Outer-Pale workspace \(team OUT\) only/);
  assert.match(ctx, /say "no epic"/);
});

// ---------- the Linear workspace guard ----------
const LINEAR = 'mcp__0d1dd885-10c9-4b72-b788-6d4ee138b01a';
const PERSONAL = 'mcp__plugin_productivity_linear';
const wsResponse = (id, name, slug) => [{ type: 'text', text: JSON.stringify({ id, name, url: `https://linear.app/${slug}` }) }];

test('guard: an unchecked Linear connector cannot write, and is told to check its workspace', () => {
  const root = project(); const home = tmp();
  const r = hook('pre-tool', { session_id: 'g1', cwd: root, tool_name: `${LINEAR}__save_issue`, tool_input: { title: 'x', team: 'OUT' } }, home);
  assert.equal(hso(r).permissionDecision, 'deny');
  assert.match(hso(r).permissionDecisionReason, /get_workspace first/);
});

test('guard: after get_workspace shows Outer-Pale, writes go through; a personal workspace stays blocked', () => {
  const root = project(); const home = tmp();
  const ok = hook('post-tool', { session_id: 'g2', cwd: root, tool_name: `${LINEAR}__get_workspace`, tool_input: {}, tool_response: wsResponse(OUTERPALE, 'Outer-Pale', 'outer-pale') }, home);
  assert.match(hso(ok).additionalContext, /writes are allowed/);
  assert.equal(hook('pre-tool', { session_id: 'g2', cwd: root, tool_name: `${LINEAR}__save_issue`, tool_input: {} }, home), null);
  assert.equal(hook('pre-tool', { session_id: 'g2', cwd: root, tool_name: `${LINEAR}__delete_comment`, tool_input: {} }, home), null);

  const bad = hook('post-tool', { session_id: 'g2', cwd: root, tool_name: `${PERSONAL}__get_workspace`, tool_input: {}, tool_response: wsResponse('11111111-2222-4333-8444-555555555555', 'Harry personal', 'harry') }, home);
  assert.match(hso(bad).additionalContext, /will be refused/);
  const r = hook('pre-tool', { session_id: 'g2', cwd: root, tool_name: `${PERSONAL}__save_comment`, tool_input: {} }, home);
  assert.equal(hso(r).permissionDecision, 'deny');
  assert.match(hso(r).permissionDecisionReason, new RegExp(`Use ${LINEAR}__save_comment instead`));
  const st = JSON.parse(fs.readFileSync(path.join(root, '.linear-link/sessions/g2.json'), 'utf8'));
  assert.ok(st.events.some(e => e.name === 'linear-guard-blocked'), 'the refusal is kept for Langfuse');
});

test('guard: the unfiled policy does not soften it, and other connectors are left alone', () => {
  const root = project(); const home = tmp();
  const soft = { CLAUDE_PLUGIN_OPTION_POLICY: 'unfiled' };
  assert.equal(hso(hook('pre-tool', { session_id: 'g3', cwd: root, tool_name: `${LINEAR}__save_project`, tool_input: {} }, home, soft)).permissionDecision, 'deny');
  for (const t of ['mcp__gmail__delete_draft', 'mcp__calendar__delete_event', 'mcp__abc__delete_comment', `${LINEAR}__list_issues`, `${LINEAR}__get_issue`]) {
    assert.equal(hook('pre-tool', { session_id: 'g3', cwd: root, tool_name: t, tool_input: {} }, home), null, t);
  }
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf8')).hooks;
  const covers = (ev, name) => hooks[ev].some(h => new RegExp(`^(?:${h.matcher})$`).test(name));
  assert.ok(covers('PreToolUse', `${LINEAR}__save_issue`));
  assert.ok(covers('PreToolUse', `${LINEAR}__create_attachment`));
  assert.ok(covers('PostToolUse', `${LINEAR}__get_workspace`));
});

// A session whose state can be read but not saved: the hook throws on its first save.
function unsavable(root, sid) {
  const f = path.join(root, '.linear-link', 'sessions', `${sid}.json`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ epic: 'ZZ' }));   // an epic that's gone, so reconcile saves
  fs.chmodSync(f, 0o444);
}

test('guard: a hook error refuses Linear writes and names the error', () => {
  const root = project(); const home = tmp();
  hook('post-tool', { session_id: 'e1', cwd: root, tool_name: `${LINEAR}__get_workspace`, tool_input: {}, tool_response: wsResponse(OUTERPALE, 'Outer-Pale', 'outer-pale') }, home);
  unsavable(root, 'e1');
  const r = hook('pre-tool', { session_id: 'e1', cwd: root, tool_name: `${LINEAR}__save_issue`, tool_input: {} }, home);
  assert.equal(hso(r).permissionDecision, 'deny');
  assert.match(hso(r).permissionDecisionReason, /hook failed \(.*E(PERM|ACCES).*\)/);
});

test('guard: a hook error still lets non-Linear tools and Linear reads through', () => {
  const root = project(); const home = tmp();
  unsavable(root, 'e2');
  for (const t of ['Read', 'mcp__gmail__delete_draft', `${LINEAR}__get_issue`]) {
    assert.equal(hook('pre-tool', { session_id: 'e2', cwd: root, tool_name: t, tool_input: {} }, home), null, t);
  }
});

test('guard: input that will not parse still refuses a Linear write, and nothing else', () => {
  const run = raw => execFileSync('node', [RUN, 'pre-tool'], { input: raw, env: env(tmp()) }).toString();
  const r = JSON.parse(run(`{"tool_name":"${LINEAR}__save_issue","tool_input":`));
  assert.equal(hso(r).permissionDecision, 'deny');
  assert.match(hso(r).permissionDecisionReason, /hook failed/);
  assert.equal(run('{"tool_name":"Read","tool_input":'), '');
  assert.equal(run('null'), '');
});

test('guard: the workspace check runs before state work, so an unchecked connector gets its own refusal', () => {
  const root = project(); const home = tmp();
  unsavable(root, 'e3');
  const r = hook('pre-tool', { session_id: 'e3', cwd: root, tool_name: `${LINEAR}__save_issue`, tool_input: {} }, home);
  assert.equal(hso(r).permissionDecision, 'deny');
  assert.match(hso(r).permissionDecisionReason, /get_workspace first/);
});

// ---------- "no epic" ----------
test('no epic: saying so lifts the block, and outputs go to unfiled/', () => {
  const root = project(); const home = tmp();
  const r = hook('prompt-submit', { session_id: 'n1', cwd: root, prompt: 'no epic, just sketch a quick css grid idea' }, home);
  assert.match(hso(r).sessionTitle, /^UNFILED · /);
  assert.match(hso(r).additionalContext, /working without an epic/);
  assert.doesNotMatch(hso(r).additionalContext, /are refused until/);
  const w = p => hook('pre-tool', { session_id: 'n1', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, p) } }, home);
  assert.equal(w('unfiled/grid-idea.md'), null);
  assert.equal(hso(w('epics/FE-frontend-redesign/notes/plan.md')).permissionDecision, 'deny');
  assert.equal(hso(w('review.md')).permissionDecision, 'deny');
  assert.match(hso(w('review.md')).permissionDecisionReason, /write it in unfiled\//);

  fs.mkdirSync(path.join(root, 'unfiled'), { recursive: true });
  fs.writeFileSync(path.join(root, 'unfiled', 'grid.html'), '<title>Grid</title>');
  const pub = hook('pre-tool', { session_id: 'n1', cwd: root, tool_name: 'Artifact', tool_input: { file_path: path.join(root, 'unfiled', 'grid.html') } }, home);
  assert.match(hso(pub).permissionDecisionReason, /"UNFILED · Grid"/);
  fs.writeFileSync(path.join(root, 'unfiled', 'grid.html'), '<title>UNFILED · Grid</title>');
  assert.equal(hook('pre-tool', { session_id: 'n1', cwd: root, tool_name: 'Artifact', tool_input: { file_path: path.join(root, 'unfiled', 'grid.html') } }, home), null);
});

test('no epic: the block policy lets it through, and naming an epic later files the thread', () => {
  const root = project(); const home = tmp();
  const block = { CLAUDE_PLUGIN_OPTION_POLICY: 'block' };
  assert.equal(hook('prompt-submit', { session_id: 'n2', cwd: root, prompt: 'what does this regex do' }, home, block).decision, 'block');
  assert.notEqual(hook('prompt-submit', { session_id: 'n2', cwd: root, prompt: 'not in an epic please, what does this regex do' }, home, block)?.decision, 'block');
  const r = hook('prompt-submit', { session_id: 'n2', cwd: root, prompt: 'ok this is FE OUT-401 after all' }, home, block);
  assert.match(hso(r).sessionTitle, /^FE · OUT-401 · /);
  const w = p => hook('pre-tool', { session_id: 'n2', cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, p) } }, home);
  assert.equal(hso(w('unfiled/x.md')).permissionDecision, 'deny', 'unfiled/ is closed once filed');
  assert.equal(w('epics/FE-frontend-redesign/notes/plan.md'), null);
});

test('no epic: plain prompts mentioning epics are not mistaken for it', () => {
  for (const p of ['open an epic for the redesign', 'which epic is this in?', 'the epic is FE']) {
    assert.equal(C.parsePrompt(p, {}, 'OUT').noEpic, false, p);
  }
  for (const p of ['no epic', 'skip the epic for now', 'work unfiled', 'do this without an epic']) {
    assert.equal(C.parsePrompt(p, {}, 'OUT').noEpic, true, p);
  }
});

// ---------- Langfuse ----------
function langfuse() {
  const got = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', c => (b += c));
    req.on('end', () => { got.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(207, { 'content-type': 'application/json' }); res.end('{"successes":[],"errors":[]}'); });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, got, host: `http://127.0.0.1:${server.address().port}` })));
}
function transcriptFile(lines) {
  const f = path.join(tmp(), 't.jsonl');
  fs.writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return f;
}
const T0 = '2026-11-23T10:00:00.000Z';
const turn1 = [
  { type: 'user', timestamp: T0, message: { role: 'user', content: 'FE OUT-401 rebuild the nav rail' } },
  { type: 'assistant', timestamp: T0, message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'nav.tsx' } }] } },
  { type: 'user', timestamp: T0, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'export const Nav' }] } },
  { type: 'assistant', timestamp: T0, message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 20, output_tokens: 7 }, content: [{ type: 'text', text: 'Rebuilt.' }] } },
];

test('langfuse: each Stop sends only the new turns, tagged with epic and issue, plus plugin events', async () => {
  const lf = await langfuse();
  try {
    const root = project(); const home = tmp();
    const keys = { LANGFUSE_HOST: lf.host, LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' };
    hook('prompt-submit', { session_id: 's1', cwd: root, prompt: 'FE OUT-401 rebuild the nav rail' }, home, keys);
    const f = transcriptFile(turn1);
    await hookAsync('stop', { session_id: 's1', cwd: root, transcript_path: f }, home, keys);
    assert.equal(lf.got.length, 1);
    const first = lf.got[0];
    assert.equal(first.url, '/api/public/ingestion');
    assert.equal(first.auth, 'Basic ' + Buffer.from('pk-lf-test:sk-lf-test').toString('base64'));
    const by = t => first.body.batch.filter(e => e.type === t).map(e => e.body);
    const [trace] = by('trace-create');
    assert.equal(trace.id, 's1-0');
    assert.equal(trace.sessionId, 's1');
    assert.deepEqual(trace.tags, ['outerpale-devops', 'FE', 'OUT-401']);
    assert.equal(trace.metadata.workspace, 'Outer-Pale');
    assert.equal(trace.input, 'FE OUT-401 rebuild the nav rail');
    assert.equal(trace.output, 'Rebuilt.');
    assert.equal(by('generation-create').length, 2);
    assert.deepEqual(by('generation-create')[0].usageDetails, { input: 10, output: 5, cache_read_input_tokens: 100 });
    const [span] = by('span-create');
    assert.equal(span.name, 'Read');
    assert.equal(span.output, 'export const Nav');
    assert.ok(by('event-create').some(e => e.name === 'epic-chosen'));

    fs.appendFileSync(f, [
      { type: 'user', timestamp: T0, message: { role: 'user', content: 'now add tests' } },
      { type: 'assistant', timestamp: T0, message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'Added.' }] } },
    ].map(l => JSON.stringify(l)).join('\n') + '\n');
    await hookAsync('stop', { session_id: 's1', cwd: root, transcript_path: f }, home, keys);
    const second = lf.got[1].body.batch;
    const traces = second.filter(e => e.type === 'trace-create');
    assert.equal(traces.length, 1, 'only the new turn');
    assert.equal(traces[0].body.id, 's1-1');
    assert.ok(!second.some(e => e.type === 'event-create'), 'events are sent once');

    await hookAsync('stop', { session_id: 's1', cwd: root, transcript_path: f }, home, keys);
    assert.equal(lf.got.length, 2, 'nothing new, nothing sent');
  } finally { lf.server.close(); }
});

test('langfuse: metadata mode drops content; no keys or an unreachable server send nothing and never fail the hook', async () => {
  const lf = await langfuse();
  try {
    const root = project(); const home = tmp();
    const f = transcriptFile(turn1);
    const meta = { LANGFUSE_HOST: lf.host, LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk', CLAUDE_PLUGIN_OPTION_TELEMETRY_CONTENT: 'metadata' };
    await hookAsync('stop', { session_id: 'm1', cwd: root, transcript_path: f }, home, meta);
    const b = lf.got[0].body.batch;
    assert.ok(b.every(e => e.body.input === undefined && e.body.output === undefined), 'no prompt, reply or tool content');
    assert.equal(b.find(e => e.type === 'generation-create').body.usageDetails.input, 10, 'tokens still sent');

    await hookAsync('stop', { session_id: 'm2', cwd: root, transcript_path: f }, home, {});
    assert.equal(lf.got.length, 1, 'no keys: nothing sent');
    const dead = { LANGFUSE_HOST: 'http://127.0.0.1:1', LANGFUSE_PUBLIC_KEY: 'pk', LANGFUSE_SECRET_KEY: 'sk' };
    const r = await hookAsync('stop', { session_id: 'm3', cwd: root, transcript_path: f }, home, dead);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /Langfuse send failed/);
    assert.ok(!fs.existsSync(path.join(root, '.linear-link/sessions/m3.json')), 'a failed send advances nothing, so the next Stop retries it');
  } finally { lf.server.close(); }
});
