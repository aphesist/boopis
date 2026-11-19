/* Model marks: which model answered, at a glance. The provider's logo beside the model's name, never instead of it
   (owner decision, DESIGN-SYSTEM.md section 10.1). `modelMark(ref, {size, color})` draws one; `modelHTML` is mark and
   name as one unit that never wraps apart; `routeHTML('qwen3-coder → sonnet 5.5')` draws both models and keeps the arrow.

   Monochrome (`currentColor`, so the theme's tokens drive it) everywhere a model appears; brand colour only in the
   model selection menu and its chip preview (`color: 'brand'`). The family comes from the model id, the last path
   segment of a ref, never the host: Claude through Bedrock is still Claude. A family the map does not know gets the
   served-by mark when its host is listed (local Ollama), else the neutral generic mark. Never the φ.

   The mapping and the icons are data (vendor/model-icons: LobeHub icons, MIT, see NOTICE), typed below. */
import data from '../vendor/model-icons/icons.json';
import { esc } from '../core/dom';

interface Variant { viewBox: string; attrs?: string; body: string }
interface Icon { mono: Variant; color?: Variant }
interface FamilyDef { id: string; name: string; icon: string; match: string }
interface ServedDef { id: string; name: string; icon: string; hosts: readonly string[] }
interface MapDef { families: readonly FamilyDef[]; served: readonly ServedDef[]; fallback: { id: string; name: string; icon: string } }

const MAP = data.map as unknown as MapDef;
const ICONS = data.icons as unknown as Record<string, Icon>;
const FAMILIES = MAP.families.map((f) => ({ ...f, re: new RegExp(f.match, 'i') }));

export interface ModelFamily { id: string; name: string; icon: string; model: string; host: string }
/** a model id, optionally behind a host path ('openrouter/anthropic/claude-sonnet-4.5'), or `{model, host}` */
export type ModelRef = string | { model?: string; id?: string; host?: string; provider?: string; via?: string };
export interface MarkOpts { size?: number | undefined; color?: 'mono' | 'brand' | undefined; /** the accessible name; false when the mark sits in an aria-hidden slot */ label?: string | false | undefined; class?: string | undefined }
export interface ModelOpts extends MarkOpts { name?: string; mono?: boolean }

function split(ref: ModelRef | null | undefined): { model: string; host: string } {
  if (ref && typeof ref === 'object') return { model: String(ref.model ?? ref.id ?? ''), host: String(ref.host ?? ref.provider ?? ref.via ?? '').toLowerCase() };
  const s = String(ref ?? '').trim(), i = s.lastIndexOf('/');
  return i < 0 ? { model: s, host: '' } : { model: s.slice(i + 1), host: s.slice(0, i).toLowerCase() };
}

const familyCache = new Map<string, ModelFamily>();
export function modelFamily(ref: ModelRef | null | undefined): ModelFamily {
  const r = split(ref), key = r.host + '\u0000' + r.model;
  let f = familyCache.get(key);
  if (!f) {
    const hit = FAMILIES.find((x) => x.re.test(r.model))
      ?? MAP.served.find((x) => x.hosts.some((h) => r.host.split(/[/.:]/).includes(h)))
      ?? MAP.fallback;
    f = { id: hit.id, name: hit.name, icon: hit.icon, model: r.model, host: r.host };
    familyCache.set(key, f);
  }
  return f;
}
/** whether the model's family is one the map knows (a time or a cost never is) */
export const isKnownModel = (ref: ModelRef | null | undefined): boolean => modelFamily(ref).id !== MAP.fallback.id;

/** 'qwen3-coder → sonnet 5.5' -> ['qwen3-coder', 'sonnet 5.5'] */
export const parseRoute = (text: string | null | undefined): string[] => String(text ?? '').split(/\s*(?:→|->)\s*/).map((s) => s.trim()).filter(Boolean);
/** the model that answered: the last of a route */
export const lastModel = (text: string | null | undefined): string => { const p = parseRoute(text); return p[p.length - 1] ?? ''; };
export const isRoute = (text: string | null | undefined): boolean => parseRoute(text).length > 1;
export const families = (): Array<{ id: string; name: string }> => [...MAP.families, ...MAP.served, MAP.fallback].map((f) => ({ id: f.id, name: f.name }));

/* gradients carry ids: each drawn copy gets its own, so two Meta marks on a page never share a gradient */
let uid = 0;
export function markHTML(ref: ModelRef | null | undefined, o: MarkOpts = {}): string {
  const f = modelFamily(ref), ic = ICONS[f.icon] ?? ICONS['generic'];
  const size = o.size ?? 16, brand = o.color === 'brand';
  const label = o.label === false ? null : (o.label ?? f.name);
  const a = 'class="ui-mm' + (o.class ? ' ' + esc(o.class) : '') + '" data-family="' + esc(f.id) + '" data-color="' + (brand ? 'brand' : 'mono') + '" width="' + size + '" height="' + size +
    '" style="--mm-size:' + size + 'px"' + (label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true"') + ' focusable="false"';
  if (!ic) return '<svg ' + a + ' viewBox="0 0 24 24"></svg>';
  const v = brand && ic.color ? ic.color : ic.mono;
  let body = v.body;
  if (body.includes(' id="')) {
    const k = '-mm' + (++uid);
    body = body.replace(/ id="([^"]+)"/g, ' id="$1' + k + '"').replace(/url\(#([^)]+)\)/g, 'url(#$1' + k + ')');
  }
  return '<svg ' + a + ' viewBox="' + v.viewBox + '"' + (v.attrs ? ' ' + v.attrs : '') + '>' + body + '</svg>';
}
const tpl = typeof document !== 'undefined' ? document.createElement('template') : null;
function frag(s: string): SVGElement & HTMLElement {
  if (!tpl) throw new Error('model-mark: no document');
  tpl.innerHTML = s;
  return tpl.content.firstElementChild as SVGElement & HTMLElement;
}

/** mark + name: the name stays (a logo alone is never the answer to "which model"), and the pair never wraps apart */
export function modelHTML(ref: ModelRef, o: ModelOpts = {}): string {
  const f = modelFamily(ref), name = o.name ?? (typeof ref === 'object' ? f.model : String(ref));
  return '<span class="ui-model' + (o.class ? ' ' + esc(o.class) : '') + '" data-family="' + esc(f.id) + '">' + markHTML(ref, o) +
    '<span class="' + (o.mono === false ? 'ui-model__name' : 'ui-model__name ui-mono') + '">' + esc(name) + '</span></span>';
}
export const arrowHTML = (via?: string): string => '<span class="ui-model-route__to" aria-hidden="true">' + esc(via || '→') + '</span><span class="ui-sr">then</span>';
export const routeHTML = (text: string, o: ModelOpts = {}): string =>
  '<span class="ui-model-route">' + parseRoute(text).map((m, i) => (i ? arrowHTML() : '') + modelHTML(m, o)).join('') + '</span>';

export const modelMark = (ref: ModelRef | null | undefined, o?: MarkOpts): SVGElement => frag(markHTML(ref, o));
/** re-draw the first mark under `root` (a chip or a picker after a new choice), keeping its size, colour and naming */
export function swapMark(root: Element | null, ref: ModelRef | null | undefined, o?: MarkOpts): SVGElement | null {
  const old = root?.querySelector('.ui-mm');
  if (!old) return null;
  const next = frag(markHTML(ref, { size: +(old.getAttribute('width') ?? 0) || 16, color: old.getAttribute('data-color') === 'brand' ? 'brand' : 'mono', label: old.hasAttribute('aria-label') ? undefined : false, ...o }));
  old.replaceWith(next);
  return next;
}
