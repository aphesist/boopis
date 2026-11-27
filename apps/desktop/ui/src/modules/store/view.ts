/* The Store (board 15; docs/STORE.md, ADR-0038): one in-app marketplace for everything installable, on the v7 kit. The shell draws it
   in the kit's wide Dialog (900 by 640): its head is "Store" with what stands at its end ("3 installed", "Sources"), its body this view.

   Browse is board 15's front page: the search Field, the kinds as filter Chips with the read's StatusLine at the line's end, then
   Recommended and every other kind as two columns of the kit's item rows (a 40 tile of letters or a mod's glyph, the name, one line
   of what it does, Get or Open). A search or a filter is one list of results under the count the host gives. An item's page leads with
   its item row and holds its facts as Cards of rows; the review is the form card with its hold; Installed is the item rows with their
   Switches; Sources is a Card of rows with Switches. The view never fetches: it reads and writes through `StoreProvider`, and shows each
   failure as the host's own sentence. An item's own text is marked `data-store-item`. */
import { itemTile, kit } from '@boopis/ui';
import { clipSpots, tipsIfClipped, watchCuts } from '../../core/clip';
import { STORE_ITEM } from '../../core/engine-words';
import { reduced } from '../../core/dom';
import type { FormOutcome, FormSpec, FormsSource, InstallPlan, InstallReceipt, StageResult, StoreBrowse, StoreDetail, StoreItem, StoreKind, StoreProvider, StoreScope, StoreSource, UpdateDiff } from '../../data';
import { ui } from '@boopis/ui';
import '../cards';
import { useFormsHost } from '../cards/forms-host';
import {
  errorCode, ENGINE_PLUGIN_NOTE, REMOTE_WORDS, isRemote, KIND_FILTERS, KIND_GROUP, KIND_LABEL, KIND_SHORT, STATE_WORDS, TIER_TIPS, TIER_WORDS, ageWords, byKind, countsWords, endWord, errorText, filterOf, hostsWords, isFront, licenseWords, pinWords, plural,
  markRef, outOfDate, readingWords, reviewSpec, scanWords, sourceState, stateOf
} from './model';
import { projectSwitch } from './policy';
import { keepFresh, readerFor } from './reading';
import type { Reading } from './reading';
import { focusForm } from '../cards/form';

export type StoreScreen = 'browse' | 'installed' | 'sources';
export interface StoreDeps {
  store: StoreProvider;
  toast: (text: string) => void;
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}
/** kit markup as an element, wired */
const make = (html: string): HTMLElement => { const t = document.createElement('template'); t.innerHTML = html.trim(); const n = t.content.firstElementChild as HTMLElement; kit.wire(n); return n; };
const sinkOf = (h: { submit(id: string, o: FormOutcome): Promise<void>; cancel(id: string): Promise<void> }): FormsSource => ({
  submit: h.submit, cancel: h.cancel, signin: () => Promise.reject(new Error('There is nothing to sign in to here.')),
  can: { signin: false, upload: false, folder: false }, pickerItems: () => [], pickFolder: () => Promise.resolve(null)
});
/** an item's tile: the kit's one rule (`itemTile`: a mod's glyph, board 15's Mods; else its brand's mark in colour, the owner, 27 November:
    conflict 30; else its letters) */
const tile = (i: Parameters<typeof markRef>[0]): { markText: string } | { markHTML: string } => itemTile(markRef(i), i.title ?? i.item_id ?? '');

