/* hypotaxis system · specimen (owner: design-system agent)
   Renders every token and component from the real library (HX.ui, components.css) and the real card layer
   (HX.cards, cards.js) into the [data-demo] slots of index.html. Theme controls drive theme.js (HX_THEME), so the
   page re-themes itself; live readouts (hex values, contrast) re-read the tokens on every hx:theme. */
(function () {
  'use strict';
  const HX = window.HX, ui = HX.ui, h = ui.html, D = window.HX_DATA || {}, T = window.HX_THEME;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = ui.esc;
  const slot = (name) => $('[data-demo="' + name + '"]');
  const put = (name, html) => { const el = slot(name); if (el) { el.innerHTML = html; ui.hydrate(el); } return el; };
  const bot = (id) => (D.bots || []).find((b) => b.id === id);

  /* ───────── preset follows the viewer until they pick one ───────── */
  const picked = () => { try { return !!localStorage.getItem('hx.ds.picked'); } catch (e) { return false; } };
  const markPicked = () => { try { localStorage.setItem('hx.ds.picked', '1'); } catch (e) { /* fine */ } };
  const hostLight = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'light' : matchMedia('(prefers-color-scheme: light)').matches; };
  if (T && !picked()) { const want = hostLight() ? 'bone' : 'catalog'; if (T.get().preset !== want) T.preset(want); }
  new MutationObserver(() => { if (T && !picked()) T.preset(hostLight() ? 'bone' : 'catalog'); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* ───────── colour reading ───────── */
  let probe = null;
  function rgbaOf(token, scope) {
    if (!probe) { probe = document.createElement('i'); probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'; }
    (scope || document.body).appendChild(probe);
    probe.style.color = token.startsWith('#') ? token : 'var(' + token + ')';
    const c = getComputedStyle(probe).color; probe.remove();
    let m = c.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] == null ? 1 : +m[4]];
    m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : [0, 0, 0, 1];
  }
  const over = (a, b) => [0, 1, 2].map((i) => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
  function solidOf(spec, scope) { const [top, under] = spec.split('@'); const t = rgbaOf(top, scope); return t[3] < 1 ? over(t, under ? solidOf(under, scope) : rgbaOf('--bg-2', scope)) : t; }
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  /* ───────── controls ───────── */
  function renderControls() {
    const t = T ? T.get() : { preset: 'catalog' };
    const P = T ? T.presets[t.preset] : { corners: 'default', density: 'regular', case: 'sentence' };
    const eff = (k) => t[k] || P[k];
    put('controls',
      '<div class="sp-control"><span id="lbl-preset">Theme</span>' + h.segmented({ mode: 'radio', size: 's', label: 'Theme', value: t.preset, options: [{ value: 'catalog', label: 'Card catalog' }, { value: 'graphite', label: 'Graphite' }, { value: 'bone', label: 'Bone' }, { value: 'typewriter', label: 'Typewriter' }], class: 'js-preset' }) + '</div>' +
      '<div class="sp-control"><span>Corners</span>' + h.segmented({ mode: 'radio', size: 's', label: 'Corners', value: eff('corners'), options: [{ value: 'sharp', label: 'Sharp' }, { value: 'default', label: 'Default' }, { value: 'round', label: 'Round' }], class: 'js-corners' }) + '</div>' +
      '<div class="sp-control"><span>Density</span>' + h.segmented({ mode: 'radio', size: 's', label: 'Density', value: eff('density'), options: [{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }, { value: 'comfortable', label: 'Comfortable' }], class: 'js-density' }) + '</div>' +
      '<div class="sp-control"><span>Case</span>' + h.segmented({ mode: 'radio', size: 's', label: 'Interface case', value: eff('case'), options: [{ value: 'sentence', label: 'Sentence' }, { value: 'lower', label: 'lower' }], class: 'js-case' }) + '</div>');
    const wire = (cls, fn) => { const el = $('.' + cls); if (el) el.addEventListener('ui:change', (e) => { markPicked(); fn(e.detail.value); }); };
    wire('js-preset', (v) => T && T.preset(v));
    wire('js-corners', (v) => T && T.set({ corners: v }));
    wire('js-density', (v) => T && T.set({ density: v }));
    wire('js-case', (v) => T && T.set({ case: v }));
  }

  /* ───────── colour ───────── */
  const ROLES = [
    ['Surfaces', [['--bg-1', 'Frame', 'Title bar, sidebars, the open panel, menus, palette, dialogs'], ['--bg-2', 'Ground', 'What the work sits on'], ['--bg-3', 'Raised', 'Your request, the composer, tooltips, toasts'], ['--bg-0', 'Inset', 'Fields, cards set into the work, wells'], ['--bg-4', 'Pressed', 'Pressed fills, kbd in a tooltip, scrollbars'], ['--chip', 'Code chip', 'Inline code']]],
    ['Text and icons', [['--text', 'Text', 'Body and labels; lines derive from it'], ['--text-strong', 'Strong', 'Titles, the current row'], ['--text-dim', 'Secondary', 'Roles, quotes, descriptions'], ['--text-quiet', 'Meta', 'Times, costs, call numbers, headings'], ['--text-faint', 'Faint', 'Decoration and disabled only'], ['--icon', 'Icon', 'Glyphs in buttons and rows'], ['--icon-quiet', 'Window controls', 'Minimise, maximise, close']]],
    ['Meaning', [['--brass', 'Accent: you are here', 'Focus ring, current marker, active rung, checked'], ['--red', 'Attention', 'Dots, stamp outlines, the blank line'], ['--red-text', 'Attention text', 'waiting for you, needs you, failed'], ['--selected', 'Selected fill', 'Primary button, tab thumb, checked switch'], ['--text-on-light', 'On selected', 'Ink on the bone fill']]],
    ['Status and diff', [['--ok', 'Passed', 'A passed gate in output'], ['--warn', 'Warning', 'A contrast warning in the customizer'], ['--add', 'Added', 'Added lines and counts'], ['--del', 'Removed', 'Removed lines and counts']]]
  ];
  function renderColour() {
    put('swatches', ROLES.map(([g, rows]) => '<div class="sp-label" style="margin:18px 0 10px">' + g + '</div><div class="sp-swatches">' + rows.map(([t, n, d]) =>
      '<div class="sp-swatch"><i style="background:var(' + t + ')"></i><b>' + n + '</b><code>' + t + ' ' + hex(rgbaOf(t)) + '</code><small>' + d + '</small></div>').join('') + '</div>').join('') +
      '<div class="sp-label" style="margin:18px 0 10px">Fixed</div><div class="sp-swatches"><div class="sp-swatch" data-fixed data-ground="dock"><i style="background:var(--dock-bg)"></i><b>Dock</b><code>--dock-bg #000000</code><small>Pitch black in every theme. Not in the customizer.</small></div></div>');
    put('layers', '<div class="sp-layers">' + [['--bg-1', 'Frame', 'cabinet'], ['--bg-2', 'Ground', 'reading room'], ['--bg-3', 'Raised', 'card stock'], ['--bg-0', 'Inset', 'drawer']].map(([t, n, w]) =>
      '<div style="background:var(' + t + ')"><b>' + n + '</b><span>' + t + '<br>' + w + ' ' + hex(rgbaOf(t)) + '</span></div>').join('') +
      '<div data-ground="dock" style="background:var(--dock-bg)"><b>Dock</b><span>--dock-bg<br>fixed #000000</span></div></div>');
    put('derived', '<div class="sp-swatches">' + [['--hair', 'Hairline', 'text 7.5%, dividers inside a surface'], ['--line', 'Line', 'text 15%, control outlines'], ['--line-strong', 'Strong line', 'text 26%, hover outlines, empty rings'], ['--line-field', 'Field line', 'text 42% (54% light), text fields at 3:1'], ['--mark-off', 'Mark off', 'quiet 55% into faint: inactive dots and rings at 3:1'], ['--hover', 'Hover', 'text 4.5%, hover fill'], ['--current', 'Current', 'text 8.5%, the selected row'], ['--brass-soft', 'Accent soft', 'brass 14%, selection'], ['--red-soft', 'Attention soft', 'red 14%, behind a stamp on hover']].map(([t, n, d]) =>
      '<div class="sp-swatch"><i style="background:linear-gradient(var(' + t + '),var(' + t + ')),var(--bg-1)"></i><b>' + n + '</b><code>' + t + '</code><small>' + d + '</small></div>').join('') + '</div>');
  }

  /* ───────── contrast ───────── */
  const PAIRS = [
    ['--text', '--bg-1', 4.5, 'Text on the frame'], ['--text', '--bg-2', 4.5, 'Text on the ground'], ['--text', '--bg-3', 4.5, 'Text on raised'], ['--text', '--bg-0', 4.5, 'Text on inset'],
    ['--text-dim', '--bg-1', 4.5, 'Secondary on the frame'], ['--text-dim', '--bg-3', 4.5, 'Secondary on raised'],
    ['--text-quiet', '--bg-1', 4.5, 'Meta on the frame'], ['--text-quiet', '--bg-2', 4.5, 'Meta on the ground'], ['--text-quiet', '--bg-3', 4.5, 'Meta on raised'], ['--text-quiet', '--bg-0', 4.5, 'Meta on inset'],
    ['--text-quiet', '--current@--bg-1', 4.5, 'Meta on a selected row'], ['--text-dim', '--bg-4', 4.5, 'Key in a tooltip'],
    ['--text-on-light', '--selected', 4.5, 'Ink on the selected fill'],
    ['--red-text', '--bg-2', 4.5, 'Attention text on the ground'], ['--red-text', '--bg-0', 4.5, 'Attention text on inset'], ['--red-text', '--current@--bg-1', 4.5, 'Attention text on a selected row'],
    ['--add', '--bg-1', 4.5, 'Added count on the frame'], ['--del', '--bg-1', 4.5, 'Removed count on the frame'],
    ['--brass', '--bg-1', 3, 'Focus ring on the frame'], ['--brass', '--bg-2', 3, 'Focus ring on the ground'], ['--brass', '--bg-3', 3, 'Accent on raised'],
    ['--icon', '--bg-1', 3, 'Icon on the frame'], ['--icon-quiet', '--bg-1', 3, 'Window control on the frame'], ['--red', '--bg-2', 3, 'Attention dot on the ground'],
    ['--line-field@--bg-0', '--bg-1', 3, 'Field outline against the frame'],
    ['--mark-off', '--bg-1', 3, 'Inactive mark on the frame'], ['--mark-off', '--bg-3', 3, 'Inactive mark on raised']
  ];
  const DOCK = [['--text', '#000', 4.5, 'Dock text'], ['--text-quiet', '#000', 4.5, 'Dock meta'], ['--text-quiet', '--surface@#000', 4.5, 'Meta on a card in the dock'], ['--red-text', '#000', 4.5, 'Dock attention text'], ['--brass', '#000', 3, 'Dock accent and focus'], ['--mark-off', '#000', 3, 'Dock inactive mark']];
  function renderContrast() {
    const dockScope = $('#sp-dock-probe') || (() => { const d = document.createElement('div'); d.id = 'sp-dock-probe'; d.dataset.ground = 'dock'; d.hidden = true; document.body.appendChild(d); return d; })();
    const row = (fg, bg, min, label, scope) => {
      const f = solidOf(fg, scope), b = bg === '#000' ? [0, 0, 0, 1] : solidOf(bg.replace('#000', '--dock-bg'), scope), r = ratio(f, b);
      const ok = r >= min;
      const glyph = min < 4.5 ? ui.icon('check', { size: 'm' }) : 'Aa';   /* non-text pairs get a non-text sample */
      return '<tr' + (ok ? '' : ' data-fail') + '><td>' + esc(label) + '</td><td><span class="sp-pair" style="background:' + hex(b) + ';color:' + hex(f) + '">' + glyph + '</span></td><td class="n">' + fg.split('@')[0] + ' / ' + bg.split('@').pop() + '</td><td class="n">' + min + '</td><td class="n">' + r.toFixed(2) + '</td></tr>';
    };
    put('contrast', '<table class="sp-table"><thead><tr><th>Pair</th><th>Sample</th><th class="n">Tokens</th><th class="n">Needs</th><th class="n">Ratio</th></tr></thead><tbody>' +
      PAIRS.map((p) => row(p[0], p[1], p[2], p[3])).join('') + DOCK.map((p) => row(p[0], p[1], p[2], p[3], dockScope)).join('') + '</tbody></table>');
  }

  /* ───────── type, scales, lines, motion ───────── */
  function renderType() {
    put('type', [
      ['sp-t-display', 'Name your bot', 'Display 20/600 sans, one per screen'],
      ['sp-t-title', 'Session details', 'Title 16/600 sans'],
      ['sp-t-cardtitle', 'nina wants to deploy to staging', 'Card title 14/600 sans'],
      ['sp-t-reading', 'Everything under src/billing now works as integer cents. prorateCents rounds once, at the end, half away from zero.', 'Reading 14/1.6 sans, measure 608'],
      ['sp-t-interface', 'proration drift in src/billing', 'Interface 13/1.35 sans; 500 for buttons and tabs'],
      ['sp-t-label', 'billing-api', 'Label 12/500 sans, group headings'],
      ['sp-t-small', 'Compacting summarises older turns. Files and project memory stay.', 'Small 12/1.5 sans, hints'],
      ['sp-t-meta', 'qwen3-coder → sonnet 5.5   3m 42s   $0.37', 'Meta 11/1.45 mono, call numbers'],
      ['', h.code('prorateCents') + ' ' + h.stamp('waiting for you'), 'Code 12 mono on chip; stamp 11/500 mono']
    ].map(([c, s, m]) => '<div><span class="' + c + '">' + (c ? esc(s) : s) + '</span><span>' + m + '</span></div>').join(''));
  }
  const px = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function renderScales() {
    put('spacing', [1, 2, 3, 4, 5, 6, 7].map((i) => '<div><span>--sp-' + i + '</span><i style="width:var(--sp-' + i + ')"></i><span>' + px('--sp-' + i) + '</span></div>').join(''));
    put('density', [['--row-h', 'row'], ['--row-h-2', 'two-line row'], ['--ctl', 'control'], ['--ctl-s', 'icon button']].map(([v, n]) => '<div><span>' + n + '</span><i style="width:calc(var(' + v + ') * 4);height:var(' + v + ');background:var(--bg-3);box-shadow:inset 0 0 0 1px var(--line)"></i><span>' + v + ' ' + px(v) + '</span></div>').join(''));
    put('radii', [['--r-xs', 'kbd, chips, stamps' + (CONT ? ', continuous' : ', round')], ['--r-s', 'buttons, rows, fields'], ['--r-m', 'cards, composer, menus'], ['--r-l', 'ground corner, dock, dialogs'], ['--r-pill', 'dots, switch']].map(([v, n]) => '<div><i style="border-radius:var(' + v + ')"></i><span class="sp-cap"><b>' + v + '</b> ' + (v === '--r-pill' ? '' : px(v)) + '</span><span class="sp-cap">' + n + '</span></div>').join(''));
    put('lines', [['--hair', 'Hairline, inside a surface'], ['--line', 'Line, control outline'], ['--line-strong', 'Strong line, hover, rings'], ['--line-field', 'Field line, 3:1']].map(([v, n]) => '<div><i style="background:var(' + v + ')"></i><span class="sp-cap"><b>' + v + '</b><br>' + n + '</span></div>').join(''));
    put('shadows', [['--shadow-pop', 'pop: menus, palette, dialogs, toasts'], ['--shadow-tip', 'tip: tooltips'], ['--shadow-side', 'side: a drawer over the ground']].map(([v, n]) => '<div style="--s:var(' + v + ')">' + n + '</div>').join(''));
  }
  const MOTION = [['press', '--dur-press', '--ease', 'Press feedback'], ['1', '--dur-1', '--ease', 'Hover in, colour'], ['out', '--dur-out', '--ease', 'Hover out, exits, tips'], ['2', '--dur-2', '--ease', 'Menus, fades, 6px drop'], ['slide', '--dur-slide', '--ease', 'Thumb, indicator'], ['3', '--dur-3', '--spring', 'Layout travel, card height'], ['hold', '--dur-hold', 'linear', 'Hold to approve']];
  function renderMotion() {
    put('motion', MOTION.map(([n, d, e, use]) => '<div><span class="sp-cap"><b>' + d + '</b> ' + px(d) + '<br>' + (e === 'linear' ? 'linear' : e) + ', ' + use + '</span><div class="sp-track" style="--d:var(' + d + ');--e:' + (e === 'linear' ? 'linear' : 'var(' + e + ')') + '"><i style="transition-duration:var(' + d + ');transition-timing-function:' + (e === 'linear' ? 'linear' : 'var(' + e + ')') + '"></i></div></div>').join('') +
      '<div><span class="sp-cap"><b>--dur-breathe</b> 1.8s<br>--ease-io, the one loop</span><div style="display:flex;align-items:center;gap:10px">' + h.dot('run') + '<span class="sp-cap">running</span></div></div>');
    put('motion-play', h.button({ label: 'Play every curve', icon: 'play', size: 's', class: 'js-play' }) + '<span class="sp-cap">Curves: --ease cubic-bezier(.2,.8,.2,1), --spring cubic-bezier(.22,1,.36,1), --ease-io cubic-bezier(.65,0,.35,1). None overshoots.</span>');
    $('.js-play').addEventListener('click', () => { for (const t of $$('.sp-track')) { t.style.setProperty('--w', t.clientWidth + 'px'); t.toggleAttribute('data-go'); } });
  }

  /* ───────── icons, mark, orbs ───────── */
  function renderIcons() {
    put('icons', ui.icons.filter((n) => n !== 'phi').map((n) => '<div>' + ui.icon(n) + '<span>' + n + '</span></div>').join(''));
    put('mark', ui.icon('phi'));
    put('mark-usage', '<div style="background:var(--bg-1);color:var(--text-strong)">' + ui.icon('phi') + '<span style="color:var(--text-quiet)">On the frame<br>--text-strong</span></div>' +
      '<div data-ground="dock" style="background:var(--dock-bg);color:var(--text-strong)">' + ui.icon('phi') + '<span style="color:var(--text-quiet)">On the dock<br>dock ink</span></div>' +
      '<div style="background:var(--bg-2);color:var(--text-faint)">' + ui.icon('phi') + '<span style="color:var(--text-quiet)">Empty state<br>--text-faint</span></div>');
  }
  function renderOrbs() {
    const bots = D.bots || [];
    put('orbs', bots.map((b) => { const s = ui.botState(b); return '<div>' + h.orb(b, { size: 40, flag: true }) + '<b>' + esc(b.name) + '</b><span class="sp-cap">' + esc(b.role) + '</span>' + (h.stateWord(b, { showIdle: true })) + '<span class="sp-cap">' + esc(b.shape) + ', ' + esc(b.eyes || 'pill') + ', ' + s.reaction + '</span></div>'; }).join(''));
    put('states', '<table class="sp-table"><thead><tr><th>State</th><th>orb2 reaction</th><th>Word</th><th>Tone</th></tr></thead><tbody>' +
      Object.entries(ui.states).map(([k, s]) => '<tr><td><code>' + k + '</code></td><td><code>' + s.reaction + '</code></td><td>' + (k === 'idle' ? '<span class="sp-cap">nothing in lists; idle where a word is required</span>' : '<span class="ui-state"' + (s.tone ? ' data-tone="' + s.tone + '"' : '') + '>' + s.word + '</span>') + '</td><td class="sp-cap">' + (s.tone || 'none') + '</td></tr>').join('') + '</tbody></table>');
    const atlas = bot('atlas'), nina = bot('nina');
    const sizes = put('orb-sizes', [16, 20, 24, 26, 40, 56].map((n) => '<div class="sp-cell" style="align-items:center"' + (n === 56 ? ' data-lead' : '') + '>' + h.orb(atlas, { size: n }) + '<span class="sp-cap">' + (n === 56 ? '56, the glance lead' : n) + '</span></div>').join('') +
      '<div class="sp-cell" style="align-items:center">' + h.orb(nina, { size: 40, flag: true }) + '<span class="sp-cap">40, flag</span></div><div class="sp-cell" style="align-items:center">' + h.orb(bot('noct'), { size: 40 }) + '<span class="sp-cap">dark body, light eyes</span></div>');
    /* the one orb you look at keeps a step every 1.8s under reduced motion (HX.ui.glance.lead) */
    if (sizes && ui.glance && ui.glance.lead) ui.glance.lead(sizes.querySelector('[data-lead] orb-avatar'));
  }

  /* ───────── components ───────── */
  function renderButtons() {
    put('buttons',
      '<div class="sp-row">' + h.button({ label: 'Open PR', variant: 'primary' }) + h.button({ label: 'View diff' }) + h.button({ label: 'Not now', variant: 'ghost' }) + h.button({ label: 'Raise cap to $1.00', variant: 'primary', size: 's' }) + h.button({ label: 'Stop here', size: 's' }) + '</div>' +
      '<div class="sp-row">' + h.button({ label: 'Open PR', variant: 'primary', disabled: true }) + h.button({ label: 'View diff', disabled: true }) + h.button({ label: 'Click again to archive', attrs: { 'data-armed': '' } }) + h.button({ label: 'New session', icon: 'plus', variant: 'ghost', keys: 'mod+shift+O', showKeys: true, tip: 'New session' }) + '</div>' +
      '<div class="sp-row"><span class="sp-label">Icon buttons</span>' + h.iconButton({ icon: 'sidebar-left', label: 'Hide sidebar', keys: 'mod+B', expanded: true }) + h.iconButton({ icon: 'back', label: 'Back', keys: 'mod+[' }) + h.iconButton({ icon: 'forward', label: 'Forward', disabled: true }) + h.iconButton({ icon: 'gear', label: 'Settings', keys: 'mod+comma' }) +
      h.iconButton({ icon: 'mic', label: 'Stop dictation', pressed: true, tip: 'Listening, click to stop' }) + h.iconButton({ icon: 'sidebar-right', label: 'Show session details', keys: 'mod+period', expanded: false }) +
      '<span style="width:12px"></span>' + h.iconButton({ icon: 'minimize', label: 'Minimise', window: true }) + h.iconButton({ icon: 'maximize', label: 'Full screen', window: true }) + h.iconButton({ icon: 'close', label: 'Close', window: true }) + '</div>' +
      '<div class="sp-row"><span class="sp-label">Send</span>' + h.send({}) + h.send({ disabled: true }) + h.send({ running: true }) + '<span class="sp-cap">ready, empty, running (Stop, esc)</span></div>');
  }
  function renderHold() {
    const el = put('hold', '<div class="sp-row" style="justify-content:flex-start">' + h.button({ label: 'Deny' }) + h.hold({}) + '<span class="sp-cap js-hold-log">Hold with the pointer, hold Space, or press Enter twice.</span></div>');
    el.addEventListener('ui:commit', (e) => { $('.js-hold-log').textContent = 'ui:commit fired. Resets in two seconds.'; const b = e.target; setTimeout(() => { b._hold.reset(); $('.js-hold-log').textContent = 'Hold with the pointer, hold Space, or press Enter twice.'; }, 2000); });
  }
  function renderChoices() {
    put('choices',
      '<div class="sp-grid">' +
      '<div class="sp-cell"><span class="sp-label">Switch</span><div class="sp-row">' + '<label class="sp-row" style="gap:10px;font-size:var(--fs-s)">' + h.switch({ id: 'sw-dock', checked: true }) + 'Show the dock</label>' + '<label class="sp-row" style="gap:10px;font-size:var(--fs-s)">' + h.switch({ id: 'sw-slack' }) + 'Also on Slack</label>' + '<label class="sp-row" style="gap:10px;font-size:var(--fs-s);color:var(--text-quiet)">' + h.switch({ id: 'sw-dis', disabled: true }) + 'Unavailable</label></div></div>' +
      '<div class="sp-cell"><span class="sp-label">Segmented, as tabs (the view)</span>' + h.segmented({ label: 'View', value: 'session', fill: true, options: [{ value: 'session', label: 'Session' }, { value: 'bots', label: 'Bots', dot: true }] }) + '</div>' +
      '<div class="sp-cell"><span class="sp-label">Segmented, as a value</span>' + h.segmented({ mode: 'radio', label: 'Model', value: 'governed', options: [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }] }) + h.segmented({ mode: 'radio', size: 's', label: 'Corners', value: 'default', options: [{ value: 'sharp', label: 'Sharp' }, { value: 'default', label: 'Default' }, { value: 'round', label: 'Round' }] }) + '</div>' +
      '<div class="sp-cell"><span class="sp-label">Vertical (the rail)</span>' + h.segmented({ label: 'View', value: 'session', vertical: true, options: [{ value: 'session', icon: 'session', ariaLabel: 'Session', tip: 'Session', keys: 'alt+1' }, { value: 'bots', icon: 'bots', ariaLabel: 'Bots', tip: 'Bots', keys: 'alt+2', dot: true }] }) + '</div>' +
      '<div class="sp-cell"><span class="sp-label">Toolbar chips</span><div class="sp-row" style="gap:4px">' + h.chip({ label: 'Governed', icon: 'ladder', pressed: true, tip: 'Climbs the model ladder, stops at $0.60' }) + h.chip({ label: 'Smart', icon: 'spark', pressed: false, tip: 'You pick the model' }) + h.chip({ label: 'sonnet 5.5', mono: true, haspopup: 'menu' }) + h.chip({ label: 'Also on Slack' }) + '</div></div>' +
      '<div class="sp-cell"><span class="sp-label">Option chips</span>' + h.chipGroup({ label: 'Schedule', value: 'asked', options: [{ value: 'asked', label: 'Only when asked' }, { value: 'hourly', label: 'Hourly' }, { value: 'night', label: 'Every night' }, { value: 'weekday', label: 'Weekday mornings' }] }) + '</div>' +
      '</div>');
  }
  function renderMarks() {
    put('marks',
      '<div class="sp-grid">' +
      '<div class="sp-cell"><span class="sp-label">Code and keys</span><p style="margin:0;font-size:var(--fs-m)">' + h.inline('`money.ts` adds a branded `Cents` type.') + '</p><div class="sp-row">' + h.keys('mod+K') + h.keys('mod+shift+O') + h.keys('esc') + h.keys('alt+1') + '</div></div>' +
      '<div class="sp-cell"><span class="sp-label">Stamps</span><div class="sp-row">' + h.stamp('waiting for you') + h.stamp('needs you') + h.stamp('failed') + '</div><span class="sp-cap">Three wordings only. Red outline, red text, never filled.</span></div>' +
      '<div class="sp-cell"><span class="sp-label">Dots</span><div class="sp-row">' + [['run', 'running'], ['attention', 'needs you'], ['here', 'current, idle'], ['', 'idle: nothing']].map(([k, n]) => '<span class="sp-row" style="gap:6px">' + (k ? h.dot(k) : '<span class="ui-dot" style="box-shadow:inset 0 0 0 1px var(--hair)"></span>') + '<span class="sp-cap">' + n + '</span></span>').join('') + '</div></div>' +
      '<div class="sp-cell"><span class="sp-label">State words</span><div class="sp-row">' + ['working', 'thinking', 'speaking', 'needs', 'happy', 'sleeping', 'error'].map((s) => h.stateWord({ state: s })).join('') + '</div></div>' +
      '</div>');
  }
  function renderLists() {
    const S = D.sessions || [];
    const groups = {}; S.forEach((s) => { (groups[s.project] = groups[s.project] || []).push(s); });
    const acts = h.iconButton({ icon: 'pen', label: 'Rename', size: 's' }) + h.iconButton({ icon: 'archive', label: 'Archive', size: 's' });
    const sessionList = Object.entries(groups).map(([p, rows], gi) => h.group({ label: p, collapsible: true, rows: rows.map((s, i) => h.row({ title: s.title, end: s.when, value: s.id, current: s.id === 's1', lead: s.id === 's1' ? h.dot('attention') : '', acts })).join('') + (gi === 2 ? h.row({ title: 'cocoapods cache on CI', end: 'oct', archived: true }) : '') })).join('');
    const botRows = (D.bots || []).slice(0, 7).map((b) => { const s = ui.botState(b); return h.row({ title: b.name, sub: b.role, value: b.id, current: b.id === 'nina', lead: h.orb(b, { size: 20 }), end: s.key === 'idle' ? '' : esc(s.word), endTone: s.attention ? 'attention' : null }); }).join('');
    put('lists',
      '<div class="sp-stage sp-stage--frame" style="padding:12px 0"><div class="sp-cap" style="padding:0 20px 8px">Session list, grouped by project</div>' + sessionList + '</div>' +
      '<div class="sp-stage sp-stage--frame" style="padding:12px 0"><div class="sp-cap" style="padding:0 20px 8px">Bots list, two lines with the orb</div><ul class="ui-rows" data-ui="rows">' + botRows + '</ul></div>');
  }
  const MODEL_MENU = [{ title: 'Model' }, { label: 'qwen3-coder', value: 'qwen3-coder', desc: 'First try, cheapest', mono: true, checked: false }, { label: 'haiku 4.5', value: 'haiku 4.5', desc: 'After one failure', mono: true, checked: false }, { label: 'sonnet 5.5', value: 'sonnet 5.5', desc: 'After two failures', mono: true, checked: true }, { label: 'opus 5.5', value: 'opus 5.5', desc: 'Only when you ask', mono: true, checked: false }, '-', { foot: 'Governed climbs this ladder on failures, under the cap.' }];
  const ACCOUNT_MENU = [{ label: 'Settings', icon: 'gear', keys: 'mod+comma' }, { label: 'Keyboard shortcuts', icon: 'more', keys: 'mod+slash' }, '-', { label: 'Show the dock', role: 'menuitemcheckbox', checked: true, keys: 'mod+J' }, { label: 'Session details', role: 'menuitemcheckbox', checked: false, keys: 'mod+period' }];
  function renderFloat() {
    const el = put('float',
      '<div class="sp-grid">' +
      '<div class="sp-cell"><span class="sp-label">Menu, radio items</span><div class="js-menu-a"></div></div>' +
      '<div class="sp-cell"><span class="sp-label">Menu, actions and checks</span><div class="js-menu-b"></div></div>' +
      '<div class="sp-cell"><span class="sp-label">Tooltip, toast</span>' + h.tip('Hide sidebar', 'mod+B') + h.tip('nina, deploys', null, { text: 'needs you', tone: 'attention' }) + h.toast('Archived audit log export', 'Undo') + h.toast('Copied') + '</div>' +
      '</div><div class="sp-row" style="margin-top:20px">' + h.button({ label: 'Open the model menu', icon: 'chevron-down', class: 'js-open-menu', attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }) + h.button({ label: 'Show a toast', class: 'js-toast' }) +
      h.iconButton({ icon: 'search', label: 'Search', keys: 'mod+K' }) + h.iconButton({ icon: 'copy', label: 'Copy output' }) + '<span class="sp-cap">Hover or tab to the icon buttons for live tooltips.</span></div>');
    el.querySelector('.js-menu-a').appendChild(ui.menu.still(MODEL_MENU, { label: 'Model' }));
    el.querySelector('.js-menu-b').appendChild(ui.menu.still(ACCOUNT_MENU, { label: 'Account' }));
    el.querySelector('.js-open-menu').addEventListener('click', (e) => ui.menu.open(e.currentTarget, MODEL_MENU, { label: 'Model', onSelect: (v) => ui.toast('Pinned to ' + v) }));
    el.querySelector('.js-toast').addEventListener('click', () => ui.toast('Archived audit log export', { action: { label: 'Undo', onClick: () => ui.toast('Restored') } }));
  }
  function renderFields() {
    put('fields',
      '<div class="sp-stage sp-stage--frame"><div style="display:grid;gap:16px">' +
      h.field({ id: 'f-role', label: 'Role, shown under its name', value: 'deploys' }) +
      h.field({ id: 'f-ins', label: 'Instructions', kind: 'textarea', placeholder: 'How it should work, what to avoid, who to tell' }) +
      h.field({ id: 'f-cron', label: 'Schedule', value: '0 9 * * 1-8', mono: true, error: 'Days of the week run from 0 to 6. Try 0 9 * * 1-5.' }) +
      h.field({ id: 'f-font', label: 'Interface font', kind: 'select', value: 'Libre Franklin', options: ['Libre Franklin', 'Geist', 'IBM Plex Sans', 'System'] }) +
      h.field({ id: 'f-dis', label: 'Workspace', value: '~/code/billing-api', mono: true, disabled: true, hint: 'Set when the session starts.' }) +
      '</div></div>' +
      '<div class="sp-stage sp-stage--frame"><div class="ui-set"><div class="ui-set__head">Dock</div>' +
      h.setRow({ label: 'Show the dock', hint: 'Bots and widgets at the bottom edge. Everything in it is also elsewhere.', for: 'set-dock', control: h.switch({ id: 'set-dock', checked: true }) }) +
      h.setRow({ label: 'Minimal when idle', for: 'set-min', control: h.switch({ id: 'set-min' }) }) +
      '<div class="ui-set__head">Shape</div>' +
      h.setRow({ label: 'Density', control: h.segmented({ mode: 'radio', size: 's', label: 'Density', value: 'regular', options: [{ value: 'compact', label: 'Compact' }, { value: 'regular', label: 'Regular' }, { value: 'comfortable', label: 'Comfortable' }] }) }) +
      h.setRow({ label: 'Cap per run', hint: 'Governed sessions stop here and ask.', for: 'set-cap', control: '<span style="width:84px">' + h.field({ id: 'set-cap', value: '$0.60', mono: true }) + '</span>' }) +
      '</div></div>');
  }
  function renderMeasures() {
    const G = D.governance || {}, C = D.context || { used: 76000, total: 200000, parts: [] };
    const k = (n) => Math.round(n / 1000) + 'k';
    put('measures',
      '<div class="sp-stage sp-stage--frame"><div style="display:grid;gap:18px">' +
      '<div class="sp-row">' + h.ladder({ stations: G.ladder, current: G.current, ground: 'var(--bg-1)' }) + '<span class="sp-cap">line: inline in an escalation, a mini row, the dock</span></div>' +
      h.ladder({ stations: G.ladder, current: G.current, variant: 'list' }) +
      '<div class="sp-row">' + h.capacity(G.spent, G.cap) + h.capacity(k(C.used), k(C.total), { label: 'Context 76k of 200k tokens' }) + '<span class="sp-cap">capacity: total against the limit</span></div>' +
      '<div class="sp-row"><span class="sp-label">Pages</span>' + h.pages({ interactive: true, current: 'bots', pages: [{ id: 'bots', label: 'Bots' }, { id: 'run', label: 'Run' }, { id: 'wait', label: 'Needs you', attention: true }, { id: 'sched', label: 'Scheduled' }] }) + '</div>' +
      '</div></div>' +
      '<div class="sp-stage sp-stage--frame"><div style="display:grid;gap:18px">' +
      '<div class="sp-row" style="align-items:flex-end">' + h.measure({ used: C.used, total: C.total, dots: 8, variant: 'strip' }) + '<span class="sp-cap">strip: the closed right panel, 8 dots</span></div>' +
      h.measure({ total: C.total, parts: C.parts, variant: 'grid', dots: 40 }) + h.legend(C.parts, k) +
      '<div class="sp-row">' + h.measure({ used: 3, total: 5, dots: 5, variant: 'row' }) + '<span class="sp-cap">row: a small count, 3 of 5</span></div>' +
      '</div></div>');
  }
  function renderConversation() {
    const conv = D.conversation || [];
    const u = conv[0] || { text: '' }, a = conv[1] || {};
    const stepsId = 'sp-steps';
    const steps = h.steps([{ title: 'Read 6 files in src/billing', time: '0:12' }, { title: 'npm test -- billing', mono: true, kind: 'fail', meta: ['qwen3-coder', '1 failed'], time: '1:05' }, { title: 'Moved up to sonnet 5.5', kind: 'escalate', meta: ['after 2 failed gate runs'], time: '1:40' }, { title: 'Edited 4 files', time: '2:58' }, { title: 'npm test', mono: true, meta: ['142 passed'], time: '3:42' }], { id: stepsId, hidden: true });
    const prose = '<div class="ui-prose">' + (a.paragraphs || []).map((p) => '<p>' + h.inline(p) + '</p>').join('') + '<ul>' + (a.bullets || []).map((b) => '<li>' + h.inline(b) + '</li>').join('') + '</ul><p class="js-q">One open question, should I keep the old export name ' + h.code('prorate') + ' as a deprecated alias?</p></div>';
    const el = put('conversation',
      '<div class="js-conv" style="max-width:var(--col-w)">' +
      h.entry({ kind: 'user', who: 'You', callno: ['14:01'], body: h.request(u.text) }) +
      h.entry({ kind: 'agent', callno: ['qwen3-coder', '→ sonnet 5.5', a.time || '3m 42s', a.cost || '$0.37'], steps: { count: a.steps || 6, id: stepsId }, body: steps + prose }) +
      h.entry({ kind: 'bot', who: h.orb(bot('nina'), { size: 20 }) + '<span>nina</span>', callno: ['14:08'], body: '<div class="ui-prose"><p>Tests are green on billing/cents. I can deploy it to staging and compare against 200 real invoices.</p></div>' }) +
      '</div>');
    const q = el.querySelector('.js-q');
    if (HX.cards) { const blank = HX.cards.create('blank', { question: a.blank ? a.blank.question : 'keep prorate?', short: 'keep `prorate` as an alias?', options: a.blank ? a.blank.options : [] }, { size: 'inline' }); q.appendChild(blank); }
    else q.insertAdjacentHTML('beforeend', h.blank({}));
    const conv2 = el.querySelector('.js-conv');
    new ResizeObserver(() => { const v = conv2.clientWidth < 560 ? 'off' : 'on'; if (conv2.getAttribute('data-margin') !== v) conv2.setAttribute('data-margin', v); }).observe(conv2);
  }
  const DECIDE = {
    path: [{ title: 'Scope' }, { label: 'src/billing', value: 'src/billing', mono: true, checked: true, desc: 'The folder you named' }, { label: 'src/billing and its tests', value: 'src/billing and its tests', checked: false }, { label: 'The whole repository', value: 'all', checked: false }],
    gate: [{ title: 'Gate' }, { label: 'npm test', value: 'npm test', mono: true, checked: true, desc: 'The project gate' }, { label: 'npm test -- billing', value: 'npm test -- billing', mono: true, checked: false, desc: 'Only the billing suite' }],
    cost: [{ title: 'Cost' }, { label: 'Start on qwen3-coder', value: 'qwen', checked: true, desc: 'Climb only after failures' }, { label: 'Start on haiku 4.5', value: 'haiku', checked: false }]
  };
  function renderComposer() {
    const el = slot('composer');
    el.innerHTML = '';
    const wrap = document.createElement('div'); wrap.style.maxWidth = 'var(--composer-w)'; el.appendChild(wrap);
    const c = ui.composer({
      value: D.composerDraft || '', placeholder: 'Describe the change', spend: { spent: '$0.37', cap: '$0.60' },
      chips: [{ label: 'Governed', icon: 'ladder', pressed: true, tip: 'Climbs the model ladder, stops at $0.60' }, { label: 'Smart', icon: 'spark', pressed: true, tip: 'Picks the model for each message' }],
      feedforward: (t) => [{ text: 'refactor', kind: 'path' }, { text: 'src/billing', kind: 'path', confirmed: true }, { text: 'run the tests', kind: 'gate' }, { text: 'open a PR', kind: 'gate' }, { text: 'cheap', kind: 'cost' }].filter((m) => t.includes(m.text)),
      hint: (t) => 'Will assume: refactor, src/billing, npm test, draft a PR, governed starts on qwen3-coder'
    });
    wrap.appendChild(c);
    c.addEventListener('ui:decision', (e) => ui.menu.open(e.detail.el, DECIDE[e.detail.kind] || DECIDE.path, { label: 'How to read ' + e.detail.text, place: 'above', onSelect: () => { e.detail.el.setAttribute('data-confirmed', ''); } }));
    c.addEventListener('ui:send', (e) => { e.preventDefault(); c.setRunning(true); ui.toast('Sent to qwen3-coder'); setTimeout(() => c.setRunning(false), 2400); });
    c.addEventListener('ui:stop', () => { c.setRunning(false); ui.toast('Stopped'); });
    /* the dock's composer: compact, its actions on the text's line; the mic talks to the bot, whose orb listens */
    const noct = bot('noct') || (D.bots || [])[0];
    const dock = document.createElement('div');
    dock.className = 'sp-dockcomp'; dock.setAttribute('data-ground', 'dock');
    dock.innerHTML = '<div class="sp-dockcomp__head">' + h.orb(noct, { size: 40, render: 80 }) + '<span><b>' + esc(noct.name) + '</b><span class="sp-cap">' + esc(noct.role) + '</span></span></div>';
    const cc = ui.composer({ placeholder: 'Message ' + noct.name, label: 'Message ' + noct.name, attach: false, bot: noct });
    cc.addEventListener('ui:send', (e) => { e.preventDefault(); cc.setValue(''); ui.toast('Sent to ' + noct.name); });
    dock.appendChild(cc);
    dock.insertAdjacentHTML('beforeend', '<p class="sp-cap">Click the mic, or alt+V in the field: ' + esc(noct.name) + ' listens (its orb, here and in the mic). Hold either for push to talk. Esc stops listening.</p>');
    el.appendChild(dock);
    if (c.attach) c.attach.addEventListener('click', () => ui.menu.open(c.attach, [{ label: 'Files', icon: 'file' }, { label: 'A folder', icon: 'folder' }, { label: 'A teammate', icon: 'at', desc: 'Hand the session to a bot' }], { label: 'Attach', place: 'above' }));
  }
  function renderPanel() {
    const C = D.context || { used: 76000, total: 200000, parts: [] }, G = D.governance || {};
    const k = (n) => Math.round(n / 1000) + 'k';
    const tasks = (D.todos || []).map(([t, s]) => '<li style="display:flex;align-items:flex-start;gap:8px;padding:4px 0;color:' + (s === 'done' ? 'var(--text-quiet)' : 'var(--text)') + '"><span style="width:16px;height:18px;display:grid;place-items:center;flex:none">' + (s === 'done' ? '<span style="color:var(--brass)">' + ui.icon('check', { size: 's' }) + '</span>' : s === 'doing' ? h.dot('run') : '<i style="width:8px;height:8px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--line-strong)"></i>') + '</span><span>' + esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</span></li>').join('');
    const changes = (D.changes || []).map(([p, a, d]) => { const cut = p.lastIndexOf('/') + 1; return '<div style="display:flex;align-items:center;gap:8px;min-height:var(--row-h)"><span class="ui-mono" style="font-size:var(--fs-xs);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span style="color:var(--text-quiet)">' + esc(p.slice(0, cut)) + '</span>' + esc(p.slice(cut)) + '</span><span class="ui-mono" style="margin-left:auto;font-size:var(--fs-2xs);display:flex;gap:8px"><span style="color:var(--add)">+' + a + '</span><span style="color:var(--del)">−' + d + '</span></span></div>'; }).join('');
    const conns = (D.connectors || []).map((c) => h.setRow({ label: c.name, hint: c.tools + ' tools', for: c.state === 'sign in' ? null : 'cn-' + c.name, control: c.state === 'sign in' ? h.button({ label: 'Sign in', size: 's' }) : h.switch({ id: 'cn-' + c.name, checked: c.state === 'on' }) })).join('');
    put('panel',
      '<div class="sp-stage sp-stage--frame" style="padding:0;display:grid;grid-template-columns:28px minmax(0,1fr);min-height:420px;overflow:hidden"><div style="display:grid;place-items:center;background:var(--bg-1)"><button type="button" class="ui-measure-btn" data-tip="Context 38% used" data-kbd="mod+period" data-tip-pos="right" aria-label="Context 38% used. Show session details">' + h.measure({ used: C.used, total: C.total, dots: 8 }) + '</button></div><div style="background:var(--bg-2);border-radius:0 var(--r-l) 0 0;display:grid;place-items:center"><span class="sp-cap">closed: the strip and its one measure</span></div></div>' +
      '<div class="sp-stage sp-stage--frame" style="padding:0;height:620px;overflow:hidden"><div class="ui-panel"><div class="ui-panel__head"><h4 class="ui-panel__title">Session details</h4></div><div class="ui-panel__body">' +
      h.section({ label: 'Context', meta: k(C.used) + ' / ' + k(C.total), open: true, body: h.measure({ total: C.total, parts: C.parts, variant: 'grid', dots: 40 }) + '<div style="margin-top:12px">' + h.legend(C.parts, k) + '</div><div style="margin-top:12px">' + h.button({ label: 'Compact conversation', size: 's' }) + '</div><p class="ui-field__hint" style="margin-top:8px">Compacting summarises older turns. Files and project memory stay. It runs on its own at 90%.</p>' }) +
      h.section({ label: 'Tasks', meta: '2 of 5', open: true, body: '<ul style="list-style:none;margin:0;padding:0;font-size:var(--fs-s)">' + tasks + '</ul>' }) +
      h.section({ label: 'Changes', meta: '<span style="color:var(--add)">+96</span><span style="color:var(--del)">−71</span>', open: true, body: changes }) +
      h.section({ label: 'Governance', meta: G.spent + ' of ' + G.cap, open: true, body: h.segmented({ mode: 'radio', fill: true, label: 'Model', value: 'governed', options: [{ value: 'governed', label: 'Governed' }, { value: 'ungoverned', label: 'Ungoverned' }] }) + '<div style="margin-top:14px">' + h.ladder({ stations: G.ladder, current: G.current, variant: 'list' }) + '</div>' }) +
      h.section({ label: 'Connectors', meta: '3 on', open: false, body: '<div class="ui-set">' + conns + '</div>' }) +
      '</div></div></div>');
  }

  /* ───────── cards: the card layer, every kind and state ───────── */
  function renderCards() {
    const el = slot('cards');
    if (!HX.cards) { el.innerHTML = '<p class="sp-cap">The card layer did not load.</p>'; return; }
    const C = HX.cards, convo = (D.conversation || [])[1] || {}, Gv = D.governance || {};
    const G = {
      approval: { from: 'nina', title: 'deploy to staging', quote: 'billing/cents → staging, dry run first', item: ['staging · invoices-api', 'read-only on invoices · 1 migration'], meta: 'expires in 9 min · ~$0.02' },
      agentApproval: { model: 'sonnet 5.5', title: 'push and open a draft PR', quote: 'the diff you asked to see first', item: ['github · billing-api', 'cents/proration · 4 files'], meta: 'expires in 30 min' },
      ship: Object.assign({}, convo.ship, { files: D.changes, failures: ['invoice.test.ts › rounds per line item'], rollbackNote: 'Rounding each line item in invoice.ts failed invoice.test.ts, so that edit was undone and the invoice total is rounded once instead.' }),
      blank: { question: 'should I keep the old export name `prorate` as a deprecated alias?', short: 'keep `prorate` as an alias?', options: convo.blank ? convo.blank.options : [] },
      teammate: { from: 'atlas', title: 'hands you a review', quote: 'invoice.ts:88 still divides before rounding. I fixed it in 9f3c1a2. Can you check it before nina deploys?', item: ['cents/proration · 9f3c1a2', '1 commit · 142 tests pass'], meta: '2 min ago' },
      escalation: { from: 'qwen3-coder', to: 'sonnet 5.5', reason: 'after 2 failed gate runs on cheaper models', ladder: Gv.ladder, current: Gv.current, spent: Gv.spent, cap: Gv.cap, raiseTo: '$1.00', next: 'opus 5.5' },
      error: { gate: 'npm test', retryWith: 'sonnet 5.5', test: 'invoice.test.ts › rounds per line item', output: (D.output || []).slice(0, 4).map((l) => l.trim()), note: 'The edit to invoice.ts was rolled back. Nothing else changed.' },
      schedule: { from: 'sol', title: 'run the morning digest', quote: 'overnight CI and your inbox, summed up before you start', time: '02:00', when: 'every weekday', days: [1, 1, 1, 1, 1, 0, 0], cron: '0 2 * * 1-5', next: 'tonight at 02:00', meta: 'about $0.08 a run' },
      connector: { name: 'linear', host: 'linear.app', tools: 9, scopes: ['issues', 'projects', 'comments'] }
    };
    const KINDS = [
      ['approval', 'Approval', 'A bot or the agent asks before something sensitive. Hold to approve.', ['pending', 'approved', 'denied', 'expired']],
      ['ship', 'Ship result', 'The gate ran; what changed and what to do next.', ['passed', 'failed', 'rolled-back']],
      ['teammate', 'Teammate', 'A named bot hands you something.', ['pending', 'accepted']],
      ['escalation', 'Escalation', 'The ladder moved; capped when the next step costs more than allowed.', ['escalated', 'capped']],
      ['error', 'Gate failure', 'A gate failed and what was rolled back.', ['failed', 'retrying', 'passed']],
      ['schedule', 'Schedule', 'A bot asks to run on a timer.', ['pending', 'scheduled']],
      ['connector', 'Connector', 'A tool needs a sign-in; it owes nothing until it fails.', ['needed', 'waiting', 'connected', 'failed']]
    ];
    el.innerHTML = KINDS.map(([k, n, d]) => '<div class="sp-sub" style="margin-top:28px"><h3 style="font-size:var(--fs-s)">' + n + '</h3><p>' + d + '</p><div class="sp-stage sp-x"><div class="sp-grid sp-grid--2 js-k-' + k + '"></div></div></div>').join('') +
      '<div class="sp-sub" style="margin-top:28px"><h3 style="font-size:var(--fs-s)">Blank, expanded</h3><p>The popover a blank opens from its sentence: options with number keys, your own answer, Later or Answer.</p><div class="sp-stage sp-stage--frame js-k-blank"></div></div>' +
      '<div class="sp-sub" style="margin-top:28px"><h3 style="font-size:var(--fs-s)">Compact and mini</h3><p>The same cards at 360px for the dock and the side panel, and as one row. In the dock they sit on the dock ground.</p><div class="sp-grid sp-grid--2"><div class="sp-stage sp-stage--frame"><div class="sp-cell js-k-compact"></div></div><div class="sp-stage" data-ground="dock" style="background:var(--dock-bg)"><div class="sp-cell js-k-dock"></div></div></div></div>';
    for (const [k, , , states] of KINDS) {
      const box = el.querySelector('.js-k-' + k);
      for (const s of states) {
        const cell = document.createElement('div'); cell.className = 'sp-cell';
        cell.innerHTML = '<span class="sp-cap"><b>' + k + '</b> ' + s + '</span>';
        const size = k === 'escalation' && s === 'escalated' ? 'inline' : 'inline';
        const data = k === 'approval' && s === 'expired' ? G.agentApproval : G[k];
        let card;
        try { card = C.create(k, data, { size, state: s }); } catch (e) { card = document.createElement('p'); card.textContent = String(e.message); }
        cell.appendChild(card); box.appendChild(cell);
      }
      if (k === 'escalation') { const cell = document.createElement('div'); cell.className = 'sp-cell'; cell.innerHTML = '<span class="sp-cap"><b>escalation</b> compact</span>'; cell.appendChild(C.create('escalation', G.escalation, { size: 'compact' })); box.appendChild(cell); }
    }
    const bl = el.querySelector('.js-k-blank'); bl.appendChild(C.create('blank', G.blank, { size: 'popover' }));
    const cp = el.querySelector('.js-k-compact');
    cp.appendChild(C.create('approval', G.agentApproval, { size: 'compact', ground: 'chrome' }));
    for (const [k, s] of [['approval', 'pending'], ['ship', 'failed'], ['error', 'retrying'], ['connector', 'needed']]) cp.appendChild(C.create(k, G[k], { size: 'mini', state: s, ground: 'chrome' }));
    const dk = el.querySelector('.js-k-dock');
    dk.appendChild(C.create('approval', G.approval, { size: 'compact', ground: 'dock' }));
    dk.appendChild(C.create('teammate', G.teammate, { size: 'mini', ground: 'dock' }));
    dk.appendChild(C.create('schedule', G.schedule, { size: 'mini', ground: 'dock' }));
  }

  /* ───────── shell miniatures ───────── */
  function sideList() {
    const S = (D.sessions || []).slice(0, 4);
    return h.group({ label: 'billing-api', rows: S.filter((s) => s.project === 'billing-api').map((s) => h.row({ title: s.title, end: s.when, current: s.id === 's1', lead: s.id === 's1' ? h.dot('attention') : '' })).join('') }) +
      h.group({ label: 'marketing-site', rows: h.row({ title: 'pricing page copy', end: 'yesterday' }) });
  }
  function bar(o) {
    return '<div class="sp-shell__bar"><div>' + h.iconButton({ icon: 'sidebar-left', label: o.left === 'open' ? 'Hide sidebar' : 'Show sidebar', keys: 'mod+B', expanded: o.left === 'open' }) + '<span class="sp-hide-n" style="display:flex;gap:2px">' + h.iconButton({ icon: 'back', label: 'Back', keys: 'mod+[' }) + h.iconButton({ icon: 'forward', label: 'Forward', disabled: true }) + '</span></div>' +
      '<button type="button" class="sp-cmd" aria-label="Search or run a command, ctrl K" aria-keyshortcuts="Control+K">' + ui.icon('search') + '<span><span class="sp-hide-n">billing-api /</span><b>proration drift in src/billing</b></span>' + h.keys('mod+K') + '</button>' +
      '<div>' + h.iconButton({ icon: 'sidebar-right', label: o.right === 'open' ? 'Hide session details' : 'Show session details', keys: 'mod+period', expanded: o.right === 'open' }) + '<span class="sp-hide-n" style="display:flex;margin-left:8px">' + h.iconButton({ icon: 'minimize', label: 'Minimise', window: true }) + h.iconButton({ icon: 'maximize', label: 'Full screen', window: true }) + h.iconButton({ icon: 'close', label: 'Close', window: true }) + '</span></div></div>';
  }
  const tabs = (v) => h.segmented({ label: 'View', value: v || 'session', fill: true, options: [{ value: 'session', label: 'Session' }, { value: 'bots', label: 'Bots', dot: true }] });
  function renderShell() {
    const ground = '<div class="sp-ground"><div style="padding:24px 24px 0;max-width:var(--col-w);margin:0 auto">' + h.entry({ kind: 'user', who: 'You', callno: ['14:01'], body: h.request('proration drifts by a cent on long invoices.') }) + '</div></div>';
    put('shell', '<div class="sp-grid" style="grid-template-columns:minmax(0,1fr)">' +
      '<div class="sp-cell"><span class="sp-cap"><b>sidebar open</b>, right panel closed (the 28px strip)</span><div class="sp-shell" data-left="open">' + bar({ left: 'open' }) + '<div class="sp-shell__body"><div class="sp-side"><div class="sp-side__brand">' + ui.icon('phi') + '<b>hypotaxis</b></div>' + tabs() + '<button type="button" class="sp-new">' + ui.icon('plus') + '<span>New session</span></button><div class="sp-side__list">' + sideList() + '</div></div>' + ground + '<div class="sp-strip"><button type="button" class="ui-measure-btn" data-tip="Context 38% used" data-kbd="mod+period" aria-label="Context 38% used">' + h.measure({ used: 76000, total: 200000, dots: 8 }) + '</button></div></div></div></div>' +
      '<div class="sp-grid sp-grid--2">' +
      '<div class="sp-cell"><span class="sp-cap"><b>rail</b>, 56px: every icon stays on the x = 28 axis</span><div class="sp-shell" data-left="rail" data-mini="rail" data-compact style="height:300px">' + bar({ left: 'rail' }) + '<div class="sp-shell__body" style="--sw:56px"><div class="sp-side sp-rail"><div class="sp-side__brand">' + ui.icon('phi') + '</div>' + h.segmented({ label: 'View', value: 'session', vertical: true, options: [{ value: 'session', icon: 'session', ariaLabel: 'Session', tip: 'Session', keys: 'alt+1', tipPos: 'right' }, { value: 'bots', icon: 'bots', ariaLabel: 'Bots', tip: 'Bots', keys: 'alt+2', dot: true }] }) + h.iconButton({ icon: 'plus', label: 'New session', keys: 'mod+shift+O', tipPos: 'right' }) + '</div>' + ground + '<div></div></div></div></div>' +
      '<div class="sp-cell"><span class="sp-cap"><b>closed</b>, right panel open</span><div class="sp-shell" data-left="closed" data-right="open" data-compact style="height:300px">' + bar({ left: 'closed', right: 'open' }) + '<div class="sp-shell__body" style="--sw:0px;--rw:minmax(150px,42%)"><div></div>' + ground + '<div class="ui-panel"><div class="ui-panel__head"><h4 class="ui-panel__title">Session details</h4></div><div class="ui-panel__body">' + h.section({ label: 'Context', meta: '76k / 200k', open: false }) + h.section({ label: 'Tasks', meta: '2 of 5', open: false }) + h.section({ label: 'Changes', meta: '+96 −71', open: false }) + '</div></div></div></div></div>' +
      '</div></div>');
  }

  /* ───────── dock ───────── */
  function renderDock() {
    const bots = D.bots || [];
    const orbBtn = (b, size) => '<button type="button" class="ui-orb-btn" data-bot="' + esc(b.id) + '" aria-describedby="sp-orb-keys" aria-label="' + esc(ui.botLabel(b)) + '" data-tip="' + esc(b.name + ', ' + b.role) + '" data-tip-state="' + esc(ui.botState(b).word) + '"' + (ui.botState(b).attention ? ' data-tip-tone="attention"' : '') + '>' + h.orb(b, { size: size || 40, flag: true, render: 80 }) + '</button>';
    const pagesHTML = (cur) => h.pages({ interactive: true, current: cur, label: 'Dock pages', pages: [{ id: 'bots', label: 'Bots' }, { id: 'run', label: 'Run' }, { id: 'wait', label: 'Needs you', attention: true }, { id: 'sched', label: 'Scheduled' }] });
    const G = D.governance || {};
    const roster = bots.slice(0, 8).map((b) => { const s = ui.botState(b); return h.row({ title: b.name, sub: s.word, lead: h.orb(b, { size: 26, flag: true }), tag: 'button' }); }).join('').replace(/<\/?li>/g, '');
    const el = put('dock',
      '<div class="sp-cell"><span class="sp-cap"><b>bots page, at rest</b>: orbs 40 at a 54px pitch, the add button, page dots in the last 10px</span><div class="sp-dock"><div class="ui-slab" data-ground="dock"><div class="sp-dock-row" role="toolbar" aria-label="Bots">' + bots.map((b) => orbBtn(b)).join('') + '<button type="button" class="sp-dock-add" aria-label="New bot" data-tip="New bot">' + ui.icon('plus') + '</button></div>' + pagesHTML('bots') + '</div></div>' +
      '<span class="sp-cap" id="sp-orb-keys"><b>Owner decision (v10).</b> Click an orb, or Enter: its session opens in the dock, and the same orb again closes it. Double-click, or mod+Enter: the full chat opens in the Bots tab. There is no short press.</span><span class="sp-cap js-orb-log" role="status"></span></div>' +
      '<div class="sp-cell"><span class="sp-cap"><b>minimal</b>: a pill with the bots as dots and the attention mark</span><div class="sp-dock" style="min-height:72px"><div class="ui-slab" data-ground="dock" style="min-height:0;padding:0"><button type="button" class="sp-dock-pill ui-btn" style="box-shadow:none;height:28px;color:var(--text-dim)" aria-label="Show the dock, nina needs you">' + bots.map((b) => h.orb(b, { size: 10, still: true })).join('') + h.dot('attention', { size: 's' }) + '</button></div></div></div>' +
      '<div class="sp-cell"><span class="sp-cap"><b>bots page, expanded</b>: the roster, the same rows as the sidebar on the dock ground</span><div class="sp-dock"><div class="ui-slab" data-ground="dock"><div class="sp-roster ui-rows" style="padding:0" data-ui="rows">' + roster + '</div>' + pagesHTML('bots') + '</div></div></div>' +
      '<div class="sp-cell"><span class="sp-cap"><b>needs you page</b>: the canonical approval card, compact, on the dock ground</span><div class="sp-dock"><div class="ui-slab" data-ground="dock"><div class="sp-dock-card js-dock-card"></div>' + pagesHTML('wait') + '</div></div></div>' +
      '<div class="sp-cell"><span class="sp-cap"><b>run page</b>: ladder, what runs, elapsed, spend against the cap, stop</span><div class="sp-dock"><div class="ui-slab" data-ground="dock"><div class="sp-run">' + h.ladder({ stations: G.ladder, current: G.current, ground: 'var(--dock-bg)' }) + '<span style="min-width:0"><b>proration drift in src/billing</b><small>qwen3-coder → sonnet 5.5</small></span><span class="sp-cap">3m 42s</span>' + h.capacity(G.spent, G.cap) + '</div>' + pagesHTML('run') + '</div></div></div>' +
      '<div class="sp-cell"><span class="sp-cap"><b>off</b>: nothing is drawn and nothing depends on it; Show the dock in the account menu or ctrl J brings it back</span></div>');
    if (HX.cards) el.querySelector('.js-dock-card').appendChild(HX.cards.create('approval', { from: 'nina', title: 'deploy to staging', quote: 'billing/cents → staging, dry run first', item: ['staging · invoices-api', 'read-only on invoices · 1 migration'], meta: 'expires in 9 min · ~$0.02' }, { size: 'compact', ground: 'dock' }));
    /* the owner's orb gestures (v10): one click or Enter opens the bot's session in the dock (a small poke is the
       click's feedback), the same orb again closes it; a double-click or mod+Enter opens the full chat in the Bots tab */
    const log = el.querySelector('.js-orb-log');
    const say = (t) => { log.textContent = t; };
    let open = null, clickT = 0;
    const MODK = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'metaKey' : 'ctrlKey';
    for (const btn of el.querySelectorAll('.sp-dock-row .ui-orb-btn')) {
      const b = bot(btn.dataset.bot), orb = btn.querySelector('orb-avatar');
      const session = () => {
        if (orb && orb.poke) orb.poke(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 0.6);
        if (open === b.id) { open = null; say(b.name + '\'s session closes: back to the row.'); } else { open = b.id; say('Opens ' + b.name + '\'s session in the dock: its last messages, its open card, a composer.'); }
      };
      const chat = () => { open = null; say('Opens ' + b.name + '\'s full chat in the Bots tab.'); };
      btn.addEventListener('click', (e) => {
        if (e.detail >= 2) { clearTimeout(clickT); chat(); return; }
        clearTimeout(clickT); clickT = setTimeout(session, 220);   /* the second click is the double-click's alone */
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e[MODK]) { e.preventDefault(); chat(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); session(); }
      });
    }
  }

  /* ───────── findings (summary; the full list is in DESIGN-SYSTEM.md) ───────── */
  const FINDINGS = [
    ['F1 drift', 'Three hold-to-approve buttons', 'cards: dot field, 1000ms, card stock at rest. dock: scaleX fill with a blend-mode label, 650ms. bots: a primary button with a 14% fill, 1100ms. Fix: HX.ui.hold everywhere, 1000ms (--dur-hold).'],
    ['F2 drift', 'Two dock palettes', 'dock.css re-derives 25 --dock-* inks; cards.css re-derives them again for hx-card[data-ground="dock"]. Fix: one [data-ground="dock"] scope in components.css; components read the usual roles.'],
    ['F3 contrast', 'Field outlines at 1.35:1', 'Text fields are bounded by --line (15%) on nearly the same fill. Fix: --line-field (42% of text, 54% in a light theme: 3:1 against the field and the frame) on text fields only.'],
    ['F4 contrast', 'Bone: diff counts and a red word on a selected row', '--add 3.97:1 and --del 4.38:1 on the frame, --red-text 4.38:1 on --current. Fix: Bone --add #356b43, --del #a63d35, --red-text #a82328.'],
    ['F5 contrast', 'Kbd in a tooltip at 4.25:1', '--text-quiet on --bg-4 fails in three presets. Fix: keys use --text-dim (5.25:1 and up).'],
    ['F6 bug', 'The customizer misreads translucent colours', 'theme.js reads computed colours with a number regex; Chrome returns color(srgb 0-1 …) for color-mix, so the selected-row pairs are measured against the wrong colour. Fix: parse color(srgb) as the specimen does.'],
    ['F7 drift', 'Five ladders', 'Session panel (8px with a brass halo), cards (5px line, 7px list), dock (3px ticks), bots settings (9px). Fix: HX.ui.ladder line and list; no halo.'],
    ['F8 drift', 'Two words for one state', 'happy reads done in the list and finished a task in the dock; compute reads working and running a job. Fix: one map, HX.ui.states.'],
    ['F9 rule', 'Red outside the stamp rule', 'The mic shows red while dictating; the bots archive button turns red when armed. Neither is owed. Fix: pressed icon buttons are brass; armed buttons strengthen their line.'],
    ['F10 scale', 'Ad-hoc sizes', 'Code chips at 12.5px in three modules; the brand at 15px; a 34px palette row; corner 14 duplicated as --r-xl. Fix: 12px code, a named --fs-brand, --row-h rows, drop --r-xl.'],
    ['F18 rule', 'Bars where the system says dots', 'The dock draws context as a segmented bar and spend as a meter. Fix: HX.ui.measure dots and the mono running total, HX.ui.capacity.'],
    ['F19 contrast', 'Brass used as text', 'The current rung\'s rule and the dock\'s tag are brass text: 4.0:1 in Bone. Fix: brass marks the station; the words are --text-dim.'],
    ['F29 owner', 'Nested corners picked by hand', 'Only the customizer swatch was concentric; a card at the top of the dock sat under a corner it did not follow, and the slab drew circular arcs. Fix: --r-outer, --pad and --r-in on every container; HX.ui.shape.slab for the path.'],
    ['F30 owner', 'The dock composer\'s floating send, and no way to talk', 'The send sat alone in the corner under a one-line field. Fix: the compact composer, its mic and send in the corner, concentric; a mic in every composer, the target bot\'s orb listening.'],
    ['F28 contrast', 'Inactive marks at 2.0–2.4:1', 'Page dots and ladder stations to come were --text-faint, decoration-grade. Fix: --mark-off (3.3–4.2:1 on every surface, 3.3–3.6:1 on the dock), still well under the active marks.'],
    ['F26 a11y', 'Options that hold buttons', 'Session rows are listbox options with rename and archive buttons inside. Fix: button rows with aria-current, actions as siblings.']
  ];
  function renderFindings() { put('findings', FINDINGS.map(([id, t, d]) => '<li><span>' + esc(id) + '</span><span><b>' + esc(t) + '</b><small>' + esc(d) + '</small></span></li>').join('')); }

  /* ───────── contents rail follows the reader ───────── */
  function followToc() {
    const links = $$('.sp-toc a'), map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { links.forEach((a) => a.removeAttribute('aria-current')); const a = map.get(e.target.id); if (a) a.setAttribute('aria-current', 'true'); } }, { rootMargin: '-80px 0px -70% 0px' });
    for (const id of map.keys()) { const t = document.getElementById(id); if (t) io.observe(t); }
  }

  /* ───────── render, and re-read live values on every theme change ───────── */
  /* ───────── corners: the curve, nested corners, where it applies, before and after ───────── */
  const CONT = !!(window.CSS && CSS.supports && CSS.supports('corner-shape', 'superellipse(2)'));
  const num = (v) => parseFloat(px(v)) || 0;
  function cornerPath(R, n, steps) {   /* one superellipse corner (exponent n) of radius R, corner at (0, 0) */
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * Math.PI / 2, x = R - R * Math.pow(Math.cos(t), 2 / n), y = R - R * Math.pow(Math.sin(t), 2 / n);
      d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    return d;
  }
  function renderCorners() {
    /* the curve: the old arc and the continuous corner that reads as deep, overlaid, then as two tiles */
    const S = 150, r = 56, R = Math.round(r * 1.6), n = Math.pow(2, 1.8);
    const edge = (rr, path) => '<path d="M' + (S + 8) + ' 0H' + rr + '"/><path d="' + path + '"/><path d="M0 ' + rr + 'V' + (S + 8) + '"/>';
    put('corner-curve',
      '<svg viewBox="-6 -6 ' + (S + 20) + ' ' + (S + 20) + '" width="' + (S + 20) + '" height="' + (S + 20) + '" role="img" aria-label="Two corners overlaid: the old circular arc, dashed, and the continuous corner, solid, which leaves the straight edge earlier and turns more gently">' +
        '<g fill="none" stroke-width="1.5" stroke-linecap="round"><g stroke="var(--text-quiet)" stroke-dasharray="3 4">' + edge(r, cornerPath(r, 2, 48)) + '</g>' +
        '<g stroke="var(--text)">' + edge(R, cornerPath(R, n, 64)) + '</g></g>' +
        '<circle cx="' + r + '" cy="0" r="2.5" fill="var(--text-quiet)"/><circle cx="' + R + '" cy="0" r="2.5" fill="var(--text)"/></svg>' +
      '<div class="sp-curve__key"><span><i data-k="arc"></i>v6: a circular arc of ' + r + ' meets the edge at once</span><span><i data-k="cont"></i>now: superellipse(1.8) at ' + R + ' (1.6 times) eases out of the edge; at the diagonal it is as deep as the arc</span></div>' +
      '<div class="sp-curve__tiles"><div><i style="border-radius:24px;corner-shape:round"></i><span class="sp-cap">round, 24</span></div><div><i style="border-radius:38px;corner-shape:superellipse(1.8)"></i><span class="sp-cap">continuous, 38</span></div></div>' +
      '<p class="sp-cap">' + (CONT ? 'This engine draws continuous corners (corner-shape), so every surface on this page has them.' : 'This engine has no corner-shape (WebKit today, so the macOS webview): every surface falls back to the slightly larger round scale, and the right tile shows a round corner too.') + '</p>');
    /* nested corners at four times: fits, too round, too sharp */
    const Rm = num('--r-m'), gap = 6, floor = num('--r-floor'), fit = Math.max(floor, Rm - gap);
    const panel = (title, inner, note, ok) => '<figure class="sp-nest__p"' + (ok ? ' data-ok' : '') + '><div class="sp-nest__o" style="border-radius:' + Rm * 4 + 'px"><i style="border-radius:' + inner * 4 + 'px"></i></div><figcaption><b>' + title + '</b><span class="sp-cap">' + note + '</span></figcaption></figure>';
    put('nest', panel('Fits', fit, 'r = R − gap = ' + Rm + ' − ' + gap + ' = ' + fit, true) + panel('Too round', Rm, 'r = R: the curves crowd the corner, the gap pinches') + panel('Too sharp', 0, 'r = 0: a hard corner against a soft one'));
    /* where it applies, with this theme's numbers */
    const v = (t) => num(t), fitOf = (R, p) => Math.max(floor, R - p);
    const rows = [
      ['Mic, send, attach and chips in the composer', '--r-m', 6, fitOf(v('--r-m'), 6)],
      ['A menu item in a menu', '--r-m', 4, fitOf(v('--r-m'), 4)],
      ['A button in a toast', '--r-m', 6, fitOf(v('--r-m'), 6)],
      ['The segmented thumb in its track', '--r-s', 3, fitOf(v('--r-s'), 3)],
      ['A key in a tooltip', '--r-s', 4, fitOf(v('--r-s'), 4)],
      ['A colour swatch in its customizer well', '--r-s', 2, fitOf(v('--r-s'), 2)],
      ['A card set into the dock slab, at its top', '--r-l', 16, fitOf(v('--r-l'), 16)],
      ['The switch thumb in its track; orbs in the dock\'s minimised pill', 'pill', 3, 'pill'],
      ['Wells and buttons in a card, fields in a popover, a card on the ground', 'loose', '≥ R', 'own step, never above R']
    ];
    put('nest-table', '<table class="sp-table sp-table--nest"><thead><tr><th>Nesting</th><th>Outer</th><th class="n">Gap</th><th class="n">Inner</th></tr></thead><tbody>' +
      rows.map(([w, t, g, r]) => '<tr><td>' + esc(w) + '</td><td><code>' + esc(t) + '</code>' + (t.startsWith('--') ? ' ' + v(t) : '') + '</td><td class="n">' + esc(g) + '</td><td class="n">' + esc(typeof r === 'number' ? r + 'px' : r) + '</td></tr>').join('') +
      '</tbody></table><p class="sp-cap">Floor ' + floor + 'px. Inner = max(--r-floor, --r-outer − --pad). Corners: ' + (T ? (T.get().corners || T.presets[T.get().preset].corners) : 'default') + (CONT ? ', continuous.' : ', round fallback.') + '</p>');
  }
  function renderBeforeAfter() {
    const items = [['card', 'An approval card'], ['dock', 'The dock slab and its flares'], ['composer', 'The composer, full and in the dock'], ['buttons', 'Buttons and the segmented control'], ['menu', 'A menu and a tooltip']];
    put('before-after', items.map(([k, t]) => '<figure class="sp-ba__row"><figcaption class="sp-cap"><b>' + esc(t) + '</b></figcaption><div class="sp-ba__pair">' +
      ['before', 'after'].map((w) => '<div><span class="sp-cap">' + (w === 'before' ? 'v6, round' : 'now, continuous') + '</span><img src="shots/corners/' + w + '-' + k + '.png" alt="' + esc(t + ', ' + (w === 'before' ? 'before: round corners' : 'after: continuous, nested corners')) + '" loading="lazy" decoding="async"></div>').join('') + '</div></figure>').join(''));
  }
  function live() { renderColour(); renderContrast(); renderScales(); renderCorners(); }
  renderControls(); live(); renderType(); renderMotion(); renderIcons(); renderOrbs();
  renderButtons(); renderHold(); renderChoices(); renderMarks(); renderLists(); renderFloat(); renderFields(); renderMeasures();
  renderConversation(); renderComposer(); renderPanel(); renderCards(); renderShell(); renderDock(); renderFindings(); renderBeforeAfter(); followToc();
  /* wide tables and card rows scroll inside their own region: give each a tab stop and a name */
  function regions() {
    for (const x of $$('.sp-x')) {
      if (x.hasAttribute('tabindex')) continue;
      const sec = x.closest('.sp-sub, .sp-sec'), t = sec && sec.querySelector('h3, h2');
      x.setAttribute('tabindex', '0'); x.setAttribute('role', 'region'); x.setAttribute('aria-label', (t ? t.textContent : 'Details') + ', scrolls sideways');
    }
  }
  regions();
  let raf = 0;
  function syncControls() {
    if (!T) return;
    const t = T.get(), P = T.presets[t.preset], eff = (k) => t[k] || P[k];
    for (const [cls, v] of [['js-preset', t.preset], ['js-corners', eff('corners')], ['js-density', eff('density')], ['js-case', eff('case')]]) { const el = $('.' + cls); if (el && el.select) el.select(v); }
  }
  const onTheme = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { live(); syncControls(); regions(); }); };
  if (HX.on) HX.on('hx:theme', onTheme);
  window.addEventListener('hx:theme', onTheme);
})();
