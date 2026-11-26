/* The README's screenshots: the app's e2e build on its mock data (the same build and server the smoke tests use), at
   deviceScaleFactor 2, in the light (bone) and dark (the default, catalog) presets: the conversation with an agent turn, the
   Bots tab, and a form card raised in the conversation. They go to .github/readme/app-<what>-<light|dark>.png.

     node tests/readme-shots.mjs [outdir]

   Optimised after the capture when `oxipng` is on PATH or pyoxipng is installed; neither changes a pixel. */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, ROOT, startServers } from './lib.mjs';

const OUT = resolve(process.argv[2] || join(ROOT, '..', '..', '..', '.github', 'readme'));
mkdirSync(OUT, { recursive: true });

/* a form as an agent sends it (docs/FORMS.md): MCP elicitation's schema plus boopis's extensions */
const QUESTION = {
  id: 'f-round', kind: 'question', origin: { kind: 'agent', model: 'sonnet 5.5' }, title: 'How should line items round?', why: 'Pick a rule for the proration split.',
  schema: { properties: { rule: { type: 'string', title: 'Rule', enum: ['half-away', 'half-even', 'none'], enumNames: ['Half away from zero', 'Half to even', 'Do not round'], 'x-other': true } }, required: ['rule'] },
};
const THEMES = { light: 'bone', dark: 'catalog' };
const SHOTS = {
  session: async () => {},
  bots: async (page) => { await page.evaluate(() => __hx.setState({ tab: 'bots' })); await page.waitForTimeout(1600); },
  form: async (page) => {
    await page.setViewportSize({ width: 1280, height: 980 });
    await page.waitForTimeout(500);
    await page.evaluate((spec) => {
      /* where a turn's forms go (modules/session/conversation.ts: `.ss-forms`, a child of the turn, in the model's gutter) */
      const turn = [...document.querySelectorAll('.ss-col .ss-turn')].at(-1);
      const box = document.createElement('div');
      box.className = 'ss-forms'; box.style.marginTop = '14px';
      box.append(__hx.ui.card('form', spec, { size: 'inline' }));
      turn.append(box);
    }, QUESTION);
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector('.ss-forms').scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(700);
  },
};

const srv = await startServers();
const browser = await chromium.launch();
for (const [theme, preset] of Object.entries(THEMES)) {
  for (const [name, act] of Object.entries(SHOTS)) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const url = `${srv.origin}/index.html?preset=${preset}`;
    await page.goto(url);
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* blocked */ } });
    await page.goto(url);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1400);
    await act(page);
    const file = join(OUT, `app-${name}-${theme}.png`);
    await page.screenshot({ path: file });
    await ctx.close();
    console.log('wrote', file);
  }
}
await browser.close();
await srv.close();

/* lossless optimisation: oxipng when there is one on PATH, else pyoxipng (`pip install pyoxipng`); skipped when neither is there */
const PY = 'import oxipng, sys\nfor f in sys.argv[1:]: oxipng.optimize(f, level=4, strip=oxipng.Strip.safe())';
const files = [];
for (const theme of Object.keys(THEMES)) for (const name of Object.keys(SHOTS)) files.push(join(OUT, `app-${name}-${theme}.png`));
for (const cmd of [['oxipng', ['-o', '4', '--strip', 'safe', ...files]], ['python3', ['-c', PY, ...files]]]) {
  try { execFileSync(cmd[0], cmd[1], { stdio: 'ignore' }); break; } catch { /* try the next */ }
}
