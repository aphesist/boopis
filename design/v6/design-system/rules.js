/* boopis system · Rules page (owner: design-system agent)
   Draws each rule of DESIGN-SYSTEM.md version 1.1 into the [data-demo] slots of rules.html, from the real library
   (HX.ui, components.css) and the tokens. The theme controls drive theme.js, so every demonstration re-themes. */
(function () {
  'use strict';
  const HX = window.HX, ui = HX.ui, h = ui.html, T = window.HX_THEME, esc = ui.esc;
  const $ = (s, r) => (r || document).querySelector(s);
  const slot = (name) => $('[data-demo="' + name + '"]');
  const put = (name, html) => { const el = slot(name); if (el) { el.innerHTML = html; ui.hydrate(el); } return el; };
  const cap = (t) => '<span class="sp-cap">' + t + '</span>';
  const label = (t) => '<span class="sp-label">' + t + '</span>';

  /* ───────── preset follows the viewer until they pick one (as the specimen) ───────── */
  const picked = () => { try { return !!localStorage.getItem('hx.ds.picked'); } catch (e) { return false; } };
  const markPicked = () => { try { localStorage.setItem('hx.ds.picked', '1'); } catch (e) { /* fine */ } };
  const hostLight = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'light' : matchMedia('(prefers-color-scheme: light)').matches; };
  if (T && !picked()) { const want = hostLight() ? 'bone' : 'catalog'; if (T.get().preset !== want) T.preset(want); }

  function controls() {
    const t = T ? T.get() : { preset: 'catalog' };
    const P = T ? T.presets[t.preset] : { corners: 'default' };
    const corners = t.corners || P.corners;
    put('controls',
      '<div class="sp-control"><span>Theme</span>' + h.segmented({ mode: 'radio', size: 's', label: 'Theme', value: t.preset, options: [{ value: 'catalog', label: 'Card catalog' }, { value: 'graphite', label: 'Graphite' }, { value: 'bone', label: 'Bone' }, { value: 'typewriter', label: 'Typewriter' }], class: 'js-preset' }) + '</div>' +
      '<div class="sp-control"><span>Corners</span>' + h.segmented({ mode: 'radio', size: 's', label: 'Corners', value: corners, options: [{ value: 'sharp', label: 'Sharp' }, { value: 'default', label: 'Default' }, { value: 'round', label: 'Round' }], class: 'js-corners' }) + '</div>');
    const wire = (cls, fn) => { const el = $('.' + cls); if (el) el.addEventListener('ui:change', (e) => { markPicked(); fn(e.detail.value); }); };
    wire('js-preset', (v) => T && T.preset(v));
    wire('js-corners', (v) => T && T.set({ corners: v }));
  }

  const lorem = [
    'Show the dock. Bots and widgets at the bottom edge; everything in it is also in the sidebar.',
    'When the sidebar collapses, a rail keeps the tabs and the new button in reach.',
    'Graphics card. Which GPU draws the window; automatic uses the dedicated one on AC power when it is safe to.',
    'Graphics renderer. What the window draws with; copy the report when asked why the app is slow.',
    'Use my own engine. Runs the one already installed on this computer, with its own settings and profile.',
    'Interface font, code font, case, corners and density: each applies at once and is kept with the theme.',
    'Export the theme as JSON, or import one; a preset is one click and any solid colour can follow it.'
  ];
  const body = () => lorem.map((t) => '<p>' + esc(t) + '</p>').join('');
  const close = () => h.iconButton({ icon: 'close', label: 'Close settings', keys: 'esc' });
  const tabs = (sel) => '<div class="rl-dtabs" role="tablist" aria-label="Settings">' + ['General', 'Models'].map((t, i) => '<button type="button" role="tab" class="rl-dtab" data-sq aria-selected="' + (i === sel) + '" tabindex="' + (i === sel ? 0 : -1) + '">' + t + '</button>').join('') + '</div>';

  function scroll() {
    put('scroll',
      '<div class="sp-cell">' + label('The rule: drawn bar, constant gutter, track clear of the curve') +
        '<div class="rl-dlg" data-sq role="group" aria-label="Settings, the rule"><div class="rl-dlg__head"><h4>Settings</h4>' + close() + '</div><div class="rl-dlg__body rl-scroll" tabindex="0" aria-label="Settings body">' + body() + '</div></div>' +
        '<p class="rl-was">--scroll-size 10, --scroll-thumb 4, --scroll-thumb-color (--bg-4)</p></div>' +
      '<div class="sp-cell">' + label('Under the pointer: 6px, 3:1') +
        '<div class="rl-dlg" data-sq role="group" aria-label="Settings, the bar hovered"><div class="rl-dlg__head"><h4>Settings</h4>' + close() + '</div><div class="rl-dlg__body rl-scroll" data-demo-hover tabindex="0" aria-label="Settings body, hovered">' + body() + '</div></div>' +
        '<p class="rl-was">--scroll-thumb-active 6, --scroll-thumb-color-active (--mark-off)</p></div>' +
      '<div class="sp-cell">' + label('Was: scrollbar-width thin (ignored by WebKitGTK)') +
        '<div class="rl-dlg" data-sq role="group" aria-label="Settings, as the mock-up drew it"><div class="rl-dlg__head"><h4>Settings</h4>' + close() + '</div><div class="rl-dlg__body rl-thin" tabindex="0" aria-label="Settings body, the mock-up">' + body() + '</div></div>' +
        '<p class="rl-was">In WebKitGTK this is the platform’s wide bar, into the curve</p></div>');
  }

  function corner() {
    const seg = h.segmented({ mode: 'radio', size: 's', label: 'Sidebar collapses to', value: 'rail', options: [{ value: 'rail', label: 'Rail' }, { value: 'hide', label: 'Hide' }] });
    put('corner',
      '<div class="sp-cell">' + label('The rule: tabs and close share --r-in-dialog (18)') +
        '<div class="rl-dlg rl-dlg--short" data-sq role="group" aria-label="Dialog head, the rule"><div class="rl-dlg__head"><h4>Settings</h4>' + tabs(0) + close() + '</div><div class="rl-dlg__body rl-scroll" style="height:96px"><p>' + esc(lorem[0]) + '</p></div></div></div>' +
      '<div class="sp-cell">' + label('Was: tabs at --r-s (12) under a 30px curve') +
        '<div class="rl-dlg rl-dlg--short rl-dlg--was" data-sq role="group" aria-label="Dialog head, as found"><div class="rl-dlg__head"><h4>Settings</h4>' + tabs(0) + close() + '</div><div class="rl-dlg__body rl-scroll" style="height:96px"><p>' + esc(lorem[0]) + '</p></div></div></div>' +
      '<div class="sp-cell">' + label('A segmented control on the band: track 18, thumb 15') +
        '<div class="rl-dlg rl-dlg--short" data-sq role="group" aria-label="Dialog head with a segmented control"><div class="rl-dlg__head"><h4>Layout</h4>' + seg + close() + '</div><div class="rl-dlg__body rl-scroll" style="height:96px"><p>' + esc(lorem[1]) + '</p></div></div></div>');
    const el = slot('composer'); if (!el) return;
    el.innerHTML = '';
    const wrap = document.createElement('div'); wrap.style.maxWidth = 'var(--composer-w)'; el.appendChild(wrap);
    wrap.appendChild(ui.composer({ placeholder: 'Describe the change', spend: { spent: '$0.37', cap: '$0.60' },
      chips: [{ label: 'Governed', icon: 'ladder', pressed: true, tip: 'Climbs the model ladder' }, { label: 'Smart', icon: 'spark', pressed: false, tip: 'You pick the model' }] }));
  }

  function levels() {
    put('levels', [['0', '--elev-0', 'The frame and the ground: tone only'], ['1', '--elev-1', 'In flow: raised or inset, a hairline, no shadow'], ['2', '--elev-2', 'Tooltips: --shadow-tip'], ['3', '--elev-3', 'Menus, popovers, toasts: --shadow-pop'], ['4', '--elev-4', 'Palette and dialogs: --shadow-pop over the scrim']]
      .map(([l, t, d]) => '<div class="rl-level" data-l="' + l + '"><b>' + t + '</b><span>' + d + '</span></div>').join(''));
  }

  function stack() {
    put('stack',
      '<div class="sp-grid sp-grid--2">' +
      '<div class="sp-cell">' + label('A card holds a well, never a card') +
        '<div class="rl-card" data-sq><h5>nina wants to deploy to staging</h5><p class="rl-quote">The migration passed on a copy of production.</p>' +
        '<div class="rl-well" data-sq>npm run deploy -- --env staging</div>' +
        '<div class="rl-foot"><span class="rl-foot__meta">2 of 3</span><span style="display:flex;gap:8px">' + h.button({ label: 'Deny' }) + h.button({ label: 'Approve', variant: 'primary' }) + '</span></div></div>' +
        cap('Meta at the start, actions at the end, the primary last; corner pieces at --r-in-card (8)') + '</div>' +
      '<div class="sp-cell">' + label('A queue: the next two peek, no shadow') +
        '<div class="rl-queue"><div class="rl-card" data-sq><h5>Run the migration on production?</h5><p class="rl-quote">Request 1 of 3</p><div class="rl-foot"><span class="rl-foot__meta">14:09</span>' + h.button({ label: 'Not now', variant: 'ghost' }) + '</div></div><div class="rl-peek" aria-hidden="true"></div><div class="rl-peek" aria-hidden="true"></div></div>' +
        cap('Peeks 7px apart, inset 12 and 24, at .9 and .55') + '</div>' +
      '</div>');
  }

  function type() {
    const rows = [
      ['Display 20/1.2 600', '<span style="font:600 var(--fs-xl)/var(--lh-tight) var(--sans);color:var(--text-strong)">nina</span>'],
      ['Title 16/1.2 600', '<span style="font:600 var(--fs-l)/var(--lh-tight) var(--sans);color:var(--text-strong)">Session details</span>'],
      ['Card title 14/1.35 600', '<span style="font:600 var(--fs-m)/var(--lh-ui) var(--sans);color:var(--text-strong)">nina wants to deploy to staging</span>'],
      ['Reading 14/1.6 400', '<span style="font:400 var(--fs-m)/var(--lh) var(--sans)">Moved the billing retry into its own module and kept the public calls as they were.</span>'],
      ['Interface 13/1.35, 500 on controls', '<span style="font:400 var(--fs-s)/var(--lh-ui) var(--sans)">Rename session</span> ' + h.button({ label: 'Open PR', size: 's' })],
      ['Label 12/1.35 500', '<span style="font:500 var(--fs-xs)/var(--lh-ui) var(--sans);color:var(--text-quiet)">Recent</span>'],
      ['Small 12/1.5 400', '<span style="font:400 var(--fs-xs)/var(--lh-small) var(--sans);color:var(--text-dim)">Applies the next time the app starts.</span>'],
      ['Code 12 mono', h.code('src/billing/retry.ts')],
      ['Meta 11/1.45 mono', '<span class="ui-mono" style="font-size:var(--fs-2xs);line-height:var(--lh-meta);color:var(--text-quiet)">3m 42s $0.37 +96 −71</span>'],
      ['Truncation, one line', '<div class="rl-truncate"><span>Refactor the billing retry module and its tests</span><span>Short title</span></div>']
    ];
    put('type', rows.map(([k, v]) => '<div><span class="sp-cap">' + k + '</span><div>' + v + '</div></div>').join(''));
  }

  function icons() {
    put('icon-sizes', [['xl', 18, 'icon buttons', 'gear'], ['l', 16, 'buttons, rows, send', 'send'], ['m', 15, 'chips, menus', 'spark'], ['s', 14, 'command field, files', 'search'], ['xs', 12, 'section chevrons', 'chevron-down'], ['2xs', 10, 'disclosures', 'chevron']]
      .map(([k, px, d, ic]) => '<figure data-ic="' + k + '"><span>' + ui.icon(ic) + '</span><figcaption>--ic-' + k + ' ' + px + '<br>' + d + '</figcaption></figure>').join(''));
    const menu = ui.menu.still([{ label: 'Fork from here', icon: 'fork', keys: 'mod+shift+F' }, { label: 'Copy the answer', icon: 'copy', desc: 'Markdown, with the call number as a heading' }, { label: 'Smart', icon: 'spark', desc: 'Picks the model for each message' }], { label: 'Message actions' });
    const el = put('icon-gaps',
      '<div class="sp-cell">' + label('Button: 16, gap 8') + '<span class="rl-guide">' + h.button({ label: 'Open PR', icon: 'fork' }) + '</span></div>' +
      '<div class="sp-cell">' + label('Chip: 15, gap 6') + '<span class="rl-guide">' + h.chip({ label: 'Governed', icon: 'ladder', pressed: true }) + '</span></div>' +
      '<div class="sp-cell">' + label('Icon button: 18 in 28') + '<span class="rl-guide">' + h.iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B' }) + '</span></div>' +
      '<div class="sp-cell" data-menu>' + label('Menu: 15 glyph on the first line') + '</div>');
    if (el) el.querySelector('[data-menu]').appendChild(menu);
  }

  function keys() {
    put('keys',
      '<div class="sp-cell">' + label('Command field: glyph in a 26 square, keys at --r-in-field') +
        '<button type="button" class="rl-cmd" data-sq aria-label="boopis / Refactor billing retry, open the palette" aria-keyshortcuts="Control+K">' + ui.icon('search') + '<span>boopis / Refactor billing retry</span>' + h.keys('mod+K') + '</button>' +
        '<p class="rl-was">Was: glyph 10 in, keys at --r-xs (6)</p>' +
        '<button type="button" class="rl-cmd rl-cmd--was" data-sq aria-label="As found, open the palette">' + ui.icon('search') + '<span>boopis / Refactor billing retry</span>' + h.keys('mod+K') + '</button></div>' +
      '<div class="sp-cell">' + label('Tooltip: keys concentric with it') + h.tip('Hide sidebar', 'mod+B') +
        '<p class="rl-prose" style="margin-top:16px">In running text a key keeps --r-xs: press ' + h.keys('mod+shift+O') + ' for a new session.</p></div>' +
      '<div class="sp-cell">' + label('The palette’s field: glyph centred in 48, match underlined in brass') +
        '<div class="rl-palfield">' + ui.icon('search') + '<span><u>New</u> session</span>' + h.keys('esc') + '</div></div>');
  }

  function states() {
    const fam = (st) => {
      const attrsFor = { disabled: { disabled: true }, armed: { attrs: { 'data-armed': '' } } };
      const cls = st === 'hover' ? 'rl-hover' : st === 'press' ? 'rl-press' : '';
      const b = h.button(Object.assign({ label: st === 'armed' ? 'Click again to archive' : 'Archive', class: cls }, attrsFor[st] || {}));
      const p = h.button(Object.assign({ label: 'Approve', variant: 'primary', class: cls }, st === 'disabled' ? { disabled: true } : {}));
      const ib = h.iconButton({ icon: 'mic', label: 'Dictate', class: cls, pressed: st === 'checked' ? true : null, disabled: st === 'disabled' });
      const chip = h.chip({ label: 'Smart', icon: 'spark', pressed: st === 'checked', class: st === 'focus' ? 'rl-focus' : cls });
      const row = '<div class="rl-row ' + (st === 'focus' ? 'rl-focus' : cls) + '"' + (st === 'current' ? ' aria-current="true"' : '') + (st === 'disabled' ? ' aria-disabled="true"' : '') + '>' + 'Billing retry</div>';
      const sw = st === 'checked' ? h.switch({ id: 'rl-sw-' + st, checked: true, label: 'On' }) : st === 'disabled' ? '<input type="checkbox" role="switch" class="ui-switch" disabled aria-label="Disabled">' : st === 'focus' ? '<input type="checkbox" role="switch" class="ui-switch rl-focus" aria-label="Focused">' : st === 'rest' ? h.switch({ id: 'rl-sw-' + st, label: 'Off' }) : '';
      const ring = (x) => (st === 'focus' ? '<span class="rl-ring">' + x + '</span>' : x);
      return [ring(b), ring(p), ring(ib), ['disabled', 'armed', 'current'].includes(st) ? '' : chip, row, sw];
    };
    const STATES = ['rest', 'hover', 'press', 'focus', 'current', 'checked', 'disabled', 'armed'];
    put('states', '<table class="rl-states"><thead><tr><th>State</th><th>Button</th><th>Primary</th><th>Icon button</th><th>Chip</th><th>Row</th><th>Switch</th></tr></thead><tbody>' +
      STATES.map((st) => '<tr><td>' + st + '</td>' + fam(st).map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
  }

  function render() { controls(); scroll(); corner(); levels(); stack(); type(); icons(); keys(); states(); }
  render();
  /* the controls re-render on a theme change (a preset brings its own corners) */
  window.addEventListener('hx:theme', () => controls());
})();
