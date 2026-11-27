// Langfuse: on every Stop, send the turns this session added since the last
// Stop. One Langfuse session per Claude session, one trace per turn, a
// generation per model reply and a span per tool call, tagged with the epic,
// issue and workspace. The plugin's own events (epic chosen, "no epic", guard
// refusals) go in as Langfuse events. Uses the public ingestion API; fails open.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const C = require('./core');

const MAX_TEXT = 20000;
const BATCH = 100;
const TIMEOUT_MS = 5000;

function enabled(cfg) { const l = cfg.langfuse; return !!(l && l.host && l.publicKey && l.secretKey); }
function uid() { return crypto.randomUUID(); }
function cut(v) {
  if (v === undefined || v === null) return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…[cut]' : (typeof v === 'string' ? v : v);
}
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
}
function isPrompt(e) {
  if (e.type !== 'user' || e.isMeta || e.isSidechain || !e.message) return false;
  const c = e.message.content;
  return typeof c === 'string' ? !c.startsWith('<') : Array.isArray(c) && c.some(b => b.type === 'text') && !c.some(b => b.type === 'tool_result');
}

// Turns in the transcript lines from `from` onwards. A turn runs from one prompt to the next.
function turns(lines) {
  const out = [];
  let cur = null;
  const tools = {};
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain || !e.message) continue;
    if (isPrompt(e)) { cur = { prompt: textOf(e.message.content), start: e.timestamp, end: e.timestamp, gens: [], tools: [], reply: '' }; out.push(cur); continue; }
    if (!cur) continue;
    cur.end = e.timestamp || cur.end;
    const c = e.message.content;
    if (e.type === 'assistant') {
      const text = textOf(c);
      if (text) cur.reply = text;
      cur.gens.push({ model: e.message.model, usage: e.message.usage, text, at: e.timestamp });
      if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_use') { const t = { id: b.id, name: b.name, input: b.input, start: e.timestamp }; tools[b.id] = t; cur.tools.push(t); }
    } else if (e.type === 'user' && Array.isArray(c)) {
      for (const b of c) if (b.type === 'tool_result' && tools[b.tool_use_id]) {
        const t = tools[b.tool_use_id];
        t.output = typeof b.content === 'string' ? b.content : textOf(b.content) || b.content;
        t.end = e.timestamp; t.error = !!b.is_error;
      }
    }
  }
  return out;
}

function usageDetails(u) {
  if (!u) return undefined;
  const d = { input: u.input_tokens || 0, output: u.output_tokens || 0 };
  if (u.cache_read_input_tokens) d.cache_read_input_tokens = u.cache_read_input_tokens;
  if (u.cache_creation_input_tokens) d.cache_creation_input_tokens = u.cache_creation_input_tokens;
  return d;
}

// The ingestion batch for these turns and pending plugin events.
function buildBatch(cfg, input, st, list, firstTurn) {
  const full = cfg.langfuse.content !== 'metadata';
  const keep = v => (full ? cut(v) : undefined);
  const tags = ['outerpale-devops', st.scope || 'unscoped', st.ref].filter(Boolean);
  const meta = { scope: st.scope, ref: st.ref, workspace: cfg.workspaceName, team: cfg.team, cwd: input.cwd };
  const name = C.buildTitle(st) || 'session';
  const now = new Date().toISOString();
  const ev = (type, body) => ({ id: uid(), type, timestamp: now, body });
  const batch = [];
  let lastTrace = null;
  list.forEach((t, i) => {
    const traceId = `${input.session_id}-${firstTurn + i}`;
    lastTrace = traceId;
    batch.push(ev('trace-create', {
      id: traceId, name, sessionId: input.session_id, timestamp: t.start || now,
      input: keep(t.prompt), output: keep(t.reply), tags, metadata: meta,
    }));
    for (const g of t.gens) {
      batch.push(ev('generation-create', {
        id: uid(), traceId, name: 'assistant', model: g.model, startTime: g.at, endTime: g.at,
        usageDetails: usageDetails(g.usage), output: keep(g.text || undefined),
      }));
    }
    for (const tool of t.tools) {
      batch.push(ev('span-create', {
        id: uid(), traceId, name: tool.name, startTime: tool.start, endTime: tool.end || tool.start,
        input: keep(tool.input), output: keep(tool.output), level: tool.error ? 'ERROR' : 'DEFAULT',
      }));
    }
  });
  for (const e of st.events || []) {
    batch.push(ev('event-create', {
      id: uid(), traceId: lastTrace || `${input.session_id}-plugin`, name: e.name, startTime: e.at || now, metadata: e,
    }));
  }
  if (!lastTrace && (st.events || []).length) {
    batch.unshift(ev('trace-create', { id: `${input.session_id}-plugin`, name, sessionId: input.session_id, tags, metadata: meta }));
  }
  return batch;
}

async function post(cfg, batch) {
  const auth = Buffer.from(`${cfg.langfuse.publicKey}:${cfg.langfuse.secretKey}`).toString('base64');
  for (let i = 0; i < batch.length; i += BATCH) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(`${cfg.langfuse.host}/api/public/ingestion`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
        body: JSON.stringify({ batch: batch.slice(i, i + BATCH) }),
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error(`Langfuse ingestion returned ${r.status}`);
    } finally { clearTimeout(timer); }
  }
}

// Send what's new and advance st.lf; returns true when something was sent.
async function flush(cfg, input, st) {
  if (!enabled(cfg) || !input.session_id || !input.transcript_path) return false;
  let lines;
  try { lines = fs.readFileSync(input.transcript_path, 'utf8').split('\n'); } catch { return false; }
  const lf = st.lf || { line: 0, turns: 0 };
  const fresh = turns(lines.slice(lf.line));
  if (!fresh.length && !(st.events || []).length) return false;
  await post(cfg, buildBatch(cfg, input, st, fresh, lf.turns));
  // A transcript ending in a newline splits into a trailing ''; don't count it as read.
  const read = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  st.lf = { line: read, turns: lf.turns + fresh.length };
  st.events = [];
  return true;
}

module.exports = { flush, turns, buildBatch, enabled };
