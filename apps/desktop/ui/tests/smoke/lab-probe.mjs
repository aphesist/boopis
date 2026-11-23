/* The lab's own checks, on pages made to break them. The owner's Store dialog cut its switches and buttons at the right
   edge (a body that scrolls down with overflow-x hidden), and the lab passed it: geometry.contain skipped everything under a
   scroller. A scroller hides only what it scrolls, so a box that shows in part past a side it does not scroll is reported. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, scenario } from './harness.mjs';

const PROBE = join(dirname(fileURLToPath(import.meta.url)), '..', 'lab', 'probe.js');
const page = (body, row) => `<!doctype html><body style="margin:0;background:#111">
<div id="dlg" style="position:absolute;left:40px;top:40px;width:500px;height:400px;background:#222;border-radius:20px">
  <div id="body" style="height:100%;${body}">${row}<div style="height:900px"></div></div></div></body>`;
const row = (w) => `<div style="width:${w}px;display:flex;justify-content:space-between;padding:16px">
  <span style="color:#eee">A source</span><button id="sw" style="width:60px;height:28px;background:#ddd;border:0;border-radius:14px"></button></div>`;
const below = '<button id="far" style="width:80px;height:28px;background:#ddd;border:0">x</button>';

export async function labProbe(env) {
  const s = scenario(env);
  const p = await s.fresh();
  const cuts = async (html) => {
    await p.setContent(html);
    await p.addScriptTag({ path: PROBE });
    return p.evaluate(() => window.__labProbe.run({ scope: '#dlg', checks: ['geometry.contain'] }).findings.filter((f) => /does not scroll that way/.test(f.msg)).map((f) => f.el + ': ' + f.msg));
  };
  await s.safe('lab-probe', async () => {
    const store = await cuts(page('overflow-y:auto;overflow-x:hidden', row(500)));
    check('lab-probe', 'a switch cut at the right edge of a column that only scrolls down is reported (the Store dialog)', store.length === 1 && /16px past its right edge/.test(store[0] ?? ''), store);
    /* the real dialog (agent S): the body scroller is width: 100% plus padding, so it is wider than the card, and the card's
       overflow: hidden is what cuts the switch; the nearest clipper (the scroller) holds the switch whole */
    const dialog = await cuts(`<!doctype html><body style="margin:0;background:#111">
<div id="dlg" style="position:absolute;left:40px;top:40px;width:500px;height:400px;background:#222;border-radius:20px;overflow:hidden">
  <div id="body" style="width:100%;height:100%;padding:0 20px;overflow-y:auto">${row(500).replace('padding:16px', 'padding:16px 0')}<div style="height:900px"></div></div></div></body>`);
    check('lab-probe', 'a switch cut by the card, past a scroller wider than the card, is reported (the real Store dialog)', dialog.length === 1 && /cut by .*div#dlg, .*20px past its right edge/.test(dialog[0] ?? ''), dialog);
    check('lab-probe', 'the same switch in a box that scrolls sideways too is not a cut (geometry.hscroll owns that)', (await cuts(page('overflow:auto', row(500)))).length === 0);
    check('lab-probe', 'a row that fits reports nothing', (await cuts(page('overflow-y:auto;overflow-x:hidden', row(420)))).length === 0);
    check('lab-probe', 'what a column scrolls out of view below is not a cut', (await cuts(page('overflow-y:auto;overflow-x:hidden', row(420)).replace('</div></div></body>', below + '</div></div></body>'))).length === 0);
  });
  /* stability.interact reads what is drawn. The dock's arrange panel and its expanded roster were "blinks" that nobody saw: a
     slot in a view put away (`hidden`) kept its own opacity, so it read as shown, and its entrance (opacity 0, then a fade in
     a few frames) read as going out and back. Each case plays frame by frame (rAF) under the sampler. */
  const blinks = async (play) => {
    await p.setContent(`<!doctype html><body style="margin:0;background:#111"><div id="root">
      <div id="view"${play === 'enter' ? ' hidden' : ''}><span id="slot" style="display:inline-block;width:40px;height:40px;background:#888"></span></div></div></body>`);
    await p.addScriptTag({ path: PROBE });
    return p.evaluate((play) => new Promise((done) => {
      const sm = window.__labProbe.sampler('#root', {});
      const view = document.getElementById('view'), slot = document.getElementById('slot');
      /* frame by frame: 3 at rest, then the change, then 12 more */
      const steps = {
        /* the view is shown and its slot enters in the same task, from opacity 0, over 5 frames */
        enter: [() => { view.hidden = false; slot.style.opacity = '0'; }, () => { slot.style.opacity = '0.25'; }, () => { slot.style.opacity = '0.5'; }, () => { slot.style.opacity = '0.75'; }, () => { slot.style.opacity = '1'; }],
        /* drawn, gone for two frames, back */
        dip: [() => { slot.style.opacity = '0'; }, () => {}, () => { slot.style.opacity = '1'; }],
        /* its view put away for two frames and shown again */
        hide: [() => { view.hidden = true; }, () => {}, () => { view.hidden = false; }]
      }[play];
      let f = 0;
      const tick = () => { f++; const s = f - 4; if (s >= 0 && s < steps.length) steps[s](); if (f < 4 + steps.length + 12) requestAnimationFrame(tick); else done(sm.stop().filter((i) => i.kind === 'flicker').map((i) => i.key)); };
      requestAnimationFrame(tick);
    }), play);
  };
  await s.safe('lab-probe', async () => {
    const enter = await blinks('enter');
    check('lab-probe', 'stability: a slot that enters from opacity 0 out of a hidden view is not a blink (the dock\'s arrange panel)', !enter.some((k) => /#slot/.test(k)), enter);
    const dip = await blinks('dip');
    check('lab-probe', 'stability: a drawn slot that goes to opacity 0 for two frames and back is a blink', dip.some((k) => /#slot/.test(k)), dip);
    const hide = await blinks('hide');
    check('lab-probe', 'stability: a slot whose view is put away for two frames blinks with it', hide.some((k) => /#slot/.test(k)) && hide.some((k) => /#view/.test(k)), hide);
  });
  await s.close();
}
