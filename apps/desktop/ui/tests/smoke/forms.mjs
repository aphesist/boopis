/* Forms (docs/FORMS.md, ADR-0020), in a real browser:
   1. the form card family on the mock provider: every kind in every state, the keyboard rules, accessible errors, hold to
      approve, the secret that never stays in the page, axe with zero violations;
   2. forms raised by the plugin, over the recorded frames of a real gateway and plugin (`?provider=live-replay&frames=forms`):
      they appear inline in the conversation and among what waits on you (the provider's waits: the v7 dock carries your bots' approvals only, DESIGN-SYSTEM.md v7 21.4, so a form is answered where it was raised), and a secret
      reaches the keychain and nowhere else (not the DOM, not one RPC payload). */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { check, scenario } from './harness.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SECRET = 'sk-smoke-SECRET-0123456789abcdef';

/* the kinds as their senders send them: the schema is MCP elicitation's plus the x- extensions */
const SPECS = {
  credential: { id: 'f-key', kind: 'credential', origin: { kind: 'agent', model: 'sonnet 5.5' }, title: 'Add your OpenAI key', why: 'The embeddings step needs a key.', effect: 'Saves to your keychain.', provider: 'OpenAI', expires: 'expires in 30 min',
    schema: { properties: { key: { type: 'string', title: 'OpenAI API key', 'x-secret': true, 'x-secret-ref': 'secret://provider.openai/api_key', pattern: '^sk-[A-Za-z0-9_-]{20,}$', 'x-error': 'That is not an OpenAI key: it starts with sk-' } }, required: ['key'] } },
  question: { id: 'f-q', kind: 'question', origin: { kind: 'teammate', ids: ['atlas'] }, title: 'How should line items round?', why: 'Pick a rule.', schema: { properties: { rule: { type: 'string', title: 'Rule', enum: ['half-away', 'half-even', 'none'], enumNames: ['Half away from zero', 'Half to even', 'Do not round'], 'x-other': true, 'x-preview': [{ code: 'a' }, { code: 'b' }, { code: 'c', note: 'n' }] } }, required: ['rule'] } },
  setup: { id: 'f-setup', kind: 'setup', origin: { kind: 'plugin' }, title: 'Set the gate command', file: 'a.yaml', diff: ' a: 1\n+gate: npm test\n-old: 2', schema: { properties: { gate: { type: 'string', title: 'Gate', default: 'npm test', minLength: 2 }, timeout: { type: 'integer', title: 'Minutes', default: 5, minimum: 1, maximum: 60 }, net: { type: 'boolean', title: 'Network' } }, required: ['gate', 'timeout'] } },
  approval: { id: 'f-ap', kind: 'approval', origin: { kind: 'teammate', ids: ['nina'], via: 'atlas' }, title: 'Deploy to staging', why: 'Tests are green.', expires: 'expires in 9 min', schema: { properties: { note: { type: 'string', title: 'Note', 'x-multiline': true } } } },
  joint: { id: 'f-joint', kind: 'permission', origin: { kind: 'teammate', ids: ['nina', 'atlas', 'kai', 'moss', 'iris'] }, title: 'Allow npm publish?', schema: { properties: { scope: { type: 'string', title: 'Allow', enum: ['once', 'session', 'always', 'deny'], default: 'once' } }, required: ['scope'] }, cancel: false },
  multi: { id: 'f-multi', kind: 'question', origin: { kind: 'mcp', server: 'sentry', trust: 'trusted' }, title: 'Which suites?', schema: { properties: { suites: { type: 'string', title: 'Suites', 'x-multi': true, enum: ['a', 'b', 'c'] }, log: { 'x-upload': true, title: 'Log' }, folder: { 'x-picker': 'model', title: 'Model', default: 'sonnet 5.5' } }, required: ['suites'] } },
  signin: { id: 'f-sign', kind: 'signin', origin: { kind: 'host' }, title: 'Sign in to Linear', provider: 'Linear', schema: { properties: { linear: { 'x-signin': { provider: 'Linear', host: 'linear.app', flow: 'browser' } } }, required: ['linear'] } }
};
const STATES = ['open', 'invalid', 'submitting', 'done', 'deferred', 'expired', 'cancelled'];

