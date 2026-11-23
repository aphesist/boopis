/* Markdown: the one renderer for what bots and agents write (the group room, a bot's own chat, Sessions, mods). A subset, drawn
   with the library's own parts and nothing else (DESIGN-SYSTEM.md 14.5 and 14.7, the chat research's direction A):
     blocks   paragraphs (one newline is a line break), # to ### (one heading size, 14/600), lists (nested by indent), quotes,
              a hairline for ---, tables (they scroll sideways), fenced code (the well: language, line count, Copy, Wrap, folded
              past 14 lines to 12), images (an attachment chip: the app loads nothing remote)
     inline   **bold**, *italic* and _italic_, ~~struck~~, `code`, [links](https://...) and bare https links, @mentions, paths
   Raw HTML is never HTML: everything is escaped first. The parse is pure (no DOM), so the tests read it as text; `markdown()`
   wires a drawn block (the code well's buttons). What a mention or a path opens is the surface's: the renderer draws them as
   buttons carrying `data-mention` and `data-path`, and the surface listens.

   Mentions match the engine's own pattern exactly (`@([A-Za-z0-9][A-Za-z0-9._:-]*)`, case-insensitive): a full stop right after a
   name is part of the handle, so "@kai." names nobody called "kai" and stays text, as the engine reads it. A handle nobody has
   stays text; `@all` and `@everyone` name the whole room when the surface gives its members. In a room (`you`), `@user` is the
   person: the engine shows the members every message the person writes as "User (user): ..." (`hosted_room_discussion._format_message`),
   so `user` is the handle a member writes to address them; it is drawn as the person's own capsule, and a message that holds it
   is marked `data-to-you`. A member whose handle is `user` keeps it, as the engine resolves members first.

   Paths are candidates until the host says they exist: a code span that reads as a path (no spaces, a slash or a known
   extension) is drawn as code with `data-path`, and `upgradePaths` turns the ones the host resolved into buttons. Nothing is
   guessed: an unresolved path stays code. */
import { attrs, cx, esc } from '../core/dom';
import type { BotLike } from './bot-state';
import { html } from './html';
import { icon } from './icons';
import { orbHtml } from './orb';

/** the engine's mention pattern (hosted_room_discussion._MENTION_RE, re.IGNORECASE), unchanged */
export const MENTION_SOURCE = '@([A-Za-z0-9][A-Za-z0-9._:-]*)';
const EVERYONE = new Set(['all', 'everyone']);
/** the person's handle in a room: the engine labels what they write "User (user)" in every member's prompt */
export const HUMAN_HANDLE = 'user';

/** a bot a mention names */
export interface MdBot extends BotLike { id: string; name: string; handle?: string | undefined }
export interface MarkdownCtx {
  /** a handle as written (without "@") to the bot it names, or null: a handle nobody has stays text */
  mention?: ((handle: string) => MdBot | null) | undefined;
  /** a handle that names a bot that exists but is not in this room: it is drawn as a muted chip saying so (a handle no bot has stays text) */
  outside?: ((handle: string) => MdBot | null) | undefined;
  /** what the muted chip says after the name (default "isn't in this room") */
  outsideNote?: string | undefined;
  /** the room's members: `@all` and `@everyone` become one chip with their orbs; without it they stay text */
  everyone?: readonly MdBot[] | undefined;
  /** a room's conversation: `@user`, the engine's handle for the person, is drawn as the person's capsule ("you"), and a message
      that holds it is marked as addressed to them */
  you?: boolean | undefined;
  /** code longer than this many lines folds to `fold - 2` lines (default 14, so 12 show) */
  fold?: number | undefined;
  /** links to https only (a mod's tree: MODS section 2); http stays words */
  httpsOnly?: boolean | undefined;
}

/** the handles a text mentions, as the engine matches them (case folded, in order, once each) */
export function mentionHandles(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text ?? '').matchAll(new RegExp(MENTION_SOURCE, 'g'))) {
    const h = (m[1] ?? '').toLowerCase();
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}
/** whom a message names, the way the engine resolves it (`resolve_mentions` with default_all off): the members whose handle it
    names, or all of them for @all and @everyone; an unknown handle (or "@kai." for kai) names nobody */
