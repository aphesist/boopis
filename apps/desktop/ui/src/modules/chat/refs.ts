/* What a message points at, answered the same way in every conversation (the group room, a bot's own chat, Sessions, mods):
     a mention    click (or Enter) opens the bot's chat; hovering or focusing it for a moment shows its card (orb, name, role,
                  state, model; "Open chat" and, in a room, "Ask in this room"); the menu key (or a right click) opens a menu:
                  Open chat, Ask in this room, Settings
     a path       the markdown renderer draws code that reads as a path; the host says which exist (inside the workspace this
                  conversation has, or absolute and there) and only those become buttons. Click opens it in the default app;
                  the menu key: Open, Open in (the editors found), Show in folder, Copy path, Copy relative path, Attach to my
                  message
     a link       an `<a href>` the shell already hands to the system browser (`host/links.ts`)
   The surface owns its words: what "Ask in this room" and "Attach to my message" do is its own callback. */
import { emit } from '../../core/bus';
import { el, esc } from '../../core/dom';
import { ui } from '@boopis/ui';
import type { BotLike, MarkdownCtx, MdBot, MenuEntry, PathTarget } from '@boopis/ui';
import { data } from '../../data';
import type { ResolvedPath } from '../../data';

/** what a mention's card says about the bot */
export interface RefBot { bot: MdBot; state?: BotLike['state']; model?: string | null; where?: string | null }
export interface RefsOpts {
  /** the bot a mention names, for its card */
  bot(id: string): RefBot | null;
  /** "Ask in this room": the room puts `@handle` in its composer (absent where there is no room) */
  ask?: ((id: string) => void) | undefined;
  /** "Attach to my message" (absent where the composer takes no files) */
  attach?: ((p: ResolvedPath) => void) | undefined;
}

const sentence = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const HOVER_MS = 400;

/** the markdown context for a set of bots: a handle is the bot's handle (its id when it has none, as in a bot's own chat), case folded,
    as the engine resolves it (a room's member answers to its handle only); `@all` names them all */
export function mentionCtx(bots: readonly MdBot[], o: { everyone?: boolean; /** bots that exist but are not in this conversation */ outside?: readonly MdBot[] } = {}): MarkdownCtx {
  const by = new Map<string, MdBot>();
  for (const b of bots) { const h = (b.handle ?? b.id).toLowerCase(); if (!by.has(h)) by.set(h, b); }
  const away = new Map<string, MdBot>();
  for (const b of o.outside ?? []) away.set((b.handle ?? b.id).toLowerCase(), b);
  return { mention: (h) => by.get(h.toLowerCase()) ?? null, ...(o.everyone ? { everyone: bots } : {}), ...(away.size ? { outside: (h: string) => away.get(h.toLowerCase()) ?? null } : {}) };
}

/* ───────── paths ───────── */
const RESOLVED = new Map<string, ResolvedPath | null>();
const key = (p: string, roots: readonly string[]): string => roots.join('\u0001') + '\u0000' + p;
/** turn the path candidates under `root` into buttons where the host found them; nothing is drawn for the others */
export async function resolvePaths(root: ParentNode, roots: readonly string[]): Promise<void> {
  const src = data().files.paths; if (!src) return;
  const want = ui.markdown.candidates(root);
  if (!want.length) return;
  const ask = want.filter((p) => !RESOLVED.has(key(p, roots)));
  if (ask.length) {
    try {
      const got = await src.resolve(ask, roots);
      ask.forEach((p, i) => { RESOLVED.set(key(p, roots), got[i] ?? null); });
    } catch { return; }   /* the host could not say: the paths stay code */
  }
  const map = new Map<string, PathTarget>();
  for (const p of want) { const r = RESOLVED.get(key(p, roots)); if (r) map.set(p, { path: r.path, abs: r.abs, kind: r.kind }); }
  /* a path button is wider than its code: a conversation that was at its end stays there */
  const sc = (root as Element).closest?.('.ui-scroll') as HTMLElement | null | undefined;
  const atEnd = !!sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 48;
  ui.markdown.upgradePaths(root, map);
  if (sc && atEnd) sc.scrollTop = sc.scrollHeight;
  for (const b of root.querySelectorAll<HTMLElement>('.ui-path')) {
    const r = RESOLVED.get(key(b.dataset['path'] ?? '', roots));
    if (r?.rel != null) b.dataset['rel'] = r.rel;
  }
}
/** forget what the host said (a new turn may have made the files) */
export const forgetPaths = (): void => { RESOLVED.clear(); };

