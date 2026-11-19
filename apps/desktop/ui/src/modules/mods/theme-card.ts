/* `$.theme.set`: "Apply <mod>'s colours?" with a live preview (docs/MODS.md section 3; DESIGN-SYSTEM.md 14.29, owner decision of
   19 November 2026). While the card is open and on screen, the whole app previews the colours through the theme module
   (`themeApi.preview`: the one theme mechanism, never saved). Keep commits them; Reject, Esc (Later), the card leaving the
   screen (removed, or its view hidden) or another theme chosen restores the previous theme at once. One preview at a time:
   the card opened last holds it. Scrolled out of the window still counts as shown, so reading the conversation never drops
   the preview.
   What the plugin sends is the mod's own colours (`mod.theme`): by token (`--brass`) or by Claude Code name (`claude`). The
   app uses the ones it can map onto its tokens (mod-colors.ts); the rest are named on the card as not used. There is no ramp
   generator yet (docs/MODS.md section 3), so surface anchors are not turned into a theme here.
   Contrast (owner decision, 19 November 2026): the theme module checks the pairs that carry text while it previews, and a colour that
   would make text hard to read is not applied (the theme's own token stays). The card says which it skipped, in words, and Keep
   stores only what was applied (docs/MODS.md section 10). */
import { on } from '../../core/bus';
import { logger } from '../../core/log';
import { ui } from '../../components';
import { MARK, parseLiteral } from '../../components/mod-colors';
import type { HxCard } from '../cards';
import type { FormSpec, ModTheme } from '../../data';
import { EDITABLE, GROUPS, skippedSentence, themeApi } from '../../styles/theme';
import type { Guarded } from '../../styles/theme';
import { surface } from './surfaces';

const log = logger('mods');
const LIVE_STATES = ['open', 'invalid', 'holding', 'submitting'];
/** the names a mod's colours go by that map onto one editable token (the same map as the text and marks of a tree) */
const NAMED: Readonly<Record<string, string>> = { ...MARK, 'text-primary': '--text', 'text-muted': '--text-quiet' };

/** what a mod's colours become: tokens with #rrggbb values, and the names that could not be used */
export function themeColors(colors: Readonly<Record<string, string>>): { colors: Record<string, string>; unused: string[] } {
  const out: Record<string, string> = {}, unused: string[] = [];
  for (const [k, v] of Object.entries(colors)) {
    const rgb = parseLiteral(v);
    const key = k.startsWith('--') ? k : '--' + k;
    const token = EDITABLE.includes(key) ? key : NAMED[k] ?? null;
    if (!rgb || !token || !EDITABLE.includes(token)) { unused.push(k); continue; }
    out[token] = '#' + rgb.map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  return { colors: out, unused };
}

const SWATCH_LABELS: Readonly<Record<string, string>> = { '--bg-2': 'ground', '--bg-3': 'raised', '--text': 'text', '--text-quiet': 'quiet', '--brass': 'accent' };
/** the order of the swatches: the design's five first (ground, raised, text, quiet, accent), then any other colour in the order of the customizer */
const SWATCH_ORDER: readonly string[] = [...Object.keys(SWATCH_LABELS), ...EDITABLE.filter((t) => !(t in SWATCH_LABELS))];
/** [label, hex] swatches of the colours on offer: the design's five when they are there, else the token's own label */
export function swatchesOf(colors: Readonly<Record<string, string>>): Array<readonly [string, string]> {
  const names = new Map<string, string>(GROUPS.flatMap((g) => g[1].map((r) => [r[0], r[1].toLowerCase()] as const)));
  return SWATCH_ORDER.filter((t) => t in colors).map((t) => [SWATCH_LABELS[t] ?? names.get(t) ?? t, colors[t] ?? ''] as const);
}

interface Meta { colors: Record<string, string>; visible: boolean; paused: boolean; ending: boolean; plugin: string; unused: readonly string[]; guard: Guarded | null }
const META = new WeakMap<HxCard, Meta>();
const CARDS = new Set<HxCard>();
let previewing: HxCard | null = null;
let seq = 0;
/** what the user decided about each offer, so a card drawn again (the conversation was redrawn) says so instead of asking again */
const decided = new WeakMap<ModTheme, 'done' | 'cancelled' | 'deferred'>();

/** on screen: in the page, rendered, and not in a view the shell has set aside (inert or hidden: another tab, a closed pane) */
function onScreen(c: HTMLElement): boolean {
  if (!c.isConnected || c.closest('[inert], [hidden]')) return false;
  const r = c.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== 'hidden';
}
function owner(): HxCard | null {
  let o: HxCard | null = null;
  for (const c of CARDS) { const m = META.get(c); if (m && m.visible && !m.paused && LIVE_STATES.includes(c.state)) o = c; }
  return o;
}
/** the card says what the guard left out, the moment the preview shows it */
function tell(card: HxCard, meta: Meta): void {
  const why = whyOf(meta.unused, meta.guard);
  if (card.data['why'] !== why) card.update({ why });
}
/** the preview follows the card that should hold it: starts it, hands it over, or ends it */
export function reconcile(): void {
  const o = owner();
  for (const c of CARDS) c.toggleAttribute('data-previewing', c === o);
  if (o) {
    if (previewing !== o) {
      previewing = o;
      const m = META.get(o);
      const guard = themeApi.preview({ colors: m?.colors ?? {} });
      if (m) { m.guard = guard; tell(o, m); }
    }
  }
  else if (previewing) { previewing = null; themeApi.endPreview(false); }
}
/** looks again at which cards are on screen (a view was hidden, the conversation was redrawn) */
export function recheck(): void {
  for (const c of [...CARDS]) { if (!c.isConnected) { CARDS.delete(c); continue; } const m = META.get(c); if (m) m.visible = onScreen(c); }
  reconcile();
}
let queued = false;
const queueRecheck = (): void => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; recheck(); }); };