export function resolveMentions<M extends { handle: string }>(text: string, members: readonly M[]): { members: M[]; everyone: boolean } {
  const hs = mentionHandles(text);
  const everyone = hs.some((h) => EVERYONE.has(h));
  if (everyone) return { members: [...members], everyone };
  return { members: members.filter((m) => hs.includes(m.handle.toLowerCase())), everyone };
}

/** the bots a text mentions that are not among `members`, by the engine's rule (a handle is the whole run after the `@`, so "@nimbus."
    names nobody; `@all` and `@everyone` name the room, never an outsider); `known` are the bots that exist, by `handle` */
export function mentionsOutside<M extends { handle: string }, B extends { handle: string }>(text: string, members: readonly M[], known: readonly B[]): B[] {
  const inside = new Set(members.map((m) => m.handle.toLowerCase()));
  const out: B[] = [];
  for (const h of mentionHandles(text)) {
    if (EVERYONE.has(h) || inside.has(h)) continue;
    const b = known.find((k) => k.handle.toLowerCase() === h);
    if (b && !out.includes(b)) out.push(b);
  }
  return out;
}

/* ───────────── paths ───────────── */
const EXT = 'json|jsonl|md|mdx|txt|py|ts|tsx|js|jsx|mjs|cjs|rs|go|rb|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|ps1|yaml|yml|toml|ini|cfg|conf|env|lock|xml|html|htm|css|scss|sql|csv|tsv|log|png|jpg|jpeg|gif|webp|svg|pdf|mp3|mp4|mov|wav|ogg|webm|zip|gz|tar|tgz|wasm|ipynb|vue|svelte|lua|dart|ex|exs|erl|hs|ml|nix|proto|graphql|tf';
const FILE_RE = new RegExp('^[\\w.@+-]*\\.(?:' + EXT + ')$', 'i');
/** a code span that reads as a path: no spaces, not a link, a slash between names or a file name with a known extension;
    a trailing `:line` or `:line:col` is allowed (the path is what comes before it) */