function pathOf(b: HTMLElement): ResolvedPath {
  return { path: b.dataset['path'] ?? '', abs: b.dataset['abs'] ?? '', kind: b.dataset['kind'] === 'folder' ? 'folder' : 'file', rel: b.dataset['rel'] ?? null };
}
function openPath(p: ResolvedPath, editor?: string | null): void {
  const src = data().files.paths; if (!src) return;
  src.open(p.abs, editor ?? null).catch((e: unknown) => { ui.toast('It did not open: ' + sentence(e)); });
}
async function pathMenu(b: HTMLElement, o: RefsOpts): Promise<void> {
  const src = data().files.paths; if (!src) return;
  const p = pathOf(b);
  let editors: readonly { id: string; name: string }[] = [];
  if (p.kind === 'file') { try { editors = await src.editors(); } catch { editors = []; } }
  const items: MenuEntry[] = [{ label: 'Open', value: 'open', icon: p.kind === 'folder' ? 'folder' : 'file' }];
  for (const e of editors) items.push({ label: 'Open in ' + e.name, value: 'editor:' + e.id });
  items.push({ label: 'Show in folder', value: 'reveal', icon: 'folder' }, '-', { label: 'Copy path', value: 'copy', icon: 'copy' });
  if (p.rel) items.push({ label: 'Copy relative path', value: 'copy-rel' });
  if (o.attach) items.push('-', { label: 'Attach to my message', value: 'attach', icon: 'plus' });
  ui.menu.open(b, items, {
    label: p.abs,
    onSelect: (v) => {
      if (v === 'open') openPath(p);
      else if (v.startsWith('editor:')) openPath(p, v.slice(7));
      else if (v === 'reveal') src.reveal(p.abs).catch((e: unknown) => { ui.toast('It could not be shown: ' + sentence(e)); });
      else if (v === 'copy') void ui.copyText(p.abs, 'Copied the path');
      else if (v === 'copy-rel' && p.rel) void ui.copyText(p.rel, 'Copied the path');
      else if (v === 'attach') o.attach?.(p);
    }
  });
}

