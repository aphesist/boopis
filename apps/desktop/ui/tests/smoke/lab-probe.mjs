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
    check('lab-probe', 'the same switch in a box that scrolls sideways too is not a cut (geometry.hscroll owns that)', (await cuts(page('overflow:auto', row(500)))).length === 0);
    check('lab-probe', 'a row that fits reports nothing', (await cuts(page('overflow-y:auto;overflow-x:hidden', row(420)))).length === 0);
    check('lab-probe', 'what a column scrolls out of view below is not a cut', (await cuts(page('overflow-y:auto;overflow-x:hidden', row(420)).replace('</div></div></body>', below + '</div></div></body>'))).length === 0);
  });
  await s.close();
}
