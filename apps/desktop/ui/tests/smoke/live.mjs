/* The Sessions section on the live provider over recorded frames (a real gateway's and plugin's answers, replayed;
   `?provider=live-replay`): it must boot without errors, show what the recording says, and show no mock content, in the
   list, the conversation, the details panels, the composer and the dock. The bots are Hermes profiles, and the recording
   has no roster: the Bots tab must show none of the mock's, not say Preview, and open on the form that makes the first. */
import { check, scenario } from './harness.mjs';

/* words only the mock's data contains (data/mock-data.ts). Its model names ('sonnet 5.5') are left out: a readable Claude model name is also what a real ladder reads as */
const MOCK = ['billing-api', 'proration', 'prorate', 'qwen3', 'cents/proration', '142 passed', 'src/billing', 'invoices-sample', 'bubblewrap', 'github', 'postgres', 'linear', 'sentry'];
const text = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].map((n) => n.textContent).join('\n'), sel);
const leaks = (t) => MOCK.filter((w) => t.toLowerCase().includes(w.toLowerCase()));

export async function liveSessions(env) {
  const s = scenario(env);
  await s.safe('live', async () => {
    const page = await s.fresh({ q: 'provider=live-replay&frames=session', settle: 1500 });
    const boot = await page.evaluate(() => ({ rows: document.querySelectorAll('#hx-list-session [data-kit~="ListRow"]').length, booting: document.getElementById('hx-app').classList.contains('is-booting'), dock: !!document.querySelector('#hx-dock .dk') }));
    check('live', 'boots on recorded frames with no console errors and lists the recorded sessions', page.errors.length === 0 && !boot.booting && boot.dock && boot.rows === 2, { errors: page.errors, ...boot });

    await page.keyboard.press('Control+i');
    await page.waitForTimeout(900);
    /* the session's details are the kit's pane (board S40): what the recorded session knows is in its rows; its changed files are the
       diff the panel shows in their place; its tasks are in the thread while a turn runs (below) */
    const panel = await text(page, '#hx-right');
    const want = { connectors: /fakemcp/i, environment: /\/work\/proj/, runtime: /boopis engine/ };
    const missing = Object.entries(want).filter(([, re]) => !re.test(panel)).map(([k]) => k);
    const ungoverned = await page.evaluate(() => ({ governed: window.__hx.data().details.governance.get().governed, cap: !!document.querySelector('#hx-right [data-pane="cap"]') }));
    await page.evaluate(() => window.__hx.emit('hx:open-panel', { panel: 'changes', from: 'smoke' }));
    await page.waitForTimeout(500);
    const diff = await text(page, '#hx-right');
    if (!/a\.py/.test(diff)) missing.push('changes');
    if (ungoverned.governed || ungoverned.cap) missing.push('governance');
    check('live', 'the details pane shows the recorded session (connectors, environment, no cap for an ungoverned session), and its diff the changed files', missing.length === 0, { missing, ungoverned, panel: panel.slice(-700), diff: diff.slice(0, 300) });
    check('live', 'the details pane says what it cannot do instead of pretending', /compact|fork/i.test(panel) && /unknown|Not available/i.test(panel), panel.slice(0, 600));
    /* Compact, by its name, where the Context row opens it */
    await page.evaluate(() => window.__hx.emit('hx:open-panel', { panel: 'context', from: 'smoke' }));
    await page.waitForTimeout(400);
    const compact = await page.evaluate(() => {
      const found = [...document.querySelectorAll('#hx-right button')].filter((b) => b.textContent.trim() === 'Compact conversation');
      return { count: found.length, disabled: found.every((b) => b.disabled) };
    });
    check('live', 'Compact conversation is disabled when this Hermes has no session.compress', compact.count === 1 && compact.disabled, compact);

    const session = await text(page, '.ss-view, #hx-list-session, #hx-right, [data-hx-composer]');
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
    const after = await page.evaluate(() => ({ asked: window.__hxReplay.requests.map((r) => r.method).filter((m) => m === 'prompt.submit').length, blank: !!document.querySelector('.ss-col [data-blank][data-kit~="AskCard"]'), question: document.body.textContent.includes('Keep the old alias?'), waits: window.__hx.data().waits.snapshot().filter((w) => w.kind === 'blank').length, dockAsks: window.__hx.dock().state.asks, tasks: document.querySelector('.ss-col [data-tasks]')?.textContent ?? '', todos: window.__hx.data().details.todos.get().length, output: (() => { const log = [...document.querySelectorAll('.ss-col [data-part="log"]')].pop(); log?.querySelector('.k7-disc__sum[aria-expanded="false"]')?.click(); return [...document.querySelectorAll('.ss-col [data-part="log"] [data-output] pre')].map((n) => n.textContent).join('\n'); })() }));
    check('live', 'a turn plays back: its blank is asked in the conversation and waits on you (a session\'s blank is the session\'s: the v7 dock carries your bots\' approvals only), its task list is on the turn in the thread, and its tool output is in its open work line', after.asked === 1 && (after.todos === 0 || /round once per invoice/i.test(after.tasks)) && after.blank && after.question && after.waits >= 1 && after.dockAsks === 0 && /\$ ship src\/a\.py/.test(after.output) && /PASS/.test(after.output), after);

    const dock = await text(page, '#hx-dock');
    check('live', 'the dock shows no mock content, and nothing in it is marked a preview', leaks(dock).length === 0 && !/Preview/.test(dock), { leaks: leaks(dock), preview: /Preview/.test(dock) });

    await page.keyboard.press('Alt+2');
    await page.waitForTimeout(700);
    const bots = await page.evaluate(() => ({
      note: document.querySelector('.bt-preview')?.textContent ?? '', rows: document.querySelectorAll('.bt-rows [data-kit~="ListRow"]:not(.bt-row--draft)').length,
      form: !!document.querySelector('.bt-new:not([hidden]) .bt-name'), attention: [...document.querySelectorAll('[role="tab"][data-value="bots"] .ui-dot[data-show]')].length
    }));
    check('live', 'the Bots tab is not a preview, lists no sample bot, and opens on the form that makes the first', bots.note === '' && bots.rows === 0 && bots.form && bots.attention === 0, bots);
  });
  await s.close();
}