/* ───────── mentions ───────── */
function openChat(id: string): void { ui.popover.close(false); emit('hx:bot-select', { id, from: 'mention' }); }
function openSettings(id: string): void { openChat(id); emit('hx:bot-settings', { open: true, from: 'mention' }); }
/** the card a mention shows: the bot's orb, its name and role, what it is doing and on which model, and the two ways to reach it */
export function mentionCard(r: RefBot, o: Pick<RefsOpts, 'ask'>): HTMLElement {
  const s = ui.botState({ ...r.bot, state: r.state ?? r.bot.state ?? 'idle' });
  const line = el('p', { class: 'ch-card__line' });
  line.insertAdjacentHTML('beforeend', '<span class="ch-card__state">' + (s.busy ? ui.html.dot('run', { size: 's' }) : s.attention ? ui.html.dot('attention', { size: 's' }) : '') + '<span>' + esc(s.word) + '</span></span>');
  if (r.model) line.insertAdjacentHTML('beforeend', '<span class="ch-card__model">' + ui.html.model(r.model, { size: 12, mono: false }) + '</span>');
  if (r.where) line.append(el('span', { text: 'in ' + r.where }));
  const acts = el('div', { class: 'ch-card__acts' });
  const open = ui.button({ label: 'Open chat', size: 's', variant: 'primary' });
  open.addEventListener('click', () => { openChat(r.bot.id); });
  acts.append(open);
  if (o.ask) { const ask = o.ask; const a = ui.button({ label: 'Ask in this room', size: 's' }); a.addEventListener('click', () => { ui.popover.close(false); ask(r.bot.id); }); acts.append(a); }
  const top = el('div', { class: 'ch-card__top' }, [ui.orb(r.bot, { size: 40, state: s.reaction === 'idle' ? 'idle' : (r.state ?? 'idle') }), el('div', { class: 'ch-card__who' }, [el('p', { class: 'ch-card__name', text: r.bot.name }), r.bot.role ? el('p', { class: 'ch-card__role', text: r.bot.role }) : null])]);
  return el('div', { class: 'ch-card' }, [top, line, acts]);
}
function mentionMenu(b: HTMLElement, id: string, o: RefsOpts): void {
  const items: MenuEntry[] = [{ label: 'Open chat', value: 'open', icon: 'bots' }];
  if (o.ask) items.push({ label: 'Ask in this room', value: 'ask', icon: 'at' });
  items.push({ label: 'Settings', value: 'settings', icon: 'gear' });
  ui.menu.open(b, items, { label: b.getAttribute('aria-label') ?? 'Mention', onSelect: (v) => { if (v === 'open') openChat(id); else if (v === 'ask') o.ask?.(id); else if (v === 'settings') openSettings(id); } });
}

/** answer mentions and paths under `root` (one set of listeners on the root) */
export function wireRefs(root: HTMLElement, o: RefsOpts): void {
  if (root.dataset['refs'] != null) return;
  root.dataset['refs'] = '';
  let timer = 0, carded: HTMLElement | null = null;
  const cancel = (): void => { window.clearTimeout(timer); timer = 0; };
  const showCard = (b: HTMLElement): void => {
    const id = b.dataset['mention'] ?? ''; const r = o.bot(id); if (!r) return;
    if (ui.popover.current && carded === b) return;
    carded = b;
    ui.popover.open(b, mentionCard(r, o), { label: r.bot.name, focus: false, onClose: () => { carded = null; } });
  };
  const later = (b: HTMLElement): void => { cancel(); timer = window.setTimeout(() => { if (b.isConnected && (b.matches(':hover') || b.matches(':focus-visible'))) showCard(b); }, HOVER_MS); };
  const target = (e: Event): HTMLElement | null => (e.target as Element | null)?.closest<HTMLElement>('.ui-mention[data-mention], .ui-path[data-abs]') ?? null;
  root.addEventListener('click', (e) => {
    const t = target(e); if (!t) return;
    e.preventDefault();
    cancel();
    if (t.matches('.ui-path')) { openPath(pathOf(t)); return; }
    const id = t.dataset['mention'] ?? '';
    if (id === '@all') return;
    openChat(id);
  });
  root.addEventListener('contextmenu', (e) => {
    const t = target(e); if (!t) return;
    e.preventDefault(); cancel();
    if (t.matches('.ui-path')) void pathMenu(t, o); else if (t.dataset['mention'] !== '@all') mentionMenu(t, t.dataset['mention'] ?? '', o);
  });
  root.addEventListener('keydown', (e) => {
    const t = target(e); if (!t || e.target !== t) return;
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault(); cancel();
      if (t.matches('.ui-path')) void pathMenu(t, o); else if (t.dataset['mention'] !== '@all') mentionMenu(t, t.dataset['mention'] ?? '', o);
    }
  });
  root.addEventListener('pointerover', (e) => { const t = target(e); if (t?.matches('.ui-mention') && t.dataset['mention'] !== '@all') later(t); });
  root.addEventListener('pointerout', (e) => { const t = target(e); if (t && !t.contains(e.relatedTarget as Node | null)) cancel(); });
  root.addEventListener('focusin', (e) => { const t = target(e); if (t?.matches('.ui-mention') && t.dataset['mention'] !== '@all') later(t); });
  root.addEventListener('focusout', () => { cancel(); });
}
