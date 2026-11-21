/* "@" mentions: a message that names the model that should answer it ("@Claude Haiku fix this"). Pure: no DOM, no client, so the
   composer (which draws the mention as a chip) and the provider (which routes the message) read the text the same way.

   A mention is "@" and a model's readable name, as the "who answers next" menu writes it; the name must end at a space, a
   punctuation mark or the end of the text, and the longest name wins ("@GPT-6 Luna" is not "@GPT-6"). The rules for what a
   message does (docs/DECISIONS.md, ADR-0036):
     - exactly one model mentioned (however many times)  -> that model answers this message only
     - two or more different models mentioned            -> left as written: the task-splitting tool reads them
     - none                                              -> an ordinary message */
import type { ModelChoice } from './types';

export interface Mention { start: number; end: number; text: string; choice: ModelChoice }

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** what the menu writes for a choice, and what the text must say for it to count (`called` is the kit's readable name) */
export const mentionName = (c: ModelChoice, called: (model: string) => string): string => called(c.model) || c.model;

export function findMentions(text: string, choices: readonly ModelChoice[], called: (model: string) => string): Mention[] {
  const names = choices.map((c) => ({ c, name: mentionName(c, called) })).filter((n) => n.name).sort((a, b) => b.name.length - a.name.length);
  const out: Mention[] = [];
  const re = /(^|[\s([{])@/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const at = m.index + m[1]!.length, rest = text.slice(at + 1);
    for (const n of names) {
      if (!new RegExp('^' + escape(n.name) + '(?=$|[\\s.,;:!?)\\]}])', 'i').test(rest)) continue;
      out.push({ start: at, end: at + 1 + n.name.length, text: text.slice(at, at + 1 + n.name.length), choice: n.c });
      re.lastIndex = at + 1 + n.name.length;
      break;
    }
  }
  return out;
}

export type MentionRoute =
  | { kind: 'none' }
  | { kind: 'one'; choice: ModelChoice }
  /** two or more different models: the message is not routed here */
  | { kind: 'many'; choices: ModelChoice[] };

export function routeMentions(text: string, choices: readonly ModelChoice[], called: (model: string) => string): MentionRoute {
  const seen = new Map<string, ModelChoice>();
  for (const m of findMentions(text, choices, called)) if (!seen.has(m.choice.value)) seen.set(m.choice.value, m.choice);
  const all = [...seen.values()];
  const [only] = all;
  return all.length === 0 || !only ? { kind: 'none' } : all.length === 1 ? { kind: 'one', choice: only } : { kind: 'many', choices: all };
}

/** The "@" being typed, read from the text before the caret: where its "@" is and the letters typed after it. The "@" must start a
 *  word (the start of the text or after a space or an opening bracket), and what follows is a name being typed only while it is
 *  letters, digits, dots and hyphens that start with a letter ("@op", "@gpt-6"). Anything else ("@@", "@ ", "@5pm") is not a mention
 *  being typed: the composer closes its menu and the text stays as written. */
export function mentionQuery(before: string): { at: number; query: string } | null {
  const m = /(^|[\s([{])@([^\s@]*)$/.exec(before);
  if (!m) return null;
  const query = m[2] ?? '';
  if (query && !/^[a-z][a-z0-9.-]*$/i.test(query)) return null;
  return { at: m.index + (m[1] ?? '').length, query };
}

/** The choice a typed query names: a readable name, or a word of it, that starts with the query ("op" is Claude Opus 5.5, "gpt-6 l"
 *  is not a query). The first choice in the menu's order wins; an empty query names nothing, so Enter still sends the message. */
export function bestMention(query: string, choices: readonly ModelChoice[], called: (model: string) => string): ModelChoice | null {
  const q = query.toLowerCase();
  if (!q) return null;
  for (const c of choices) {
    const name = mentionName(c, called).toLowerCase();
    if (name.startsWith(q) || name.split(/[\s/]+/).some((w) => w.startsWith(q)) || c.model.toLowerCase().startsWith(q)) return c;
  }
  return null;
}
