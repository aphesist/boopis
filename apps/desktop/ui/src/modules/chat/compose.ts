/* What a composer's own controls do, the same in a bot's chat, a room, the dock's card and a new session (the kit's Composer fires the
   events, wire.ts and compose.ts): "+" asks the host for files and sets each into the text as a chip whose words are its "@" reference,
   the way a typed path is read; a file dropped on the composer or pasted into it becomes the same chip (`composerFiles`, which a started
   session uses too); the mic dictates into the text through the provider's dictation until it is switched off or let go, and the
   bot's orbs listen meanwhile (with no speech model set up the provider has no dictation: the mic then says what it needs, `micTool`);
   "@" names what the screen offers. The voice
   circle (the primary button with no text) is always there (owner, 26 November): it talks once a voice model is set up (the
   provider's `voice`), and until then says what it needs, with the way to Settings, Models (`voiceTool`). */
import { emit } from '../../core/bus';
import { kit, ui } from '@boopis/ui';
import { REST_REACTION, restReact } from '@boopis/ui';
import type { ComposerChip, KitMentions, MarkdownCtx } from '@boopis/ui';
import { data } from '../../data';
import type { Attached, LaterFeature } from '../../data/types';

/** the mentions a draft holds, each as the chip the sent message will draw (the kit's InlineChip with its words): a bot's orb and name
    in its colour, the room's stack for @all, a bot that is not here muted. `ctx` is the context the conversation draws its messages with */
export function mentionChips(text: string, ctx: MarkdownCtx): ComposerChip[] {
  return ui.markdown.spans(text, ctx).map((s) => {
    const t = s.target, words = s.text;
    const html = t.kind === 'you' ? kit.html.inlineChip({ kind: 'you', words })
      : t.kind === 'all' ? kit.html.inlineChip({ kind: 'mention', text: words, members: t.members, words })
      : kit.html.inlineChip({ kind: 'mention', bot: t.bot, words, ...(t.kind === 'out' ? { out: true, attrs: { 'data-tip': t.bot.name + ' ' + (ctx.outsideNote ?? "isn't in this room") } } : { colour: t.bot.color ?? undefined }) });
    return { at: s.at, text: words, html };
  });
}
/** whether a feature the boards draw and no build does yet is switched on (the provider's `info.later`: a lab fixture's alone). A control
    is built against this and is not shown while it says no: a thing shows only once it exists */
export const later = (f: LaterFeature): boolean => data().info.later?.has(f) ?? false;

/** no voice model is set up yet: a composer's voice circle says so (`ComposerOpts.voiceSetup`) */
export const voiceNeedsSetup = (): boolean => !data().voice;
/** what the voice circle does, in every composer (the kit fires ui:voice when it is pressed with no text): with a voice model set up
    it starts talking (the provider's `voice`; pressed again, it ends); with none it starts nothing and opens a small Notice at the
    circle that says so, whose one action opens Settings at Models. Live voice itself is not built here. Returns what ends a talk */
export function voiceTool(slot: HTMLElement, botId: () => string | null): () => void {
  let end: (() => void) | null = null;
  const stop = (): void => { end?.(); end = null; };
  slot.addEventListener('ui:voice', () => {
    const v = data().voice;
    if (v) { if (end) stop(); else end = v.start({ botId: botId() }); return; }
    const at = slot.querySelector<HTMLElement>('.k7-composer [data-send]');
    if (at) kit.openNotice(at, { icon: 'waveform', title: 'Voice needs a voice model', text: '', action: 'Set up voice', onAction: () => { emit('hx:open-settings', { section: 'models', from: 'voice' }); } });
  });
  return stop;
}

/** no speech model is set up yet, so nothing can hear a dictation: a composer's mic says so (`ComposerOpts.micSetup`) */
export const micNeedsSetup = (): boolean => !data().dictation;
/** what the mic says when it is pressed, held or keyed with no speech model (the kit fires ui:dictate-setup and starts nothing): the same
    Notice as the voice circle's, at the mic, whose one action opens Settings at Models (the lead, 26 November). Transcription itself
    is not built here */
export const MIC_NEEDS = 'Dictation needs a speech model';
export function micTool(slot: HTMLElement): void {
  slot.addEventListener('ui:dictate-setup', () => {
    const at = slot.querySelector<HTMLElement>('.k7-composer [data-mic]');
    if (at) kit.openNotice(at, { icon: 'mic', title: MIC_NEEDS, text: '', action: 'Set up voice', onAction: () => { emit('hx:open-settings', { section: 'models', from: 'dictation' }); } });
  });
}

