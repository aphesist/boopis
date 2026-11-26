import type { CardKind, CardSize, CardOpts } from '@boopis/ui';
import type { HxCard } from './card';
import type { FormSpec } from '../../data';
import type { KnownOrigin } from './parts';

/** the data a card takes: the union of what every kind reads (see each kind in kinds.ts) */
export interface Data extends Partial<Omit<FormSpec, 'id' | 'title' | 'receipt'>> {
  [extra: string]: unknown;
  /** who asks, relayed by (older shapes: `from`, `via`, `model`) */
  via?: string;
  from?: string; bot?: string; source?: string; model?: string; title?: string; quote?: string; item?: readonly string[]; lines?: readonly string[];
  meta?: string; cost?: string; expiresAt?: number; decidedAt?: number; progress?: number; state?: string; id?: string; at?: string;
  /* blank */
  question?: string; short?: string; options?: readonly string[]; answer?: string;
  /* connector */
  name?: string; tools?: number; host?: string; scopes?: readonly string[];
}

export interface Ctx {
  d: Data; s: string; size: CardSize; id: string; at: string; q: CardOpts['queue']; card: HxCard;
  plain: string; tone: string; owe: string; origin: KnownOrigin | null;
}
export interface Render { side?: string; head: string; body: string; foot: string; /** a kind drawn whole by the kit (a form: the AskCard's block), in place of the v6 regions */ whole?: string }
export interface Kind {
  /** the origin a kind has when its data names none (a connector's is its server) */
  origin?(c: Pick<Ctx, 'd' | 's'>): KnownOrigin | null;
  states: readonly string[];
  initial: string;
  quiet?: Readonly<Record<string, number>>;
  tone(c: Pick<Ctx, 's'> & Partial<Ctx>): string | undefined;
  stamp?(c: Ctx): string;
  attention?(c: Pick<Ctx, 'd' | 's' | 'size'>): boolean;
  resolved(c: Ctx): boolean;
  say?(c: Ctx): string;
  text?(c: Ctx): string;
  orb?(c: Ctx): string;
  inline?(c: Ctx): string;
  render(c: Ctx): Render;
  mini(c: Ctx): string;
  act?(card: HxCard, action: string, x: { value?: string | null | undefined; el?: HTMLElement | undefined }): void;
}
export type { CardKind, CardSize, CardOpts };
