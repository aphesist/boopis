/* A still sheet of the real kit at film scale: the check that the product's components, tokens, fonts, orbs and mark
   draw on the film's stage. index.html?scene=kit */
import { mount, ui } from '../engine/kit';
import { FilmOrb } from '../engine/orb';
import { logoSVG } from '../engine/logo';
import { ground } from '../engine/ground';
import { el, place } from '../engine/stage';
import type { Scene } from './types';

const scene: Scene = {
  config: { name: 'kit', duration: 1 },
  build(film, stage) {
    ground(film, stage);
    const L = stage.layer('stage', 1);
    const composer = ui.composer({ placeholder: 'Describe the change', chips: [{ label: 'Smart', pressed: true }] });
    composer.setValue('plan the billing migration with nina and kai');
    const c = mount(composer, { zoom: 2.25, width: 620 });
    L.appendChild(place(c, 960, 760));
    const orb = new FilmOrb({ shape: 'circle', color: '#4fc9a8' }, 260, { eyes: 'pill', yaw: 10, pitch: 6 });
    const holder = place(el('div', 'orb-holder'), 640, 360, { w: 260, h: 260 });
    holder.appendChild(orb.el);
    L.appendChild(holder);
    const orb2 = new FilmOrb({ shape: 'triangle', color: '#f23b5a' }, 260, { eyes: 'arc', yaw: -12, pitch: 4 });
    const holder2 = place(el('div', 'orb-holder'), 1280, 360, { w: 260, h: 260 });
    holder2.appendChild(orb2.el);
    L.appendChild(holder2);
    film.onRender(() => { orb.render(); orb2.render(); });
    const mark = place(el('div', 'mark', logoSVG({ mark: true, color: 'var(--text-strong)' })), 960, 360, { w: 180 });
    mark.style.color = 'var(--text-strong)';
    L.appendChild(mark);
    const h = place(el('div', 'headline', 'the AI plans you already pay for'), 960, 140);
    h.style.cssText += ';font-size:88px;font-weight:600;letter-spacing:-0.015em;white-space:nowrap';
    L.appendChild(h);
  }
};
export default scene;