export async function formCards(env) {
  const s = scenario(env);
  await s.safe('forms', async () => {
    const page = await s.fresh({ w: 1100, h: 900 });
    /* every kind in every state, on every size: drawn, labelled, no console error */
    const drawn = await page.evaluate(([specs, states]) => {
      const host = document.createElement('div'); host.id = 'gal'; host.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:var(--bg-0);padding:16px;display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,500px))';
      document.body.append(host);
      const out = [];
      for (const size of ['inline', 'compact', 'mini']) for (const st of states) for (const [k, sp] of Object.entries(specs)) {
        const c = __hx.ui.card('form', { ...JSON.parse(JSON.stringify(sp)), id: `g-${size}-${st}-${k}` }, { size, state: st });
        host.append(c);
        out.push({ k, st, size, state: c.state, label: !!(c.getAttribute('aria-labelledby') || c.querySelector('.cd-mini[aria-labelledby]')), text: c.textContent.length > 8 });
      }
      return out;
    }, [SPECS, STATES]);
    check('forms', 'every kind draws in every state on every size, named and not empty', drawn.every((d) => d.label && d.text && d.state === d.st), drawn.filter((d) => !(d.label && d.text && d.state === d.st)).slice(0, 5));
    const origin = await page.evaluate(() => ({
      stack: document.querySelectorAll('hx-card [data-origin="joint"] .ui-stack__more').length,
      more: [...document.querySelectorAll('hx-card [data-origin="joint"] .ui-sr')].some((n) => /atlas/.test(n.textContent)),
      relay: [...document.querySelectorAll('hx-card [data-origin="relay"] .cd-names__via')].some((n) => /via atlas/.test(n.textContent)),
      agent: !!document.querySelector('hx-card [data-origin="agent"] svg.ui-mm[data-family="claude"]'),
      system: !!document.querySelector('hx-card [data-origin="plugin"] .cd-glyph'), mcp: !!document.querySelector('hx-card [data-origin="mcp"] .cd-tile'), one: !!document.querySelector('hx-card [data-origin="teammate"] orb-avatar')
    }));
    check('forms', 'the origin slot draws one teammate, several with +N and every name, a relay, the agent with its logo, a system glyph and an MCP server', Object.values(origin).every((v) => v === true || v > 0), origin);
    await page.evaluate(() => document.getElementById('gal').remove());
  });

  await s.safe('forms', async () => {
    const page = await s.fresh({ w: 1100, h: 900, reduced: true });
    const mount = (spec, o) => page.evaluate(([sp, op]) => { let h = document.getElementById('gal'); if (!h) { h = document.createElement('div'); h.id = 'gal'; h.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:var(--bg-0);padding:16px;max-width:540px'; document.body.append(h); } h.replaceChildren(); const c = __hx.ui.card('form', sp, op); window.__c = c; h.append(c); window.__events = []; c.addEventListener('hx:card-action', (e) => window.__events.push(JSON.stringify({ a: e.detail.action, v: e.detail.value }))); }, [spec, o]);
    /* validation: errors are in the field's description, the field is invalid, the first one is announced and focused */
    await mount(SPECS.credential, { size: 'inline' });
    await page.keyboard.press('Tab');
    await page.locator('#gal hx-card [data-action="submit"]').click();
    await page.waitForTimeout(150);
    let v = await page.evaluate(() => { const i = __c.querySelector('input[data-secret]'), e = __c.querySelector('.cd-err'); return { state: __c.state, invalid: i.getAttribute('aria-invalid'), describedby: i.getAttribute('aria-describedby').includes(e.id), err: e.textContent, hidden: e.hidden, focus: document.activeElement === i, live: __c.querySelector('[role=status]').textContent }; });
    check('forms', 'an empty required field is an error in its description, the field is aria-invalid and focused, and it is announced', v.state === 'invalid' && v.invalid === 'true' && v.describedby && !v.hidden && /Enter/.test(v.err) && v.focus && /Check/.test(v.live), v);
    await page.fill('#gal input[data-secret]', 'nope');
    await page.locator('#gal hx-card [data-action="submit"]').click();
    v = await page.evaluate(() => ({ err: __c.querySelector('.cd-err').textContent }));
    check('forms', 'a value that fails its pattern says why, in the schema\'s own words', /not an OpenAI key/.test(v.err), v);

    /* the secret: typed, submitted, and gone from the page */
    await page.fill('#gal input[data-secret]', SECRET);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const during = await page.evaluate((sec) => ({ state: __c.state, html: document.documentElement.outerHTML.includes(sec), inputs: [...document.querySelectorAll('input')].some((i) => i.value.includes(sec)), events: JSON.stringify(window.__events).includes(sec), sub: window.__events.some((e) => /"a":"submit"/.test(e) && /"provided":\["key"\]/.test(e)) }), SECRET);
    check('forms', 'Enter submits from a field; the secret leaves the field and the page as it is sent, and the event names it without carrying it', during.state === 'submitting' && !during.html && !during.inputs && !during.events && during.sub, during);
    await page.waitForTimeout(900);
    const done = await page.evaluate((sec) => ({ state: __c.state, text: __c.textContent, html: document.documentElement.outerHTML.includes(sec), mem: JSON.stringify(Object.assign({}, __c.formState)).includes(sec) }), SECRET);
    check('forms', 'the done receipt says what happened and holds no secret', done.state === 'done' && /Saved to your keychain/.test(done.text) && !done.html && !done.mem, done);

    /* keys: Esc defers (never cancels), x cancels, 1-9 pick, Tab order, Enter on a choice submits */
    await mount(SPECS.question, { size: 'inline' });
    await page.locator('#gal hx-card .cd-opt').first().focus();
    await page.keyboard.press('2');
    const picked = await page.evaluate(() => ({ v: __c.formState.vals.rule, checked: [...__c.querySelectorAll('.cd-opt')].map((o) => o.getAttribute('aria-checked')), preview: __c.querySelector('.cd-preview').textContent }));
    check('forms', '1-9 pick an option and its preview shows beside it', picked.v === 'half-even' && picked.checked[1] === 'true' && /b/.test(picked.preview), picked);
    await page.keyboard.press('ArrowDown');
    const arrow = await page.evaluate(() => __c.formState.vals.rule);
    check('forms', 'the arrow keys move and choose in a radio group', arrow === 'none', arrow);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check('forms', 'Esc defers: the form collapses and offers to open again, nothing is cancelled', await page.evaluate(() => __c.state === 'deferred' && !!__c.querySelector('[data-action="reopen"]') && !window.__events.some((e) => /cancel/.test(e))));
    await page.locator('#gal [data-action="reopen"]').click();
    await page.waitForTimeout(150);
    await page.locator('#gal hx-card .cd-opt').first().focus();
    await page.keyboard.press('x');
    await page.waitForTimeout(150);
    check('forms', 'x cancels, and the receipt says the asker continues without it', await page.evaluate(() => __c.state === 'cancelled' && /continues without it/.test(__c.textContent)));

    /* hold to approve: one second, in a form */
    await mount(SPECS.approval, { size: 'inline' });
    const hold = page.locator('#gal hx-card [data-hold]');
    check('forms', 'an approval form asks for the hold, with Deny beside it', (await hold.count()) === 1 && (await page.locator('#gal hx-card [data-action="cancel"]').count()) === 1);
    const t0 = Date.now();
    await hold.focus();
    await page.keyboard.down('Space');
    await page.waitForTimeout(700);
    const mid = await page.evaluate(() => __c.state);
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');
    await page.waitForTimeout(400);
    const final = await page.evaluate(() => __c.state);
    check('forms', 'holding Space for a second approves (not before)', (mid === 'holding' || mid === 'open') && (final === 'submitting' || final === 'done') && Date.now() - t0 >= 1000, { mid, final });

    /* a sign-in the build cannot run says so on the control, and a card with several sources of origin stays valid */
    await mount(SPECS.signin, { size: 'inline' });
    check('forms', 'the sign-in control draws, with its provider named', await page.evaluate(() => /Sign in with Linear/.test(__c.querySelector('[data-action="signin"]').textContent)));
  });

  await s.safe('forms', async () => {
    const page = await s.fresh({ w: 1100, h: 1000 });
    await page.evaluate(([specs, states]) => {
      const host = document.createElement('div'); host.id = 'gal'; host.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:var(--bg-0);padding:16px;display:grid;gap:16px;grid-template-columns:repeat(2,minmax(0,500px))';
      document.body.append(host);
      for (const size of ['inline', 'compact']) for (const st of states) for (const [k, sp] of Object.entries(specs)) host.append(__hx.ui.card('form', { ...JSON.parse(JSON.stringify(sp)), id: `a-${size}-${st}-${k}` }, { size, state: st }));
    }, [SPECS, ['open', 'invalid', 'done', 'deferred']]);
    await page.waitForTimeout(500);
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => { const res = await axe.run(document.getElementById('gal'), { resultTypes: ['violations'], preload: false, rules: { region: { enabled: false } } }); return res.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, t: x.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0] ? ' - ' + n.any[0].message.slice(0, 90) : '')) })); });
    check('forms', 'axe: every form kind, open, invalid, done and deferred, inline and compact', v.length === 0, v);
    for (const preset of ['bone', 'graphite', 'typewriter']) {
      await page.evaluate((p) => __hx.theme.preset(p), preset);
      await page.waitForTimeout(250);
      const w = await page.evaluate(async () => { const res = await axe.run(document.getElementById('gal'), { resultTypes: ['violations'], preload: false, runOnly: ['color-contrast'] }); return res.violations.map((x) => ({ id: x.id, n: x.nodes.length, t: x.nodes.slice(0, 2).map((n) => n.target.join(' ') + (n.any[0] ? ' - ' + n.any[0].message.slice(0, 100) : '')) })); });
      check('forms', 'axe contrast of the form cards: ' + preset, w.length === 0, w);
    }
  });
  await s.close();
}

