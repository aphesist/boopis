/* HX.botNames of the mock-up: a bot's name when its owner does not choose one ("Surprise me", an empty name).
   The curated list is shared data (apps/shared/data/bot-names.json) and the module's own state is nothing at all:
   availability is derived on every call, the list minus the names of the bots that exist now (case-insensitive,
   matched against the name and the id), so a name is taken while its bot exists, picked or typed, and comes back
   when that bot is archived or deleted. When every name is in use, `pick` returns a list name with the lowest free
   number ("nova-2") and `exhausted` says so. The functions take the names in use as an argument so they are pure;
   `botNames` binds them to the bots the module holds (which the provider keeps current). */
import list from '../../../../../shared/data/bot-names.json';
import { botIdBase, numbered } from '../../data/bot-id';
import { data } from '../../data';
import { S } from './model';

export { numbered };

/** names as the list means them: trimmed, lower case, once each, in the order given */
export function normaliseNames(raw: readonly unknown[]): string[] {
  return [...new Set(raw.map((n) => String(n).trim().toLowerCase()).filter(Boolean))];
}
export const NAME_POOL: readonly string[] = normaliseNames(list.names);

/** the names a set of bots occupies: each one's name and id, lower case */
export function namesInUse(bots: ReadonlyArray<{ id?: string; name?: string }>): Set<string> {
  const used = new Set<string>();
  for (const b of bots) { if (b.name) used.add(String(b.name).toLowerCase()); if (b.id) used.add(String(b.id).toLowerCase()); }
  return used;
}
export const isTaken = (name: string, used: ReadonlySet<string>): boolean => used.has(String(name || '').trim().toLowerCase());
export const availableNames = (pool: readonly string[], used: ReadonlySet<string>): string[] => pool.filter((n) => !used.has(n));
export const isExhausted = (pool: readonly string[], used: ReadonlySet<string>): boolean => !availableNames(pool, used).length;
export interface PickOpts {
  /** names to keep out of the answer while another is free: a reroll never lands on what is already in the field */
  avoid?: string | readonly string[];
  /** a number in [0, 1); Math.random by default */
  random?: () => number;
}
/** a random free name; with none free, a list name with a number */
export function pickName(pool: readonly string[], used: ReadonlySet<string>, o: PickOpts = {}): string {
  const rand = o.random ?? Math.random;
  const avoid = new Set(([] as string[]).concat(o.avoid ?? []).map((s) => String(s).toLowerCase()));
  const free = availableNames(pool, used), fresh = free.filter((n) => !avoid.has(n));
  const from = fresh.length ? fresh : free;
  if (from.length) return from[Math.floor(rand() * from.length)] as string;
  const base = pool[Math.floor(rand() * pool.length)] ?? 'bot';
  return numbered(base, (n) => used.has(n) || avoid.has(n));
}
/** what a name in the field will turn into, in words ('' when nothing changes) */
export function nameNote(name: string, taken: boolean, nextFree: string, rolledOut: boolean): string {
  const n = name.trim();
  if (n && taken) return 'There is already a bot called ' + n + '. This one will be ' + nextFree + '.';
  if (n && rolledOut) return 'Every name in the list is taken, so this one has a number.';
  return '';
}
/** alt+R rolls a name: matched by code, since Option+R types a symbol on a Mac */
export const isRollKey = (e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code'>): boolean =>
  e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR';

/** the bots whose names are in use: the module's copy, kept current by the provider's events, else the provider's own list */
const existing = (): ReadonlyArray<{ id: string; name: string }> => [
  ...(S.bots.length ? S.bots : data().bots.snapshot().bots),
  /* names the provider keeps for itself (Hermes's own `default`) are in use however many bots exist */
  ...(data().bots.catalog().reserved ?? []).map((n) => ({ id: n, name: n }))
];
export const botNames = {
  available: (): string[] => availableNames(NAME_POOL, namesInUse(existing())),
  taken: (name: string): boolean => isTaken(name, namesInUse(existing())),
  exhausted: (): boolean => isExhausted(NAME_POOL, namesInUse(existing())),
  pick: (o?: PickOpts): string => pickName(NAME_POOL, namesInUse(existing()), o),
  /** the number a name would get if a bot called that already exists (the provider's rule for ids) */
  next: (name: string): string => numbered(botIdBase(name), (id) => existing().some((b) => b.id === id))
};