/* ───────── files dropped on a composer or pasted into it ───────── */
/** a file the page was handed (its own drop, a paste): its name and size. The page is told no place on disk */
const fromPage = (f: File): Attached => ({ name: f.name, kind: f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) ? 'image' : 'file', bytes: f.size });
/** the composers that take files, each with what it makes of them; the host's drags are heard once for all of them */
const TAKERS = new Set<{ slot: WeakRef<HTMLElement>; add: (list: readonly Attached[]) => void }>();
let hostDrags: (() => void) | null = null, dragSource: unknown = null;
function hearHostDrags(): void {
  const drops = data().files.drops;
  if (dragSource === drops) return;
  hostDrags?.(); hostDrags = null; dragSource = drops;
  if (!drops) return;
  hostDrags = drops.subscribe((ev) => {
    /* the composer under the pointer: the one whose box the point is in, the topmost where two overlap (the dock's card over a session's) */
    const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(ev.x, ev.y) : null;
    let over: { slot: HTMLElement; add: (list: readonly Attached[]) => void } | null = null;
    for (const t of [...TAKERS]) {
      const slot = t.slot.deref();
      if (!slot) { TAKERS.delete(t); continue; }
      /* a composer that is not on the page, or stepped aside (the session's under an open dock), takes nothing */
      if (!slot.isConnected || (typeof slot.checkVisibility === 'function' && !slot.checkVisibility({ opacityProperty: true, visibilityProperty: true }))) continue;
      const r = slot.getBoundingClientRect(), inside = ev.x >= r.left && ev.x <= r.right && ev.y >= r.top && ev.y <= r.bottom && r.width > 0;
      const mine = inside && (!hit || slot.contains(hit) || !hit.closest('.k7-composer'));
      if (mine && (!over || over.slot.contains(slot))) over = { slot, add: t.add };
      if (!mine || ev.phase === 'leave' || ev.phase === 'drop') kit.composerDropping(slot, false);
    }
    if (!over) return;
    if (ev.phase === 'drop') { if (ev.attachments.length) over.add(ev.attachments); } else if (ev.phase !== 'leave') kit.composerDropping(over.slot, true);
  });
}
/** files reach the composer living in `slot` three ways besides "+": dropped on it in the page (the kit's `ui:files`), pasted into its
    text (the same event), or dropped on it in the desktop app, whose host reports the drag and the files with their paths. Each way
    ends in `add`, which makes of them what "+" does there. In the live app a file with no place on disk (a pasted picture) cannot
    be read by the engine: it is not attached, and the app says so */
export function composerFiles(slot: HTMLElement, add: (list: readonly Attached[]) => void): void {
  slot.addEventListener('ui:files', (e) => {
    const all = (e as CustomEvent<{ files: readonly File[] }>).detail.files.map(fromPage);
    const usable = data().info.live ? all.filter((a) => a.path) : all;
    if (usable.length < all.length) kit.notify(NO_PLACE);
    if (usable.length) add(usable);
  });
  TAKERS.add({ slot: new WeakRef(slot), add });
  hearHostDrags();
}
/** what the app says of a pasted file it cannot attach */
export const NO_PLACE = 'That file has no place on disk yet. Save it, then add it with +.';

/* ───────── the bot's orbs listen while you dictate ───────── */
/** every orb of `id` on the page listens (`on`), or goes back to what it was: a bot on a rest surface (the rail, the sidebar) comes out of
    its pose and returns to it. The dock keeps its own orbs (it follows its bots' states itself) */
function orbsListen(id: string | null, on: boolean, was: Map<Element, string | null>): void {
  if (on && id) {
    for (const o of document.querySelectorAll('.ui-orb[data-bot="' + id.replace(/["\\]/g, '') + '"] > orb-avatar')) {
      if (o.closest('#hx-dock') || was.has(o)) continue;
      was.set(o, o.getAttribute('reaction'));
      if (o.parentElement?.hasAttribute('data-orb-rest')) restReact(o, 'listening'); else o.setAttribute('reaction', 'listening');
    }
    return;
  }
  for (const [o, r] of was) {
    if (o.getAttribute('reaction') !== 'listening') continue;   /* something else changed it meanwhile: it keeps that */
    if (o.parentElement?.hasAttribute('data-orb-rest')) restReact(o, !r || r === REST_REACTION ? 'idle' : r); else if (r === null) o.removeAttribute('reaction'); else o.setAttribute('reaction', r);
  }
  was.clear();
}

export interface ComposeTools {
  /** who dictation is for (the open bot), null in a session */ botId(): string | null;
  /** what "@" names here; none when the screen has nothing to name */ mentions?: KitMentions;
}
/** wire the composer living in `slot` (redrawn in place: the listeners are the slot's, the mention menu each drawn composer's) */
export function composeTools(slot: HTMLElement, o: ComposeTools): { drawn(): void; stop(): void } {
  let cancel: (() => void) | null = null;
  const text = (): HTMLElement | null => slot.querySelector<HTMLElement>('.k7-composer__text');
  const was = new Map<Element, string | null>();
  const hush = (): void => { cancel?.(); cancel = null; orbsListen(null, false, was); };
  const stop = (): void => { hush(); slot.querySelector('[data-mic]')?.setAttribute('aria-pressed', 'false'); };
  /* each file is a chip in the text (owner, 25 November; the boards' reference chip, S32): its name shows, its words are the "@" reference the engine reads */
  const addFiles = (files: readonly Attached[]): void => {
    const c = text(); if (!c || !files.length) return;
    c.focus();
    for (const f of files) kit.composerInsertChip(c, kit.html.inlineChip({ kind: 'reference', text: '@' + f.name, words: '@' + (f.path ?? f.name), attrs: { 'data-tip': f.path ?? f.name } }));
  };
  slot.addEventListener('ui:add', () => { void data().files.pick('file').then(addFiles); });
  composerFiles(slot, addFiles);
  slot.addEventListener('ui:dictate', (e) => {
    hush();
    if (!(e as CustomEvent<{ on: boolean }>).detail.on) return;
    const hear = data().dictation;
    if (!hear) return;   /* the kit's mic does not switch on without one (`micSetup`) */
    cancel = hear.start({ botId: o.botId() }, (heard) => { const c = text(); if (c) kit.composerInsert(c, heard); });
    orbsListen(o.botId(), true, was);
  });
  micTool(slot);
  const endTalk = voiceTool(slot, o.botId);
  return {
    drawn() { stop(); const c = slot.querySelector<HTMLElement>('.k7-composer'); if (c && o.mentions) kit.mentions(c, o.mentions); },
    stop() { stop(); endTalk(); }
  };
}
