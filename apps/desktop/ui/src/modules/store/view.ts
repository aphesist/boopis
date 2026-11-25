/* The store view (docs/STORE.md, ADR-0038) on the v7 kit (DESIGN-SYSTEM.md v7 7 "Dialogs", 12, 21): a large Dialog (900, its 220
   nav: Browse, Installed, Sources), each screen a settings Page of SectionHeads and Cards. Browse: the search field (a pill), the
   kind filter as Chips, the source as a SelectorItem that opens a Menu, the items as ListRows (item: the 40 mark, the name, one
   line, the state as a Badge), the reading of the sources as a StatusLine, and "out of date" as a page Notice with its two
   actions. An item's page: its ListRow head with the one primary Button, its facts in Cards. Installed: Rows (name, state, the
   Switch, an overflow Menu for Details, Roll back and Remove), a taken-down item as a red page Notice. Sources: Rows with their
   Switch, the explanation behind the row's info label. The review and the confirmations stay the card family's form card (owner
   decision: forms are one card family). The view never fetches: it reads and writes through `StoreProvider` and shows each
   failure as the host's own sentence. An item's own text is marked `data-store-item`. */
import { itemGlyphHTML, kit, ui } from '@boopis/ui';
import { clipSpots, tipsIfClipped, watchCuts } from '../../core/clip';
import { STORE_ITEM, storeItem } from '../../core/engine-words';
import { esc, reduced } from '../../core/dom';
import type { FormOutcome, FormSpec, FormsSource, InstallPlan, InstallReceipt, StageResult, StoreBrowse, StoreDetail, StoreItem, StoreKind, StoreProvider, StoreScope, StoreSource, UpdateDiff } from '../../data';
import '../cards';
import { useFormsHost } from '../cards/forms-host';
import {
  errorCode, ENGINE_PLUGIN_NOTE, REMOTE_WORDS, isRemote, KIND_FILTERS, KIND_GROUP, KIND_LABEL, KIND_SHORT, STATE_WORDS, TIER_TIPS, TIER_WORDS, ageWords, byKind, countsWords, endWord, errorText, filterOf, hostsWords, isFront, licenseWords, markRef, pinWords, plural,
  outOfDate, READ_BADGE, readingWords, reviewSpec, rowLine, scanWords, sourceState, stateOf, upToDateWords
} from './model';
import { projectSwitch } from './policy';
import { keepFresh, readerFor } from './reading';
import type { Reading } from './reading';

/** a row of a kit Menu (v7 21.2 rows 5, 19) */
type MenuEntry = Parameters<typeof kit.openMenu>[1]['entries'][number];

export type StoreScreen = 'browse' | 'installed' | 'sources';
export interface StoreDeps {
  store: StoreProvider;
  /** a line the person should see now (the floating Notice) */
  notify: (text: string) => void;
  /** the project the session is in, for the scope choice and the project switch; null: none */
  project?: () => string | null;
  /** the delay before the next card replaces one that just answered, so its receipt shows (0 in tests) */
  settle?: number;
  now?: () => number;
  /** how often, while the store is open, to look at which sources have fallen due and read them (ms; default a minute) */
  every?: number;
  /** false: a card appears at once, without its entrance (the lab's checks measure a settled card) */
  enter?: boolean;
}
export interface StoreView {
  show(screen: StoreScreen, itemId?: string): void;
  refresh(): Promise<void>;
  /** read the sources that are due (never read, failed last time, or old): the store calls it each time it is opened */
  readDue(): Promise<void>;
  /** stop reading by itself (the view is going away) */
  stop(): void;
}

export const SCREENS: ReadonlyArray<readonly [StoreScreen, string, string]> = [['browse', 'Browse', 'store'], ['installed', 'Installed', 'check'], ['sources', 'Sources', 'folder']];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}
const sinkOf = (h: { submit(id: string, o: FormOutcome): Promise<void>; cancel(id: string): Promise<void> }): FormsSource => ({
  submit: h.submit, cancel: h.cancel, signin: () => Promise.reject(new Error('There is nothing to sign in to here.')),
  can: { signin: false, upload: false, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null)
});
const idOf = (prefix: string, id: string): string => prefix + id.replace(/[^a-z0-9_-]/gi, '_');
const h = (html: string): HTMLElement => kit.wire(document.createRange().createContextualFragment(html).firstElementChild as HTMLElement);

/** a source's state as the short value at its row's end; the whole sentence is the row's explanation */
export function sourceValue(s: StoreSource, word: ReturnType<typeof sourceState>['word'], mode?: 'waiting' | 'reading'): string {
  if (word === 'off') return 'Off';
  if (word === 'reading') return mode === 'waiting' ? READ_BADGE.waiting : READ_BADGE.reading;
  if (word === 'trouble') return READ_BADGE.failed;
  if (s.fetch === 'compiled-in') return s.items != null ? plural(s.items, 'item') : 'Built in';
  if (s.fetch === 'github-api') return 'Needs a GitHub sign-in';
  if (s.items != null && s.refreshed_at) return plural(s.items, 'item');
  return s.refreshable === false ? 'Empty' : 'Not read yet';
}

