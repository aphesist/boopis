/* v7 board kit: HTML helpers for the proposal's components, the continuous-corner painter (the kit's own
   squircle-path.ts, bundled), and boopis's real vendored <orb-avatar> and <boopis-logo>. */
(function () {
  const I = (n, cls = '') => { const ic = window.ICONS[n]; if (!ic) return ''; return `<svg class="i ${cls}" viewBox="${ic[0]}" aria-hidden="true">${ic[1] || ''}</svg>`; };
  // a few glyphs the v6 set lacks, drawn on its 16 grid and stroke for the boards (marked as proposals in the doc)
  const EXTRA = {
    info: ['0 0 16 16', '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.6"/><circle class="is-fill" cx="8" cy="5.2" r=".8"/>'],
    'info-fill': ['0 0 16 16', '<circle class="is-fill" cx="8" cy="8" r="6.5"/><path d="M8 7.3v3.4" stroke="var(--bg-3)"/><circle cx="8" cy="5.2" r=".85" fill="var(--bg-3)" stroke="none"/>'],
    waveform: ['0 0 16 16', '<path d="M3 6.5v3M5.5 4.5v7M8 3v10M10.5 5v6M13 6.5v3"/>'],
    arrowup: ['0 0 16 16', '<path d="M8 13V3.5M4 7.5l4-4 4 4"/>'],
    share: ['0 0 16 16', '<path d="M8 2.5v7.5M5 5.5l3-3 3 3"/><path d="M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4"/>'],
    terminal: ['0 0 16 16', '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="m4.6 6.2 2 1.8-2 1.8M8.4 10h3"/>'],
    store: ['0 0 16 16', '<path d="M2.5 6 3.6 3h8.8l1.1 3"/><path d="M2.5 6h11v1a2 2 0 0 1-3.7 1 2 2 0 0 1-3.6 0A2 2 0 0 1 2.5 7z"/><path d="M3.5 8.8V13h9V8.8"/>'],
    user: ['0 0 16 16', '<circle cx="8" cy="5.5" r="2.6"/><path d="M3 13.5a5 5 0 0 1 10 0"/>'],
    shield: ['0 0 16 16', '<path d="M8 1.8 13 3.8v3.8c0 3-2.2 5.4-5 6.6-2.8-1.2-5-3.6-5-6.6V3.8z"/>'],
    plug: ['0 0 16 16', '<path d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 0 1-7 0zM8 11v3"/>'],
    keyboard: ['0 0 16 16', '<rect x="1.8" y="3.8" width="12.4" height="8.4" rx="1.8"/><path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h.01M5 9.5h6"/>'],
    palette: ['0 0 16 16', '<path d="M8 2a6 6 0 1 0 0 12c.9 0 1.3-.6 1.1-1.3-.3-.9.3-1.7 1.2-1.7H12a2 2 0 0 0 2-2A6 6 0 0 0 8 2z"/><circle class="is-fill" cx="5.2" cy="7" r=".9"/><circle class="is-fill" cx="8" cy="5" r=".9"/><circle class="is-fill" cx="10.8" cy="7" r=".9"/>'],
    grid: ['0 0 16 16', '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2"/><path d="M11.25 9v4.5M9 11.25h4.5"/>'],
    bell: ['0 0 16 16', '<path d="M4 7a4 4 0 0 1 8 0v3l1.2 2H2.8L4 10z"/><path d="M6.5 13.5a1.6 1.6 0 0 0 3 0"/>']
  };
  Object.assign(window.ICONS, EXTRA);

  const LOOKS = {
    boopis: { color: 'var(--text-strong)', shape: 'squircle', role: 'runs the team' },
    kai: { color: '#4fc9a8', shape: 'circle', role: 'docs and changelog' },
    nina: { color: '#f23b5a', shape: 'triangle', role: 'deploys' },
    moss: { color: '#2fd26a', shape: 'squircle', role: 'flaky test hunter' },
    iris: { color: '#3b82f6', shape: 'flower', role: 'design QA' },
    hex: { color: '#a6a6ab', shape: 'hexagon', role: 'security review' },
    nimbus: { color: '#9b5cf6', shape: 'cloud', role: 'inbox triage' }
  };
  // orb: eyes 'cut' = the surface colour (option B), 'dark' = orb2's own (option A)
  /* the decided pose (owner, 23 Nov; ORBS.md section 23, K08 B, orb3 3.0.0): every bot turned by orb3's home orientation
     (38, 22, -24) and, at rest, K07's big upright pills painted on its face. The rest of the old note: a hidden orb2
     reaction (pill eyes, no blink); the angle is orb2's own gaze, 38 and 15 degrees (ORBS.md section 23) */
  if (window.OrbAvatar && !window.OrbAvatar.__pose) { const A = window.OrbAvatar; A.__pose = 1; const D0 = Math.PI / 180, P8 = A.shapes.pairEyes(['pill', { x: -.19 + .04, y: -.08, w: .18, h: .41, ang: 4 * D0 }], ['pill', { x: .19 + .04, y: -.08, w: .18, h: .41, ang: 4 * D0 }]); A.defineReaction('pose', { label: 'Pose', blink: false, rest: true, face: () => P8, motion: () => ({ eyaw: 0, epitch: 0, w: 1 }) }); }
  function orb(name, size, o = {}) {
    const l = LOOKS[name] || LOOKS.kai;
    const reaction = o.state || (o.pose ? 'pose' : 'idle');
    const still = o.still || size <= 16 ? ' static' : '';
    const eye = o.eyes === 'dark' ? '' : ` data-eye-cut="${o.surface || 'var(--bg-2)'}"`;
    const col = name === 'boopis' ? ' data-ink' : '';
    return `<orb-avatar size="${size}" shape="${l.shape}" color="${l.color.startsWith('var') ? '#f5f5f5' : l.color}" reaction="${reaction}" home="38 22 -24" idle-motion="${o.pose ? 'off' : 'calm'}" mode="${o.pose ? 'drift' : 'fixed'}"${size <= 44 ? ' face-scale="1.25"' : ''}${still}${eye}${col} style="width:${size}px;height:${size}px;flex:none"></orb-avatar>`;
  }
  function stack(names, size, o = {}) {
    const step = Math.round(size * 2 / 3);
    return `<span style="position:relative;display:inline-block;width:${size + step * (names.length - 1)}px;height:${size}px;flex:none">` +
      names.map((n, i) => `<span style="position:absolute;left:${i * step}px;top:0">${orb(n, size, { ...o, still: true })}</span>`).join('') + '</span>';
  }
  function cluster(names, size) { // the rail's circle of members (v6 owner decision, 23 Nov)
    const r = size * 0.62, c = size * 1.25, pts = names.slice(0, 4);
    return `<span style="position:relative;display:inline-block;width:${c * 2}px;height:${c * 2}px">` + pts.map((n, i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / pts.length; return `<span style="position:absolute;left:${c + r * Math.cos(a) - size / 2}px;top:${c + r * Math.sin(a) - size / 2}px">${orb(n, size, { still: true })}</span>`;
    }).join('') + '</span>';
  }

  // paint continuous corners: elements with .sq whose radius is under half their short side
  function paint(root = document) {
    const els = root.querySelectorAll('.sq');
    const reads = [];
    els.forEach((el) => {
      const cs = getComputedStyle(el); const sm = parseFloat(cs.getPropertyValue('--corner-smoothing')) || 0;
      const r = parseFloat(cs.borderTopLeftRadius) || 0; const w = el.offsetWidth, h = el.offsetHeight;
      reads.push({ el, sm, r, w, h, hl: parseFloat(cs.getPropertyValue('--hl')) || 0.5 });
    });
    for (const { el, sm, r, w, h, hl } of reads) {
      if (!sm || !r || r >= Math.min(w, h) / 2 - 0.5 || !w || !h) { el.removeAttribute('data-sq-on'); continue; }
      const outer = SQ.squirclePath(w, h, r, { smoothing: sm });
      const inner = SQ.squirclePath(w - 2 * hl, h - 2 * hl, Math.max(0, r - hl), { smoothing: sm, x: hl, y: hl });
      el.style.setProperty('--sqp', `path("${outer}")`);
      el.style.setProperty('--sqr', `path(evenodd, "${outer} ${inner}")`);
      el.setAttribute('data-sq-on', '');
    }
  }
  // cut-out eyes: orb2 draws the eyes in eye-color; the cut-out look sets it to the surface behind
  function eyes(root = document) {
    root.querySelectorAll('orb-avatar').forEach((o) => {
      const cut = o.getAttribute('data-eye-cut');
      const cs = getComputedStyle(o.parentElement || o);
      if (o.hasAttribute('data-ink')) { const ink = cs.getPropertyValue('--text-strong').trim(); if (ink) o.setAttribute('color', ink); }
      if (cut) { const v = cut.startsWith('var(') ? cs.getPropertyValue(cut.slice(4, -1)).trim() : cut; if (v) o.setAttribute('eye-color', v); }
      else if (o.hasAttribute('data-ink')) o.setAttribute('eye-color', cs.getPropertyValue('--bg-2').trim());
    });
  }
  function dock(w, h, inner, o = {}) { // the slab: v6's slabPath, black in both themes
    const R = 30, F = 30, path = SQ.slabPath(w, h, R, F);
    return `<div class="dock" style="left:${o.left || '50%'};width:${w}px;height:${h}px"><svg class="slab" style="inset:auto;top:0;left:-${F}px" viewBox="0 0 ${w + 2 * F} ${h}" width="${w + 2 * F}" height="${h}"><path d="${path}" fill="#000"/></svg><div class="dk-in">${inner}</div></div>`;
  }
  function mark(fam, size = 16, cls = '') { const m = (window.MODEL_ICONS[fam] || {}).mono; if (!m) return ''; return `<svg class="mk ${cls}" viewBox="${m.viewBox}" width="${size}" height="${size}" ${m.attrs} aria-hidden="true" style="flex:none">${m.body}</svg>`; }
  /* a session's agent is branded by its model: the provider's mark in the gutter of the last bubble of a run (as a bot's orb in a room) */
  function brand(root = document) {
    root.querySelectorAll('.thread.sess').forEach((th) => {
      const fam = th.getAttribute('data-model') || 'claude';
      th.querySelectorAll(':scope > .b.agent').forEach((b) => {
        const n = b.nextElementSibling; if (n && n.matches('.b.agent')) return;
        if (b.querySelector(':scope > .gm')) return;
        const g = document.createElement('span'); g.className = 'gm'; g.innerHTML = mark(fam, 14); b.prepend(g);
      });
    });
  }
  window.V7 = { brand, I, mark, orb, stack, cluster, paint, eyes, dock, LOOKS };
  window.addEventListener('load', () => { document.fonts.ready.then(() => { brand(); eyes(); paint(); setTimeout(() => { paint(); }, 300); }); });
})();
