/* The gallery: the index on the left, the toolbar on top, and the chosen story as a grid of its states, each a frame
   (frame.ts) beside the v6 mock-up's counterpart. The toolbar's choices live in the URL's hash, so a link opens the
   same view: #story=<id>&preset=<id>&w=<px>&zoom=<1|1.6>&force=<hover|focus|active>&reduced=1&mock=0 */
import '../styles';
import { kit, ui } from '@boopis/ui';
import { STORIES, storyById } from './registry';
import { AREAS } from './types';
import type { Story, StoryKind } from './types';
import './lab.css';

const PRESETS = ['catalog', 'graphite', 'bone', 'typewriter'];
const WIDTHS = ['390', '1200', '1440', '1920'];
const KINDS: ReadonlyArray<readonly [StoryKind, string]> = [['component', 'Components'], ['card', 'Cards'], ['surface', 'Surfaces'], ['page', 'Pages']];

interface View { story: string; preset: string; w: string; zoom: string; force: string; reduced: string; mock: string }
function readView(): View {
  const h = new URLSearchParams(location.hash.slice(1));
  return { story: h.get('story') ?? STORIES[0]?.id ?? '', preset: h.get('preset') ?? 'catalog', w: h.get('w') ?? '1440', zoom: h.get('zoom') ?? '1', force: h.get('force') ?? '', reduced: h.get('reduced') ?? '0', mock: h.get('mock') ?? '1' };
}
const writeView = (v: View): void => { history.replaceState(null, '', '#' + new URLSearchParams(v as unknown as Record<string, string>).toString()); };

const frameUrl = (s: Story, state: string, v: View): string => {
  const p = new URLSearchParams({ frame: '1', story: s.id, state, preset: v.preset });
  if (v.zoom !== '1') p.set('zoom', v.zoom);
  if (v.force) p.set('force', v.force);
  if (v.reduced === '1') p.set('reduced', '1');
  return 'lab.html?' + p.toString();
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n;
}

function seg(label: string, values: readonly string[], value: string, names: (v: string) => string, onChange: (v: string) => void): HTMLElement {
  const wrap = el('label');
  wrap.append(label);
  const s = kit.segmented({ label, value, items: values.map((x) => ({ value: x, label: names(x) })), attrs: { 'data-ui': 'v7', 'data-theme': 'dark' } });
  s.addEventListener('ui:change', (e) => onChange(String((e as CustomEvent<{ value: string }>).detail.value)));
  wrap.append(s);
  return wrap;
}

function pane(title: string, url: string, w: number, h: number, scale: number, fit: boolean, crop?: string): HTMLElement {
  const box = el('div', 'lab-pane');
  box.append(el('span', '', title));
  const vp = el('div', 'lab-viewport');
  const f = el('iframe');
  f.src = url; f.width = String(w); f.height = String(h); f.title = title; f.loading = 'lazy';
  f.style.transform = 'scale(' + scale + ')';
  vp.style.width = Math.round(w * scale) + 'px'; vp.style.height = Math.round(h * scale) + 'px';
  f.addEventListener('load', () => {
    const d = f.contentDocument; if (!d) return;
    const done = (): void => {
      const target = crop ? d.querySelector<HTMLElement>(crop) : null;
      if (target) d.defaultView?.scrollTo(0, target.getBoundingClientRect().top + (d.defaultView?.scrollY ?? 0));   /* scrollIntoView would scroll the gallery too */
      if (fit) { const hh = Math.min(2400, Math.max(160, d.documentElement.scrollHeight)); f.height = String(hh); vp.style.height = Math.round(hh * scale) + 'px'; }
    };
    let n = 0;
    const poll = (): void => { if (d.documentElement.dataset['labReady'] || ++n > 60 || !url.includes('frame=1')) done(); else setTimeout(poll, 100); };
    poll();
  });
  vp.append(f);
  box.append(vp);
  return box;
}