export function mountStore(root: HTMLElement, deps: StoreDeps): StoreView {
  const { store } = deps;
  const settle = deps.settle ?? (reduced() ? 200 : 700);
  const now = (): number => (deps.now ? deps.now() : Date.now());
  const later = (fn: () => void): void => { window.setTimeout(fn, settle); };
  root.classList.add('hx-store');
  /* what stands at the head's end: the Dialog's own slot when the view is in one, else a line of its own over the view (a test's host) */
  const headEnd = root.closest('.k7-dialog')?.querySelector<HTMLElement>('.k7-dialog__end') ?? null;
  const end = headEnd ?? el('div', { class: 'hx-store__end' });
  const main = el('div', { class: 'hx-store__main', id: 'hx-store-main' });
  root.replaceChildren(...(headEnd ? [] : [end]), main);
  let screen: StoreScreen = 'browse';
  let came: StoreScreen = 'browse';   // where Sources goes back to
  let gen = 0;   // a screen drawn for an older request is dropped
  const reader = readerFor(store);

  const release = (): void => { useFormsHost(null); };
  const card = (spec: FormSpec, sink: FormsSource): HTMLElement => {
    useFormsHost(sink);
    const c = ui.card('form', spec as unknown as Record<string, unknown>, { size: 'inline', enter: deps.enter ?? true });
    queueMicrotask(() => { focusForm(c); });
    return c;
  };
  /* one polite line a screen reader hears, and the notice the person sees */
  const status = (): HTMLElement => el('p', { class: 'k7-sr', role: 'status', 'aria-live': 'polite', 'data-store-status': '' });
  const say = (text: string): void => { const s = main.querySelector('[data-store-status]'); if (s) s.textContent = text; deps.toast(text); };
  const board = (...kids: Node[]): HTMLElement => el('div', { class: 'hx-store__stack' }, ...kids);
  const empty = (text: string, action?: { label: string; run: () => void; attrs?: Record<string, string> }): HTMLElement => {
    const e = make(kit.html.emptyState({ text, ...(action ? { action: action.label } : {}) }));
    const b = e.querySelector('button');
    if (b && action) { for (const [k, v] of Object.entries(action.attrs ?? {})) b.setAttribute(k, v); b.addEventListener('click', action.run); }
    return e;
  };
  const back = (label: string, go: () => void): HTMLElement => { const b = kit.button({ label, size: 28, variant: 'ghost', icon: 'back', attrs: { 'data-store-back': '' } }); b.addEventListener('click', go); return b; };
  const head = (id: string, title: string, count?: string): string => kit.html.sectionHead({ title, ...(count ? { count } : {}), attrs: { id } });
  /* the head's end: on Browse how many are installed, on Installed the way to Sources */
  const drawEnd = (): void => {
    const go = screen === 'browse' ? { label: plural(store.installed.get().length, 'installed', 'installed'), to: 'installed' as const }
      : screen === 'installed' ? { label: 'Sources', to: 'sources' as const } : null;
    end.replaceChildren(...(go ? [kit.button({ label: go.label, size: 28, variant: 'ghost', iconEnd: 'chevron', attrs: { 'data-store-go': go.to } })] : []));
    end.querySelector('[data-store-go]')?.addEventListener('click', () => { came = screen; show(go?.to ?? 'browse'); });
  };
  /* when the store opens, nothing in it holds the focus yet (the dialog's frame or the page does): the search field takes it, since
     finding a thing is what a person opens the store for. A redraw keeps the focus on the control with the same id. */
  const nothingFocused = (): boolean => {
    const a = document.activeElement;
    if (!root.isConnected || (a && root.contains(a))) return false;
    const d = root.closest('dialog');
    return !a || a === document.body || (!!d && d.contains(a));
  };
  const place = (...kids: Node[]): void => {
    const a = document.activeElement instanceof HTMLElement && main.contains(document.activeElement) ? document.activeElement : null;
    const key = a ? a.id || [...a.attributes].filter((x) => x.name.startsWith('data-store-')).map((x) => '[' + x.name + '="' + CSS.escape(x.value) + '"]').join('') : '';
    main.replaceChildren(...kids);
    if (key) (a?.id ? main.querySelector<HTMLElement>('#' + CSS.escape(key)) : main.querySelector<HTMLElement>(key))?.focus({ preventScroll: true });
  };

  /* ───────── item rows ───────── */
  const installedList = (): readonly InstallReceipt[] => store.installed.get();
  const updatesList = (): readonly UpdateDiff[] => store.updates.get();
  /* an item is board 15's row: its tile, its name, what it does (with "Not reviewed" first when nobody has), and at its end Get, or Open
     once it is installed; a word before it only where the person needs one (an update, taken down, a key it needs). Get and Open both
     open its page: installing starts there, with the review. */
  function itemRow(item: StoreItem): string {
    const st = stateOf(item, installedList(), updatesList()), w = endWord(item, st);
    const word = st === 'installed' ? '' : w.word;
    return kit.html.listRow({
      variant: 'item', title: item.title, sub: (item.tier === 'not-reviewed' ? 'Not reviewed · ' : '') + item.summary.trim(), ...tile(item),
      action: st ? 'Open' : 'Get', actionAttrs: { 'data-store-open': item.id, 'aria-label': (st ? 'Open ' : 'Get ') + item.title },
      ...(word ? { endHTML: kit.html.statusWord({ text: word, tone: w.tone === 'attention' ? 'owe' : 'neutral' }) } : {}),
      attrs: { [STORE_ITEM]: '', 'data-store-item-row': item.id }
    });
  }
  /** a list of rows under its head, two columns wide (board 15) */
  function rowsSection(id: string, label: string, items: readonly StoreItem[]): HTMLElement {
    const s = el('section', { class: 'hx-store__group', 'aria-labelledby': id });
    s.innerHTML = head(id, label) + '<div class="hx-store__grid" role="list" aria-labelledby="' + id + '">' + items.map(itemRow).join('') + '</div>';
    kit.wire(s);
    return s;
  }
  /* a title or a line cut by the row's width shows whole in the tooltip while it is cut */
  let stopCuts: (() => void) | null = null;
  const watchList = (host: HTMLElement): void => { stopCuts?.(); stopCuts = watchCuts(host); };
  /* a press anywhere on a row opens its page, as its button does (the button is the keyboard's way) */
  main.addEventListener('click', (e) => {
    const t = e.target as Element;
    const b = t.closest<HTMLElement>('[data-store-open]');
    if (b) { void openItem(b.dataset['storeOpen'] ?? ''); return; }
    const r = t.closest<HTMLElement>('[data-store-item-row]');
    if (r && !t.closest('button, a, input')) void openItem(r.dataset['storeItemRow'] ?? '');
  });

  /* ───────── browse ───────── */
  const B = { query: '', kind: 'all' as 'all' | StoreKind, source: 'any', items: [] as StoreItem[], page: null as StoreBrowse | null, error: '' };
  async function drawBrowse(keep?: { focus?: string }): Promise<void> {
    const mine = ++gen;
    const sources = store.sources.get().filter((s) => s.enabled !== false);
    /* a kind shows its chip while a source that is on can list it (board 15: All, Skills, Connectors, Plugins, Mods) */
    const listed = new Set(sources.flatMap((s) => s.kinds));
    const kinds = KIND_FILTERS.filter(([v]) => v === 'all' || listed.has(v) || v === B.kind);
    const search = make(kit.html.field({ id: 'hx-store-q', kind: 'search', ariaLabel: 'Search the store', placeholder: 'Search skills, connectors, plugins and mods', value: B.query }));
    const chips = el('div', { class: 'hx-store__chips', role: 'group', 'aria-label': 'Kind' });
    chips.innerHTML = kinds.map(([value, label, name]) => kit.html.chip({ label, value, chosen: B.kind === value, attrs: { 'aria-label': name } })).join('');
    kit.wire(chips);
    /* the source, where more than one that is on has listed something: a select after the kinds (board 15 has one, so none) */
    const listing = sources.filter((s) => (s.items ?? 0) > 0);
    const srcName = (): string => B.source === 'any' ? 'All sources' : sources.find((s) => s.id === B.source)?.label ?? B.source;
    const pick = listing.length > 1 || B.source !== 'any' ? make(kit.html.selectorItem({ variant: 'field', label: 'Source', value: srcName(), attrs: { id: 'hx-store-source' } })) : null;
    const line = el('div', { class: 'hx-store__line' });
    const strip = el('div', { class: 'hx-store__filters' }, chips, ...(pick ? [pick] : []), line);
    const note = el('div', { class: 'hx-store__note' });
    const list = el('div', { class: 'hx-store__list' });
    place(board(search, strip, note, list, status()));
    drawEnd();
    let page0: StoreBrowse | null = null;
    let sawRead = false;   // a read ran while this page was showing: when it ends the line says the list is now current
    /* the line at the filters' end: the read as board 15 draws it ("Reading sources 0 of 1"), then "Up to date" once a read put the list
       right; while the list is out of date, a Notice under the filters says why with its way to fix it */
    const sayFresh = (): void => {
      const r = reader.state.get();
      const od = !r.running && page0 ? outOfDate(page0, now(), store.sources.get()) : null;
      if (r.running) sawRead = true;
      line.innerHTML = r.running ? kit.html.statusLine({ kind: 'system', phrase: 'Reading sources', count: `${String(r.done)} of ${String(r.total)}`, attrs: { 'data-store-read': '' } })
        : sawRead && page0 && !od ? kit.html.statusLine({ kind: 'system', phrase: 'Up to date', working: false, attrs: { 'data-store-read': '' } }) : '';
      const held = note.contains(document.activeElement);
      if (held) return;   /* never taken away from under the focus: a keyboard user who pressed Read again stays on it */
      note.replaceChildren(...(od ? [make(kit.html.notice({ text: freshWords(od.why, od.failed, page0?.refreshed_at ?? null), tone: od.why === 'failed' ? 'owe' : 'neutral',
        actions: [{ label: 'Read again', value: 'read' }, ...(od.failed ? [{ label: 'Show why', value: 'why', ghost: true }] : [])], attrs: { 'data-store-fresh': '' } }))] : []));
    };
    note.addEventListener('click', (e) => {
      const v = (e.target as Element).closest<HTMLElement>('[data-value]')?.dataset['value'];
      if (v === 'read') void reader.read(true);
      if (v === 'why') { came = 'browse'; show('sources'); }
    });
    const input = search.querySelector<HTMLInputElement>('input');
    /* Down from the field goes to the first result's button; Enter opens the only result */
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { const r = list.querySelector<HTMLElement>('[data-store-open]'); if (r) { e.preventDefault(); r.focus(); } }
      if (e.key === 'Enter') { const rows = list.querySelectorAll<HTMLElement>('[data-store-open]'); if (rows.length === 1) { e.preventDefault(); rows[0]?.click(); } }
      if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; B.query = ''; void load(false); }
    });
    /* the rows' buttons are one list for Up and Down, two columns read row by row; Up from the first goes back to the field */
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = [...list.querySelectorAll<HTMLElement>('[data-store-open]')], i = all.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      const n = i + (e.key === 'ArrowDown' ? 1 : -1);
      if (n < 0) input?.focus(); else all[Math.min(n, all.length - 1)]?.focus();
    });
    watchList(list);
    let timer = 0;
    input?.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { B.query = input.value; void load(false); }, 150); });
    /* the kinds are one choice: a chip pressed is the kind, and the others let go */
    chips.addEventListener('ui:change', (e) => {
      const c = (e.target as Element).closest<HTMLElement>('[data-kit~="Chip"]'); if (!c) return;
      B.kind = (c.dataset['value'] ?? 'all') as typeof B.kind;
      for (const x of chips.querySelectorAll<HTMLElement>('[data-kit~="Chip"]')) { const on = x === c; x.setAttribute('aria-pressed', String(on)); x.toggleAttribute('data-chosen', on); }
      void load(false);
    });
    pick?.addEventListener('click', () => {
      kit.openMenu(pick, { label: 'Source', place: 'below', align: 'end', entries: [{ label: 'All sources', value: 'any', role: 'menuitemradio', checked: B.source === 'any' }, ...listing.map((s) => ({ label: s.label, value: s.id, role: 'menuitemradio', checked: B.source === s.id }))],
        onSelect: (v) => { B.source = v; const val = pick.querySelector('.k7-sel__value'); if (val) val.textContent = srcName(); pick.setAttribute('aria-label', 'Source: ' + srcName()); void load(false); } });
    });
    if (keep?.focus) main.querySelector<HTMLElement>(keep.focus)?.focus();
    else if (nothingFocused()) input?.focus({ preventScroll: true });
    /* while the sources are read, the line says how far it is, and each source that finishes brings its items into the list (unless
       the list holds the focus: a keyboard user is not moved) */
    let doneSeen = reader.state.get().done;
    const off = reader.state.subscribe((r) => {
      if (mine !== gen || !list.isConnected) { off(); return; }
      sayFresh();
      if (r.done !== doneSeen || !r.running) { doneSeen = r.done; if (!list.contains(document.activeElement)) void load(false); }
    });

    async function load(more: boolean): Promise<void> {
      const filter = filterOf(B.kind, B.source);
      try {
        const page = B.query.trim() ? await store.search(B.query.trim(), filter, more ? B.page?.next_cursor : null) : await store.browse(filter, more ? B.page?.next_cursor : null);
        if (mine !== gen) return;
        B.error = ''; B.page = page; B.items = more ? [...B.items, ...page.items] : [...page.items];
        paint(page);
      } catch (e) {
        if (mine !== gen) return;
        B.error = errorText(e);
        list.replaceChildren(empty(B.error, { label: 'Try again', run: () => { void load(false); } }));
      }
    }
    function paint(page: StoreBrowse): void {
      page0 = page; sayFresh();
      const q = B.query.trim();
      const front = isFront(filterOf(B.kind, B.source), B.query);
      const rec = front ? (page.recommended ?? []) : [];
      const recIds = new Set(rec.map((i) => i.id));
      const rest = front ? B.items.filter((i) => !recIds.has(i.id)) : B.items;
      const parts: Node[] = [];
      /* the front page: Recommended (the host's list), then everything else by kind; a search or a filter: one list of results under
         the count the host gives */
      if (rec.length) parts.push(rowsSection('hx-store-rec', 'Recommended', rec));
      if (front) for (const g of byKind(rest)) parts.push(rowsSection('hx-store-k-' + g.kind, g.label, g.items));
      else if (rest.length) parts.push(rowsSection('hx-store-all', resultsWords(page.total, q), rest));
      if (!rec.length && !rest.length) {
        if (q || B.kind !== 'all' || B.source !== 'any') {
          const clear = { label: q ? 'Clear the search' : 'Show everything', attrs: { 'data-store-clear': '' }, run: (): void => { B.query = ''; B.kind = 'all'; B.source = 'any'; void drawBrowse({ focus: '#hx-store-q' }); } };
          const e = empty(q ? `Nothing matches “${q}”.` : 'Nothing listed here yet.', clear);
          parts.push(e);
          /* a search narrowed by kind or source that finds nothing may still find something without it: the empty state's one action
             becomes the wider search, with the host's own count */
          if (q && (B.kind !== 'all' || B.source !== 'any')) {
            store.search(q, filterOf('all', 'any'), null).then((wide) => {
              if (mine !== gen || !e.isConnected || !wide.total) return;
              const b = e.querySelector<HTMLElement>('button');
              if (!b || b.contains(document.activeElement)) return;
              const all = make(kit.html.button({ label: `Show ${plural(wide.total, 'result')} in every kind`, variant: 'primary', size: 32, attrs: { 'data-store-widen': '' } }));
              all.addEventListener('click', () => { B.kind = 'all'; B.source = 'any'; void drawBrowse({ focus: '#hx-store-q' }); });
              b.replaceWith(all);
            }).catch(() => undefined);
          }
        } else parts.push(empty(sources.length ? 'No source has listed anything yet.' : 'Every source is off.', { label: 'Sources', run: () => { came = 'browse'; show('sources'); } }));
      }
      if (page.next_cursor) { const more = kit.button({ label: 'Show more', size: 28, variant: 'tint', attrs: { 'data-store-more': '' } }); more.addEventListener('click', () => { void load(true); }); parts.push(more); }
      list.replaceChildren(...parts);
      tipsIfClipped(clipSpots(list));
    }
    /* "3 results for “git” in Skills": the host's count, then what narrowed it */
    function resultsWords(total: number, q: string): string {
      const kind = B.kind !== 'all' ? KIND_GROUP[B.kind] : '';
      const src = B.source !== 'any' ? sources.find((s) => s.id === B.source)?.label ?? B.source : '';
      return plural(total, 'result') + (q ? ' for “' + q + '”' : '') + (kind ? ' in ' + kind : '') + (src ? ' from ' + src : '');
    }
    await load(false);
  }
  /** the out-of-date Notice's one sentence: what is wrong (its reasons are on Sources) */
  function freshWords(why: string, failed: number, at: string | null): string {
    if (why === 'offline') return at ? `You are offline: this copy is from ${ageWords(at, now())}.` : 'You are offline: this is the last saved copy.';
    if (why === 'failed') return failed === 1 ? 'A source could not be read.' : `${String(failed)} sources could not be read.`;
    if (why === 'unread') return 'Some sources have not been read yet.';
    return 'This list is out of date.';
  }

  /* ───────── an item's page ───────── */
  async function openItem(id: string, from: StoreScreen = screen): Promise<void> {
    let d: StoreDetail;
    try { d = await store.detail(id); } catch (e) { place(board(back(from === 'installed' ? 'Installed' : 'Store', () => { show(from); }), empty(errorText(e)), status())); return; }
    drawDetail(d, from);
  }
  function drawDetail(d: StoreDetail, from: StoreScreen): void {
    gen++;
    const it = d.item, st = stateOf(it, installedList(), updatesList());
    const srcLabel = store.sources.get().find((s) => s.id === it.source)?.label ?? it.source;
    const prov = it.provenance;
    /* reference data: a Card of rows, each fact's name and its value under it (they wrap: nothing is cut) */
    const cardOf = (id: string, label: string, rows: ReadonlyArray<readonly [string, string]>): string =>
      '<section class="hx-store__facts" aria-labelledby="hx-store-d-' + id + '">' + head('hx-store-d-' + id, label) + kit.html.card({ variant: 'settings', rows: rows.map(([l, v]) => ({ label: l, sub: v, attrs: { [STORE_ITEM]: '' } })) }) + '</section>';
    const warn: Array<readonly [string, string]> = [];
    if (it.removed) warn.push(['Taken down', `${it.removed.reason}. It cannot be installed${d.installed ? ' and is off from the next session' : ''}.`]);
    if (!it.pinned) warn.push(['Not pinned', 'Not pinned to a version, so boopis will not install it.']);
    if (isRemote(it.pinned)) warn.push(['Hosted by the publisher', REMOTE_WORDS]);
    if (it.tier === 'not-reviewed') warn.push(['Not reviewed', TIER_TIPS['not-reviewed']]);
    if (it.kind === 'engine-plugin') warn.push(['Runs inside the engine', ENGINE_PLUGIN_NOTE]);
    if (d.update?.status === 'available') warn.push(['Update available', d.update.widened ? 'It adds new code, hosts or keys.' : 'A newer version is listed.']);
    const facts = [
      cardOf('about', 'About', [['Summary', it.summary], ...(it.tags?.length ? [['Topics', it.tags.join(', ')] as const] : [])]),
      warn.length ? cardOf('notes', 'Read first', warn) : '',
      cardOf('reach', 'What it needs and reaches', [['Keys', it.secrets.length ? it.secrets.map((s) => s.title + (s.optional ? ' (optional)' : '')).join('; ') + '. They go to your keychain.' : 'None'], ['Hosts', hostsWords(it.hosts, it.verified)]]),
      cardOf('adds', 'What it adds', [['Contents', countsWords(it.components)], ['Tools and context', d.cost.tools == null ? 'Not known. Every tool loads in every session.' : `${plural(d.cost.tools, 'tool')}${d.cost.context_tokens == null ? '' : ', about ' + String(d.cost.context_tokens) + ' tokens'}. Every tool loads in every session.`]]),
      cardOf('prov', 'Where it comes from', [
        ['Source', `${srcLabel}${prov.source_tier && it.source !== 'boopis' ? ', which calls it ' + prov.source_tier : ''}`],
        ...(it.source === 'boopis' && prov.source_tier ? [['Why it is listed', prov.source_tier.charAt(0).toUpperCase() + prov.source_tier.slice(1)] as const] : []),
        ['Publisher', it.publisher + (prov.namespace_proof === 'none' ? ' (not proved)' : '')], ['Pinned to', pinWords(it.pinned)], ['Folder hash', prov.tree_sha256 ?? 'Known once downloaded'],
        ['Check', scanWords(prov.scan.verdict) + (prov.scan.findings.length ? ': ' + prov.scan.findings.map((f) => f.text).join('; ') : '')],
        ['Last updated', prov.last_updated ? ageWords(prov.last_updated, now()) : 'Not known'], ['Licence', licenseWords(it.license)], ['Checked by boopis', it.verified ?? 'Nobody'],
        ...(it.homepage ? [['Home page', it.homepage] as const] : [])
      ]),
      cardOf('gov', 'In governed sessions', [['Governed mode', d.governed.text]]),
      d.installed ? cardOf('have', 'Installed', [['Version', `${d.installed.version ?? 'not stated'}, ${d.installed.enabled ? 'on' : 'off'}, for ${d.installed.scope.bot}${d.installed.scope.project ? ' and ' + d.installed.scope.project : ''}`]]) : ''
    ].join('');
    /* the head is the item's own row: its tile, its name, what it is (kind, publisher, tier, state), and the one action */
    const canInstall = !d.installed && !it.removed && !!it.pinned;
    const primary = d.update?.status === 'available' ? 'Review the update' : canInstall ? 'Review and install' : '';
    const blocked = !!primary && !store.can.install;
    const meta = [KIND_SHORT[it.kind] + ' by ' + it.publisher, TIER_WORDS[it.tier], st ? STATE_WORDS[st] : ''].filter(Boolean).join(' · ');
    const hero = make('<div class="hx-store__hero" role="list" aria-label="' + it.title.replace(/[&<>"]/g, '') + '">' + kit.html.listRow({ variant: 'item', title: it.title, sub: meta, ...tile(it), ...(primary ? { action: primary, actionAttrs: { 'data-store-review': it.id, ...(blocked ? { 'aria-disabled': 'true', 'data-tip': store.can.reason ?? 'This build cannot install' } : {}) } } : {}), attrs: { [STORE_ITEM]: '' } }) + '</div>');
    /* an installed item's own actions: Roll back when a version is kept, Remove */
    const have = installedList().find((r) => r.item_id === it.id);
    const acts = have ? make('<div class="hx-store__acts">' + [have.previous ? kit.html.button({ label: 'Roll back', size: 28, variant: 'tint', attrs: { 'data-store-rollback': it.id } }) : '', kit.html.button({ label: 'Remove', size: 28, variant: 'ghost', attrs: { 'data-store-remove': it.id } })].join('') + '</div>') : null;
    const body = el('div', { class: 'hx-store__sheet', 'aria-label': 'About ' + it.title, role: 'region' });
    body.innerHTML = facts;
    kit.wire(body);
    place(board(back(from === 'installed' ? 'Installed' : 'Store', () => { show(from); }), hero, ...(acts ? [acts] : []), body, status()));
    end.replaceChildren();
    hero.querySelector('[data-store-review]')?.addEventListener('click', (e) => { if ((e.currentTarget as HTMLElement).getAttribute('aria-disabled') === 'true') return; void startReview(it.id, d.update?.status === 'available' ? 'update' : 'install', from); });
    acts?.querySelector('[data-store-rollback]')?.addEventListener('click', () => { rollback(it.id); });
    acts?.querySelector('[data-store-remove]')?.addEventListener('click', () => { if (have) removeFlow(have, from); });
    (hero.querySelector<HTMLElement>('[data-store-review]') ?? main.querySelector<HTMLElement>('[data-store-back]'))?.focus();
  }
  const rollback = (id: string): void => { store.rollback(id).then((r) => { say(`${r.title ?? id} is back at ${r.version ?? 'its earlier version'}.`); }).catch((e: unknown) => { say(errorText(e)); }); };

  /* ───────── review ───────── */
  async function startReview(id: string, mode: 'install' | 'update', from: StoreScreen, scope?: StoreScope): Promise<void> {
    place(board(make(kit.html.statusLine({ kind: 'system', phrase: 'Checking it. Nothing runs.' })), status()));
    let out: { stage: StageResult; plan: InstallPlan };
    try { out = mode === 'update' ? await store.reviewUpdate(id) : await store.review(id, scope); } catch (e) { place(board(back('Back', () => { void openItem(id, from); }), empty(errorText(e)), status())); return; }
    drawReview(out.stage, out.plan, mode, from);
  }
  function drawReview(stage: StageResult, plan: InstallPlan, mode: 'install' | 'update', from: StoreScreen): void {
    const project = deps.project?.() ?? null;
    const diff = mode === 'update' ? updatesList().find((d) => d.item_id === plan.item_id) ?? null : null;
    const result = el('div', { class: 'hx-store__stack', 'aria-live': 'polite' });
    const kids: Node[] = [];
    const scopeBox = el('div', { class: 'hx-store__scope' });
    if (project && mode === 'install') {
      const drawScope = (blocked: boolean): void => {
        const items = [{ value: 'bot', label: 'This bot' }, ...(blocked ? [] : [{ value: 'bot-project', label: 'This bot, trusted here' }])];
        const seg = make(kit.html.segmented({ label: 'Install for', items, value: blocked ? 'bot' : plan.scope.level }));
        seg.addEventListener('ui:change', (e) => { const level = (e as CustomEvent<{ value: 'bot' | 'bot-project' }>).detail.value; void startReview(plan.item_id, mode, from, { level, bot: plan.scope.bot, ...(level === 'bot-project' ? { project } : {}) }); });
        scopeBox.replaceChildren(seg, ...(blocked ? [make(kit.html.notice({ text: 'Plugin hooks are off in this project, so it installs for this bot only.' }))] : []));
      };
      drawScope(false);
      const hasHooks = plan.components.some((c) => c.type === 'hook');
      if (hasHooks) store.projectPolicy(project).then((p) => { if (p.effective) drawScope(true); }).catch(() => undefined);
      kids.push(scopeBox);
    }
    const spec = reviewSpec(plan, { update: diff });
    const c = card(spec, sinkOf({
      async submit(_id, o) {
        const restart = o.values['restart'];
        let r: InstallReceipt;
        try { r = await store.install({ stage_id: stage.stage_id, plan_hash: plan.plan_hash, ...(Object.keys(o.secrets).length ? { secrets: o.secrets } : {}), ...(restart === 'now' || restart === 'when-idle' ? { restart } : {}) }); } catch (e) {
          /* what was shown is no longer what would be installed: the way on is a fresh review */
          if (['hx.store.plan_changed', 'hx.store.stage_missing'].includes(errorCode(e))) {
            const n = make(kit.html.notice({ text: 'Nothing was installed: it changed since the review.', actions: [{ label: 'Review again', primary: true, value: 'again' }] }));
            n.querySelector('[data-value="again"]')?.addEventListener('click', () => { void startReview(plan.item_id, mode, from); });
            result.replaceChildren(n);
          }
          throw new Error(errorText(e));
        }
        later(() => { drawDone(r, result, from); });
      },
      cancel() { void openItem(plan.item_id, from); return Promise.resolve(); }
    }));
    kids.push(c, result);
    place(board(...kids, status()));
    end.replaceChildren();
  }
  function drawDone(r: InstallReceipt, into: HTMLElement, from: StoreScreen): void {
    const rows = [...r.steps.map((s) => ({ label: s.name, value: s.ok ? 'done' : 'failed', ...(s.note ? { sub: s.note } : {}) })), ...r.notes.map((n) => ({ label: n, wrap: true }))];
    const box = make('<section class="hx-store__facts" aria-labelledby="hx-store-done">' + head('hx-store-done', `${r.title ?? r.item_id} is installed`) + kit.html.card({ variant: 'settings', rows }) +
      (r.restart_needed ? kit.html.notice({ text: 'The engine restarts when no turn is running.' }) : '') + '<div class="hx-store__acts">' +
      kit.html.button({ label: 'See what is installed', variant: 'primary', size: 28, attrs: { 'data-store-done': 'installed' } }) + kit.html.button({ label: 'Back to the store', variant: 'ghost', size: 28, attrs: { 'data-store-done': 'back' } }) + '</div></section>');
    box.querySelector('[data-store-done="installed"]')?.addEventListener('click', () => { show('installed'); });
    box.querySelector('[data-store-done="back"]')?.addEventListener('click', () => { show(from === 'installed' ? 'installed' : 'browse'); });
    into.replaceChildren(box);
  }

  /* ───────── installed ───────── */
  async function drawInstalled(): Promise<void> {
    const list = installedList(), ups = updatesList();
    const byId = new Map(ups.map((d) => [d.item_id, d]));
    const blocks: Node[] = [];
    const killed = list.filter((r) => r.kill_listed);
    /* taken down by their source: one Notice, the one action on it when there is one item */
    const k0 = killed[0];
    if (killed.length === 1 && k0) {
      const n = make(kit.html.notice({ tone: 'owe', text: `${k0.title ?? k0.item_id} was taken down by its source.`, actions: [{ label: 'Remove', value: 'remove' }], attrs: { 'data-store-kill': '' } }));
      n.querySelector('[data-value="remove"]')?.addEventListener('click', () => { removeFlow(k0, 'installed'); });
      blocks.push(n);
    } else if (killed.length > 1) blocks.push(make(kit.html.notice({ tone: 'owe', text: `${String(killed.length)} items were taken down by their sources.`, attrs: { 'data-store-kill': '' } })));
    const rows = list.map((r) => {
      const u = byId.get(r.item_id);
      const name = r.title ?? r.item_id;
      const word = r.kill_listed ? kit.html.statusWord({ text: 'taken down', tone: 'owe' }) : u?.status === 'available' ? kit.html.statusWord({ text: 'update', tone: 'neutral' }) : '';
      const sub = `${KIND_LABEL[r.kind]}${r.version ? ' ' + r.version : ''} · for ${r.scope.bot}${r.scope.project ? ', trusted in ' + r.scope.project : ''} · ${ageWords(r.installed_at, now())}`;
      return kit.html.listRow({ variant: 'item', title: name, sub, ...tile(r), action: 'Open', actionAttrs: { 'data-store-open': r.item_id, 'aria-label': 'Open ' + name },
        endHTML: word + kit.html.switch({ checked: r.enabled, label: name + (r.enabled ? ' is on' : ' is off'), attrs: { 'data-store-switch': r.item_id } }), attrs: { [STORE_ITEM]: '', 'data-store-item-row': r.item_id } });
    });
    const have = el('section', { class: 'hx-store__group', 'aria-labelledby': 'hx-store-have' });
    have.innerHTML = head('hx-store-have', 'Installed', list.length ? String(list.length) : undefined) + (list.length ? '<div class="hx-store__grid" data-one role="list" aria-labelledby="hx-store-have">' + rows.join('') + '</div>' : kit.html.emptyState({ text: 'Nothing installed yet.' }));
    kit.wire(have);
    blocks.push(have);
    const check = kit.button({ label: 'Check for updates', size: 28, variant: 'tint', attrs: { 'data-store-check': '' } });
    check.addEventListener('click', () => {
      store.checkUpdates().then((f) => { say(f.length ? `${plural(f.length, 'update')} found.` : 'Everything is up to date.'); }).then(() => drawInstalled()).catch((e: unknown) => { say(errorText(e)); });
    });
    const project = deps.project?.() ?? null;
    const pol = project ? el('section', { class: 'hx-store__facts', 'aria-labelledby': 'hx-store-proj' }) : null;
    if (pol) { pol.innerHTML = head('hx-store-proj', 'This project'); pol.append(projectSwitch(store, project as string, say)); }
    place(board(back('Store', () => { show('browse'); }), el('div', { class: 'hx-store__acts' }, check), ...blocks, ...(pol ? [pol] : []), status()));
    drawEnd();
    for (const sw of main.querySelectorAll<HTMLElement>('[data-store-switch]')) sw.addEventListener('ui:change', (e) => {
      const want = !!(e as CustomEvent<{ value: boolean }>).detail.value, id = sw.dataset['storeSwitch'] ?? '';
      store.setEnabled(id, want).then(() => { say(`${list.find((r) => r.item_id === id)?.title ?? id} is ${want ? 'on' : 'off'} from the next session.`); }).catch((e2: unknown) => { sw.setAttribute('aria-checked', String(!want)); say(errorText(e2)); });
    });
  }
  function removeFlow(r: InstallReceipt, from: StoreScreen): void {
    const name = r.title ?? r.item_id;
    const spec: FormSpec = {
      id: 'store.remove.' + r.item_id, kind: 'choice', title: `Remove ${name}?`, origin: { kind: 'host' }, defer: false,
      why: 'Gone from the next session.',
      schema: { properties: { keys: { type: 'string', title: 'Its keys', enum: ['keep', 'delete'], enumNames: ['Keep them in my keychain', 'Delete them too'], default: 'keep' } }, required: ['keys'] },
      submit: { label: 'Remove', hold: true }, cancel: { label: 'Keep it' }, receipt: `Removed ${name}`
    };
    place(board(card(spec, sinkOf({
      async submit(_id, o) {
        try { const u = await store.uninstall(r.item_id, { deleteSecrets: o.values['keys'] === 'delete' }); deps.toast([`Removed ${name}.`, u.kept_secrets.length ? 'Its keys stay in your keychain.' : ''].filter(Boolean).join(' ')); } catch (e) { throw new Error(errorText(e)); }
        later(() => { show('installed'); });
      },
      cancel() { show(from); return Promise.resolve(); }
    })), status()));
    end.replaceChildren();
  }

  /* ───────── sources ───────── */
  async function drawSources(): Promise<void> {
    const list: readonly StoreSource[] = store.sources.get();
    const reading: Reading = reader.state.get();
    const rows = list.map((s) => {
      const state = sourceState(s, now(), reading.states.get(s.id));
      const word = state.word === 'reading' ? kit.html.statusWord({ text: 'reading', pulse: true }) : state.word === 'trouble' ? kit.html.statusWord({ text: 'could not read', tone: 'owe' }) : '';
      const controls = word + kit.html.switch({ checked: s.enabled !== false, label: s.label + (s.enabled === false ? ' is off' : ' is on'), attrs: { 'data-store-src': s.id } }) +
        (s.user_added ? kit.html.button({ label: 'Remove', size: 28, variant: 'ghost', attrs: { 'data-store-src-remove': s.id, 'aria-label': 'Remove ' + s.label } }) : '');
      return { label: s.label, sub: state.text, control: '<span class="hx-set__acts">' + controls + '</span>', attrs: { [STORE_ITEM]: '' } };
    });
    const sec = el('section', { class: 'hx-store__facts', 'aria-labelledby': 'hx-store-src' });
    sec.innerHTML = head('hx-store-src', 'Sources') + (list.length ? kit.html.card({ variant: 'settings', rows }) : kit.html.emptyState({ text: 'No sources.' })) +
      head('hx-store-add', 'Add a source') + kit.html.card({ variant: 'settings', rows: [{ label: 'A marketplace, repository or folder', sub: 'Its items start as not reviewed.', control: kit.html.button({ label: 'Add', size: 28, variant: 'tint', attrs: { 'data-store-src-add': '', 'aria-label': 'Add a source' } }) }] });
    kit.wire(sec);
    /* not disabled while a read runs (the focus would be lost as the rows redraw): a second press joins the read in progress */
    const refresh = kit.button({ label: 'Read the sources again', size: 28, variant: 'tint', attrs: { id: 'hx-store-read' } });
    refresh.addEventListener('click', () => { void reader.read(true).then(() => { say(readingWords(reader.state.get())); }); });
    const line = reading.running ? make(kit.html.statusLine({ kind: 'system', phrase: 'Reading sources', count: `${String(reading.done)} of ${String(reading.total)}` })) : null;
    place(board(back(came === 'installed' ? 'Installed' : 'Store', () => { show(came); }), el('div', { class: 'hx-store__acts' }, refresh, ...(line ? [line] : [])), sec, status()));
    drawEnd();
    for (const sw of main.querySelectorAll<HTMLElement>('[data-store-src]')) sw.addEventListener('ui:change', (e) => {
      const want = !!(e as CustomEvent<{ value: boolean }>).detail.value;
      store.setSourceEnabled(sw.dataset['storeSrc'] ?? '', want).then(() => drawSources()).catch((e2: unknown) => { sw.setAttribute('aria-checked', String(!want)); say(errorText(e2)); });
    });
    for (const b of main.querySelectorAll<HTMLElement>('[data-store-src-remove]')) b.addEventListener('click', () => { store.removeSource(b.dataset['storeSrcRemove'] ?? '').then(() => drawSources()).catch((e: unknown) => { say(errorText(e)); }); });
    main.querySelector('[data-store-src-add]')?.addEventListener('click', addFlow);
  }
  function addFlow(): void {
    const spec: FormSpec = {
      id: 'store.source.add', kind: 'setup', title: 'Add a source', origin: { kind: 'host' }, defer: false,
      why: 'Nothing in it installs without a review.',
      schema: { properties: { where: { type: 'string', title: 'Address or folder', placeholder: 'https://example.com/plugins', 'x-mono': true } }, required: ['where'] },
      submit: { label: 'Add source' }, cancel: { label: 'Back' }, receipt: 'Added. Its items show in the store.'
    };
    place(board(card(spec, sinkOf({
      async submit(_id, o) {
        const where = String(o.values['where'] ?? '').trim();
        const asUrl = /^(https?:\/\/|git@|ssh:\/\/|github\.com\/)/.test(where);
        try { await store.addSource(asUrl ? { url: where.startsWith('github.com/') ? 'https://' + where : where } : { path: where }); } catch (e) { throw new Error(errorText(e)); }
        later(() => { show('sources'); });
      },
      cancel() { show('sources'); return Promise.resolve(); }
    })), status()));
    end.replaceChildren();
  }

  /* ───────── the view's own frame ───────── */
  function show(s: StoreScreen, itemId?: string): void {
    screen = s; gen++; release();
    if (itemId) { void openItem(itemId, s); return; }
    if (s === 'browse') void drawBrowse();
    else if (s === 'installed') void drawInstalled();
    else void drawSources();
  }
  const keep = (fn: () => void) => (): void => { if (root.isConnected && main.querySelector('[data-store-status]') && !main.querySelector('hx-card[data-kind="form"]')) fn(); };
  store.installed.subscribe(keep(() => { if (screen === 'installed' && !main.querySelector('.hx-store__hero')) void drawInstalled(); else if (screen === 'browse') drawEnd(); }));
  store.sources.subscribe(keep(() => { if (screen === 'sources') void drawSources(); }));
  reader.state.subscribe(keep(() => { if (screen === 'sources') void drawSources(); }));
  show('browse');
  /* while the store stays open, the sources that fall due are read again: a copy ages whether or not anyone presses anything. A
     closed store (its dialog shut, or the view gone) reads nothing. */
  const isOpen = (): boolean => { if (!root.isConnected) return false; const d = root.closest('dialog'); return !d || d.open; };
  const stopFresh = keepFresh(store, { open: isOpen, now, ...(deps.every ? { every: deps.every } : {}) });
  return { show, refresh: async () => { show(screen); }, readDue: () => reader.readDue(), stop: stopFresh };
}