/* ───────── forms raised by the plugin, over a real gateway's recorded frames ───────── */
export async function liveForms(env) {
  const s = scenario(env);
  await s.safe('forms-live', async () => {
    const page = await s.fresh({ q: 'provider=live-replay&frames=forms', settle: 1500, w: 1440, h: 1000 });
    const composer = await page.$('.ss-composer textarea, .ss-composer [contenteditable="true"], .ss-composer [role="textbox"]');
    await composer.click();
    await page.keyboard.type('ask me three things');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1800);
    const raised = await page.evaluate(() => ({
      inline: [...document.querySelectorAll('.ss-forms hx-card[data-kind="form"]')].map((c) => c.data.kind),
      dock: __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length, dockAsks: __hx.dock().state.asks, waits: __hx.data().waits.snapshot().map((w) => w.kind + ':' + w.data.kind),
      origin: [...document.querySelectorAll('.ss-forms hx-card .cd-by')].map((n) => n.dataset.origin)
    }));
    check('forms-live', 'forms the plugin raised appear inline in the conversation, where the turn raised them', raised.inline.join() === 'credential,question,setup', raised);
    check('forms-live', 'and they wait on you, next to approvals and blanks (none of them in the dock: its asks are your bots\' approvals)', raised.dock === 3 && raised.dockAsks === 0 && raised.waits.join() === 'form:credential,form:question,form:setup', raised);
    check('forms-live', 'each says who is asking: the agent, with its model', raised.origin.every((o) => o === 'agent'), raised.origin);

    /* answer the credential INLINE, with a secret */
    const inlineKey = page.locator('.ss-forms hx-card').filter({ hasText: 'openai' }).first();
    await inlineKey.locator('input[data-secret]').fill(SECRET);
    await inlineKey.locator('[data-action="submit"]').click();
    await page.waitForTimeout(500);
    const k1 = await page.evaluate((sec) => ({
      stored: [...window.__hxReplaySecrets.stored.entries()], requests: window.__hxReplay.requests.filter((r) => r.method.startsWith('plugin.boopis.form.')),
      all: JSON.stringify(window.__hxReplay.requests).includes(sec),
      dom: document.documentElement.outerHTML.includes(sec) || [...document.querySelectorAll('input,textarea')].some((i) => i.value.includes(sec)),
      state: [...document.querySelectorAll('hx-card')].filter((c) => c.data.kind === 'credential').map((c) => c.state)
    }), SECRET);
    check('forms-live', 'the secret reaches the keychain (secret_set) under the plugin\'s reference', k1.stored.length === 1 && k1.stored[0][0] === 'boopis.provider.openai/api_key' && k1.stored[0][1] === SECRET, k1.stored.map((e) => e[0]));
    const sub = k1.requests.find((r) => r.method === 'plugin.boopis.form.submit');
    check('forms-live', 'form.submit carries the field name in provided and no value', !!sub && JSON.stringify(sub.params.provided) === '["value"]' && Object.keys(sub.params.values).length === 0, sub);
    check('forms-live', 'the secret is in no RPC payload and not in the DOM, before or after the answer', !k1.all && !k1.dom, { rpc: k1.all, dom: k1.dom });
    check('forms-live', 'answering inline resolves the inline card (a receipt)', k1.state.every((s) => s === 'done'), k1.state);
    await page.waitForTimeout(1300);
    check('forms-live', 'and it no longer waits on you', await page.evaluate(() => __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length === 2 && !document.querySelector('#hx-dock input[data-secret]')));

    /* answer the question, inline (the dock's Needs-you page went with v7: a session's form is answered in the session) */
    const inlineQ = page.locator('.ss-forms hx-card[data-kind="form"]').filter({ hasText: 'Keep the old alias?' }).first();
    await inlineQ.locator('.cd-opt').first().click();
    await inlineQ.locator('[data-action="submit"]').click();
    await page.waitForTimeout(600);
    const q = await page.evaluate(() => ({ req: window.__hxReplay.requests.filter((r) => r.method === 'plugin.boopis.form.submit').map((r) => r.params.values), inline: [...document.querySelectorAll('.ss-forms hx-card')].filter((c) => c.data.kind === 'question').map((c) => c.state) }));
    check('forms-live', 'answering the question sends the answer and the card becomes a receipt', q.req.some((v) => v.answer === 'yes') && q.inline.every((s) => s === 'done'), q);
    await page.waitForTimeout(1300);
    check('forms-live', 'one form is left waiting', await page.evaluate(() => __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length === 1));

    /* cancel the third inline */
    const inlineSetup = page.locator('.ss-forms hx-card').filter({ hasText: 'gate command' }).first();
    await inlineSetup.locator('[data-action="cancel"]').click();
    await page.waitForTimeout(1600);
    const c3 = await page.evaluate(() => ({ cancel: window.__hxReplay.requests.some((r) => r.method === 'plugin.boopis.form.cancel'), waits: __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length }));
    check('forms-live', 'cancelling sends form.cancel and nothing waits any more', c3.cancel && c3.waits === 0, c3);
    check('forms-live', 'nothing in the run logged a console error', page.errors.length === 0, page.errors);
  });
  await s.close();
}

