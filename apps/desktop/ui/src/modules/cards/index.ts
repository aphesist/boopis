/* The card layer: the <hx-card> host of a form (the kit's AskCard block). `createCard('form', spec, opts)` -> <hx-card>.
   Importing this module registers the factory the component library's `card` calls. */
import { setCardFactory } from '@boopis/ui';
import type { CardFactory } from '@boopis/ui';
import { create } from './card';
import type { Data } from './types';

setCardFactory(((kind, data, opts) => create(kind, data as Data, opts)) as CardFactory);

export { create as createCard };
export type { HxCard, CardActionDetail, CardStateDetail } from './card';
export type { Data as CardData } from './types';
