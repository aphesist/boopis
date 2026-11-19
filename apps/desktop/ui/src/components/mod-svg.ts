/* The Svg element's sanitiser (docs/MODS.md section 2): no script, no foreignObject, no external reference. A mod's graphic
   is parsed as XML and rebuilt from an allowlist of elements and attributes; everything else is dropped with its children.
   Colours go through the same map as Text (mod-colors.ts), graphics being marks (3:1). */
import { paintColor } from './mod-colors';
import type { PaintCtx } from './mod-colors';

const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath']);
const SVG_ATTRS = new Set(['viewbox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'offset', 'stop-color', 'stop-opacity', 'id', 'gradientunits', 'gradienttransform', 'preserveaspectratio', 'clip-path', 'role', 'aria-label']);
const NS = 'http://www.w3.org/2000/svg';

/** the sanitised <svg>, or null when the source is not one (not XML, not an svg root, nothing allowed left) */
export function cleanSvg(source: unknown, ctx: PaintCtx): SVGElement | null {
  let doc: Document;
  try { doc = new DOMParser().parseFromString(String(source), 'image/svg+xml'); } catch { return null; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  const build = (src: Element): SVGElement | null => {
    const tag = src.nodeName.toLowerCase();
    if (!SVG_TAGS.has(tag)) return null;   /* script, foreignObject, image, use, style, a, anything else goes with its children */
    const out = document.createElementNS(NS, src.localName) as SVGElement;
    for (const a of Array.from(src.attributes)) {
      const n = a.name.toLowerCase(), v = a.value;
      if (!SVG_ATTRS.has(n)) continue;   /* no on* handlers, no href, no style, no class */
      if (/url\(/i.test(v) && !/^url\(\s*#[\w-]+\s*\)$/.test(v)) continue;   /* an internal reference only */
      if (/javascript:|data:|expression\(/i.test(v)) continue;
      if (n === 'fill' || n === 'stroke' || n === 'stop-color') {
        if (v === 'none' || v === 'currentColor' || /^url\(#/.test(v)) { out.setAttribute(n, v); continue; }
        paintColor(out, n === 'stop-color' ? 'stopColor' : n, v, 'mark', ctx);
        continue;
      }
      out.setAttribute(a.name, v);
    }
    if (tag === 'text' || tag === 'tspan') {
      if (!out.hasAttribute('fill') && !out.style.fill) out.style.fill = 'var(--text-quiet)';
      out.style.fontFamily = 'var(--mono)';
    }
    for (const c of Array.from(src.childNodes)) {
      if (c.nodeType === 3) out.appendChild(document.createTextNode(c.nodeValue ?? ''));
      else if (c.nodeType === 1) { const k = build(c as Element); if (k) out.appendChild(k); }
    }
    return out;
  };
  const svg = build(root);
  if (!svg) return null;
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/** the sanitised markup of a graphic, or null (for tests and for anything that needs the string) */
export const sanitizeSvg = (source: string): string | null => cleanSvg(source, { surface: 'frame', lits: [] })?.outerHTML ?? null;
