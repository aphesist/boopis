/* "@" mentions: a message that names the model that should answer it ("@Claude Haiku fix this"). Pure: no DOM, no client, so the
   composer (which draws the mention as a chip) and the provider (which routes the message) read the text the same way.

   A mention is "@" and a model's readable name, as the "who answers next" menu writes it; the name must end at a space, a
   punctuation mark or the end of the text, and the longest name wins ("@GPT-6 Luna" is not "@GPT-6"). The rules for what a
   message does (docs/DECISIONS.md, ADR-0041):
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