/* ───────── Hermes's string prompts (secret, sudo), over a real gateway's recorded frames ───────── */
export async function liveRequests(env) {
  const s = scenario(env);
  const TYPED = 'smoke-typed-0123456789abcdef';
  await s.safe('forms-requests', async () => {
    const page = await s.fresh({ q: 'provider=live-replay&frames=requests', settle: 1500, w: 1440, h: 1000 });
    const say = async (text) => {
      const composer = await page.$('.ss-composer textarea, .ss-composer [contenteditable="true"], .ss-composer [role="textbox"]');
      await composer.click();
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    };
    const cards = () => page.evaluate(() => ({
      inline: [...document.querySelectorAll('.ss-forms hx-card[data-kind="form"]')].map((c) => ({ title: c.data.title, kind: c.data.kind, state: c.state, origin: c.querySelector('.cd-by')?.dataset.origin })),
      dock: __hx.data().waits.snapshot().filter((w) => w.kind === 'form').length,
      waits: __hx.data().waits.snapshot().map((w) => w.kind + ':' + w.data.kind)
    }));

    /* a skill whose token is missing: Hermes's `secret` request */
    await say('use the skill');
    let c = await cards();
    check('forms-requests', 'a secret request is a credential form, inline in the turn that raised it, from the session', c.inline.length === 1 && c.inline[0].kind === 'credential' && c.inline[0].title === 'boopis needs BOOPIS_TEST_TOKEN' && c.inline[0].origin === 'hermes', c);
    check('forms-requests', 'and it waits on you', c.dock === 1 && c.waits.join() === 'form:credential', c);
    const card = page.locator('.ss-forms hx-card').first();
    const field = await card.locator('input[data-secret]').evaluate((i) => ({ type: i.type, autocomplete: i.autocomplete }));
    check('forms-requests', 'the value is typed in a masked field', field.type === 'password' && field.autocomplete === 'off', field);
    check('forms-requests', 'it says where the value goes: boopis keeps it, the model never sees it', /never sees it/.test(await card.innerText()) && /Send it/.test(await card.innerText()) && !/hermes/i.test(await card.innerText()));
    await card.locator('input[data-secret]').fill(TYPED);
    await card.locator('[data-action="submit"]').click();
    await page.waitForTimeout(800);
    const k = await page.evaluate((typed) => ({
      responses: window.__hxReplay.responses,
      calls: JSON.stringify(window.__hxReplay.requests).includes(typed),
      keychain: window.__hxReplaySecrets.stored.size,
      dom: document.documentElement.outerHTML.includes(typed) || [...document.querySelectorAll('input,textarea')].some((i) => i.value.includes(typed)),
      states: [...document.querySelectorAll('.ss-forms hx-card')].map((x) => x.state),
      receipt: document.querySelector('.ss-forms hx-card')?.innerText ?? ''
    }), TYPED);
    check('forms-requests', 'the value goes in the response frame of the request\'s own id', k.responses.length === 1 && String(k.responses[0].id).startsWith('srq-') && k.responses[0].result.value === TYPED, k.responses);
    check('forms-requests', 'and in no call to the gateway, not the keychain, and not the page, before or after the answer', !k.calls && k.keychain === 0 && !k.dom, { calls: k.calls, keychain: k.keychain, dom: k.dom });
    check('forms-requests', 'the card becomes a receipt', k.states.every((x) => x === 'done') && /\bSent\b/.test(k.receipt) && /^boopis needs/.test(k.receipt), k);
    await page.waitForTimeout(1300);
    check('forms-requests', 'nothing waits on you any more', (await cards()).dock === 0);

    /* a sudo request the gateway withdraws when the turn is interrupted */
    await say('run sudo');
    c = await cards();
    const sudo = page.locator('.ss-forms hx-card').filter({ hasText: 'sudo password' }).last();
    check('forms-requests', 'a sudo request is a credential form with the command it is for, not held (a password is typed on purpose)', c.dock === 1 && /sudo true # never/.test(await sudo.innerText()) && (await sudo.locator('.ui-hold').count()) === 0, c);
    await page.evaluate(() => { const sid = window.__hxReplay.requests.find((r) => r.method === 'prompt.submit').params.session_id; __hx.data().sessions.stop(sid); });
    await page.waitForTimeout(1500);
    c = await cards();
    const closed = await page.evaluate(() => [...document.querySelectorAll('.ss-forms hx-card')].map((x) => x.state));
    check('forms-requests', 'the gateway withdrawing it (request.cancel) closes the form everywhere, with nothing sent', c.dock === 0 && closed.at(-1) === 'cancelled' && (await page.evaluate(() => window.__hxReplay.responses.length)) === 1, { dock: c.dock, closed });

    /* the next sudo request is answered */
    await say('run sudo again');
    const sudo2 = page.locator('.ss-forms hx-card').filter({ hasText: 'sudo password' }).last();
    await sudo2.locator('input[data-secret]').fill(TYPED + '-sudo');
    await sudo2.locator('[data-action="submit"]').click();
    await page.waitForTimeout(800);
    const r2 = await page.evaluate((typed) => ({ last: window.__hxReplay.responses.at(-1), calls: JSON.stringify(window.__hxReplay.requests).includes(typed), dom: document.documentElement.outerHTML.includes(typed) }), TYPED + '-sudo');
    check('forms-requests', 'a sudo password is answered the same way, and kept nowhere', r2.last.result.value === TYPED + '-sudo' && !r2.calls && !r2.dom, { last: r2.last.id, calls: r2.calls, dom: r2.dom });
    check('forms-requests', 'nothing in the run logged a console error', page.errors.length === 0, page.errors);
  });
  await s.close();
}
