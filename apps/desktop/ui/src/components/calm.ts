/* The calm pass's library pieces (docs/UI-COMPONENTS.md, "Calm", owner decision 23 November 2026: R-calm-*, R-comp-2, R-comp-6):
   a status line (one job, one line), a "danger zone" for rare and destructive actions, an overflow button, and the long-text
   editor (a preview and an Edit action, the text opens in its own dialog). Row (no hint by default), Section (collapses when
   empty) and the one-line EmptyState live beside their old forms in html.ts. */
import { esc, frag } from '../core/dom';
import { fire } from '../core/dom';
import { html } from './html';
import { menu } from './layer';
import type { MenuEntry } from './html';
import { hydrateOne } from './wire';

type U<T> = T | undefined;

/* ───────── StatusLine (R-calm-6) ───────── */
export const STATUS_TONES = ['work', 'idle', 'attention'] as const;
export type StatusTone = typeof STATUS_TONES[number];
/** how the work shows: `dot` the breathing dot (the system's one loop), `pulse` the phrase alone, fading in and out */
export const STATUS_LOOKS = ['dot', 'pulse'] as const;
export type StatusLook = typeof STATUS_LOOKS[number];
export interface StatusLineOpts {
  /** a short phrase, no full stop: "Reading sources" */
  text: string;
  /** an optional count in mono: "0 of 1" */
  count?: U<string>;
  tone?: U<StatusTone>;
  look?: U<StatusLook>;
  id?: U<string>;
}
/** One job, one status line: a mark, a short phrase and an optional count. A live region, so a change is announced once. Change it in place with `setStatus`. */
export function statusLine(o: StatusLineOpts): string {
  const tone = o.tone ?? 'work', look = o.look ?? 'dot';
  return '<p class="ui-status" role="status"' + (o.id ? ' id="' + esc(o.id) + '"' : '') + ' data-tone="' + tone + '" data-look="' + look + '">' +
    (look === 'dot' ? html.dot(tone === 'work' ? 'run' : tone === 'attention' ? 'attention' : undefined) : '') +
    '<span class="ui-status__text">' + esc(o.text) + '</span>' + '<span class="ui-status__count ui-mono">' + esc(o.count ?? '') + '</span></p>';
}
/** the phrase and the count change in place; the phrase cross-fades (R-calm-6, R-flow-4) */
export function setStatus(el: HTMLElement, o: Partial<StatusLineOpts>): void {
  const text = el.querySelector<HTMLElement>('.ui-status__text'), count = el.querySelector<HTMLElement>('.ui-status__count');
  if (o.tone) {
    el.dataset['tone'] = o.tone;
    const dot = el.querySelector('.ui-dot');
    if (dot) dot.className = 'ui-dot' + (o.tone === 'work' ? ' ui-dot--run' : o.tone === 'attention' ? ' ui-dot--attention' : '');
  }
  if (count && o.count != null && count.textContent !== o.count) count.textContent = o.count;
  if (text && o.text != null && text.textContent !== o.text) {
    text.textContent = o.text;
    text.classList.remove('is-swap'); void text.offsetWidth; text.classList.add('is-swap');
  }
}

/* ───────── Danger zone and overflow (R-calm-14) ───────── */
export interface DangerAction { label: string; /** what the button says: a verb and an object */ action: string; /** the row's name: a noun phrase */ name?: U<string>; id?: U<string> }
export interface DangerZoneOpts { label?: U<string>; id?: U<string>; actions: readonly DangerAction[]; open?: U<boolean> }
/** The group at the end of a page that holds the rare and destructive actions: a collapsed section, so nothing red sits at rest. Each action is a
    row (its name) with a button. The button carries `data-action`; the page wires it (a destructive action confirms in a dialog, R-comp-6). */
