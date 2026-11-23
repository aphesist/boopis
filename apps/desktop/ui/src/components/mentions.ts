/* "@" in a composer: a mention says whom a message is for. One machinery for every composer that can address someone: the session's
   models (one message to one model, ADR-0036), a group room's members and a bot's teammates (the engine's own `@handle`). Each surface
   hands the composer a `MentionSource` (who can be named, how a name being typed is read, what a pick writes, the mentions a text
   holds); the composer wires it (`ui.composer({ mentions })`) and draws the chips.
     typing    "@" at the start of a word opens the source's list as suggestions, never as a picker that takes the keyboard: the caret
               stays in the text and typing goes on into it. The list closes as soon as what follows the "@" cannot become a name
               (`query`: "@@", "@ 5pm", a space after the name) or names nobody it lists (`best`), so nothing typed is ever lost
     picking   Enter or Tab takes the entry the typed letters name (`best`; with none, Enter sends as usual); Down or Up moves into the
               list, where Enter picks and Esc gives the caret back where it was; a click on a row picks it. A pick writes the name
               and a space after the "@", one edit the composer's undo keeps
     the chip  a finished mention is drawn as a chip in the text (`find`, the composer's marks): one unit for the caret, one Backspace
               takes it out, a click on it (or Alt+Down beside it) opens the list to change it or remove it
   What the text says is always the plain words: a chip is drawn over them and the send carries them exactly as typed. Places are kept
   as character offsets, never as DOM ranges, because the composer draws its text again under them. */
import { listbox } from './select';
import type { SelectEntry, SelectOption } from './select-html';

/** the value of the list's first row when it was opened on a chip */
export const REMOVE_MENTION = '__remove-mention';

/** a mention in a text, drawn as a chip: where it starts, its exact words, and how it looks (`html`: trusted markup whose text is
    exactly `text`; without it the words alone), with a class for the chip and a tooltip */
export interface MentionMark { at: number; text: string; kind: string; cls?: string | undefined; html?: string | undefined; tip?: string | undefined }
export interface MentionSource {
  /** the list's name, read as it opens ("Answer this message with", "Bring in") */
  label: string;
  /** the quiet line under the list: what a pick does */
  foot?: (() => string | undefined) | undefined;
  /** the name being typed, from the text before the caret: where its "@" is and the letters after it, or null when what follows the
      "@" cannot become a name */
  query(before: string): { at: number; query: string } | null;
  /** the rows of the list */
  entries(): SelectEntry[];
  /** the row typed letters name, for Enter and Tab; null names nothing (Enter then sends) */
  best(query: string): string | null;
  /** what a picked row writes after the "@", or null for a row that writes nothing */
  write(value: string): string | null;
  /** the mentions a text holds, each drawn as a chip */
  find(text: string): MentionMark[];
}
/** what the machinery needs of its composer: the text as characters, where the caret is, and edits the undo keeps */
export interface MentionHost {
  root: HTMLElement; input: HTMLElement; box: HTMLElement;
  value(): string;
  caret(): number | null;
  setCaret(at: number): void;
  /** the text from `start` to `end` becomes `text`, the caret after it */
  replace(start: number, end: number, text: string): void;
  /** where a node of the text starts, in characters */
  offsetOf(node: Node): number;
}
export interface Mentions {
  /** the list, as suggestions for the name being typed, or on a chip (`over`) to change or remove it */
  open(over: HTMLElement | null): void;
  /** the suggestions are open: the composer leaves its text alone until they close */
  readonly suggesting: boolean;
}