export function pathCandidate(code: string): string | null {
  const s = code.trim();
  if (!s || s !== code || /\s/.test(s) || s.length > 400 || /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith('@')) return null;
  const p = s.replace(/:\d+(?::\d+)?$/, '');
  if (!/[A-Za-z]/.test(p)) return null;
  if (FILE_RE.test(p)) return p;
  if (/^(~|\.{1,2})?\/?[\w.@+-]+(\/[\w.@+-]*)+$/.test(p) && !/\/\//.test(p)) return p;
  if (/^~(\/[\w.@+-]+)+\/?$/.test(p)) return p;
  return null;
}
/** what the host says a path is */
export interface PathTarget { path: string; abs: string; kind: 'file' | 'folder' }
/** a resolved path as a button: the code chip with a file or folder glyph, its folders cut from the left so the name shows */
export function pathHTML(t: PathTarget, label?: string): string {
  const shown = label ?? t.path;
  const trimmed = shown.replace(/\/$/, '');
  const cut = trimmed.lastIndexOf('/') + 1;
  const dir = shown.slice(0, cut), base = shown.slice(cut);
  return '<button type="button" class="ui-code ui-path"' + attrs({ 'data-path': t.path, 'data-abs': t.abs, 'data-kind': t.kind, 'data-tip': t.abs, 'aria-haspopup': 'menu', 'aria-label': t.abs + '. Open it, or press the menu key for more' }) + '>' +
    icon(t.kind === 'folder' ? 'folder' : 'file') + (dir ? '<span class="ui-path__dir"><span>' + esc(dir) + '</span></span>' : '') + '<span class="ui-path__base">' + esc(base) + '</span></button>';
}
/** turn the path candidates under `root` that the host resolved into buttons (the others stay code) */
export function upgradePaths(root: ParentNode, resolved: ReadonlyMap<string, PathTarget>): number {
  let n = 0;
  for (const c of root.querySelectorAll<HTMLElement>('code.ui-code[data-path]')) {
    const t = resolved.get(c.dataset['path'] ?? ''); if (!t) continue;
    const tpl = document.createElement('template');
    tpl.innerHTML = pathHTML(t, c.textContent ?? t.path);
    const b = tpl.content.firstElementChild; if (!b) continue;
    c.replaceWith(b); n++;
  }
  return n;
}
/** the candidates under `root` still waiting for the host */
export const pathCandidates = (root: ParentNode): string[] => [...new Set([...root.querySelectorAll<HTMLElement>('code.ui-code[data-path]')].map((c) => c.dataset['path'] ?? '').filter(Boolean))];

/* ───────────── mentions ───────────── */
/** a mention: the bot's still orb and its name in a capsule; a button (the surface opens the bot's chat, and its card) */
export function mentionHTML(b: MdBot): string {
  return '<button type="button" class="ui-mention"' + attrs({ 'data-mention': b.id, 'aria-haspopup': 'dialog', 'aria-label': b.name + (b.role ? ', ' + b.role : '') + '. Open its chat' }) + '>' +
    orbHtml(b, { size: 16, still: true }) + '<span class="ui-mention__name">' + esc(b.name) + '</span></button>';
}
/** a mention of a bot that is not in this room: the same capsule, muted, saying so (not a button: there is nothing to open here) */
export function mentionOutsideHTML(b: MdBot, note = "isn't in this room"): string {
  const said = b.name + ' ' + note;
  return '<span class="ui-mention ui-mention--out" tabindex="0"' + attrs({ 'data-tip': said, 'aria-label': said }) + '>' + orbHtml(b, { size: 16, still: true }) + '<span class="ui-mention__name">' + esc(b.name) + '</span></span>';
}
const stackHTML = (members: readonly MdBot[]): string => '<span class="ui-mention__stack" aria-hidden="true">' + members.slice(0, 4).map((m) => orbHtml(m, { size: 16, still: true })).join('') + '</span>';
/** `@all`: the members' orbs, overlapping, and the word */
export function everyoneHTML(word: string, members: readonly MdBot[]): string {
  return '<button type="button" class="ui-mention ui-mention--all"' + attrs({ 'data-mention': '@all', 'aria-label': word + ': ' + members.map((m) => m.name).join(', ') }) + '>' +
    stackHTML(members) + '<span class="ui-mention__name">' + esc(word) + '</span></button>';
}

/** `@user` in a room: the person, as a capsule of their own. Not a bot's: no orb (the person has none) but the attention dot, the word
    "you" in attention text, the capsule's ring and glow in attention red, since a bot that writes it is waiting on them (R-colour-2:
    red is what the user owes). Not a button: there is nothing to open */
export const youHTML = (): string => '<span class="ui-mention ui-mention--you">' + html.dot('attention') + '<span class="ui-mention__name">you</span></span>';

/** what a handle names in a context, by the engine's rule: a bot of this conversation, the whole room (`@all`, `@everyone`), the
    person (`@user`, in a room), or a bot that exists but is not here; null when it names nobody (it stays text) */
export type MentionTarget = { kind: 'bot'; bot: MdBot } | { kind: 'out'; bot: MdBot } | { kind: 'all'; members: readonly MdBot[] } | { kind: 'you' };
export function mentionTarget(handle: string, ctx: MarkdownCtx): MentionTarget | null {
  const k = handle.toLowerCase();
  if (EVERYONE.has(k)) return ctx.everyone?.length ? { kind: 'all', members: ctx.everyone } : null;
  const b = ctx.mention?.(handle);
  if (b) return { kind: 'bot', bot: b };
  if (ctx.you && k === HUMAN_HANDLE) return { kind: 'you' };
  const o = ctx.outside?.(handle);
  return o ? { kind: 'out', bot: o } : null;
}
const targetHTML = (t: MentionTarget, word: string, ctx: MarkdownCtx): string => (t.kind === 'all' ? everyoneHTML(word, t.members) : t.kind === 'bot' ? mentionHTML(t.bot) : t.kind === 'you' ? youHTML() : mentionOutsideHTML(t.bot, ctx.outsideNote));
const hasMentions = (ctx: MarkdownCtx): boolean => !!(ctx.mention || ctx.everyone || ctx.outside || ctx.you);
/** whether a text addresses the person: a room's member wrote `@user` (the engine's handle for them), and no member answers to it */
export const addressesYou = (text: string, ctx: MarkdownCtx): boolean => !!ctx.you && mentionSpans(text, ctx).some((s) => s.target.kind === 'you');

/** a mention in a text: where it starts, its words exactly as written ("@kai", "@All"), and what it names */
export interface MentionSpan { at: number; text: string; target: MentionTarget }
/** the mentions a text holds that name someone in this context, matched by the engine's pattern anywhere in the text (the engine
    does not ask for a word start: "me@kai" names kai to it too) */
export function mentionSpans(text: string, ctx: MarkdownCtx): MentionSpan[] {
  if (!hasMentions(ctx)) return [];
  const out: MentionSpan[] = [];
  for (const m of String(text ?? '').matchAll(new RegExp(MENTION_SOURCE, 'g'))) {
    const t = mentionTarget(m[1] ?? '', ctx);
    if (t) out.push({ at: m.index ?? 0, text: m[0], target: t });
  }
  return out;
}
/** A mention set into the composer's text: the capsule a sent mention is drawn as, as a chip of the text. Its text is exactly the words
    typed (the "@" and the handle, which the send carries), kept for the caret, the copy and the screen reader; what shows is the
    capsule's own face (the orb and the name, the room's orbs and the word). Not a button: the text box is the control. */
export function mentionChip(s: MentionSpan, note = "isn't in this room"): { cls: string; html: string; tip?: string } {
  const t = s.target;
  if (t.kind === 'you') return { cls: 'ui-mention ui-mention--you', html: html.dot('attention') + '<span class="ui-sr">' + esc(s.text) + '</span><span class="ui-mention__name" aria-hidden="true" data-name="you"></span>' };
  if (t.kind === 'all') return { cls: 'ui-mention ui-mention--all', html: stackHTML(t.members) + '<span class="ui-mention__name">' + esc(s.text) + '</span>' };
  const face = orbHtml(t.bot, { size: 16, still: true }) + '<span class="ui-sr">' + esc(s.text) + '</span><span class="ui-mention__name" aria-hidden="true"' + attrs({ 'data-name': t.bot.name }) + '></span>';
  return t.kind === 'out' ? { cls: 'ui-mention ui-mention--out', html: face, tip: t.bot.name + ' ' + note } : { cls: 'ui-mention', html: face };
}

/* ───────────── inline ───────────── */
const linkHost = (href: string): string => href.replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '');
const linkHTML = (label: string, href: string): string => '<a class="ui-link"' + attrs({ href, target: '_blank', rel: 'noopener noreferrer', 'data-tip': linkHost(href) }) + '>' + label + '</a>';
const SAFE_URL = /^https?:\/\/[^\s<>"'`]+$/i;
const PH = (k: string, i: number): string => '\u0000' + k + i + '\u0000';

/** one line of inline markdown to HTML (escaped first; code, links and images are held aside while the rest is styled) */
export function inlineHTML(src: string, ctx: MarkdownCtx = {}): string {
  const held: string[] = [];
  const hold = (h: string): string => { held.push(h); return PH('h', held.length - 1); };
  let s = String(src ?? '');
  const ok = (href: string): boolean => SAFE_URL.test(href) && (!ctx.httpsOnly || /^https:/i.test(href));
  /* code spans: `x` or ``x`` */
  s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t: string, body: string) => {
    const code = body.length > 2 && body.startsWith(' ') && body.endsWith(' ') ? body.slice(1, -1) : body;
    const p = pathCandidate(code);
    return hold('<code class="ui-code"' + attrs({ 'data-path': p }) + '>' + esc(code) + '</code>');
  });
  /* images: an attachment chip (nothing remote is loaded), a link to it when it is on the web */
  s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, href: string) => {
    const name = alt.trim() || href.replace(/[?#].*$/, '').split('/').pop() || 'image';
    const chip = '<span class="ui-file ui-file--static ui-md__image">' + icon('file') + '<span>' + esc(name) + '</span></span>';
    return hold(ok(href) ? '<a class="ui-md__image-link"' + attrs({ href, target: '_blank', rel: 'noopener noreferrer', 'data-tip': linkHost(href), 'aria-label': name + ', image' }) + '>' + chip + '</a>' : chip);
  });
  /* links: [label](https://...) ; anything but http and https keeps its words and loses its target */
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, href: string) => (ok(href) ? hold(linkHTML(inlineHTML(label, { ...ctx, mention: undefined, everyone: undefined }), href)) : hold(inlineHTML(label, ctx))));
  /* autolinks: <https://...> and bare https://... (a closing mark of the sentence stays outside) */
  s = s.replace(/<(https?:\/\/[^\s<>]+)>/gi, (m, href: string) => (ok(href) ? hold(linkHTML(esc(href), href)) : m));
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>"'`]+)/gi, (_m, pre: string, raw: string) => {
    let href = raw, tail = '';
    while (/[.,;:!?)\]]$/.test(href)) { if (href.endsWith(')') && (href.match(/\(/g)?.length ?? 0) >= (href.match(/\)/g)?.length ?? 0)) break; tail = href.slice(-1) + tail; href = href.slice(0, -1); }
    return ok(href) ? pre + hold(linkHTML(esc(href), href)) + tail : pre + raw;
  });
  s = esc(s);
  /* emphasis */
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  /* mentions, by the engine's pattern; an unknown handle stays as written */
  if (hasMentions(ctx)) s = s.replace(new RegExp(MENTION_SOURCE, 'g'), (m, h: string) => { const t = mentionTarget(h, ctx); return t ? hold(targetHTML(t, '@' + h, ctx)) : m; });
  for (let i = held.length - 1; i >= 0; i--) s = s.split(PH('h', i)).join(held[i] ?? '');
  return s;
}