/* the theme module ended a preview itself (another theme chosen, a colour edited, reset, import): no card previews until it is reopened */
on('hx:theme-preview', (e) => {
  const o = previewing;
  if (!e.previewing && o) { const m = META.get(o); if (m && !m.ending) { m.paused = true; previewing = null; for (const c of CARDS) c.removeAttribute('data-previewing'); } }
});
/* navigating away ends a preview at once, without waiting for the observers */
for (const ev of ['hx:tab', 'hx:session-select', 'hx:new-session', 'hx:nav'] as const) on(ev, queueRecheck);
window.addEventListener('pagehide', () => { if (previewing) themeApi.endPreview(false); });
let hideWatch: MutationObserver | null = null;

/** what the card says it is: what the colours change, which of the mod's names the app has no token for, which colours the contrast guard left out */
export function whyOf(unused: readonly string[], guard: Guarded | null): string {
  const skipped = guard ? skippedSentence(guard.skipped) : null;
  return 'It changes the surfaces, the text and the accent. The whole app shows them now. Keep them to use them, or reject them to go back.' +
    (unused.length ? ' ' + unused.length + (unused.length === 1 ? ' colour is' : ' colours are') + ' not used here: ' + unused.join(', ') + '.' : '') +
    (skipped ? ' ' + skipped : '');
}
/** the receipt after Keep: what was stored when the guard left some out */
export function keptWords(plugin: string, guard: Guarded | null): string {
  const left = guard?.skipped.length ?? 0;
  if (!guard || !left) return 'Kept ' + plugin + '’s colours. Undo in Settings, Appearance';
  if (!Object.keys(guard.applied).length) return 'Kept nothing: every colour of ' + plugin + ' would make text hard to read';
  return 'Kept ' + plugin + '’s colours, without ' + left + ' that would make text hard to read. Undo in Settings, Appearance';
}

/** the card for a mod's theme: `null` when the app can use none of its colours */
export function themeCard(t: ModTheme): HxCard | null {
  const { colors, unused } = themeColors(t.colors);
  if (!Object.keys(colors).length) { log.warn(t.plugin + ' offered a theme with no colour this app can use' + (unused.length ? ' (' + unused.join(', ') + ')' : '')); return null; }
  const plugin = t.plugin;
  const why = whyOf(unused, null);
  const data: FormSpec = {
    id: 'mod-theme-' + plugin + '-' + (++seq), kind: 'theme', title: 'Apply ' + plugin + '’s colours?', origin: { kind: 'mod', plugin },
    why, swatches: swatchesOf(colors), preview: true, schema: { properties: {} }, submit: { label: 'Keep' }, cancel: { label: 'Reject' },
    receipt: 'Kept ' + plugin + '’s colours. Undo in Settings, Appearance', cancelledText: 'Rejected. The theme is back as it was', deferredText: 'Later. The theme stays as it was'
  };
  const was = decided.get(t);
  const card = ui.card('form', data as unknown as Record<string, unknown>, { size: 'inline', ...(was ? { state: was } : {}) }) as HxCard;
  card.dataset['modTheme'] = plugin;
  const meta: Meta = { colors, visible: false, paused: false, ending: false, plugin, unused, guard: null };
  META.set(card, meta);
  if (!was) CARDS.add(card);
  card.addEventListener('hx:card-state', (e) => {
    const st = e.detail.state;
    if (st === 'open') meta.paused = false;   /* reopened: it previews again */
    if (st === 'done' || st === 'cancelled' || st === 'deferred') decided.set(t, st);
    if (st === 'done') {
      meta.ending = true;
      if (previewing === card) { previewing = null; themeApi.endPreview(true); }   /* Keep: the previewed colours, which are the ones that held, are the theme now */
      else meta.guard = themeApi.keep(colors);                                       /* no preview showed them: the same guard, then stored */
      card.update({ receiptText: keptWords(plugin, meta.guard) });
      meta.ending = false; CARDS.delete(card); card.removeAttribute('data-previewing');
    }
    reconcile();
  });
  /* leaving the screen: removed from the page, or its view hidden (another tab, another session) */
  if (typeof IntersectionObserver === 'function') {
    const io = new IntersectionObserver(() => {
      const shown = onScreen(card);
      if (shown && !meta.visible) meta.paused = false;
      meta.visible = shown;
      if (!card.isConnected) { io.disconnect(); CARDS.delete(card); }
      reconcile();
    });
    queueMicrotask(() => { io.observe(card); });
  }
  if (!hideWatch) { hideWatch = new MutationObserver(queueRecheck); hideWatch.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['inert', 'hidden', 'aria-hidden'] }); }
  return card;
}

/** puts the card in the conversation, at the point the mod raised it: no margin text, the card's own byline names the mod */
export function placeThemeCard(card: HxCard): void {
  const art = ui.entry({ kind: 'mod', callno: [], body: '' });
  art.setAttribute('data-mod-card', '');
  art.querySelector('.ui-entry__body')?.append(card);
  surface.place?.(art, { quiet: true });
  recheck();
}

/** a card whose offer was withdrawn (`$.theme.clear`) or replaced leaves the page; its preview goes with it */
export function withdraw(card: HxCard): void {
  card.closest('.ui-entry')?.remove();
  CARDS.delete(card);
  reconcile();
}
/** the cards the mods module has up, for the tests */
export const openCards = (): readonly HxCard[] => [...CARDS];
export const previewingCard = (): HxCard | null => previewing;
