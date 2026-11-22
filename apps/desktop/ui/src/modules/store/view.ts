/* The store view (docs/STORE.md, ADR-0038): one in-app marketplace for everything installable. Composed from the kit and the
   patterns the Connectors tab already uses (settings rows, the card layer's form card with its hold, segmented controls, the
   search field, the themed select, empty states), for the owner's review: it adds no component. Screens: Browse (Recommended
   on the front page, search, a kind filter, a source filter), a detail sheet, the review card, Installed (switches, Update with
   its diff, Roll back, Remove, kill-list banners) and Sources. The view never fetches: it reads and writes through
   `StoreProvider` and shows each failure as the host's own sentence. An item's own text is marked `data-store-item`. */
import { progressDots, setProgress, ui } from '@boopis/ui';
import { storeItem } from '../../core/engine-words';
import { reduced } from '../../core/dom';
import type { FormOutcome, FormSpec, FormsSource, InstallPlan, InstallReceipt, StageResult, StoreBrowse, StoreDetail, StoreItem, StoreKind, StoreProvider, StoreScope, StoreSource, UpdateDiff } from '../../data';
import '../cards';
import { useFormsHost } from '../cards/forms-host';
import {
  errorCode, ENGINE_PLUGIN_NOTE, REMOTE_WORDS, isRemote, KIND_FILTERS, KIND_LABEL, STATE_WORDS, TIER_TIPS, TIER_WORDS, ageWords, countsWords, errorText, filterOf, hostsWords, isFront, licenseWords, pinWords, plural,
  outOfDate, READ_BADGE, readingWords, reviewSpec, scanWords, sourceState, stateOf, upToDateWords
} from './model';
import { projectSwitch } from './policy';
import { keepFresh, readerFor } from './reading';
import type { Reading } from './reading';

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

const SCREENS: ReadonlyArray<readonly [StoreScreen, string]> = [['browse', 'Browse'], ['installed', 'Installed'], ['sources', 'Sources']];

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