export function mountStore(root: HTMLElement, deps: StoreDeps): StoreView {
  const { store } = deps;
  const settle = deps.settle ?? (reduced() ? 200 : 700);
  const now = (): number => (deps.now ? deps.now() : Date.now());
  const later = (fn: () => void): void => { window.setTimeout(fn, settle); };
  root.classList.add('hx-store');
  root.innerHTML = kit.html.dialog({
    variant: 'large', title: 'Store', scrim: false, id: 'hx-store-dlg', attrs: { role: null, 'aria-modal': null },
    nav: SCREENS.map(([value, label, icon]) => ({ label, icon, current: value === 'browse', attrs: { 'data-value': value, id: 'hx-store-nav-' + value, 'aria-controls': 'hx-store-main' } })),
    body: '<div class="hx-store__main" id="hx-store-main"></div>'
  });
  kit.wire(root);
  const nav = root.querySelector<HTMLElement>('.k7-dialog__nav') as HTMLElement;
  const main = root.querySelector<HTMLElement>('#hx-store-main') as HTMLElement;
  const scroller = main.closest<HTMLElement>('.k7-dialog__page');
  let screen: StoreScreen = 'browse';
  let gen = 0;   // a screen drawn for an older request is dropped
  const reader = readerFor(store);

  const release = (): void => { useFormsHost(null); };
  const card = (spec: FormSpec, sink: FormsSource): HTMLElement => {
    useFormsHost(sink);
    const c = ui.card('form', spec as unknown as Record<string, unknown>, { size: 'inline', enter: deps.enter ?? true });
    queueMicrotask(() => { c.querySelector<HTMLElement>('.cd-form .ui-input, .cd-form .cd-opt[tabindex="0"], .cd-form .ui-switch, .cd-form [data-hold]')?.focus(); });
    return c;
  };
  /* a line the screen keeps (for a screen reader, and so a test can read it) and the floating Notice */
  const say = (text: string): void => { const s = main.querySelector('[data-store-status]'); if (s) s.textContent = text; deps.notify(text); };
  const status = (text = '', id?: string): HTMLElement => el('p', { class: 'k7-sr', role: 'status', 'aria-live': 'polite', 'data-store-status': '', ...(id ? { id } : {}) }, text);
  /** the screen as a settings Page: its title, then its parts */
  const page = (title: string, ...kids: Node[]): HTMLElement => {
    const p = h(kit.html.page({ variant: 'settings', title, body: '' }));
    p.querySelector('.k7-page__body')?.append(...kids);
    return p;
  };
  /* an EmptyState; its one action is tinted, as every action on the dialog's ground (a raised button would paint the dialog's own --bg-3) */
  const empty = (text: string, action?: { label: string; go: () => void }): HTMLElement => {
    const e = h(kit.html.emptyState({ text }));
    if (action) e.append(button(action.label, action.go, { variant: 'tint' }));
    return e;
  };
  const noticeEl = (text: string, tone: 'neutral' | 'owe' | 'accent' | 'red', actions: ReadonlyArray<{ label: string; go: () => void; name?: string }> = []): HTMLElement => {
    const n = h(kit.html.notice({ text, tone, place: 'page', actions: actions.map((a) => ({ label: a.label })) }));
    const bs = [...n.querySelectorAll<HTMLButtonElement>('[data-kit~="Button"]')];
    actions.forEach((a, i) => { const b = bs[i]; if (!b) return; if (a.name) b.setAttribute('aria-label', a.name); b.addEventListener('click', a.go); });
    return n;
  };
  const button = (label: string, go: () => void, o: { variant?: 'primary' | 'secondary' | 'ghost' | 'tint' | 'danger'; icon?: string; size?: 36 | 32 | 28; attrs?: Record<string, string | null> } = {}): HTMLButtonElement => {
    const b = h(kit.html.button({ label, variant: o.variant ?? 'secondary', size: o.size ?? 32, ...(o.icon ? { icon: o.icon } : {}), ...(o.attrs ? { attrs: o.attrs } : {}) })) as HTMLButtonElement;
    b.addEventListener('click', go);
    return b;
  };
  const back = (label: string, go: () => void): HTMLElement => { const b = button(label, go, { variant: 'ghost', icon: 'back' }); b.classList.add('hx-store__back'); return b; };
  const section = (title: string, ...kids: Node[]): HTMLElement => { const s = h(kit.section(title, '')); s.append(...kids); return s; };
  const cardOf = (rows: Parameters<typeof kit.html.card>[0]['rows'], attrs?: Record<string, string>): HTMLElement => h(kit.html.card({ rows, ...(attrs ? { attrs } : {}) }));
  /* when the store opens, nothing in it holds the focus yet: the search field takes it, since finding a thing is what a person opens
     the store for. A nav row chosen by keyboard keeps its focus. */
  const nothingFocused = (): boolean => {
    const a = document.activeElement;
    if (!root.isConnected || (a && root.contains(a))) return false;
    const d = root.closest('dialog');
    return !a || a === document.body || (!!d && d.contains(a));
  };
  /* A screen that redraws itself (a switch was turned and the list came back) keeps the focus where it was: the control with the same
     id takes it again, so a keyboard user is not sent back to the top of the page after every switch. */
  const place = (node: Node): void => {
    const held = document.activeElement instanceof HTMLElement && main.contains(document.activeElement) ? document.activeElement.id : '';
    main.replaceChildren(node);
    if (held) main.querySelector<HTMLElement>('#' + CSS.escape(held))?.focus({ preventScroll: true });
  };

  /* ───────── rows ───────── */
  const installedList = (): readonly InstallReceipt[] => store.installed.get();
  const updatesList = (): readonly UpdateDiff[] => store.updates.get();
  /* An item is one ListRow (item): its mark, its title, one line that says what it is, and one word at its end as a Badge (its state,
     else what it needs). The whole row opens its page: one tab stop per list, Up and Down move, Enter opens. */
  function itemRow(item: StoreItem, first: boolean): string {
    const end = endWord(item, stateOf(item, installedList(), updatesList()));
    return kit.html.listRow({
      variant: 'item', title: item.title, sub: rowLine(item), markHTML: itemGlyphHTML(markRef(item)), ...(end.word ? { count: end.word } : {}),
      attrs: { role: 'option', tabindex: first ? '0' : '-1', 'aria-selected': 'false', 'data-store-open': item.id, [STORE_ITEM]: '' }
    });
  }
  function rowsSection(id: string, label: string, items: readonly StoreItem[]): HTMLElement {
    const s = section(label);
    s.id = id;
    s.append(h('<div class="k7-list hx-store__rows" role="listbox" aria-label="' + esc(label) + '">' + items.map((it, i) => itemRow(it, i === 0)).join('') + '</div>'));
    return s;
  }
  let stopCuts: (() => void) | null = null;
  const watchList = (host: HTMLElement): void => { stopCuts?.(); stopCuts = watchCuts(host); };
  const rowsOf = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('[data-store-open][role=option]')];
  const focusRow = (r: HTMLElement): void => { r.closest('[role=listbox]')?.querySelectorAll<HTMLElement>('[role=option]').forEach((x) => { x.tabIndex = x === r ? 0 : -1; }); r.focus(); };
  /* the lists read as one: Down from the last row of one list goes on to the next, Up from the very first row returns to the search
     field; Enter or Space opens the row's page, as a click does */
  const wireRows = (host: HTMLElement, search: HTMLInputElement | null): void => {
    host.addEventListener('click', (e) => { const r = (e.target as Element).closest<HTMLElement>('[data-store-open][role=option]'); if (r && host.contains(r)) void openItem(r.dataset['storeOpen'] ?? ''); });
    host.addEventListener('keydown', (e) => {
      const r = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-store-open][role=option]');
      if (!r || !host.contains(r)) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void openItem(r.dataset['storeOpen'] ?? ''); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = rowsOf(host), at = all.indexOf(r);
      e.preventDefault();
      if (e.key === 'ArrowDown' && all[at + 1]) focusRow(all[at + 1] as HTMLElement);
      if (e.key === 'ArrowUp') { if (at > 0) focusRow(all[at - 1] as HTMLElement); else search?.focus(); }
    });
  };
  /* a title or a line cut by the row's width shows whole in the tooltip while it is cut */
  const tipCut = (host: HTMLElement): void => { tipsIfClipped(clipSpots(host)); };

  /* ───────── browse ───────── */
  const B = { query: '', kind: 'all' as 'all' | StoreKind, source: 'any', items: [] as StoreItem[], page: null as StoreBrowse | null, error: '' };
  async function drawBrowse(keep?: { focus?: string }): Promise<void> {
    const mine = ++gen;
    const sources = store.sources.get().filter((s) => s.enabled !== false);
    const search = h(kit.html.field({ id: 'hx-store-q', kind: 'search', ariaLabel: 'Search the store', placeholder: 'Search by name, publisher or what it does', value: B.query }));
    /* the kind filter: Chips (the toolbar's filters, 12.2), the chosen one inverted; one of them is always chosen */
    const chips = h('<div class="hx-store__chips" role="radiogroup" aria-label="Kind">' + KIND_FILTERS.map(([value, label]) =>
      kit.html.chip({ label, variant: 'filter', chosen: value === B.kind, value, attrs: { role: 'radio', 'aria-pressed': null, 'aria-checked': String(value === B.kind), 'data-value': value } })).join('') + '</div>');
    const sourceLabel = (v: string): string => (v === 'any' ? 'All sources' : sources.find((s) => s.id === v)?.label ?? v);
    const pick = h(kit.html.selectorItem({ variant: 'field', label: 'Source', value: sourceLabel(B.source), attrs: { id: 'hx-store-source' } }));
    const strip = el('div', { class: 'hx-store__filters' }, chips, pick);
    const note = el('div', { class: 'hx-store__note' });
    const live = status();
    const reading = el('div', { class: 'hx-store__reading' });
    const list = el('div', { class: 'hx-store__list' });
    place(page('Browse', search, strip, note, live, reading, list));
    let page0: StoreBrowse | null = null;
    let sawRead = false;   // a read ran while this page was showing: when it ends the line says whether the list is now current
    const drawReading = (r: Reading): void => {
      if (!r.running) { reading.replaceChildren(); return; }
      const byId = new Map(store.sources.get().map((s) => [s.id, s]));
      const rows = r.order.flatMap((id) => {
        const s = byId.get(id);
        if (!s) return [];
        const mode = r.states.get(id);
        const word = mode ?? (s.error ? 'failed' : 'done');
        return [{ label: s.label, labelHTML: storeItem(esc(s.label)), value: READ_BADGE[word], explain: sourceState(s, now(), mode).text }];
      });
      const line = h(kit.html.statusLine({ kind: 'system', phrase: 'Reading the sources', count: `${r.done} of ${r.total}` }));
      reading.replaceChildren(section('Reading the sources', line, cardOf(rows)));
    };
    /* the line over the list: why the list is out of date, as a page Notice with the way to fix it and, where sources could not be
       read, their reasons one press away; after a read that put it right, that it is current. Never taken away from under the focus. */
    const sayFresh = (): void => {
      const r = reader.state.get();
      const od = !r.running && page0 ? outOfDate(page0, now(), store.sources.get()) : null;
      if (r.running) sawRead = true;
      live.textContent = r.running ? readingWords(r) + ' What they list shows here as each one is read.' : od ? od.text : sawRead && page0 ? upToDateWords(r) : '';
      drawReading(r);
      const focused = note.contains(document.activeElement) ? (document.activeElement as HTMLElement).textContent?.trim() ?? '' : '';
      const again = { label: 'Read the sources again', go: () => { void reader.read(true); } };
      const why = { label: 'Show why', name: 'Show why the sources could not be read', go: () => { show('sources'); } };
      if (od) note.replaceChildren(noticeEl(od.text, 'owe', od.failed > 0 ? [again, why] : [again]));
      else if (!r.running && sawRead && page0) note.replaceChildren(noticeEl(upToDateWords(r), 'accent'));
      else if (!note.contains(document.activeElement)) note.replaceChildren();
      if (focused) [...note.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent?.trim() === focused)?.focus({ preventScroll: true });
    };
    const input = search.querySelector<HTMLInputElement>('input');
    /* Down from the field goes to the first result; Enter opens the first result when there is exactly one */
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { const r = rowsOf(list)[0]; if (r) { e.preventDefault(); focusRow(r); } }
      if (e.key === 'Enter') { const rows = rowsOf(list); if (rows.length === 1) { e.preventDefault(); rows[0]?.click(); } }
    });
    wireRows(list, input ?? null);
    /* a cut title or line is checked again whenever the list's width changes (a scrollbar arriving, the window resized) */
    watchList(list);
    let timer = 0;
    input?.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { B.query = input.value; void load(false); }, 150); });
    chips.addEventListener('ui:change', (e) => {
      e.preventDefault();
      const c = (e.target as Element).closest<HTMLElement>('[data-value]');
      const v = c?.dataset['value']; if (!v || v === B.kind) return;
      for (const x of chips.querySelectorAll<HTMLElement>('[data-value]')) { const on = x === c; x.toggleAttribute('data-chosen', on); x.setAttribute('aria-checked', String(on)); }
      B.kind = v as typeof B.kind; void load(false);
    });
    chips.addEventListener('keydown', (e) => {
      const list2 = [...chips.querySelectorAll<HTMLElement>('[data-value]')], i = list2.indexOf(document.activeElement as HTMLElement);
      const n = ({ ArrowRight: i + 1, ArrowLeft: i - 1 } as Record<string, number>)[e.key];
      if (i < 0 || n == null) return;
      e.preventDefault(); list2[(n + list2.length) % list2.length]?.focus();
    });
    pick.addEventListener('click', () => {
      pick.setAttribute('aria-expanded', 'true');
      const entries: MenuEntry[] = [{ value: 'any', label: 'All sources', checked: B.source === 'any', role: 'menuitemradio' as const }, ...sources.map((s) => ({ value: s.id, label: s.label, checked: B.source === s.id, role: 'menuitemradio' as const }))];
      kit.openMenu(pick, { label: 'Source', entries, align: 'start', onSelect: (v) => {
        B.source = v; const val = pick.querySelector('.k7-sel__value'); if (val) val.textContent = sourceLabel(v); pick.setAttribute('aria-label', 'Source: ' + sourceLabel(v)); void load(false);
      } });
      const m = document.querySelector('[data-kit~="Menu"][data-floating]');
      const done = (): void => { if (!m?.isConnected) { pick.setAttribute('aria-expanded', 'false'); return; } requestAnimationFrame(done); };
      requestAnimationFrame(done);
    });
    if (keep?.focus) main.querySelector<HTMLElement>(keep.focus)?.focus();
    else if (nothingFocused()) input?.focus({ preventScroll: true });
    /* while the sources are read, the line says how far it is, and each source that finishes brings its items into the list
       (unless the list holds the focus: a keyboard user is not moved) */
    let doneSeen = reader.state.get().done;
    const off = reader.state.subscribe((r) => {
      if (mine !== gen || !list.isConnected) { off(); return; }
      sayFresh();
      if (r.done !== doneSeen || !r.running) { doneSeen = r.done; if (!list.contains(document.activeElement)) void load(false); }
    });

    async function load(more: boolean): Promise<void> {
      const filter = filterOf(B.kind, B.source);
      try {
        const pg = B.query.trim() ? await store.search(B.query.trim(), filter, more ? B.page?.next_cursor : null) : await store.browse(filter, more ? B.page?.next_cursor : null);
        if (mine !== gen) return;
        B.error = ''; B.page = pg; B.items = more ? [...B.items, ...pg.items] : [...pg.items];
        paint(pg);
      } catch (e) {
        if (mine !== gen) return;
        B.error = errorText(e);
        list.replaceChildren(noticeEl('The store did not load. ' + B.error, 'red', [{ label: 'Try again', go: () => { void load(false); } }]));
      }
    }
    function paint(pg: StoreBrowse): void {
      page0 = pg; sayFresh();
      const q = B.query.trim();
      const front = isFront(filterOf(B.kind, B.source), B.query);
      const rec = front ? (pg.recommended ?? []) : [];
      const recIds = new Set(rec.map((i) => i.id));
      const rest = front ? B.items.filter((i) => !recIds.has(i.id)) : B.items;
      const parts: Node[] = [];
      /* the front page: Recommended (the host's list), then everything else by kind; a search or a filter: one list of results,
         its heading the count the host gives and what it was narrowed by */
      if (rec.length) parts.push(rowsSection('hx-store-rec', 'Recommended', rec));
      if (front) for (const g of byKind(rest)) parts.push(rowsSection('hx-store-k-' + g.kind, g.label, g.items));
      else if (rest.length) parts.push(rowsSection('hx-store-all', resultsWords(pg.total, q), rest));
      if (!rec.length && !rest.length) {
        if (q || B.kind !== 'all' || B.source !== 'any') {
          const clearAll = (): void => { B.query = ''; B.kind = 'all'; B.source = 'any'; void drawBrowse({ focus: '#hx-store-q' }); };
          const e = empty(nothingWords(q), { label: q ? 'Clear the search' : 'Show everything', go: clearAll });
          e.querySelector('button')?.setAttribute('data-store-clear', '');
          parts.push(e);
          /* a search narrowed by kind or source that finds nothing may still find something without it: ask the host, and offer its own
             count of what the wider search holds, as the empty state's one action in place of clearing */
          if (q && (B.kind !== 'all' || B.source !== 'any')) {
            store.search(q, filterOf('all', 'any'), null).then((wide) => {
              const clear = e.querySelector('[data-store-clear]');
              if (mine !== gen || !e.isConnected || !wide.total || !clear || clear.contains(document.activeElement)) return;
              const all = button(`Show the ${plural(wide.total, 'result')} in every kind and source`, () => { B.kind = 'all'; B.source = 'any'; void drawBrowse({ focus: '#hx-store-q' }); }, { variant: 'primary', attrs: { 'data-store-widen': '' } });
              clear.replaceWith(all);
            }).catch(() => undefined);
          }
        } else parts.push(empty(sources.length ? 'No source has listed anything yet. Open Sources to read them again.' : 'Every source is off. Switch one on in Sources.'));
      }
      if (pg.next_cursor) { const more = button('Show more', () => { void load(true); }, { variant: 'tint' }); more.classList.add('hx-store__more'); parts.push(more); }
      list.replaceChildren(...parts);
      tipCut(list);
    }
    /* "3 results for “git” in Skills from GitHub": the host's count, then what narrowed it */
    function resultsWords(total: number, q: string): string {
      const kind = B.kind !== 'all' ? KIND_GROUP[B.kind] : '';
      const src = B.source !== 'any' ? sources.find((s) => s.id === B.source)?.label ?? B.source : '';
      return plural(total, 'result') + (q ? ' for “' + q + '”' : '') + (kind ? ' in ' + kind : '') + (src ? ' from ' + src : '');
    }
    function nothingWords(q: string): string {
      const kind = B.kind !== 'all' ? KIND_GROUP[B.kind].toLowerCase() : '';
      if (q) return `Nothing${kind ? ' in ' + kind : ''} matches “${q}”.`;
      return `Nothing is listed${kind ? ' in ' + kind : ''}${B.source !== 'any' ? ' from this source' : ''} yet.`;
    }
    await load(false);
  }

  /* ───────── detail ───────── */
  async function openItem(id: string, from: StoreScreen = screen): Promise<void> {
    let d: StoreDetail;
    try { d = await store.detail(id); } catch (e) { place(page('Not found', back('Back to the store', () => { show(from); }), noticeEl('That item did not open. ' + errorText(e), 'red'))); return; }
    drawDetail(d, from);
  }
  function drawDetail(d: StoreDetail, from: StoreScreen): void {
    const it = d.item, st = stateOf(it, installedList(), updatesList());
    const srcLabel = store.sources.get().find((s) => s.id === it.source)?.label ?? it.source;
    const prov = it.provenance;
    const blocks: Node[] = [];
    /* reference data in a Card: the term, then its value beside it (one column when the dialog is narrow) */
    const R = (label: string, value: string): string => '<div class="hx-store__fact"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
    const sec = (label: string, body: string): void => {
      const c = h('<section class="k7-card hx-store__factcard" data-kit="Card" data-variant="settings" data-sq data-sq-mode="frame">' + storeItem('<dl class="hx-store__facts">' + body + '</dl>') + '</section>');
      blocks.push(section(label, c));
    };
    sec('About', R('Summary', it.summary) + (it.tags?.length ? R('Topics', it.tags.join(', ')) : ''));
    const warn: string[] = [];
    if (it.removed) warn.push(R('Taken down', `${it.removed.reason}. It cannot be installed${d.installed ? ' and is switched off from the next session' : ''}.`));
    if (!it.pinned) warn.push(R('Not pinned', 'This item is not pinned to an exact version, so boopis will not install it.'));
    if (isRemote(it.pinned)) warn.push(R('Hosted by the publisher', REMOTE_WORDS));
    if (it.tier === 'not-reviewed') warn.push(R('Not reviewed', TIER_TIPS['not-reviewed']));
    if (it.kind === 'engine-plugin') warn.push(R('Runs inside the engine', ENGINE_PLUGIN_NOTE));
    if (d.update?.status === 'available') warn.push(R('Update available', d.update.widened ? 'It adds new code, hosts or keys. The review shows what.' : 'A newer version is listed. The review shows what changes.'));
    if (warn.length) sec('Read first', warn.join(''));
    sec('What it needs and where it reaches', R('Keys', it.secrets.length ? it.secrets.map((s) => s.title + (s.optional ? ' (optional)' : '')).join('; ') + '. They go to your keychain.' : 'None.') + R('Hosts', hostsWords(it.hosts, it.verified)));
    sec('What it adds', R('Contents', countsWords(it.components)) + R('Tools and context', d.cost.tools == null ? 'Not known. Every tool it adds is loaded in every session.' : `${plural(d.cost.tools, 'tool')}${d.cost.context_tokens == null ? '' : ', about ' + String(d.cost.context_tokens) + ' tokens of context'}. Every tool is loaded in every session.`));
    sec('Where it comes from', R('Source', `${srcLabel}${prov.source_tier && it.source !== 'boopis' ? ', which calls it ' + prov.source_tier : ''}`) + (it.source === 'boopis' && prov.source_tier ? R('Why it is listed here', prov.source_tier.charAt(0).toUpperCase() + prov.source_tier.slice(1)) : '') + R('Publisher', it.publisher + (prov.namespace_proof === 'none' ? ' (not proved)' : '')) +
      R('Pinned to', pinWords(it.pinned)) + R('Folder hash', prov.tree_sha256 ?? 'Not known until it is downloaded.') + R('Check', scanWords(prov.scan.verdict) + (prov.scan.findings.length ? ': ' + prov.scan.findings.map((f) => f.text).join('; ') : '')) +
      R('Last updated', prov.last_updated ? ageWords(prov.last_updated, now()) : 'Not known') + R('Licence', licenseWords(it.license)) + R('Checked by boopis', it.verified ?? 'Nobody has checked it') + (it.homepage ? R('Home page', it.homepage) : ''));
    sec('In governed sessions', R('Governed mode', d.governed.text));
    if (d.installed) sec('Installed', R('Version', `${d.installed.version ?? 'not stated'}, ${d.installed.enabled ? 'on' : 'off'}, for ${d.installed.scope.bot}${d.installed.scope.project ? ' and ' + d.installed.scope.project : ''}`));

    /* the head: the item's ListRow (its mark, its name, what it is, by whom, its tier and state) and the one primary action */
    const meta = [KIND_SHORT[it.kind] + ' by ' + it.publisher, TIER_WORDS[it.tier], st ? STATE_WORDS[st] : ''].filter(Boolean).join(', ');
    const hero = el('div', { class: 'hx-store__hero' });
    hero.append(h(storeItem(kit.html.listRow({ variant: 'item', title: it.title, sub: meta, markHTML: itemGlyphHTML(markRef(it)), attrs: { role: 'group', tabindex: null, 'aria-selected': null, 'aria-label': it.title } }))).firstElementChild as HTMLElement);
    hero.firstElementChild?.setAttribute(STORE_ITEM, '');
    const canInstall = !d.installed && !it.removed && !!it.pinned;
    const primary = d.update?.status === 'available' ? 'Review the update' : canInstall ? 'Review and install' : '';
    if (primary) {
      const b = button(primary, () => { void startReview(it.id, d.update?.status === 'available' ? 'update' : 'install', from); }, { variant: 'primary', attrs: { 'data-store-primary': '' } });
      if (!store.can.install) b.disabled = true;
      hero.append(b);
    }
    const why = !store.can.install && store.can.reason ? noticeEl(store.can.reason, 'neutral') : null;
    const sheet = el('section', { class: 'hx-store__sheet', 'aria-label': 'About ' + it.title }, hero, ...(why ? [why] : []), ...blocks);
    place(page(KIND_SHORT[it.kind], back('Back to the store', () => { show(from); }), sheet));
    main.querySelector<HTMLElement>('.hx-store__sheet button')?.focus();
  }

  /* ───────── review ───────── */
  async function startReview(id: string, mode: 'install' | 'update', from: StoreScreen, scope?: StoreScope): Promise<void> {
    place(page('Review', h(kit.html.statusLine({ kind: 'system', phrase: 'Downloading it to check it. Nothing runs.' }))));
    let out: { stage: StageResult; plan: InstallPlan };
    try { out = mode === 'update' ? await store.reviewUpdate(id) : await store.review(id, scope); } catch (e) { place(page('Review', back('Back', () => { void openItem(id, from); }), noticeEl('It could not be checked. ' + errorText(e), 'red'))); return; }
    drawReview(out.stage, out.plan, mode, from);
  }
  function drawReview(stage: StageResult, plan: InstallPlan, mode: 'install' | 'update', from: StoreScreen): void {
    const project = deps.project?.() ?? null;
    const diff = mode === 'update' ? updatesList().find((x) => x.item_id === plan.item_id) ?? null : null;
    const result = el('div', { class: 'hx-store__stack', 'aria-live': 'polite' });
    const kids: Node[] = [];
    const scopeBox = el('div', { class: 'hx-store__scope' });
    if (project && mode === 'install') {
      const drawScope = (blocked: boolean): void => {
        const items = [{ value: 'bot', label: 'This bot' }, ...(blocked ? [] : [{ value: 'bot-project', label: 'This bot, trusted here' }])];
        const seg = h(kit.html.segmented({ label: 'Install for', items, value: blocked ? 'bot' : plan.scope.level }));
        seg.addEventListener('ui:change', (e) => { const level = (e as CustomEvent<{ value: 'bot' | 'bot-project' }>).detail.value; void startReview(plan.item_id, mode, from, { level, bot: plan.scope.bot, ...(level === 'bot-project' ? { project } : {}) }); });
        scopeBox.replaceChildren(section('Install for'));
        scopeBox.firstElementChild?.append(seg);
        if (blocked) scopeBox.append(noticeEl('This project has engine plugins and plugin hooks turned off, so this plugin cannot be trusted here. It installs for this bot alone.', 'neutral'));
      };
      drawScope(false);
      if (plan.components.some((c) => c.type === 'hook')) store.projectPolicy(project).then((p) => { if (p.effective) drawScope(true); }).catch(() => undefined);
      kids.push(scopeBox);
    }
    const spec = reviewSpec(plan, { update: diff });
    const c = card(spec, sinkOf({
      async submit(_id, o) {
        const restart = o.values['restart'];
        let r: InstallReceipt;
        try { r = await store.install({ stage_id: stage.stage_id, plan_hash: plan.plan_hash, ...(Object.keys(o.secrets).length ? { secrets: o.secrets } : {}), ...(restart === 'now' || restart === 'when-idle' ? { restart } : {}) }); } catch (e) {
          /* what was shown is no longer what would be installed (the plan changed, the download is gone, the engine restarted meanwhile): the way on is a fresh review */
          if (['hx.store.plan_changed', 'hx.store.stage_missing'].includes(errorCode(e))) {
            result.replaceChildren(noticeEl('Nothing was installed. Review it again to see what it would do now.', 'owe', [{ label: 'Review again', go: () => { void startReview(plan.item_id, mode, from); } }]));
          }
          throw new Error(errorText(e));
        }
        later(() => { drawDone(r, result, from); });
      },
      cancel() { void openItem(plan.item_id, from); return Promise.resolve(); }
    }));
    kids.push(c, result);
    place(page(mode === 'update' ? 'Review the update' : 'Review', ...kids));
  }
  function drawDone(r: InstallReceipt, into: HTMLElement, from: StoreScreen): void {
    const rows = [...r.steps.map((s) => ({ label: s.name, value: s.ok ? 'done' : 'failed', ...(s.note ? { explain: s.note } : {}) })), ...r.notes.map((n) => ({ label: n }))];
    if (r.restart_needed) rows.push({ label: 'The engine restarts when no turn is running.' });
    const head = h(storeItem(kit.html.sectionHead({ title: `${r.title ?? r.item_id} is installed` })));
    const acts = el('div', { class: 'hx-store__acts' }, button('See what is installed', () => { show('installed'); }, { variant: 'primary' }), button('Back to the store', () => { show(from === 'installed' ? 'installed' : 'browse'); }, { variant: 'ghost' }));
    into.replaceChildren(head, cardOf(rows, { class: 'hx-store__lines' }), acts);
  }

  /* ───────── installed ───────── */
  async function drawInstalled(): Promise<void> {
    const list = installedList(), ups = updatesList();
    const byId = new Map(ups.map((x) => [x.item_id, x]));
    const blocks: Node[] = [];
    /* a taken-down item: the in-page Notice (21.3: the banner became a Notice), red, with Remove */
    for (const r of list.filter((x) => x.kill_listed)) {
      const name = r.title ?? r.item_id;
      const n = noticeEl(`${name} was taken down by its source: ${r.kill_listed?.reason ?? ''}. It is switched off from the next session.`, 'red', [{ label: 'Remove', name: 'Remove ' + name, go: () => { removeFlow(r); } }]);
      n.setAttribute(STORE_ITEM, '');
      blocks.push(n);
    }
    const rows = list.map((r) => {
      const name = r.title ?? r.item_id;
      const u = byId.get(r.item_id);
      const value = r.kill_listed ? 'Removed' : u?.status === 'available' ? 'Update' : r.enabled ? 'On' : 'Off';
      const explain = `${KIND_LABEL[r.kind]}${r.version ? ', version ' + r.version : ''}. For ${r.scope.bot}${r.scope.project ? ', trusted in ' + r.scope.project : ''}. Installed ${ageWords(r.installed_at, now())}.${u?.status === 'available' ? ' An update is available' + (u.widened ? ' and it reaches further.' : '.') : ''}`;
      const control = (u?.status === 'available' ? kit.html.button({ label: 'Update', variant: 'tint', size: 28, attrs: { 'data-store-update': r.item_id, 'aria-label': 'Update ' + name } }) : '') +
        kit.html.switch({ id: idOf('hx-store-sw-', r.item_id), checked: r.enabled, label: name, attrs: { 'data-store-switch': r.item_id } }) +
        kit.html.iconButton({ icon: 'more', label: 'More for ' + name, variant: 'tinted', haspopup: 'menu', tip: 'More', attrs: { 'data-store-more': r.item_id } });
      return { label: name, labelHTML: storeItem(esc(name)), value, explain, control };
    });
    blocks.push(section('Installed', list.length ? cardOf(rows, { id: 'hx-store-have' }) : empty('Nothing installed yet.')));
    const live = status();
    const check = button('Check for updates', () => {
      live.textContent = 'Looking for updates…';
      store.checkUpdates().then((f) => { say(f.length ? `${plural(f.length, 'update')} found.` : 'Everything is up to date.'); }).then(() => drawInstalled()).catch((e: unknown) => { say(errorText(e)); });
    }, { variant: 'tint', attrs: { id: 'hx-store-check' } });
    const project = deps.project?.() ?? null;
    const pol = project ? section('This project', projectSwitch(store, project, say, 'hx-store-policy-installed')) : null;
    place(page('Installed', el('div', { class: 'hx-store__acts' }, check), live, ...blocks, ...(pol ? [pol] : [])));
    const host = main;
    for (const b of host.querySelectorAll<HTMLElement>('[data-store-update]')) b.addEventListener('click', () => { void startReview(b.dataset['storeUpdate'] ?? '', 'update', 'installed'); });
    for (const b of host.querySelectorAll<HTMLElement>('[data-store-more]')) b.addEventListener('click', () => {
      const r = list.find((x) => x.item_id === b.dataset['storeMore']); if (!r) return;
      const entries: MenuEntry[] = [{ label: 'Details', value: 'details' }, ...(r.previous ? [{ label: 'Roll back', value: 'rollback' }] : []), '-', { label: 'Remove', value: 'remove', danger: true }];
      b.setAttribute('aria-expanded', 'true');
      kit.openMenu(b, { label: 'More for ' + (r.title ?? r.item_id), entries, align: 'end', onSelect: (v) => {
        if (v === 'details') void openItem(r.item_id, 'installed');
        else if (v === 'rollback') store.rollback(r.item_id).then((x) => { say(`${x.title ?? r.item_id} is back at ${x.version ?? 'its earlier version'}. It takes effect in new sessions.`); }).catch((e: unknown) => { say(errorText(e)); });
        else if (v === 'remove') removeFlow(r);
      } });
    });
    for (const sw of host.querySelectorAll<HTMLButtonElement>('[data-store-switch]')) sw.addEventListener('ui:change', (e) => {
      const want = (e as CustomEvent<{ value: boolean }>).detail.value, id = sw.dataset['storeSwitch'] ?? '';
      store.setEnabled(id, want).then(() => { say(`${list.find((r) => r.item_id === id)?.title ?? id} is ${want ? 'on' : 'off'}. Open sessions keep what they started with; new ones use this.`); }).catch((err: unknown) => { sw.setAttribute('aria-checked', String(!want)); say(errorText(err)); });
    });
  }
  function removeFlow(r: InstallReceipt): void {
    const name = r.title ?? r.item_id;
    const spec: FormSpec = {
      id: 'store.remove.' + r.item_id, kind: 'choice', title: `Remove ${name}?`, origin: { kind: 'host' }, defer: false,
      why: 'It stops being available from the next session. If it has keys in your keychain they stay unless you say so.',
      schema: { properties: { keys: { type: 'string', title: 'Its keys', enum: ['keep', 'delete'], enumNames: ['Keep them in my keychain', 'Delete them too'], default: 'keep' } }, required: ['keys'] },
      submit: { label: 'Remove', hold: true }, cancel: { label: 'Keep it' }, receipt: `Removed ${name}`
    };
    place(page('Remove', card(spec, sinkOf({
      async submit(_id, o) {
        try { const u = await store.uninstall(r.item_id, { deleteSecrets: o.values['keys'] === 'delete' }); deps.notify([`Removed ${name}.`, u.kept_secrets.length ? 'Its keys stay in your keychain.' : ''].filter(Boolean).join(' ')); } catch (e) { throw new Error(errorText(e)); }
        later(() => { show('installed'); });
      },
      cancel() { show('installed'); return Promise.resolve(); }
    }))));
  }

  /* ───────── sources ───────── */
  async function drawSources(): Promise<void> {
    const list: readonly StoreSource[] = store.sources.get();
    const reading = reader.state.get();
    const rows = list.map((s) => {
      const mode = reading.states.get(s.id);
      const state = sourceState(s, now(), mode);
      const control = kit.html.switch({ id: idOf('hx-store-src-', s.id), checked: s.enabled !== false, label: s.label, attrs: { 'data-store-src': s.id } }) +
        (s.user_added ? kit.html.iconButton({ icon: 'more', label: 'More for ' + s.label, variant: 'tinted', haspopup: 'menu', tip: 'More', attrs: { 'data-store-src-more': s.id } }) : '');
      return { label: s.label, labelHTML: storeItem(esc(s.label)), value: sourceValue(s, state.word, mode === 'waiting' || mode === 'reading' ? mode : undefined), explain: `${s.description ? s.description + ' ' : ''}${state.text}`.trim(), control };
    });
    const add = section('Add a source', cardOf([{ label: 'A marketplace, repository or folder', explain: 'A marketplace address, a git repository, a GitHub address or a folder on this computer. Items from it start as not reviewed.',
      control: kit.html.button({ label: 'Add', size: 28, variant: 'tint', attrs: { 'data-store-src-add': '', 'aria-label': 'Add a source' } }) }]));
    /* not disabled while a read runs (the focus would be lost as the rows redraw): a second press joins the read in progress */
    const refresh = button('Read the sources again', () => { void reader.read(true).then(() => { deps.notify(readingWords(reader.state.get())); }); }, { variant: 'tint', attrs: { id: 'hx-store-read', 'aria-describedby': 'hx-store-read-status' } });
    const line = reading.running ? h(kit.html.statusLine({ kind: 'system', phrase: 'Reading the sources', count: `${reading.done} of ${reading.total}` })) : null;
    place(page('Sources', el('div', { class: 'hx-store__acts' }, refresh), status(readingWords(reading), 'hx-store-read-status'), ...(line ? [line] : []),
      list.length ? section('Where items come from', cardOf(rows, { id: 'hx-store-src' })) : empty('boopis has no sources to read right now.'), add));
    for (const sw of main.querySelectorAll<HTMLButtonElement>('[data-store-src]')) sw.addEventListener('ui:change', (e) => {
      const want = (e as CustomEvent<{ value: boolean }>).detail.value;
      store.setSourceEnabled(sw.dataset['storeSrc'] ?? '', want).then(() => drawSources()).catch((err: unknown) => { sw.setAttribute('aria-checked', String(!want)); say(errorText(err)); });
    });
    for (const b of main.querySelectorAll<HTMLElement>('[data-store-src-more]')) b.addEventListener('click', () => {
      const id = b.dataset['storeSrcMore'] ?? '';
      kit.openMenu(b, { label: 'More for ' + (list.find((s) => s.id === id)?.label ?? id), align: 'end', entries: [{ label: 'Remove', value: 'remove', danger: true }],
        onSelect: () => { store.removeSource(id).then(() => drawSources()).catch((e: unknown) => { say(errorText(e)); }); } });
    });
    main.querySelector('[data-store-src-add]')?.addEventListener('click', addFlow);
  }
  function addFlow(): void {
    const spec: FormSpec = {
      id: 'store.source.add', kind: 'setup', title: 'Add a source', origin: { kind: 'host' }, defer: false,
      why: 'boopis reads it once and refuses what it cannot parse. Nothing in it is installed without a review.',
      schema: { properties: { where: { type: 'string', title: 'Address or folder', placeholder: 'https://github.com/owner/repo, or a folder', 'x-mono': true } }, required: ['where'] },
      submit: { label: 'Add source' }, cancel: { label: 'Back' }, receipt: 'Added. Its items show in Browse.'
    };
    place(page('Add a source', card(spec, sinkOf({
      async submit(_id, o) {
        const where = String(o.values['where'] ?? '').trim();
        const asUrl = /^(https?:\/\/|git@|ssh:\/\/|github\.com\/)/.test(where);
        try { await store.addSource(asUrl ? { url: where.startsWith('github.com/') ? 'https://' + where : where } : { path: where }); } catch (e) { throw new Error(errorText(e)); }
        later(() => { show('sources'); });
      },
      cancel() { show('sources'); return Promise.resolve(); }
    }))));
  }

  /* ───────── the shell of the view ───────── */
  function show(s: StoreScreen, itemId?: string): void {
    screen = s; gen++; release();
    for (const b of nav.querySelectorAll<HTMLElement>('.k7-dialog__navrow')) { if (b.dataset['value'] === s) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    if (scroller) scroller.scrollTop = 0;
    if (itemId) { void openItem(itemId, s); return; }
    if (s === 'browse') void drawBrowse();
    else if (s === 'installed') void drawInstalled();
    else void drawSources();
  }
  nav.addEventListener('ui:change', (e) => { show((e as CustomEvent<{ value: StoreScreen }>).detail.value); });
  const keep = (fn: () => void) => (): void => { if (root.isConnected && main.querySelector('[data-store-status]') && !main.querySelector('.cd-form')) fn(); };
  store.installed.subscribe(keep(() => { if (screen === 'installed') void drawInstalled(); }));
  store.sources.subscribe(keep(() => { if (screen === 'sources') void drawSources(); }));
  reader.state.subscribe(keep(() => { if (screen === 'sources') void drawSources(); }));
  show('browse');
  /* while the store stays open, the sources that fall due are read again: a copy ages whether or not anyone presses anything. A
     closed store (its dialog shut, or the view gone) reads nothing. */
  const isOpen = (): boolean => { if (!root.isConnected) return false; const d = root.closest('dialog'); return !d || d.open; };
  const stopFresh = keepFresh(store, { open: isOpen, now, ...(deps.every ? { every: deps.every } : {}) });
  return { show, refresh: async () => { show(screen); }, readDue: () => reader.readDue(), stop: stopFresh };
}
