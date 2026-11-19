/* The sign-in commands boopis may run on a form's behalf (apps/shared/data/logins.json: the one file the host reads too). A form
   names a provider id and never a command; the host maps the id to its own program and arguments. This file only says what the
   card may offer: the line it will show, and whether a sign-in is one boopis knows. The host decides again when it runs. */
import table from '../../../../shared/data/logins.json';
import type { FieldSchema } from '../data/types';

export interface LoginInfo { id: string; name: string; /** the command line the host will run, display only */ line: string }
const q = (a: string): string => (a === '' || /\s/.test(a) ? "'" + a.replace(/'/g, "'\\''") + "'" : a);
const LOGINS: ReadonlyMap<string, LoginInfo> = new Map(table.logins.map((l) => [l.id, { id: l.id, name: l.name, line: [l.program, ...l.args].map(q).join(' ') }]));

/** the sign-in for a provider id, or null when it is not one boopis knows */
export const loginFor = (provider: string | undefined): LoginInfo | null => (provider ? LOGINS.get(provider) ?? null : null);
export const knownLogins = (): readonly LoginInfo[] => [...LOGINS.values()];

export type XSignin = NonNullable<FieldSchema['x-signin']>;
/** A form's sign-in field can name an installed connector (`server`, Hermes's own OAuth) or a provider id from the table. A command
    or arguments in the field are never run and make the sign-in unknown, whatever else it says. */
export function signinKnown(s: XSignin): boolean {
  if (s.command !== undefined || s.args !== undefined) return false;
  return !!s.server || loginFor(s.provider) !== null;
}
