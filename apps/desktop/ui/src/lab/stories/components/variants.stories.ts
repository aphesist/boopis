/* Every variant the kit exports (`variants`), one axis at a time: a story per component, a state per axis, each value of
   that axis side by side over the component's base props (src/lab/variant-drawers.ts). When a component gains a variant,
   its story gains it without an edit. */
import { ui, variants } from '@boopis/ui';
import type { ComponentName } from '@boopis/ui';
import { line } from '../../story';
import type { State, Story } from '../../types';
import { DRAWERS } from '../../variant-drawers';
import type { Drawer } from '../../variant-drawers';

function story(name: ComponentName, d: Drawer): Story {
  const axes = variants[name] as Record<string, readonly unknown[]>;
  const states: Record<string, State> = {};
  for (const [axis, values] of Object.entries(axes)) {
    states[axis] = {
      tags: ['variant'], note: values.map(String).join(' · '), ...(d.width ? { width: d.width } : {}), ...(d.ground ? { ground: d.ground } : {}),
      render({ root }) {
        line(root, ...values.map((v) => { const p = { ...d.base, ...(d.as ? d.as(axis, v) : { [axis]: v }) }; const out = d.draw(p); return out; }));
        ui.hydrate(root);
      }
    };
  }
  if (!Object.keys(states).length) states['base'] = { tags: ['variant'], render({ root }) { line(root, d.draw(d.base)); ui.hydrate(root); } };
  return { id: 'components/variants-' + name, title: 'Variants: ' + name, area: 'components', kind: 'component', covers: [], states };
}

export default (Object.keys(DRAWERS) as ComponentName[]).map((n) => story(n, DRAWERS[n] as Drawer));
