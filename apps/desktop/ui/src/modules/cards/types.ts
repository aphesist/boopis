import type { CardKind, CardSize, CardOpts } from '@boopis/ui';
import type { HxCard } from './card';
import type { FormSpec } from '../../data';

/** the data a card takes: a form's spec (form.ts), with the older shapes of who asks */
export interface Data extends Partial<Omit<FormSpec, 'id' | 'title' | 'receipt'>> {
  [extra: string]: unknown;
  /** who asks, relayed by (older shapes: `from`, `bot`, `via`, `model`) */
  via?: string;
  from?: string; bot?: string; model?: string; title?: string;
  meta?: string; expiresAt?: number; decidedAt?: number; progress?: number; state?: string; id?: string;
}

export interface Ctx {
  d: Data; s: string; size: CardSize; id: string; at: string; card: HxCard;
  plain: string; tone: string; owe: string;
}
export interface Kind {
  states: readonly string[];
  initial: string;
  quiet?: Readonly<Record<string, number>>;
  tone(c: Pick<Ctx, 's'> & Partial<Ctx>): string | undefined;
  stamp?(c: Ctx): string;
  resolved(c: Ctx): boolean;
  say?(c: Ctx): string;
  text?(c: Ctx): string;
  /** the card drawn whole by the kit (a form: the AskCard's block) */
  render(c: Ctx): string;
  /** the one-row size */
  mini(c: Ctx): string;
  act?(card: HxCard, action: string, x: { value?: string | null | undefined; el?: HTMLElement | undefined }): void;
}
export type { CardKind, CardSize, CardOpts };
