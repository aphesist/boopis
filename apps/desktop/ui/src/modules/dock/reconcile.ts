/* Update a view's DOM in place instead of rebuilding it. A view used to be re-rendered with `innerHTML`, so a bot made or
   archived, a run that stopped, a schedule that changed or a context that moved replaced every button in the view: the
   hover and the focus were lost, the library bound every new control's corner again (a frame with the corner undrawn),
   the live orbs were pulled out of their slots and put back, and what the pointer was on was gone under it. Here the new
   markup is parsed off-screen and the old nodes are matched to the new by key (`data-id`, `data-slot`, `data-k`, `id`, else
   tag and place), patched, and only what has no counterpart is added or removed. Elements that exist in both stay the
   same element.

   Three things are never touched: the children of a slot or a JS-filled container (`data-slot`, `data-cards`, `data-card`,
   `data-composer`: the live orb, the cards and the composers are put there by script), attributes a script added (only
   what the previous render wrote is removed again), and an element's inline `style` unless the markup sets one (the
   engine's transforms and entrances live there). */

const OPAQUE = '[data-slot], [data-cards], [data-card], [data-composer], orb-avatar, hx-card';
const rendered = new WeakMap<Element, Set<string>>();

export function keyOf(el: Element): string | null {
  const a = el.getAttribute('data-slot'); if (a) return 's:' + a;
  const id = el.getAttribute('data-id'); if (id && el.getAttribute('data-act')) return 'a:' + el.getAttribute('data-act') + ':' + id;
  const k = el.getAttribute('data-k'); if (k) return 'k:' + k;
  const i = el.getAttribute('id'); if (i) return 'i:' + i;
  const t = el.getAttribute('data-tile'); if (t) return 't:' + t;
  if (id) return 'd:' + id;
  return null;
}

function syncAttrs(old: Element, next: Element): void {
  const prev = rendered.get(old) ?? new Set<string>(), now = new Set<string>();
  for (const a of Array.from(next.attributes)) {
    now.add(a.name);
    if (old.getAttribute(a.name) !== a.value) old.setAttribute(a.name, a.value);
  }
  for (const n of prev) if (!now.has(n) && old.hasAttribute(n)) old.removeAttribute(n);
  rendered.set(old, now);
}

function sameKind(a: Element, b: Element): boolean { return a.localName === b.localName && a.namespaceURI === b.namespaceURI; }

function patchChildren(old: Element, next: Element): void {
  const oldKids = Array.from(old.childNodes), newKids = Array.from(next.childNodes);
  const keyed = new Map<string, Element>();
  for (const o of oldKids) if (o.nodeType === 1) { const k = keyOf(o as Element); if (k && !keyed.has(k)) keyed.set(k, o as Element); }
  const used = new Set<Node>();
  const takeUnkeyed = (n: Element, from: number): { node: Element; at: number } | null => {
    for (let i = from; i < oldKids.length; i++) { const o = oldKids[i] as Node; if (!used.has(o) && o.nodeType === 1 && !keyOf(o as Element) && sameKind(o as Element, n)) return { node: o as Element, at: i }; }
    return null;
  };
  let cursor = 0;
  const placed: Node[] = [];
  for (const n of newKids) {
    let target: Node | null = null;
    if (n.nodeType === 1) {
      const el = n as Element, k = keyOf(el);
      let m: Element | null = null;
      if (k) { const c = keyed.get(k); if (c && !used.has(c) && sameKind(c, el)) m = c; }
      else { const t = takeUnkeyed(el, cursor); if (t) { m = t.node; cursor = t.at + 1; } }
      if (m) { used.add(m); patchElement(m, el); target = m; } else target = el;
    } else if (n.nodeType === 3) {
      let i = cursor; while (i < oldKids.length && (used.has(oldKids[i] as Node) || (oldKids[i] as Node).nodeType !== 3)) i++;
      const o = oldKids[i];
      if (o) { used.add(o); cursor = i + 1; if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; target = o; } else target = n;
    } else target = n;
    placed.push(target);
  }
  for (const o of oldKids) if (!used.has(o)) old.removeChild(o);
  placed.forEach((node, i) => { if (old.childNodes[i] !== node) old.insertBefore(node, old.childNodes[i] ?? null); });
}

function patchElement(old: Element, next: Element): void {
  syncAttrs(old, next);
  if (old.matches(OPAQUE)) return;
  if (old.localName === 'svg') { if (old.innerHTML !== next.innerHTML) old.innerHTML = next.innerHTML; return; }
  patchChildren(old, next);
}

/** put `html` in `host`, keeping every element that is in both the old and the new markup */
export function patchHTML(host: Element, html: string): void {
  const t = document.createElement('template');
  t.innerHTML = html;
  const shell = host.cloneNode(false) as Element;
  shell.append(t.content);
  patchChildren(host, shell);
}