export function wireMentions(h: MentionHost, src: MentionSource): Mentions {
  let suggesting = false, menuNode: HTMLElement | null = null;
  /** where the caret was last in the text while the list is open: the list gives it back there */
  let caretAt: number | null = null;
  /** the name being typed at the caret: its "@", the letters after it, and the caret */
  function typed(): { at: number; query: string; end: number } | null {
    const s = getSelection(), end = h.caret();
    if (!s || !s.isCollapsed || end == null) return null;
    const q = src.query(h.value().slice(0, end));
    return q ? { ...q, end } : null;
  }
  /** the "@" just typed starts a word: not the middle of an address or a file mention */
  function atWordStart(): boolean {
    const end = h.caret(); if (end == null || end < 1) return false;
    const before = h.value().slice(0, end - 1);
    return before === '' || /[\s([{]$/.test(before);
  }
  /** a name being typed that can still become one of the list's: letters that name nobody close it ("@kai." in a room, a typo) */
  const live = (t: { query: string } | null): boolean => !!t && (!t.query || src.best(t.query) != null);
  /** the letters after the "@" become the picked name and a space */
  function take(value: string, t: { at: number; end: number }): void {
    const w = src.write(value); if (!w) return;
    h.replace(t.at + 1, t.end, w + ' ');
  }
  h.input.addEventListener('input', (e) => {
    const ie = e as InputEvent;
    if (ie.isComposing) return;
    if (suggesting) { caretAt = h.caret(); if (!live(typed())) listbox.close(false); return; }
    if (ie.data === '@' && atWordStart()) requestAnimationFrame(() => { if (!suggesting && live(typed())) open(null, true); });
  });
  /* before the composer's own keys (Enter sends): capture on the composer runs first */
  h.root.addEventListener('keydown', (e) => {
    if (!suggesting || e.isComposing || !h.input.contains(document.activeElement)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const opts = [...(menuNode?.querySelectorAll<HTMLElement>('.ui-option:not([aria-disabled="true"])') ?? [])];
      const to = e.key === 'ArrowDown' ? opts[0] : opts[opts.length - 1];
      if (!to) return;
      e.preventDefault(); e.stopImmediatePropagation();
      caretAt = h.caret();
      to.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const t = typed(), pick = t ? src.best(t.query) : null;
      listbox.close(false);
      if (pick && t) { e.preventDefault(); e.stopImmediatePropagation(); take(pick, t); }
    }
  }, true);

  /* the list opens above the composer's box. The layer marks its anchor expanded, which a text box may not carry, so the anchor is a
     quiet layer over the box (never focused, never in the reading order) */
  function anchor(): HTMLElement {
    let a = h.box.querySelector<HTMLElement>(':scope > .ui-composer__anchor');
    if (!a) { a = document.createElement('span'); a.className = 'ui-composer__anchor'; a.setAttribute('role', 'combobox'); a.setAttribute('aria-hidden', 'true'); h.box.append(a); }
    a.setAttribute('aria-label', src.label);
    return a;
  }
  function open(over: HTMLElement | null, suggest = false): void {
    const entries: SelectEntry[] = [...(over ? [{ value: REMOVE_MENTION, label: 'Remove the mention', icon: 'close' } satisfies SelectOption] : []), ...src.entries()];
    /* the caret is where the "@" is, which is not always the end: it is put back there, not moved to the end */
    caretAt = h.caret();
    const back = (): void => { h.input.focus(); if (caretAt != null) h.setCaret(caretAt); };
    const at = over ? h.offsetOf(over) : -1, old = over?.textContent ?? '';
    const node = listbox.open(anchor(), entries, {
      place: 'above', label: src.label, foot: src.foot?.(),
      onClose: () => {
        const away = !h.input.contains(document.activeElement);
        suggesting = false; menuNode = null;
        if (!suggest || away) back();   /* suggestions never took the caret, so it stays where the typing left it */
      },
      onSelect: (v) => {
        requestAnimationFrame(() => {
          if (over) {
            const w = v === REMOVE_MENTION ? '' : src.write(v);
            if (w == null || at < 0) return;
            h.replace(at, at + old.length, w ? '@' + w : '');
            return;
          }
          back();
          const t = typed();
          if (t) take(v, t);
          else { const w = src.write(v), c = h.caret(); if (w && c != null) h.replace(c, c, w + ' '); }
        });
      }
    });
    menuNode = node;
    if (suggest && node) { suggesting = true; back(); }
  }
  return { open: (over) => { open(over); }, get suggesting() { return suggesting; } };
}
