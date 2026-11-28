/* A mod's element tree, as data (docs/MODS.md section 2, docs/PROTOCOL.md `mod.render`): the types, the limits and the
   check that skips a tree the renderer must not draw. `hx-mods` checks the same limits before a tree leaves the worker
   (`crates/hx-mods/src/tree.rs`); this is the renderer's own line of defence, because a tree arrives as JSON from outside
   the page. A tree that fails is skipped whole: the site keeps the app's own drawing and says why, as Claude Code does.
   Handlers never run in the UI. A handler prop is an id, `{"$handler": id}` on the wire, and the view answers with it. */

export type ModChild = ModElement | string | number | boolean | null | undefined;
/** `{type, props, children}`; a child may also be a string or a number (drawn as Text) */
export interface ModElement { type: string; props?: Readonly<Record<string, unknown>> | null | undefined; children?: ModChild | readonly ModChild[] | undefined }

export const ELEMENT_TYPES = ['Box', 'Text', 'Button', 'Input', 'Select', 'Markdown', 'Code', 'Link', 'Svg'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/** the documented limits: characters drawn, elements, depth; and the caps of two props */
export const LIMITS = { chars: 100000, elements: 20000, depth: 32, href: 2048, svg: 131072 } as const;

/** the string props whose text is drawn, and so counted against the characters limit */
const COUNTED = ['label', 'placeholder', 'value', 'text', 'source', 'path', 'language', 'href'] as const;

export type Validation = { ok: true; count: number; chars: number } | { ok: false; reason: string };

const isElementType = (t: unknown): t is ElementType => typeof t === 'string' && (ELEMENT_TYPES as readonly string[]).includes(t);
const kidsOf = (n: ModElement): readonly ModChild[] => (n.children == null ? [] : Array.isArray(n.children) ? n.children as readonly ModChild[] : [n.children as ModChild]);

/** Checks a tree against the limits and the vocabulary. Iterative: a hostile tree cannot overflow the stack. */
export function validateTree(tree: unknown): Validation {
  let count = 0, chars = 0;
  const stack: Array<[unknown, number]> = [[tree, 1]];
  while (stack.length) {
    const [n, depth] = stack.pop() as [unknown, number];
    if (n == null || n === false || n === true) continue;
    /* text is not an element: it adds characters, not depth (hx-mods counts depth over elements, `crates/hx-mods/src/tree.rs`) */
    if (typeof n === 'string' || typeof n === 'number') {
      chars += String(n).length;
      if (chars > LIMITS.chars) return { ok: false, reason: 'more than ' + LIMITS.chars + ' characters' };
      continue;
    }
    if (depth > LIMITS.depth) return { ok: false, reason: 'deeper than ' + LIMITS.depth };
    if (typeof n !== 'object' || !isElementType((n as ModElement).type)) return { ok: false, reason: 'unknown element ' + String((n as { type?: unknown } | null)?.type) };
    const el = n as ModElement;
    if (++count > LIMITS.elements) return { ok: false, reason: 'more than ' + LIMITS.elements + ' elements' };
    const p = el.props ?? {};
    for (const k of COUNTED) { const v = p[k]; if (typeof v === 'string') chars += v.length; }
    if (el.type === 'Svg' && String(p['svg'] ?? p['source'] ?? '').length > LIMITS.svg) return { ok: false, reason: 'an Svg over ' + LIMITS.svg + ' characters' };
    if (el.type === 'Link' && String(p['href'] ?? '').length > LIMITS.href) return { ok: false, reason: 'a Link href over ' + LIMITS.href };
    if (chars > LIMITS.chars) return { ok: false, reason: 'more than ' + LIMITS.chars + ' characters' };
    const kids = kidsOf(el);
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
  }
  return { ok: true, count, chars };
}

/** the id a handler prop carries: `{"$handler": id}` on the wire (a bare id string is read too); null when there is none */
export function handlerId(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && typeof (v as { $handler?: unknown }).$handler === 'string') return (v as { $handler: string }).$handler || null;
  return null;
}

/** the text of children, for a label that is given as children (a Button, a Code block) */
export const textOf = (children: ModElement['children']): string =>
  (children == null ? [] : Array.isArray(children) ? [...children] : [children]).map((c) => (c == null || c === false || c === true ? '' : typeof c === 'object' ? textOf((c as ModElement).children) : String(c))).join('');

/** element constructors for tests and samples: `h.Box({gap: 1}, h.Text({dimColor: true}, 'quiet'))` */
type Make = (props?: Record<string, unknown> | null, ...children: ModChild[]) => ModElement;
export const h = Object.fromEntries(ELEMENT_TYPES.map((t) => [t, (props?: Record<string, unknown> | null, ...children: ModChild[]): ModElement => ({ type: t, props: props ?? {}, children: children.flat() as ModChild[] })])) as Record<ElementType, Make>;
