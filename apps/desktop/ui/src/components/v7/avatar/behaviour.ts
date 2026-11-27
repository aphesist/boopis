/* Avatar: its behaviour, moved as it was from wire.ts; wire.ts wires it on every Avatar once (docs/kit/RULES.md). State lives in ARIA and data attributes. */
/** a bot at rest on a rest surface wakes under the pointer (the lively idle, its 3D turns and glances) and settles back into the pose
    when it leaves (ORBS.md, per-surface policy); a bot in a state keeps its state */
export function wireRestOrb(w: HTMLElement): void {
  const o = w.querySelector('orb-avatar');
  if (!o) return;
  w.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'touch' || o.getAttribute('reaction') !== 'pose') return;
    w.dataset['awake'] = '';
    o.setAttribute('reaction', 'idle'); o.setAttribute('idle-motion', 'lively');
  });
  w.addEventListener('pointerleave', () => {
    if (!('awake' in w.dataset)) return;
    delete w.dataset['awake'];
    o.setAttribute('reaction', 'pose'); o.setAttribute('idle-motion', 'off');
  });
}
