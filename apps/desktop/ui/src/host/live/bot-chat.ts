/* A conversation with a bot: a session of the bot's own profile, on the bot's own link to the engine (the host's
   `connect(profile)`: the engine binds a ticket to one profile, so the session runs with that profile's soul, memory,
   skills and model, and its files are that profile's). Nothing here is the user's own session: the Sessions section
   never lists these, and the bot's room lists them as its recent sessions.

     a message               `session.create` (once, on the first message) and `prompt.submit`
     the reply               `message.start`, `message.delta`, `message.complete` on the bot's link, drawn as one message of the bot
     an approval             `approval.request` is a card in the thread; the decision is `approval.respond`
     stop                    `session.interrupt`
     a recent session        `session.resume`: its transcript is the thread and the next message continues it

   The thread is the one session open. Starting over (`fresh`) or opening another replaces it; a bot that is replying is
   never switched away from, because its reply would land in the wrong thread. */
import { logger } from '../../core/log';
import type { BotsEvent } from '../../data/provider';
import type { ApprovalMessage, NoteMessage, TextMessage, ThreadMessage } from '../../data/types';
import type { TranscriptMessage } from '../../vendor/hermes-shared/gateway-contract.generated';
import type { GatewayClient, GatewayEvent } from '../gateway';
import { clock } from '../map';
import { turnFailedWords } from './turn-failed';

const log = logger('bot-chat');

export interface ChatDeps {
  /** the bot's own link (opened once, shared with its routines) */
  link(botId: string): Promise<GatewayClient>;
  emit(ev: BotsEvent): void;
  now(): Date;
  /** what the bot is doing now, for its orb and its line: null when it is idle again. `attention` is what it waits on the user for. */
  live(botId: string, state: { state: string; activity: string; attention: string | null } | null): void;
  /** its recent sessions are read again (a session was made or grew) */
  changed(botId: string): void;
}