export function mountStore(root: HTMLElement, deps: StoreDeps): StoreView {
  const { store } = deps;
  const settle = deps.settle ?? (reduced() ? 200 : 700);
  const now = (): number => (deps.now ? deps.now() : Date.now());
  const later = (fn: () => void): void => { window.setTimeout(fn, settle); };
  root.classList.add('hx-store');
  const tabs = ui.segmented({ mode: 'tabs', label: 'Store', value: 'browse', options: SCREENS.map(([value, label]) => ({ value, label })), controls: { browse: 'hx-store-main', installed: 'hx-store-main', sources: 'hx-store-main' } });
  const head = el('div', { class: 'hx-store__head' }, tabs);
  const main = el('div', { class: 'hx-store__main', id: 'hx-store-main', role: 'tabpanel' });
  root.replaceChildren(head, main);
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
  const say = (text: string): void => { const s = main.querySelector('[data-store-status]'); if (s) s.textContent = text; deps.toast(text); };
  const board = (...kids: Node[]): HTMLElement => el('div', { class: 'hx-store__stack' }, ...kids);
  const notice = (title: string, text: string, again?: () => void): HTMLElement => {
    const e = ui.empty({ title, text, ...(again ? { action: ui.html.button({ label: 'Try again', size: 's' }) } : {}) });
    if (again) e.querySelector('button')?.addEventListener('click', again);
    return e;
  };
  const back = (label: string, go: () => void): HTMLElement => { const b = ui.button({ label, size: 's', variant: 'ghost' }); b.addEventListener('click', go); return b; };
  /* A screen that redraws itself (a switch was turned and the list came back) keeps the focus where it was: the control with the same
     id takes it again, so a keyboard user is not sent back to the top of the page after every switch. */
  const place = (...kids: Node[]): void => {
    const held = document.activeElement instanceof HTMLElement && main.contains(document.activeElement) ? document.activeElement.id : '';
    main.replaceChildren(...kids);
    if (held) main.querySelector<HTMLElement>('#' + CSS.escape(held))?.focus({ preventScroll: true });
  };

  /* ───────── rows ───────── */
  const installedList = (): readonly InstallReceipt[] => store.installed.get();
  const updatesList = (): readonly UpdateDiff[] => store.updates.get();
  function itemRow(item: StoreItem): string {
    const st = stateOf(item, installedList(), updatesList());
    const hint = `${KIND_LABEL[item.kind]} by ${item.publisher}. ${item.summary} ${TIER_WORDS[item.tier]}.${item.pinned ? '' : ' Not pinned, so it cannot be installed.'}`;
    const control = '<span class="ui-set__actions">' + (st ? ui.html.badge({ label: STATE_WORDS[st] }) : '') +
      ui.html.button({ label: 'Details', size: 's', attrs: { 'data-store-open': item.id, 'aria-label': 'Details for ' + item.title } }) + '</span>';
    return storeItem(ui.html.setRow({ label: item.title, hint, control }));
  }
  const wireRows = (host: HTMLElement): void => {
    ui.hydrate(host);
    for (const b of host.querySelectorAll<HTMLElement>('[data-store-open]')) b.addEventListener('click', () => { void openItem(b.dataset['storeOpen'] ?? ''); });
  };

  /* ───────── browse ───────── */
  const B = { query: '', kind: 'all' as 'all' | StoreKind, source: 'any', items: [] as StoreItem[], page: null as StoreBrowse | null, error: '' };
  async function drawBrowse(keep?: { focus?: string }): Promise<void> {
    const mine = ++gen;
    const sources = store.sources.get().filter((s) => s.enabled !== false);
    const search = ui.search({ size: 'm', label: 'Search the store', placeholder: 'Search skills, connectors, plugins and mods', value: B.query, id: 'hx-store-q' });
    /* the kind filter is the kit's option chips (a radio group, as the bot settings' schedule presets): they wrap at a narrow
       width, where a segmented control of six options cut every label to a few letters */
    const seg = ui.chipGroup({ label: 'Kind', value: B.kind, options: KIND_FILTERS.map(([value, label]) => ({ value, label })) });
    const pick = ui.select({ id: 'hx-store-source', label: 'Source', entries: [{ value: 'any', label: 'All sources' }, ...sources.map((s) => ({ value: s.id, label: s.label }))], value: B.source });
    const strip = el('div', { class: 'hx-store__filters' }, seg, pick);
    const status = el('p', { class: 'ui-field__hint', role: 'status', 'aria-live': 'polite', 'data-store-status': '' });
    const again = ui.button({ label: 'Read the sources again', size: 's' });
    again.addEventListener('click', () => { void reader.read(true); });
    const why = ui.button({ label: 'Show why', size: 's', variant: 'ghost', attrs: { 'aria-label': 'Show why the sources could not be read' } });
    why.addEventListener('click', () => { show('sources'); });
    const dots = progressDots({ value: 0, label: 'Reading the sources', dots: 8 });
    const note = el('div', { class: 'hx-store__note' }, status);
    /* the progress of a read, source by source: each says waiting, being read, or what came of it, and the items each brings
       show in the list below as it finishes */
    const reading = el('div', { class: 'hx-store__reading' });
    const list = el('div', { class: 'hx-store__list' });
    place(board(search, strip, note, reading, list));
    let page0: StoreBrowse | null = null;
    let sawRead = false;   // a read ran while this page was showing: when it ends the line says whether the list is now current
    const drawReading = (r: Reading): void => {
      if (!r.running) { reading.replaceChildren(); return; }
      const byId = new Map(store.sources.get().map((s) => [s.id, s]));
      const rows = r.order.map((id) => {
        const s = byId.get(id);
        if (!s) return '';
        const mode = r.states.get(id);
        const word = mode ?? (s.error ? 'failed' : 'done');
        const badge = ui.html.badge({ label: READ_BADGE[word] });
        return storeItem(ui.html.setRow({ label: s.label, hint: sourceState(s, now(), mode).text, control: '<span class="ui-set__actions">' + badge + '</span>' }));
      });
      const sec = section('hx-store-reading', 'Reading the sources', rows.join(''));
      setProgress(dots, r.total ? Math.round((r.done / r.total) * 100) : 0);
      reading.replaceChildren(sec);
    };
    /* the line over the list: a read in progress, else why the list is out of date with the way to fix it, else (after a read
       that put it right) that it is current */
    const sayFresh = (): void => {
      const r = reader.state.get();
      const od = !r.running && page0 ? outOfDate(page0, now(), store.sources.get()) : null;
      if (r.running) sawRead = true;
      const text = r.running ? readingWords(r) + ' What they list shows here as each one is read.' : od ? od.text : sawRead && page0 ? upToDateWords(r) : '';
      status.textContent = text;
      drawReading(r);
      /* the fix is offered while the list is out of date and while a read runs (a second press joins it); never taken away from
         under the focus, so a keyboard user who pressed it stays on it. Where sources could not be read, the line also offers
         their reasons. */
      const offer = r.running || !!od;
      const wantWhy = !r.running && !!od && od.failed > 0;
      if (r.running && !dots.isConnected) note.insertBefore(dots, status); else if (!r.running && dots.isConnected) dots.remove();
      if (offer && !again.isConnected) note.append(again); else if (!offer && again.isConnected && !again.contains(document.activeElement)) again.remove();
      if (wantWhy && !why.isConnected) note.append(why); else if (!wantWhy && why.isConnected && !why.contains(document.activeElement)) why.remove();
    };
    const input = search.querySelector<HTMLInputElement>('input');
    let timer = 0;
    input?.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => { B.query = input.value; void load(false); }, 150); });
    seg.addEventListener('ui:change', (e) => { B.kind = (e as CustomEvent<{ value: string }>).detail.value as typeof B.kind; void load(false); });
    pick.addEventListener('ui:change', (e) => { B.source = (e as CustomEvent<{ value: string }>).detail.value; void load(false); });
    if (keep?.focus) main.querySelector<HTMLElement>(keep.focus)?.focus();
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
        const page = B.query.trim() ? await store.search(B.query.trim(), filter, more ? B.page?.next_cursor : null) : await store.browse(filter, more ? B.page?.next_cursor : null);
        if (mine !== gen) return;
        B.error = ''; B.page = page; B.items = more ? [...B.items, ...page.items] : [...page.items];
        paint(page);
      } catch (e) {
        if (mine !== gen) return;
        B.error = errorText(e);
        list.replaceChildren(notice('The store did not load', B.error, () => { void load(false); }));
      }
    }
    function paint(page: StoreBrowse): void {
      page0 = page; sayFresh();
      const front = isFront(filterOf(B.kind, B.source), B.query);
      const rec = front ? (page.recommended ?? []) : [];
      const recIds = new Set(rec.map((i) => i.id));
      const rest = front ? B.items.filter((i) => !recIds.has(i.id)) : B.items;
      const parts: Node[] = [];
      if (rec.length) parts.push(section('hx-store-rec', 'Recommended', rec.map(itemRow).join('')));
      if (rest.length) parts.push(section('hx-store-all', front ? 'Everything else' : plural(page.total, 'result'), rest.map(itemRow).join('')));
      if (!rec.length && !rest.length) {
        parts.push(B.query.trim() ? notice('Nothing matches', `Nothing in the store matches “${B.query.trim()}”. Try fewer words, another kind, or all sources.`)
          : notice('The store is empty', sources.length ? 'No source has listed anything yet. Open Sources to read them again.' : 'Every source is off. Switch one on in Sources.'));
      }
      if (page.next_cursor) { const more = ui.button({ label: 'Show more', size: 's' }); more.addEventListener('click', () => { void load(true); }); parts.push(more); }
      list.replaceChildren(...parts);
      wireRows(list);
    }
    await load(false);
  }
  function section(id: string, label: string, rows: string): HTMLElement {
    const s = el('section', { class: 'ui-set', 'aria-labelledby': id });
    s.innerHTML = ui.html.setHead({ id, label }) + rows;
    return s;
  }

  /* ───────── detail ───────── */
  async function openItem(id: string, from: StoreScreen = screen): Promise<void> {
    let d: StoreDetail;
    try { d = await store.detail(id); } catch (e) { place(board(notice('That item did not open', errorText(e)), back('Back to the store', () => { show(from); }))); return; }
    drawDetail(d, from);
  }
  function drawDetail(d: StoreDetail, from: StoreScreen): void {
    const it = d.item, st = stateOf(it, installedList(), updatesList());
    const srcLabel = store.sources.get().find((s) => s.id === it.source)?.label ?? it.source;
    const prov = it.provenance;
    const blocks: Node[] = [];
    const sec = (id: string, label: string, body: string): void => { blocks.push(section('hx-store-d-' + id, label, body)); };
    const R = (label: string, hint: string): string => storeItem(ui.html.setRow({ label, hint }));
    sec('about', 'About', R('Summary', it.summary));
    const warn: string[] = [];
    if (it.removed) warn.push(R('Taken down', `${it.removed.reason}. It cannot be installed${d.installed ? ' and is switched off from the next session' : ''}.`));
    if (!it.pinned) warn.push(R('Not pinned', 'This item is not pinned to an exact version, so boopis will not install it.'));
    if (isRemote(it.pinned)) warn.push(R('Hosted by the publisher', REMOTE_WORDS));
    if (it.tier === 'not-reviewed') warn.push(R('Not reviewed', TIER_TIPS['not-reviewed']));
    if (it.kind === 'engine-plugin') warn.push(R('Runs inside the engine', ENGINE_PLUGIN_NOTE));
    if (d.update?.status === 'available') warn.push(R('Update available', d.update.widened ? 'It adds new code, hosts or keys. The review shows what.' : 'A newer version is listed. The review shows what changes.'));
    if (warn.length) sec('notes', 'Read first', warn.join(''));
    sec('adds', 'What it adds', R('Contents', countsWords(it.components)) + R('Tools and context', d.cost.tools == null ? 'Not known. Every tool it adds is loaded in every session.' : `${plural(d.cost.tools, 'tool')}${d.cost.context_tokens == null ? '' : ', about ' + String(d.cost.context_tokens) + ' tokens of context'}. Every tool is loaded in every session.`));
    sec('reach', 'Where it reaches and what it needs', R('Hosts', hostsWords(it.hosts, it.verified)) + R('Keys', it.secrets.length ? it.secrets.map((s) => s.title + (s.optional ? ' (optional)' : '')).join('; ') : 'None.'));
    sec('prov', 'Where it comes from', R('Source', `${srcLabel}${prov.source_tier && it.source !== 'boopis' ? ', which calls it ' + prov.source_tier : ''}`) + (it.source === 'boopis' && prov.source_tier ? R('Why it is listed here', prov.source_tier.charAt(0).toUpperCase() + prov.source_tier.slice(1)) : '') + R('Publisher', it.publisher + (prov.namespace_proof === 'none' ? ' (not proved)' : '')) +
      R('Pinned to', pinWords(it.pinned)) + R('Folder hash', prov.tree_sha256 ?? 'Not known until it is downloaded.') + R('Check', scanWords(prov.scan.verdict) + (prov.scan.findings.length ? ': ' + prov.scan.findings.map((f) => f.text).join('; ') : '')) +
      R('Last updated', prov.last_updated ? ageWords(prov.last_updated, now()) : 'Not known') + R('Licence', licenseWords(it.license)) + R('Checked by boopis', it.verified ?? 'Nobody has checked it') + (it.homepage ? R('Home page', it.homepage) : ''));
    sec('gov', 'In governed sessions', R('Governed mode', d.governed.text));
    if (d.installed) sec('have', 'Installed', R('Version', `${d.installed.version ?? 'not stated'}, ${d.installed.enabled ? 'on' : 'off'}, for ${d.installed.scope.bot}${d.installed.scope.project ? ' and ' + d.installed.scope.project : ''}`));

    const act = el('div', { class: 'ui-set__actions' });
    const canInstall = !d.installed && !it.removed && !!it.pinned;
    const primary = d.update?.status === 'available' ? 'Review the update' : canInstall ? 'Review and install' : '';
    if (primary) {
      const b = ui.button({ label: primary, variant: 'primary', ...(store.can.install ? {} : { disabled: true }) });
      b.addEventListener('click', () => { void startReview(it.id, d.update?.status === 'available' ? 'update' : 'install', from); });
      act.append(b);
    }
    const title = el('h2', { class: 'ui-set__head' });
    title.innerHTML = storeItem(`<span>${ui.esc(it.title)}</span>`);
    const meta = el('p', { class: 'ui-field__hint' });
    meta.innerHTML = storeItem(ui.esc(`${KIND_LABEL[it.kind]} by ${it.publisher}. ${TIER_WORDS[it.tier]}${st ? '. ' + STATE_WORDS[st] : ''}.`));
    const why = !store.can.install && store.can.reason ? el('p', { class: 'ui-field__hint', role: 'status' }, store.can.reason) : null;
    const sheet = el('section', { class: 'hx-store__sheet', 'aria-label': 'About ' + it.title }, title, meta, ...(why ? [why] : []), act, ...blocks);
    place(board(back('Back to the store', () => { show(from); }), sheet));
    ui.hydrate(sheet);
    main.querySelector<HTMLElement>('.hx-store__sheet button')?.focus();
  }

  /* ───────── review ───────── */
  async function startReview(id: string, mode: 'install' | 'update', from: StoreScreen, scope?: StoreScope): Promise<void> {
    place(board(el('p', { class: 'ui-field__hint', role: 'status' }, 'Downloading it to check it. Nothing runs.')));
    let out: { stage: StageResult; plan: InstallPlan };
    try { out = mode === 'update' ? await store.reviewUpdate(id) : await store.review(id, scope); } catch (e) { place(board(notice('It could not be checked', errorText(e)), back('Back', () => { void openItem(id, from); }))); return; }
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
        const opts = [{ value: 'bot', label: 'This bot' }, ...(blocked ? [] : [{ value: 'bot-project', label: 'This bot, trusted here', ariaLabel: 'This bot, trusted here, in ' + project }])];
        const seg = ui.segmented({ mode: 'radio', size: 's', label: 'Install for', value: blocked ? 'bot' : plan.scope.level, options: opts });
        seg.addEventListener('ui:change', (e) => { const level = (e as CustomEvent<{ value: 'bot' | 'bot-project' }>).detail.value; void startReview(plan.item_id, mode, from, { level, bot: plan.scope.bot, ...(level === 'bot-project' ? { project } : {}) }); });
        scopeBox.replaceChildren(seg, ...(blocked ? [el('p', { class: 'ui-field__hint', role: 'status' }, 'This project has engine plugins and plugin hooks turned off, so this plugin cannot be trusted here. It installs for this bot alone, and you can turn the switch off under Installed.')] : []));
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
          /* what was shown is no longer what would be installed (the plan changed, the download is gone, the engine restarted meanwhile): the way on is a fresh review */
          if (['hx.store.plan_changed', 'hx.store.stage_missing'].includes(errorCode(e))) {
            const again = ui.button({ label: 'Review again', variant: 'primary', size: 's' });
            again.addEventListener('click', () => { void startReview(plan.item_id, mode, from); });
            result.replaceChildren(el('p', { class: 'ui-field__hint', role: 'status' }, 'Nothing was installed. Review it again to see what it would do now.'), again);
          }
          throw new Error(errorText(e));
        }
        later(() => { drawDone(r, result, from); });
      },
      cancel() { void openItem(plan.item_id, from); return Promise.resolve(); }
    }));
    kids.push(c, result);
    place(board(...kids));
  }
  function drawDone(r: InstallReceipt, into: HTMLElement, from: StoreScreen): void {
    const list = el('ul', { class: 'hx-store__lines' });
    for (const s of r.steps) list.append(el('li', {}, `${s.name}: ${s.ok ? 'done' : 'failed'}${s.note ? '. ' + s.note : ''}`));
    for (const n of r.notes) list.append(el('li', {}, n));
    const h = el('h3', { class: 'ui-set__head' }); h.innerHTML = storeItem(ui.esc(`${r.title ?? r.item_id} is installed`));
    const done = ui.button({ label: 'See what is installed', variant: 'primary', size: 's' });
    done.addEventListener('click', () => { show('installed'); });
    const more = ui.button({ label: 'Back to the store', size: 's', variant: 'ghost' });
    more.addEventListener('click', () => { show(from === 'installed' ? 'installed' : 'browse'); });
    into.replaceChildren(h, list, ...(r.restart_needed ? [el('p', { class: 'ui-field__hint' }, 'The engine restarts when no turn is running.')] : []), el('div', { class: 'ui-set__actions' }, done, more));
  }

  /* ───────── installed ───────── */
  async function drawInstalled(): Promise<void> {
    const list = installedList(), ups = updatesList();
    const byId = new Map(ups.map((d) => [d.item_id, d]));
    const status = el('p', { class: 'ui-field__hint', role: 'status', 'aria-live': 'polite', 'data-store-status': '' });
    const blocks: Node[] = [];
    const killed = list.filter((r) => r.kill_listed);
    if (killed.length) {
      blocks.push(section('hx-store-kill', 'Taken down by their source', killed.map((r) => storeItem(ui.html.setRow({
        label: r.title ?? r.item_id, hint: `${r.kill_listed?.reason ?? ''}. It is switched off from the next session.`,
        control: ui.html.button({ label: 'Remove', size: 's', attrs: { 'data-store-remove': r.item_id, 'aria-label': 'Remove ' + (r.title ?? r.item_id) } })
      }))).join('')));
    }
    const rows = list.map((r) => {
      const id = 'hx-store-sw-' + r.item_id.replace(/[^a-z0-9_-]/gi, '_');
      const u = byId.get(r.item_id);
      const name = r.title ?? r.item_id;
      const word = r.kill_listed ? 'Removed' : u?.status === 'available' ? 'Update' : '';
      const hint = `${KIND_LABEL[r.kind]}${r.version ? ', version ' + r.version : ''}. ${r.enabled ? 'On' : 'Off'}. For ${r.scope.bot}${r.scope.project ? ', trusted in ' + r.scope.project : ''}. Installed ${ageWords(r.installed_at, now())}.${u?.status === 'available' ? ' An update is available' + (u.widened ? ' and it reaches further.' : '.') : ''}`;
      const controls = [
        word ? ui.html.badge({ label: word }) : '',
        ui.html.switch({ id, name: r.item_id, checked: r.enabled, label: name + (r.enabled ? ' is on' : ' is off') }),
        u?.status === 'available' ? ui.html.button({ label: 'Update', size: 's', variant: 'primary', attrs: { 'data-store-update': r.item_id, 'aria-label': 'Update ' + name } }) : '',
        r.previous ? ui.html.button({ label: 'Roll back', size: 's', attrs: { 'data-store-rollback': r.item_id, 'aria-label': 'Roll back ' + name } }) : '',
        ui.html.button({ label: 'Details', size: 's', variant: 'ghost', attrs: { 'data-store-open': r.item_id, 'aria-label': 'Details for ' + name } }),
        ui.html.button({ label: 'Remove', size: 's', variant: 'ghost', attrs: { 'data-store-remove': r.item_id, 'aria-label': 'Remove ' + name } })
      ].join('');
      return storeItem(ui.html.setRow({ label: name, hint, for: id, control: '<span class="ui-set__actions">' + controls + '</span>' }));
    });
    blocks.push(list.length ? section('hx-store-have', 'Installed', rows.join('')) : section('hx-store-have', 'Installed', ui.html.setRow({ label: 'Nothing installed yet', hint: 'Skills, connectors, plugins and mods you install show here, with their switches.' })));
    const check = ui.button({ label: 'Check for updates', size: 's' });
    check.addEventListener('click', () => {
      status.textContent = 'Looking for updates…';
      store.checkUpdates().then((f) => { say(f.length ? `${plural(f.length, 'update')} found.` : 'Everything is up to date.'); }).then(() => drawInstalled()).catch((e: unknown) => { say(errorText(e)); });
    });
    const project = deps.project?.() ?? null;
    const pol = project ? section('hx-store-proj', 'This project', '') : null;
    if (pol) pol.append(projectSwitch(store, project as string, say, 'hx-store-policy-installed'));
    place(board(el('div', { class: 'ui-set__actions' }, check), status, ...blocks, ...(pol ? [pol] : [])));
    const host = main;
    ui.hydrate(host);
    for (const b of host.querySelectorAll<HTMLElement>('[data-store-open]')) b.addEventListener('click', () => { void openItem(b.dataset['storeOpen'] ?? '', 'installed'); });
    for (const b of host.querySelectorAll<HTMLElement>('[data-store-update]')) b.addEventListener('click', () => { void startReview(b.dataset['storeUpdate'] ?? '', 'update', 'installed'); });
    for (const b of host.querySelectorAll<HTMLElement>('[data-store-rollback]')) b.addEventListener('click', () => {
      const id = b.dataset['storeRollback'] ?? '';
      store.rollback(id).then((r) => { say(`${r.title ?? id} is back at ${r.version ?? 'its earlier version'}. It takes effect in new sessions.`); }).catch((e: unknown) => { say(errorText(e)); });
    });
    for (const b of host.querySelectorAll<HTMLElement>('[data-store-remove]')) b.addEventListener('click', () => { const r = list.find((x) => x.item_id === b.dataset['storeRemove']); if (r) removeFlow(r); });
    for (const sw of host.querySelectorAll<HTMLInputElement>('input[role=switch][name]')) sw.addEventListener('change', () => {
      const want = sw.checked, id = sw.name;
      store.setEnabled(id, want).then(() => { say(`${list.find((r) => r.item_id === id)?.title ?? id} is ${want ? 'on' : 'off'}. Open sessions keep what they started with; new ones use this.`); }).catch((e: unknown) => { sw.checked = !want; say(errorText(e)); });
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
    place(board(card(spec, sinkOf({
      async submit(_id, o) {
        try { const u = await store.uninstall(r.item_id, { deleteSecrets: o.values['keys'] === 'delete' }); deps.toast([`Removed ${name}.`, u.kept_secrets.length ? 'Its keys stay in your keychain.' : ''].filter(Boolean).join(' ')); } catch (e) { throw new Error(errorText(e)); }
        later(() => { show('installed'); });
      },
      cancel() { show('installed'); return Promise.resolve(); }
    }))));
  }

  /* ───────── sources ───────── */
  async function drawSources(): Promise<void> {
    const list: readonly StoreSource[] = store.sources.get();
    const reading = reader.state.get();
    const status = el('p', { class: 'ui-field__hint', role: 'status', 'aria-live': 'polite', 'data-store-status': '', id: 'hx-store-read-status' }, readingWords(reading));
    const rows = list.map((s) => {
      const id = 'hx-store-src-' + s.id.replace(/[^a-z0-9_-]/gi, '_');
      const state = sourceState(s, now(), reading.states.get(s.id));
      const controls = ui.html.switch({ id, name: s.id, checked: s.enabled !== false, label: s.label + (s.enabled === false ? ' is off' : ' is on') }) +
        (s.user_added ? ui.html.button({ label: 'Remove', size: 's', variant: 'ghost', attrs: { 'data-store-src-remove': s.id, 'aria-label': 'Remove ' + s.label } }) : '');
      return storeItem(ui.html.setRow({ label: s.label, hint: `${s.description ? s.description + ' ' : ''}${state.word === 'off' ? 'Off. ' : ''}${state.text}`.trim(), for: id, control: '<span class="ui-set__actions">' + controls + '</span>' }));
    });
    const add = section('hx-store-add', 'Add a source', ui.html.setRow({
      label: 'A marketplace, repository or folder', hint: 'A marketplace address, a git repository, a GitHub address or a folder on this computer. Items from it start as not reviewed.',
      control: ui.html.button({ label: 'Add', size: 's', attrs: { 'data-store-src-add': '', 'aria-label': 'Add a source' } })
    }));
    /* not disabled while a read runs (the focus would be lost as the rows redraw): a second press joins the read in progress */
    const refresh = ui.button({ label: 'Read the sources again', size: 's', attrs: { id: 'hx-store-read', 'aria-describedby': 'hx-store-read-status' } });
    refresh.addEventListener('click', () => { void reader.read(true).then(() => { deps.toast(readingWords(reader.state.get())); }); });
    place(board(el('div', { class: 'ui-set__actions' }, refresh), status, list.length ? section('hx-store-src', 'Where items come from', rows.join('')) : notice('No sources', 'boopis has no sources to read right now.'), add));
    ui.hydrate(main);
    for (const sw of main.querySelectorAll<HTMLInputElement>('input[role=switch][name]')) sw.addEventListener('change', () => {
      const want = sw.checked;
      store.setSourceEnabled(sw.name, want).then(() => drawSources()).catch((e: unknown) => { sw.checked = !want; say(errorText(e)); });
    });
    for (const b of main.querySelectorAll<HTMLElement>('[data-store-src-remove]')) b.addEventListener('click', () => { store.removeSource(b.dataset['storeSrcRemove'] ?? '').then(() => drawSources()).catch((e: unknown) => { say(errorText(e)); }); });
    main.querySelector('[data-store-src-add]')?.addEventListener('click', addFlow);
  }
  function addFlow(): void {
    const spec: FormSpec = {
      id: 'store.source.add', kind: 'setup', title: 'Add a source', origin: { kind: 'host' }, defer: false,
      why: 'boopis reads it once and refuses what it cannot parse. Nothing in it is installed without a review.',
      schema: { properties: { where: { type: 'string', title: 'Address or folder', placeholder: 'https://github.com/owner/repo, or a folder', 'x-mono': true } }, required: ['where'] },
      submit: { label: 'Add source' }, cancel: { label: 'Back' }, receipt: 'Added. Its items show in Browse.'
    };
    place(board(card(spec, sinkOf({
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
    tabs.select(s);
    if (itemId) { void openItem(itemId, s); return; }
    if (s === 'browse') void drawBrowse();
    else if (s === 'installed') void drawInstalled();
    else void drawSources();
  }
  tabs.addEventListener('ui:change', (e) => { show((e as CustomEvent<{ value: StoreScreen }>).detail.value); });
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