/** what the user wrote, as written (no markdown: a person's message is not styled), with its mentions as chips */
export function plainHTML(src: string, ctx: MarkdownCtx = {}): string {
  const s = String(src ?? '');
  let out = '', i = 0;
  for (const m of mentionSpans(s, ctx)) { out += esc(s.slice(i, m.at)) + targetHTML(m.target, m.text, ctx); i = m.at + m.text.length; }
  return out + esc(s.slice(i));
}

/* ───────────── blocks ───────────── */
export type BlockKind = 'p' | 'h' | 'list' | 'quote' | 'hr' | 'table' | 'code';
/** a top-level block and the source it came from; `open` is a fence not closed yet (a reply still arriving) */
export interface Block { kind: BlockKind; src: string; open?: boolean }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w.+#-]*)[^`]*$/;
const HEAD = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TROW = /^\s*\|.*\|\s*$/;
const TSEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** split a text into its top-level blocks */
export function splitBlocks(text: string): Block[] {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  const push = (kind: BlockKind, from: number, to: number, open?: boolean): void => { out.push({ kind, src: lines.slice(from, to).join('\n'), ...(open ? { open } : {}) }); };
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) { i++; continue; }
    const f = FENCE.exec(line);
    if (f) {
      const mark = f[1] ?? '```';
      let j = i + 1;
      while (j < lines.length && !new RegExp('^ {0,3}' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}\\s*$').test(lines[j] ?? '')) j++;
      if (j >= lines.length) { push('code', i, lines.length, true); i = lines.length; continue; }
      push('code', i, j + 1); i = j + 1; continue;
    }
    if (HEAD.test(line)) { push('h', i, i + 1); i++; continue; }
    if (HR.test(line)) { push('hr', i, i + 1); i++; continue; }
    if (TROW.test(line) && TSEP.test(lines[i + 1] ?? '')) {
      let j = i + 2;
      while (j < lines.length && TROW.test(lines[j] ?? '')) j++;
      push('table', i, j); i = j; continue;
    }
    if (QUOTE.test(line)) {
      let j = i + 1;
      while (j < lines.length && QUOTE.test(lines[j] ?? '')) j++;
      push('quote', i, j); i = j; continue;
    }
    if (ITEM.test(line)) {
      let j = i + 1;
      /* an item goes on while lines are items, indented continuations, or a blank line followed by more of the list */
      while (j < lines.length) {
        const l = lines[j] ?? '';
        if (ITEM.test(l) || (/^\s{2,}\S/.test(l))) { j++; continue; }
        if (!l.trim() && j + 1 < lines.length && (ITEM.test(lines[j + 1] ?? '') || /^\s{2,}\S/.test(lines[j + 1] ?? ''))) { j++; continue; }
        break;
      }
      push('list', i, j); i = j; continue;
    }
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] ?? '';
      if (!l.trim() || FENCE.test(l) || HEAD.test(l) || HR.test(l) || QUOTE.test(l) || (ITEM.test(l) && !/^\s{4,}/.test(l)) || (TROW.test(l) && TSEP.test(lines[j + 1] ?? ''))) break;
      j++;
    }
    push('p', i, j); i = j;
  }
  return out;
}

