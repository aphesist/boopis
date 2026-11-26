/* `ui.card(kind, data, opts)` creates an <hx-card>. The card layer lives in modules/cards (it needs the library, so the
   library cannot import it): the layer registers its factory here when it loads, and the library calls it. */
export type CardKind = 'approval' | 'blank' | 'connector' | 'form';
export type CardSize = 'inline' | 'compact' | 'mini' | 'popover';
export interface CardOpts {
  size?: CardSize | undefined; state?: string | undefined; ground?: 'chrome' | 'dock' | undefined;
  holdMs?: number | undefined; holdFill?: 'dots' | 'solid' | undefined; layer?: string | undefined; enter?: boolean | undefined;
  queue?: { index: number; total: number } | undefined;
}
/** the card data is kind-specific and lives in modules/cards/types.ts; the library passes it through */
export type CardData = Record<string, unknown>;
export interface CardLike extends HTMLElement {
  readonly kind: CardKind;
  readonly state: string;
  readonly data: CardData;
  update(patch: Record<string, unknown>): this;
}
export type CardFactory = (kind: CardKind, data: CardData, opts?: CardOpts) => CardLike;

let factory: CardFactory | null = null;
export function setCardFactory(f: CardFactory): void { factory = f; }
export function card(kind: CardKind, data: CardData, opts?: CardOpts): CardLike {
  if (!factory) throw new Error('ui.card needs the card layer (modules/cards) loaded');
  return factory(kind, data, opts);
}
