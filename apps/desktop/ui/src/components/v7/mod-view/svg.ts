/* The Svg element's sanitiser (docs/MODS.md section 2): no script, no foreignObject, no external reference. A mod's graphic
   is parsed as XML and rebuilt from an allowlist of elements and attributes; everything else is dropped with its children.
   Colours go through the same map as Text (colours.ts), graphics being marks (3:1): a name is its token in the markup, a literal is
   painted by the behaviour against the surface under it. The result is markup, so the view stays a function of its props. */
import { esc } from '../util';
import { colourOf } from './colours';

const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title', 'desc', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath']);
const SVG_ATTRS = new Set(['viewbox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'text-anchor', 'dominant-baseline', 'font-size', 'font-weight', 'offset', 'stop-color', 'stop-opacity', 'id', 'gradientunits', 'gradienttransform', 'preserveaspectratio', 'clip-path', 'role', 'aria-label']);

/** the sanitised <svg> as markup, or null when the source is not one (not XML, not an svg root, nothing allowed left) */
export function cleanSvg(source: unknown): string | null {
  if (typeof DOMParser === 'undefined') return null;
  let doc: Document;
  try { doc = new DOMParser().parseFromString(String(source), 'image/svg+xml'); } catch { return null; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
  const build = (src: Element, top: boolean): string | null => {
    const tag = src.nodeName.toLowerCase();
    if (!SVG_TAGS.has(tag)) return null;   /* script, foreignObject, image, use, style, a, anything else goes with its children */
    const out: string[] = [], style: string[] = [], lits: string[] = [];
    for (const a of Array.from(src.attributes)) {
      const n = a.name.toLowerCase(), v = a.value;
      if (!SVG_ATTRS.has(n)) continue;   /* no on* handlers, no href, no style, no class */
      if (top && (n === 'width' || n === 'height')) continue;   /* the graphic fits the width */
      if (/url\(/i.test(v) && !/^url\(\s*#[\w-]+\s*\)$/.test(v)) continue;   /* an internal reference only */
      if (/javascript:|data:|expression\(/i.test(v)) continue;
      if (n === 'fill' || n === 'stroke' || n === 'stop-color') {
        if (v === 'none' || v === 'currentColor' || /^url\(#/.test(v)) { out.push(a.name + '="' + esc(v) + '"'); continue; }
        const c = colourOf(n, v, 'mark');
        if (c.style) style.push(c.style); if (c.lit) lits.push(c.lit);
        continue;
      }
      out.push(a.name + '="' + esc(v) + '"');
    }
    if ((tag === 'text' || tag === 'tspan')) { if (!src.hasAttribute('fill')) style.push('fill:var(--text-quiet)'); style.push('font-family:var(--mono)'); }
    if (top) out.push('focusable="false"', 'aria-hidden="true"');
    if (style.length) out.push('style="' + esc(style.join(';')) + '"');
    if (lits.length) out.push('data-mv-lit="' + esc(lits.join(';')) + '"');
    let kids = '';
    for (const c of Array.from(src.childNodes)) {
      if (c.nodeType === 3) kids += esc(c.nodeValue ?? '');
      else if (c.nodeType === 1) kids += build(c as Element, false) ?? '';
    }
    const name = top ? 'svg' : src.localName;
    return '<' + name + (top ? ' xmlns="http://www.w3.org/2000/svg"' : '') + (out.length ? ' ' + out.join(' ') : '') + '>' + kids + '</' + name + '>';
  };
  return build(root, true);
}

/** the sanitised markup of a graphic, or null (for tests and for anything that needs the string) */
export const sanitizeSvg = (source: string): string | null => cleanSvg(source);
