/* Variants: one candidate cause switched off (or one fix applied) at a time, injected after the app has booted, so a
   scenario can be measured with and without it. `css` is a stylesheet, `js` a script run in the page. */
const staticOrbs = `(() => { const s = (o) => o.setAttribute('static', ''); document.querySelectorAll('orb-avatar').forEach(s);
  new MutationObserver((m) => { for (const r of m) for (const n of r.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'ORB-AVATAR') s(n); n.querySelectorAll && n.querySelectorAll('orb-avatar').forEach(s); } }).observe(document.documentElement, { childList: true, subtree: true });
  new MutationObserver((m) => { for (const r of m) if (r.target.tagName === 'ORB-AVATAR' && !r.target.hasAttribute('static')) s(r.target); }).observe(document.documentElement, { attributes: true, attributeFilter: ['static'], subtree: true }); })();`;
const staticWhere = (cond) => `(() => { const want = (o) => ${cond}; const s = (o) => { if (want(o)) o.setAttribute('static', ''); }; document.querySelectorAll('orb-avatar').forEach(s);
  new MutationObserver((m) => { for (const r of m) { if (r.type === 'attributes') s(r.target); else for (const n of r.addedNodes) if (n.nodeType === 1) { if (n.tagName === 'ORB-AVATAR') s(n); n.querySelectorAll && n.querySelectorAll('orb-avatar').forEach(s); } } }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['static'] }); })();`;
export const VARIANTS = {
  baseline: {},
  'orbs-hidden': { css: 'orb-avatar { display: none !important; }' },
  'orbs-static': { js: staticOrbs },
  'orbs-q0': { js: 'OrbAvatar.quality = 0;' },
  'orbs-q2': { js: 'OrbAvatar.quality = 2;' },
  'orbs-dock-only': { js: staticWhere("!o.closest('#hx-dock')") },
  'orbs-not-dock': { js: staticWhere("!!o.closest('#hx-dock')") },
  'orbs-sync-q2': { js: "OrbAvatar.quality = 2; document.querySelectorAll('orb-avatar').forEach((o) => { o._slot = 0; });" },
  'no-squircle-clip': { css: '[data-sq-on] { clip-path: none !important; } [data-sq-on]::before, [data-sq-on]::after { clip-path: none !important; }' },
  'no-stage-clip': { css: '.dk-stage { clip-path: none !important; }' },
  'no-dock-slab': { css: '.dk-shape { display: none !important; }' },
  'no-box-shadow': { css: '*, *::before, *::after { box-shadow: none !important; }' },
  'no-mask': { css: '* { -webkit-mask-image: none !important; mask-image: none !important; }' },
  'no-mask+orbs-hidden': { css: '* { -webkit-mask-image: none !important; mask-image: none !important; } orb-avatar { display: none !important; }' },
  'no-transitions': { css: '*, *::before, *::after { transition: none !important; }' },
  'no-dock': { css: '#hx-dock { display: none !important; }' }
};
