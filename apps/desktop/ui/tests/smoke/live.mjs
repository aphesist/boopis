/* The Sessions section on the live provider over recorded frames (a real gateway's and plugin's answers, replayed;
   `?provider=live-replay`): it must boot without errors, show what the recording says, and show no mock content, in the
   list, the conversation, the details panels, the composer and the dock. The bots are Hermes profiles, and the recording
   has no roster: the Bots tab must show none of the mock's, not say Preview, and open on the form that makes the first. */
import { check, scenario } from './harness.mjs';

/* words only the mock's data contains (data/mock-data.ts). Its model names ('sonnet 5.5') are left out: a readable Claude model name is also what a real ladder reads as */
const MOCK = ['billing-api', 'proration', 'prorate', 'enzo', 'qwen3', 'cents/proration', '142 passed', 'src/billing', 'invoices-sample', 'bubblewrap', 'github', 'postgres', 'linear', 'sentry'];
const text = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((n) => n.textContent).join('\n'), sel);
const leaks = (t) => MOCK.filter((w) => t.toLowerCase().includes(w.toLowerCase()));

export async function liveSessions(env) {
  const s = scenario(env);
  await s.safe('live', async () => {
    const page = await s.fresh({ q: 'provider=live-replay&frames=session', settle: 1500 });
    const boot = await page.evaluate(() => ({ rows: document.querySelectorAll('#hx-list-session .ui-row').length, booting: document.getElementById('hx-app').classList.contains('is-booting'), dock: !!document.querySelector('#hx-dock .dk') }));
    check('live', 'boots on recorded frames with no console errors and lists the recorded sessions', page.errors.length === 0 && !boot.booting && boot.dock && boot.rows === 2, { errors: page.errors, ...boot });

    await page.keyboard.press('Control+i');
    await page.waitForTimeout(900);
    const panel = await text(page, '.ssr-panel');
    const want = { tasks: /round once per invoice/i, changes: /a\.py/, connectors: /fakemcp/i, environment: /\/work\/proj/, governance: /Ungoverned/, runtime: /boopis engine/ };
    const missing = Object.entries(want).filter(([, re]) => !re.test(panel)).map(([k]) => k);
    check('live', 'the details panel shows the recorded session (tasks, changes, connectors, environment, governance)', missing.length === 0, { missing, panel: panel.slice(-700) });
    check('live', 'the details panel says what it cannot do instead of pretending', /compact|fork/i.test(panel) && /unknown|Not available/i.test(panel), panel.slice(0, 600));
    const compactDisabled = await page.evaluate(() => [...document.querySelectorAll('.ssr-actions button')].every((b) => b.disabled));
    check('live', 'Compact conversation is disabled when this Hermes has no session.compress', compactDisabled);

    const session = await text(page, '.ss-view, #hx-list-session, .ssr-panel, [data-hx-composer]');
    check('live', 'the Sessions section shows no mock content', leaks(session).length === 0, leaks(session));

    /* send a message: the recorded turn plays back, with its steps, its blank and its todo list */
    const composer = await page.$('.ss-composer textarea, .ss-composer [contenteditable="true"], .ss-composer [role="textbox"]');
    check('live', 'the session composer is there', !!composer);
    if (composer) {
      await composer.click();
      await page.keyboard.type('round once per invoice');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1800);
    }
    const after = await page.evaluate(() => ({ asked: window.__hxReplay.requests.map((r) => r.method).filter((m) => m === 'prompt.submit').length, blank: !!document.querySelector('.ss-q hx-card, hx-card[kind="blank"]'), question: document.body.textContent.includes('Keep the old alias?'), waits: window.__hx.dock().state.waits, output: [...document.querySelectorAll('.ssr-term')].map((n) => n.textContent).join('\n') }));
    check('live', 'a turn plays back: its blank is asked in the conversation and waits in the dock, and its tool output reaches the Output panel', after.asked === 1 && after.blank && after.question && after.waits >= 1 && /\$ ship src\/a\.py/.test(after.output) && /PASS/.test(after.output), after);

    const dock = await text(page, '#hx-dock');
    check('live', 'the dock shows no mock content, and nothing in it is marked a preview', leaks(dock).length === 0 && !/Preview/.test(dock), { leaks: leaks(dock), preview: /Preview/.test(dock) });
    const previews = await page.evaluate(() => document.querySelectorAll('#hx-dock .dk-preview').length);
    check('live', 'the dock marks no page as a preview: its bots and schedules are Hermes\u2019s', previews === 0, previews);

    await page.keyboard.press('Alt+2');
    await page.waitForTimeout(700);
    const bots = await page.evaluate(() => ({
      note: document.querySelector('.bt-preview')?.textContent ?? '', rows: document.querySelectorAll('.bt-rows .ui-row:not(.bt-row--draft)').length,
      form: !!document.querySelector('.bt-new:not([hidden]) .bt-name'), attention: [...document.querySelectorAll('[role="tab"][data-value="bots"] .ui-dot[data-show]')].length
    }));
    check('live', 'the Bots tab is not a preview, lists no sample bot, and opens on the form that makes the first', bots.note === '' && bots.rows === 0 && bots.form && bots.attention === 0, bots);
  });
  await s.close();
}
