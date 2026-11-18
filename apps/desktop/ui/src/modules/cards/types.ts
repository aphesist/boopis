import type { CardKind, CardSize, CardOpts } from '../../components/card-registry';
import type { HxCard } from './card';

/** the data a card takes: the union of what every kind reads (see each kind in kinds.ts) */
export interface Data {
  [extra: string]: unknown;
  from?: string; bot?: string; source?: string; model?: string; title?: string; quote?: string; item?: readonly string[]; lines?: readonly string[];
  meta?: string; cost?: string; expiresAt?: number; decidedAt?: number; progress?: number; state?: string; id?: string; at?: string;
  /* ship */
  passed?: number; rolledBack?: number; files?: number | ReadonlyArray<readonly [string, number, number]>; add?: number; del?: number; branch?: string;
  failures?: readonly string[]; showRollback?: boolean; rollbackNote?: string;
  /* blank */
  question?: string; short?: string; options?: readonly string[]; answer?: string;
  /* escalation */
  ladder?: ReadonlyArray<readonly [string, string]>; current?: number; to?: string; reason?: string; cap?: string; spent?: string; next?: string; raiseTo?: string;
  /* error */
  gate?: string; retryWith?: string; output?: readonly string[]; test?: string; note?: string;
  /* schedule */
  days?: readonly number[]; time?: string; cron?: string; when?: string;
  /* connector */
  name?: string; tools?: number; host?: string; scopes?: readonly string[];
}

export interface Ctx {
  d: Data; s: string; size: CardSize; id: string; at: string; q: CardOpts['queue']; card: HxCard;
  plain: string; tone: string; owe: string;
}
export interface Render { side?: string; head: string; body: string; foot: string }
export interface Kind {
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
