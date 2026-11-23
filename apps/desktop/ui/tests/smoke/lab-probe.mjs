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
  /* inline-baseline: a capsule in a sentence, trimmed to its words' cap height and baseline and padded by half of what is left, is
     on its line; the same capsule nudged 4px down is not. The family's italic face is drawn smaller (size-adjust), as a face that has
     not loaded yet stands in a smaller fallback: the probes take the text's own face, never the italic an <i> would ask for (CI run
     207 read Liberation Sans's cap height off Libre Franklin's unloaded italic, a chip 0.7px low that was not) */
  const chips = async (nudge) => {
    await p.setContent(`<!doctype html><style>
@font-face { font-family: LabSans; src: local("DejaVu Sans"), local("Liberation Sans"), local("Arial"); font-weight: 100 900; }
@font-face { font-family: LabSans; font-style: italic; src: local("DejaVu Sans"), local("Liberation Sans"), local("Arial"); font-weight: 100 900; size-adjust: 80%; }
</style><body style="margin:0;background:#111;color:#eee"><div id="t" style="width:600px;padding:20px">
  <p style="margin:0;font:400 15px/24px LabSans">staging needs <span class="ui-mention" style="display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:10px;background:#444;font:500 13px/1 LabSans;vertical-align:${nudge}"><span style="align-self:baseline;line-height:1;text-box:trim-both cap alphabetic;padding-block:calc((20px - 1cap) / 2)">you</span></span> before I deploy.</p></div></body>`);
    await p.addScriptTag({ path: PROBE });
    return p.evaluate(() => window.__labProbe.run({ scope: '#t', checks: ['inline-baseline'] }).findings.map((f) => f.el + ': ' + f.msg));
  };
  await s.safe('lab-probe', async () => {
    const on = await chips('baseline');
    check('lab-probe', 'inline-baseline: a capsule trimmed to its cap height and baseline is on its line, measured in its own face (not an italic one)', on.length === 0, on);
    const off = await chips('-4px');
    check('lab-probe', 'inline-baseline: the same capsule nudged 4px down is off its line', off.length === 1 && /\(a\) its text's baseline is 4 device px below/.test(off[0] ?? ''), off);
  });
  await s.close();
}
