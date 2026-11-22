/* The four acts of the master, in order (the coordinator's table; seams in SEAMS.md). */
import { act as A1 } from './a1';
import { act as A2 } from './a2';
import { act as A3 } from './a3';
import { act as A4 } from './a4';
import type { Act } from './act';

export const ACTS: Act[] = [A1, A2, A3, A4];
export const actById = (id: string): Act => {
  const a = ACTS.find((x) => x.id === id.toUpperCase());
  if (!a) throw new Error('no act ' + id);
  return a;
};
