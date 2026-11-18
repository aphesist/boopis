/* The expanded blank is a card that brings its own surface; the library's one layer places it below the gap, closes
   it on Esc or an outside press, loops Tab inside and returns focus to the gap. */
import { layer } from '../../components';
import { create } from './card';
import type { HxCard } from './card';

export function openBlank(src: HxCard): HxCard | null {
  const trigger = src.querySelector<HTMLElement>('.cd-blank');
  if (!trigger) return null;
  const pop = create('blank', src.data, { size: 'popover', state: src.state });
  pop.source = src;
  pop.setAttribute('data-layer', '');
  const host = src.opts.layer ? document.querySelector(src.opts.layer) : null;
  const node = layer.open(trigger, pop, { place: 'below', ...(host ? { layer: host } : {}), onClose: () => { if (src.blankPop === pop) src.blankPop = null; } });
  if (!node) return null; /* the same gap again: the layer closed it */
  src.blankPop = pop;
  const first = pop.querySelector<HTMLElement>('.cd-opt[aria-checked="true"]') ?? pop.querySelector<HTMLElement>('.cd-opt');
  if (first) { first.tabIndex = 0; first.focus({ preventScroll: true }); }
  return pop;
}
export function closeBlank(pop: HxCard): void { if (pop && pop.isConnected) layer.close(); }