interface ListNode { ord: boolean; start: number; items: { text: string[]; kids: ListNode | null }[] }
/** a list block's lines as lists: nested by indent; a change from bullets to numbers at one depth starts a new list */
function listsOf(lines: readonly string[]): ListNode[] {
  const roots: ListNode[] = [];
  const stack: { indent: number; node: ListNode }[] = [];
  const fresh = (ord: boolean, marker: string): ListNode => ({ ord, start: ord ? parseInt(marker, 10) : 1, items: [] });
  for (const raw of lines) {
    if (!raw.trim()) continue;
    const m = ITEM.exec(raw);
    if (m) {
      const indent = (m[1] ?? '').replace(/\t/g, '    ').length, marker = m[2] ?? '-', ord = /\d/.test(marker);
      while (stack.length && indent < (stack[stack.length - 1]?.indent ?? 0)) stack.pop();
      let top = stack[stack.length - 1];
      if (top && indent > top.indent + 1) {
        const parent = top.node.items[top.node.items.length - 1];
        if (parent) { parent.kids ??= fresh(ord, marker); top = { indent, node: parent.kids }; stack.push(top); }
      }
      if (!top || top.node.ord !== ord) {
        const node = fresh(ord, marker);
        if (!top || stack.length <= 1) { roots.push(node); stack.length = 0; }
        else { stack.pop(); const parent = stack[stack.length - 1]?.node.items.at(-1); if (parent) parent.kids = node; }
        top = { indent, node }; stack.push(top);
      }
      top.node.items.push({ text: [m[3] ?? ''], kids: null });
    } else {
      const top = stack[stack.length - 1], last = top?.node.items[top.node.items.length - 1];
      if (last) last.text.push(raw.trim());
    }
  }
  return roots;
}
function listHTML(n: ListNode, ctx: MarkdownCtx): string {
  const tag = n.ord ? 'ol' : 'ul';
  return '<' + tag + (n.ord && n.start !== 1 ? ' start="' + n.start + '"' : '') + '>' + n.items.map((it) => '<li>' + it.text.map((t) => inlineHTML(t, ctx)).join('<br>') + (it.kids ? listHTML(it.kids, ctx) : '') + '</li>').join('') + '</' + tag + '>';
}
const cells = (row: string): string[] => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/** a fenced code block: the well, its language and line count, Copy in its corner, Wrap, and the fold */
export function codeHTML(lang: string, code: readonly string[], ctx: MarkdownCtx = {}): string {
  const fold = Math.max(4, ctx.fold ?? 14), show = fold - 2;
  const lines = code.length && code[code.length - 1] === '' ? code.slice(0, -1) : [...code];
  const n = lines.length;
  const diff = /^(diff|patch)$/i.test(lang) || (n > 1 && lines.every((l) => /^([+\- @]|\\|$)/.test(l)) && lines.some((l) => /^[+-]/.test(l)) && lines.some((l) => /^@@/.test(l)));
  const kind = (l: string): string | null => (!diff ? null : /^@@/.test(l) ? 'hunk' : /^\+(?!\+\+)/.test(l) ? 'add' : /^-(?!--)/.test(l) ? 'del' : null);
  const lineHTML = (l: string): string => '<span class="ui-codeblock__l"' + attrs({ 'data-d': kind(l) }) + '>' + esc(l) + '</span>';
  const folded = n > fold;
  const body = folded ? lines.slice(0, show).map(lineHTML).join('') + '<span class="ui-codeblock__rest" hidden>' + lines.slice(show).map(lineHTML).join('') + '</span>' : lines.map(lineHTML).join('');
  const name = lang || 'text', count = n + (n === 1 ? ' line' : ' lines');
  return '<div class="ui-codeblock ui-nest" data-sq' + attrs({ role: 'group', 'aria-label': name + ' code, ' + count, 'data-lang': lang || null, 'data-folded': folded ? '' : null }) + '>' +
    '<div class="ui-codeblock__head ui-corners" data-edge="both"><span class="ui-codeblock__lang">' + esc(name) + '</span><span class="ui-codeblock__n">' + esc(count) + '</span>' +
    html.button({ label: 'Wrap', size: 's', variant: 'ghost', class: 'ui-codeblock__wrap', attrs: { 'aria-pressed': 'false', 'data-tip': 'Wrap long lines' } }) +
    html.iconButton({ icon: 'copy', label: 'Copy the code', size: 's', tip: 'Copy', tipPos: 'top', class: 'ui-corner ui-codeblock__copy' }) + '</div>' +
    '<pre class="ui-codeblock__pre" tabindex="0"' + attrs({ 'aria-label': name + ' code' }) + '><code>' + body + '</code></pre>' +
    (folded ? '<div class="ui-codeblock__foot">' + html.button({ label: 'Show ' + (n - show) + ' more lines', size: 's', variant: 'ghost', class: 'ui-codeblock__fold', attrs: { 'aria-expanded': 'false', 'data-more': String(n - show) } }) + '</div>' : '') +
    '</div>';
}

