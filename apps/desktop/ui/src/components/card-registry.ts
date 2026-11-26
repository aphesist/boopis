/* `ui.card(kind, data, opts)` creates an <hx-card>. The card layer lives in modules/cards (it needs the library, so the
   library cannot import it): the layer registers its factory here when it loads, and the library calls it. */
/** the host draws one kind: a form (the v6 kinds approval, blank and connector went to the kit at step 6f) */
export type CardKind = 'form';
export type CardSize = 'inline' | 'compact' | 'mini';
export interface CardOpts {
  size?: CardSize | undefined; state?: string | undefined; ground?: 'chrome' | 'dock' | undefined;
  enter?: boolean | undefined;
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