export function dangerZone(o: DangerZoneOpts): string {
  const body = o.actions.map((a) => html.setRow({ label: a.name ?? a.label, danger: true,
    control: html.button({ label: a.label, size: 's', variant: 'secondary', action: a.action, attrs: { id: a.id } }) })).join('');
  return '<div class="ui-danger">' + html.section({ label: o.label ?? 'Danger zone', open: o.open ?? false, body, id: o.id, name: 'danger' }) + '</div>';
}
export interface OverflowOpts { label?: U<string>; items: readonly MenuEntry[]; onSelect: (value: string) => void; /** where the menu opens */ place?: U<'above' | 'below'> }
/** the "more" button: the secondary and rare actions of a surface in one menu, never a permanent footer */
export function overflow(o: OverflowOpts): HTMLButtonElement {
  const b = frag<HTMLButtonElement>(html.iconButton({ icon: 'more', label: o.label ?? 'More', haspopup: 'menu', expanded: false, size: 's' }));
  b.addEventListener('click', () => {
    b.setAttribute('aria-expanded', 'true');
    const m = menu.open(b, o.items, { label: o.label ?? 'More', ...(o.place ? { place: o.place } : {}), onSelect: (v: string) => { o.onSelect(v); } });
    if (!m) b.setAttribute('aria-expanded', 'false');
    else new MutationObserver((_r, ob) => { if (!m.isConnected) { b.setAttribute('aria-expanded', 'false'); ob.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
  });
  return b;
}

/* ───────── Long text (R-calm-9) ───────── */
export interface LongTextOpts {
  label: string; value: string; id?: U<string>;
  /** the preview's lines, 2 by default */
  lines?: U<number>;
  /** the placeholder shown when the text is empty */
  empty?: U<string>;
  /** the button's words */
  action?: U<string>;
}
/** The sheet's one-line (here two-line) preview of a long text and its Edit action. The action carries `data-action="edit-long"`. */
export function longText(o: LongTextOpts): string {
  const v = o.value.trim();
  return '<div class="ui-long"' + (o.id ? ' id="' + esc(o.id) + '"' : '') + '><div class="ui-long__head"><span class="ui-long__label">' + esc(o.label) + '</span>' +
    html.button({ label: o.action ?? 'Edit', size: 's', variant: 'ghost', action: 'edit-long' }) + '</div>' +
    '<p class="ui-long__preview"' + (v ? '' : ' data-empty') + ' style="--lines:' + String(o.lines ?? 2) + '">' + esc(v || o.empty || 'Empty') + '</p></div>';
}
/** keep a long text's preview in step with its value */
export function setLongText(el: HTMLElement, value: string, empty = 'Empty'): void {
  const p = el.querySelector<HTMLElement>('.ui-long__preview'); if (!p) return;
  const v = value.trim(); p.textContent = v || empty; p.toggleAttribute('data-empty', !v);
}
export interface TextEditorOpts {
  title: string; value: string;
  /** the textarea's accessible name */
  label?: U<string>;
  /** a file's syntax, for the mono face */
  mono?: U<boolean>;
  save?: U<string>;
  /** where the dialog goes; the document's body by default */
  host?: U<HTMLElement>;
  /** open it in the flow, not modal (the lab draws it so) */
  inline?: U<boolean>;
}
/** The long-text editor: its own dialog with a header (title, close), the text taking the room, and Cancel and Save at the foot (Save only once
    the text changed). Resolves to the new text, or null when it closes unchanged or cancelled. */
export function editLong(o: TextEditorOpts): Promise<string | null> {
  const d = document.createElement('dialog'); d.className = 'ui-editor';
  const id = 'ui-ed-' + String(Math.random()).slice(2, 8);
  d.setAttribute('aria-labelledby', id + '-t');
  d.innerHTML = '<div class="ui-editor__card ui-nest"><header class="ui-editor__head"><h2 id="' + id + '-t">' + esc(o.title) + '</h2>' +
    html.iconButton({ icon: 'close', label: 'Close', class: 'ui-corner', action: 'cancel' }) + '</header>' +
    '<div class="ui-editor__body">' + html.input({ id: id + '-x', value: o.value, rows: 12, label: o.label ?? o.title, mono: o.mono ?? true, class: 'ui-editor__text ui-scroll' }) + '</div>' +
    '<footer class="ui-editor__foot">' + html.button({ label: 'Cancel', variant: 'ghost', action: 'cancel' }) + html.button({ label: o.save ?? 'Save', variant: 'primary', action: 'save', disabled: true }) + '</footer></div>';
  hydrateOne(d);
  const text = d.querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement, save = d.querySelector<HTMLButtonElement>('[data-action="save"]') as HTMLButtonElement;
  return new Promise((resolve) => {
    let out: string | null = null;
    text.addEventListener('input', () => { save.disabled = text.value === o.value; });
    d.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset['action'];
      if (a === 'save' && !save.disabled) { out = text.value; d.close(); } else if (a === 'cancel' || e.target === d) d.close();
    });
    d.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !save.disabled) { e.preventDefault(); out = text.value; d.close(); } });
    d.addEventListener('close', () => { d.remove(); resolve(out); }, { once: true });
    (o.host ?? document.body).appendChild(d);
    if (o.inline) d.show(); else { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
    text.focus({ preventScroll: true }); text.setSelectionRange(0, 0);
    fire(d, 'ui:open', {});
  });
}