/** one block to HTML */
export function blockHTML(b: Block, ctx: MarkdownCtx = {}): string {
  const lines = b.src.split('\n');
  switch (b.kind) {
    case 'code': {
      const f = FENCE.exec(lines[0] ?? '');
      const body = lines.slice(1, b.open ? undefined : -1);
      return codeHTML(f?.[2] ?? '', body, ctx);
    }
    case 'h': { const m = HEAD.exec(lines[0] ?? ''); return '<p class="ui-md__h" role="heading" aria-level="' + Math.min(6, Math.max(3, (m?.[1] ?? '###').length + 2)) + '">' + inlineHTML(m?.[2] ?? '', ctx) + '</p>'; }
    case 'hr': return '<hr class="ui-md__hr">';
    case 'quote': {
      const paras: string[][] = [[]];
      for (const l of lines) { const t = QUOTE.exec(l)?.[1] ?? ''; if (!t.trim()) { if (paras[paras.length - 1]?.length) paras.push([]); } else paras[paras.length - 1]?.push(t); }
      return '<blockquote class="ui-md__quote">' + paras.filter((p) => p.length).map((p) => '<p>' + p.map((t) => inlineHTML(t, ctx)).join('<br>') + '</p>').join('') + '</blockquote>';
    }
    case 'list': { const ls = listsOf(lines); return ls.length === 1 ? listHTML(ls[0] as ListNode, ctx) : ls.length ? '<div class="ui-md__lists">' + ls.map((n) => listHTML(n, ctx)).join('') + '</div>' : '<p>' + inlineHTML(b.src, ctx) + '</p>'; }
    case 'table': {
      const head = cells(lines[0] ?? ''), aligns = cells(lines[1] ?? '').map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : null));
      const row = (cs: string[], tag: 'th' | 'td'): string => '<tr>' + head.map((_h, k) => '<' + tag + attrs({ 'data-align': aligns[k] }) + '>' + inlineHTML(cs[k] ?? '', ctx) + '</' + tag + '>').join('') + '</tr>';
      return '<div class="ui-md__table ui-scroll ui-scroll--x" role="region" tabindex="0" aria-label="Table"><table><thead>' + row(head, 'th') + '</thead><tbody>' + lines.slice(2).map((l) => row(cells(l), 'td')).join('') + '</tbody></table></div>';
    }
    default: return '<p>' + lines.map((l) => inlineHTML(l.trim(), ctx)).join('<br>') + '</p>';
  }
}

/** a whole text to HTML: the prose wrapper and its blocks */
export function markdownHTML(text: string, ctx: MarkdownCtx = {}, o: { class?: string } = {}): string {
  return '<div class="' + cx('ui-prose ui-md', o.class) + '"' + (addressesYou(text, ctx) ? ' data-to-you' : '') + '>' + splitBlocks(text).map((b) => blockHTML(b, ctx)).join('') + '</div>';
}
