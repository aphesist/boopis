/* The card layer: HX.cards of the v6 mock-up. `createCard(kind, data, opts)` -> <hx-card>; `queue(items, opts)`.
   Importing this module registers the factory the component library's `ui.card` calls. */
import { setCardFactory } from '../../components/card-registry';
import type { CardFactory } from '../../components/card-registry';
import "./cards.css";
import { create } from './card';
import { KINDS } from './kinds';
import { queue } from './queue';
import { openBlank, closeBlank } from './popover';
import { layer } from '../../components';
import type { Data } from './types';

setCardFactory(((kind, data, opts) => create(kind, data as Data, opts)) as CardFactory);

export const cards = {
  create, queue,
  kinds: Object.keys(KINDS),
  states: (kind: keyof typeof KINDS): string[] => (KINDS[kind] ? [...KINDS[kind].states] : []),
  sizes: ['inline', 'compact', 'mini'] as const,
  openBlank, closeBlank: (): void => layer.close(),
  version: '6.1.0'
};
export { create as createCard, queue, openBlank, closeBlank };
export type { HxCard, CardActionDetail, CardStateDetail } from './card';
export type { Data as CardData } from './types';