interface Chat {
  /** the engine's id for the open session on this link, null before the first message */
  gw: string | null;
  /** the id the session is kept under (what the recent sessions list names) */
  stored: string | null;
  thread: ThreadMessage[];
  running: { id: string; text: string } | null;
  /** the last `execution_generation` an event carried (an approval answer needs it) */
  generation: number;
  /** while a session is being made or opened: a second message waits for it */
  busy: Promise<unknown> | null;
  approvals: Map<string, { prompt: string; generation: number }>;
  /** the folder the session works in, as the engine said when it made or opened it (paths in its replies resolve there) */
  cwd: string | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** a stored transcript as a thread: the user's messages and the bot's own words; the tool rows between are not thread */
export function threadFrom(rows: readonly TranscriptMessage[], botId: string, prefix: string): ThreadMessage[] {
  const out: ThreadMessage[] = [];
  for (const r of rows) {
    if (r.role !== 'user' && r.role !== 'assistant') continue;
    if (r.display_kind === 'hidden') continue;
    const text = (r.text ?? (typeof r.content === 'string' ? r.content : '') ?? '').trim();
    if (!text) continue;
    out.push({ kind: 'text', id: prefix + out.length, who: r.role === 'user' ? 'you' : botId, t: r.timestamp ? clock(new Date(r.timestamp * 1000)) : '', text });
  }
  return out;
}

export function createBotChat(deps: ChatDeps) {
  const chats = new Map<string, Chat>();
  const byGw = new Map<string, string>();
  let counter = 0;
  const nextId = (p: string): string => p + (++counter).toString(36);
  const chat = (botId: string): Chat => {
    let c = chats.get(botId);
    if (!c) { c = { gw: null, stored: null, thread: [], running: null, generation: 0, busy: null, approvals: new Map(), cwd: null }; chats.set(botId, c); }
    return c;
  };
  const t = (): string => clock(deps.now());
  const add = (botId: string, c: Chat, m: ThreadMessage, streaming = false): void => { c.thread.push(m); deps.emit({ type: 'message', botId, message: m, streaming }); };
  const note = (botId: string, c: Chat, text: string): void => { const m: NoteMessage = { kind: 'note', id: nextId('n'), who: 'app', t: t(), text }; add(botId, c, m); };
  const bind = (botId: string, c: Chat, gw: string, stored: string | null): void => { if (c.gw) byGw.delete(c.gw); c.gw = gw; c.stored = stored ?? gw; byGw.set(gw, botId); };

  /* ───────── the user's side ───────── */
  async function ensureSession(botId: string, c: Chat): Promise<string> {
    if (c.gw) return c.gw;
    const link = await deps.link(botId);
    /* a second message sent while the session is being made finds it made */
    if (c.gw) return c.gw;
    const res = await link.requestRaw('session.create', { source: 'gui' }) as { session_id: string; stored_session_id?: string; info?: { cwd?: unknown } };
    bind(botId, c, res.session_id, res.stored_session_id ?? null);
    if (typeof res.info?.cwd === 'string' && res.info.cwd) c.cwd = res.info.cwd;
    return res.session_id;
  }

  function send(botId: string, text: string, via: 'bots' | 'dock'): void {
    const c = chat(botId);
    const m: TextMessage = { kind: 'text', id: nextId('m'), who: 'you', t: t(), text, via };
    add(botId, c, m);
    deps.emit({ type: 'run', botId, running: true });
    deps.live(botId, { state: 'thinking', activity: '', attention: null });
    const go = (async () => {
      if (c.busy) await c.busy.catch(() => undefined);
      const gw = await ensureSession(botId, c);
      const link = await deps.link(botId);
      await link.requestRaw('prompt.submit', { session_id: gw, text, submission_id: 'sub-' + crypto.randomUUID() });   /* the gateway requires submission_id; the vendored contract does not list it yet */
    })();
    c.busy = go;
    go.then(() => { deps.changed(botId); }, (e: unknown) => {
      log.error('the message to ' + botId + ' was not accepted', e);
      if (!c.running) { deps.emit({ type: 'run', botId, running: false }); deps.live(botId, null); }
      note(botId, c, 'The message was not sent: ' + why(e));
    }).finally(() => { if (c.busy === go) c.busy = null; });
  }

  function stop(botId: string): boolean {
    const c = chats.get(botId);
    if (!c?.gw || (!c.running && !c.busy)) return false;
    const gw = c.gw;
    void deps.link(botId).then((l) => l.request('session.interrupt', { session_id: gw })).catch((e: unknown) => { log.warn('could not stop ' + botId, e); });
    return true;
  }

  function decide(botId: string, messageId: string, decision: 'approved' | 'denied'): void {
    const c = chats.get(botId);
    const m = c?.thread.find((x): x is ApprovalMessage => x.kind === 'approval' && x.id === messageId);
    const route = c?.approvals.get(messageId);
    if (!c || !m || !route || !c.gw || m.resolved) return;
    const gw = c.gw;
    void deps.link(botId)
      .then((l) => l.requestRaw('approval.respond', { session_id: gw, execution_generation: route.generation, prompt_id: route.prompt, choice: decision === 'approved' ? 'once' : 'deny' }))   /* the canonical shape the main provider uses */
      .then(() => { settled(botId, c, messageId, decision); })
      .catch((e: unknown) => { log.error('the answer was not delivered', e); note(botId, c, 'Your answer did not reach ' + botId + ': ' + why(e)); });
  }
  function settled(botId: string, c: Chat, messageId: string, decision: 'approved' | 'denied'): void {
    const i = c.thread.findIndex((x) => x.id === messageId);
    const m = c.thread[i];
    if (!m || m.kind !== 'approval' || m.resolved) return;
    const at = t();
    c.thread[i] = { ...m, resolved: decision, resolvedAt: at };
    c.approvals.delete(messageId);
    deps.emit({ type: 'message-resolved', botId, messageId, resolved: decision, resolvedAt: at });
    if (![...c.approvals.keys()].length) deps.live(botId, c.running ? { state: 'working', activity: '', attention: null } : null);
  }

  /* ───────── the bot's side: events on its link ───────── */
  /* A message another surface said into this conversation (the local API, docs/LOCAL-API.md). The engine sends a window nothing
     for a message that was submitted elsewhere, so the host says it (`connection.said`, before the engine can start the reply) and
     the chat draws it as the owner's own message, with nothing of where it came from. Its reply then arrives as any reply does.
     A conversation that is not open here shows the message when it is opened, as before. */
  function said(botId: string, ev: GatewayEvent): boolean {
    const c = chats.get(botId);
    const gw = ev.session_id ?? '';
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const stored = str(p['stored_session_id']);
    if (!c || !gw) return false;
    const here = byGw.get(gw) === botId;
    /* the same conversation under another live id (the engine opened it again): follow it, unless a reply is being written */
    if (!here && !(stored && c.stored === stored && !c.running)) return false;
    if (!here) bind(botId, c, gw, stored);
    if (ev.type === 'connection.said_failed') {
      if (!c.running) { deps.emit({ type: 'run', botId, running: false }); deps.live(botId, null); }
      note(botId, c, str(p['reason']) || 'A message to ' + botId + ' was not sent.');
      return true;
    }
    const text = str(p['text']);
    if (!text) return true;
    const m: TextMessage = { kind: 'text', id: nextId('m'), who: 'you', t: t(), text };
    add(botId, c, m);
    deps.emit({ type: 'run', botId, running: true });
    deps.live(botId, { state: 'thinking', activity: '', attention: null });
    return true;
  }

  function onEvent(botId: string, ev: GatewayEvent): boolean {
    if (ev.type === 'connection.said' || ev.type === 'connection.said_failed') return said(botId, ev);
    const mine = ev.session_id ? byGw.get(ev.session_id) : undefined;
    if (mine !== botId) return false;
    const c = chat(botId);
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    if (typeof ev.execution_generation === 'number') c.generation = ev.execution_generation;
    const start = (): { id: string; text: string } => {
      if (c.running) return c.running;
      const m: TextMessage = { kind: 'text', id: nextId('m'), who: botId, t: t(), text: '' };
      c.running = { id: m.id, text: '' };
      add(botId, c, m, true);
      deps.emit({ type: 'run', botId, running: true });
      deps.live(botId, { state: 'thinking', activity: '', attention: null });
      return c.running;
    };
    switch (ev.type) {
      case 'message.start': start(); break;
      case 'tool.start': {
        start();
        deps.live(botId, { state: 'working', activity: str(p['name']) || str(p['tool_name']), attention: null });
        break;
      }
      case 'message.delta': {
        const r = start();
        const d = str(p['text']);
        if (!d) break;
        r.text += d;
        deps.live(botId, { state: 'speaking', activity: '', attention: null });
        patch(botId, c, r.id, r.text);
        deps.emit({ type: 'message-text', botId, messageId: r.id, text: r.text });
        break;
      }
      case 'message.complete': {
        const r = start();
        const text = typeof p['text'] === 'string' ? p['text'] : r.text;
        const outcome = typeof p['outcome'] === 'string' ? p['outcome'] : 'completed';
        c.running = null;
        deps.emit({ type: 'run', botId, running: false });
        deps.live(botId, null);
        if (p['status'] === 'error') {
          /* a failed turn: the engine's own sentence never shows (ADR-0031). What the bot said before it failed stays; a reply that
             is only the engine's error text goes, and the failure is said in boopis's words */
          const raw = str(p['error']) || str(p['failure_reason']) || text;
          const own = text.trim() && text.trim() !== raw.trim() && !text.trim().startsWith('⚠');
          if (own) { patch(botId, c, r.id, text); deps.emit({ type: 'message-end', botId, messageId: r.id, text }); }
          else c.thread = c.thread.filter((m) => m.id !== r.id);
          c.thread.push({ kind: 'note', id: nextId('n'), who: 'app', t: t(), text: turnFailedWords(botId, raw, str(p['failure_reason']) || null) });
          deps.emit({ type: 'thread', botId, messages: [...c.thread] });
          deps.changed(botId);
          break;
        }
        patch(botId, c, r.id, text);
        deps.emit({ type: 'message-end', botId, messageId: r.id, text });
        if (outcome !== 'completed' && !text.trim()) note(botId, c, 'The reply was stopped.');
        deps.changed(botId);
        break;
      }
      case 'approval.request': {
        const id = str(p['prompt_id']);
        if (!id) break;
        const command = str(p['command']), what = str(p['description']);
        const mid = 'ap-' + id;
        if (c.thread.some((x) => x.id === mid)) break;
        const gen = typeof p['execution_generation'] === 'number' ? p['execution_generation'] : c.generation;
        c.approvals.set(mid, { prompt: id, generation: gen });
        const m: ApprovalMessage = { kind: 'approval', id: mid, who: botId, t: t(), data: { id: mid, title: command || what || 'Approval needed', quote: command, meta: what, from: botId, item: [] } };
        add(botId, c, m);
        deps.live(botId, { state: 'needs', activity: '', attention: 'approval' });
        break;
      }
      case 'approval.settled': {
        const id = str(p['prompt_id']);
        settled(botId, c, 'ap-' + id, 'approved');   /* settled elsewhere or here; the ledger says who */
        break;
      }
      default: return true;
    }
    return true;
  }
  const patch = (botId: string, c: Chat, id: string, text: string): void => {
    const i = c.thread.findIndex((x) => x.id === id);
    const m = c.thread[i];
    if (m && m.kind === 'text') c.thread[i] = { ...m, text };
    void botId;
  };

  /* ───────── which session is the thread ───────── */
  async function open(botId: string, sessionId: string): Promise<void> {
    const c = chat(botId);
    if (c.running || c.busy) throw new Error('Wait for ' + botId + ' to finish its reply, or stop it, before opening another session.');
    const link = await deps.link(botId);
    const res = await link.requestRaw('session.resume', { session_id: sessionId }) as { session_id: string; stored_session_id?: string | null; messages?: TranscriptMessage[]; info?: { cwd?: unknown } };
    if (typeof res.info?.cwd === 'string' && res.info.cwd) chat(botId).cwd = res.info.cwd;
    bind(botId, c, res.session_id, res.stored_session_id ?? sessionId);
    c.approvals.clear();
    c.thread = threadFrom(res.messages ?? [], botId, 'h' + sessionId.slice(-6) + ':');
    deps.emit({ type: 'thread', botId, messages: [...c.thread] });
  }
  function fresh(botId: string): void {
    const c = chat(botId);
    if (c.running || c.busy) return;
    if (c.gw) byGw.delete(c.gw);
    c.gw = null; c.stored = null; c.thread = []; c.approvals.clear();
    deps.emit({ type: 'thread', botId, messages: [] });
  }

  return {
    send, stop, decide, open, fresh, onEvent,
    current: (botId: string): string | null => chats.get(botId)?.stored ?? null,
    thread: (botId: string): readonly ThreadMessage[] => chats.get(botId)?.thread ?? [],
    running: (botId: string): boolean => !!chats.get(botId)?.running,
    /** the folder the bot's session works in, when the engine has said */
    workspace: (botId: string): string | null => chats.get(botId)?.cwd ?? null,
    /** a bot that went (archived, deleted): nothing of it is kept */
    forget(botId: string): void { const c = chats.get(botId); if (c?.gw) byGw.delete(c.gw); chats.delete(botId); }
  };
}
export type BotChat = ReturnType<typeof createBotChat>;
