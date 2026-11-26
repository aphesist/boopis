/* What a composer's own controls do, the same in a bot's chat, a room and a new session (the kit's Composer fires the events,
   wire.ts): "+" asks the host for files and sets each into the text as a chip whose words are its "@" reference, the way a typed path is read; the mic
   dictates into the text through the provider's dictation until it is switched off; "@" names what the screen offers. The voice
   circle (the primary button with no text) is always there (owner, 26 November): it talks once a voice model is set up (the
   provider's `voice`), and until then says what it needs, with the way to Settings, Models (`voiceTool`). */
import { emit } from '../../core/bus';
import { kit, ui } from '@boopis/ui';
import type { ComposerChip, KitMentions, MarkdownCtx } from '@boopis/ui';
import { data } from '../../data';
import type { LaterFeature } from '../../data/types';

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

export interface ComposeTools {
  /** who dictation is for (the open bot), null in a session */ botId(): string | null;
  /** what "@" names here; none when the screen has nothing to name */ mentions?: KitMentions;
}
/** wire the composer living in `slot` (redrawn in place: the listeners are the slot's, the mention menu each drawn composer's) */
export function composeTools(slot: HTMLElement, o: ComposeTools): { drawn(): void; stop(): void } {
  let cancel: (() => void) | null = null;
  const text = (): HTMLElement | null => slot.querySelector<HTMLElement>('.k7-composer__text');
  const stop = (): void => { cancel?.(); cancel = null; slot.querySelector('[data-mic]')?.setAttribute('aria-pressed', 'false'); };
  slot.addEventListener('ui:add', () => {
    void data().files.pick('file').then((files) => {
      const c = text(); if (!c || !files.length) return;
      c.focus();
      /* each file is a chip in the text (owner, 25 November; the boards' reference chip, S32): its name shows, its words are the "@" reference the engine reads */
      for (const f of files) kit.composerInsertChip(c, kit.html.inlineChip({ kind: 'reference', text: '@' + f.name, words: '@' + (f.path ?? f.name), attrs: { 'data-tip': f.path ?? f.name } }));
    });
  });
  slot.addEventListener('ui:dictate', (e) => {
    if (!(e as CustomEvent<{ on: boolean }>).detail.on) { cancel?.(); cancel = null; return; }
    cancel?.();
    cancel = data().dictation.start({ botId: o.botId() }, (heard) => { const c = text(); if (c) kit.composerInsert(c, heard); });
  });
  const endTalk = voiceTool(slot, o.botId);
  return {
    drawn() { stop(); const c = slot.querySelector<HTMLElement>('.k7-composer'); if (c && o.mentions) kit.mentions(c, o.mentions); },
    stop() { stop(); endTalk(); }
  };
}