export function startGallery(): void {
  let v = readView();
  document.title = 'boopis UI lab';
  const root = el('div', 'lab ui-root');
  root.id = 'hx-app';
  const bar = el('header', 'lab-bar');
  const index = el('nav', 'lab-index'); index.setAttribute('aria-label', 'Stories');
  const main = el('main', 'lab-main');
  root.append(bar, index, main);
  document.body.style.margin = '0';
  document.body.append(root);
  ui.squircle.start();
  ui.scrollEdges.start();
  ui.tooltip.enable();

  const set = (patch: Partial<View>): void => { v = { ...v, ...patch }; writeView(v); draw(); };
  bar.append(el('h1', '', 'UI lab'));
  bar.append(seg('Theme', PRESETS, v.preset, (x) => x, (x) => set({ preset: x })));
  bar.append(seg('Width', WIDTHS, v.w, (x) => x, (x) => set({ w: x })));
  bar.append(seg('Zoom', ['1', '1.6'], v.zoom, (x) => x + 'x', (x) => set({ zoom: x })));
  bar.append(seg('Force', ['', 'hover', 'focus', 'active'], v.force, (x) => x || 'none', (x) => set({ force: x })));
  bar.append(seg('Motion', ['0', '1'], v.reduced, (x) => (x === '1' ? 'reduced' : 'full'), (x) => set({ reduced: x })));
  bar.append(seg('Mock', ['1', '0'], v.mock, (x) => (x === '1' ? 'beside' : 'hidden'), (x) => set({ mock: x })));

  const search = el('input', 'ui-input'); search.type = 'search'; search.placeholder = 'Filter stories'; search.setAttribute('aria-label', 'Filter stories');
  index.append(search);
  const lists = el('div');
  index.append(lists);
  const drawIndex = (): void => {
    lists.textContent = '';
    const f = search.value.trim().toLowerCase();
    for (const [kind, title] of KINDS) {
      const items = STORIES.filter((s) => s.kind === kind && (!f || (s.id + ' ' + s.title + ' ' + s.covers.join(' ')).toLowerCase().includes(f)));
      if (!items.length) continue;
      lists.append(el('h2', '', title + ' (' + items.length + ')'));
      const ul = el('ul');
      for (const s of items) {
        const li = el('li'), a = el('a');
        a.href = '#story=' + encodeURIComponent(s.id);
        a.append(el('span', '', s.title), el('span', '', String(Object.keys(s.states).length)));
        if (s.id === v.story) a.setAttribute('aria-current', 'page');
        a.addEventListener('click', (e) => { e.preventDefault(); set({ story: s.id }); drawIndex(); });
        li.append(a); ul.append(li);
      }
      lists.append(ul);
    }
  };
  search.addEventListener('input', drawIndex);

  const draw = (): void => {
    main.textContent = '';
    const s = storyById(v.story);
    if (!s) { main.append(el('p', 'lab-empty', 'Pick a story.')); return; }
    const head = el('header');
    head.append(el('h2', '', s.title), el('p', '', AREAS[s.area] + ' · ' + s.kind + ' · covers ' + s.covers.join(', ')));
    main.append(head);
    const grid = el('div', 'lab-grid');
    const avail = Math.max(320, main.clientWidth - 48);
    for (const [name, st] of Object.entries(s.states)) {
      const box = el('section', 'lab-state');
      const h3 = el('h3', '', name);
      h3.append(el('small', '', st.tags.join(' · ') + (st.note ? ' · ' + st.note : '')));
      const open = el('a', '', 'open'); open.href = frameUrl(s, name, v); open.target = '_blank';
      h3.append(open);
      box.append(h3);
      const pair = el('div', 'lab-pair');
      const mock = st.mock ?? s.mock;
      const showMock = v.mock === '1' && !!mock;
      const zoom = Number(v.zoom);
      const w = Math.round((st.app ? Number(v.w) : st.width ? st.width + 48 : Number(v.w)) * zoom);
      const h = Math.round((st.app ? (v.w === '390' ? 844 : 900) : 400) * zoom);
      const scale = Math.min(1, (showMock ? avail / 2 - 16 : avail) / w);
      pair.append(pane('boopis · ' + v.w + 'px', frameUrl(s, name, v), w, h, scale, !st.app));
      if (showMock && mock) pair.append(pane('v6 mock' + (mock.note ? ' · ' + mock.note : ''), mock.url + (mock.url.includes('?') ? '&' : '?') + 'preset=' + v.preset, w, h, scale, false, mock.crop));
      box.append(pair);
      grid.append(box);
    }
    main.append(grid);
  };
  window.addEventListener('hashchange', () => { v = readView(); drawIndex(); draw(); });
  drawIndex();
  draw();
}
