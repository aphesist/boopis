/* B17 to B19: the tagline, the eyes becoming the wordmark, the end card (SC/script/script.md; cutdowns.md section 1). */
import { BOTS, h, orb } from '../stage';
import { appWindow, filmLine } from './parts';

const logoSvg = (o: object = {}): string => (window as unknown as { BoopisLogo: { svg(o: object): string } }).BoopisLogo.svg({ color: 'currentColor', ...o });

/** B17 at 40.8 s: everything but nina has blurred into the ground; she keeps her happy face and glances up at the tagline */
export function b17(s: HTMLElement, v: boolean): void {
  s.style.setProperty('--pool-x', '50%'); s.style.setProperty('--pool-y', v ? '64%' : '72%'); s.style.setProperty('--pool-w', '70%'); s.style.setProperty('--pool-h', '80%');
  const back = appWindow({ x: v ? -200 : 160, y: v ? 500 : 120, w: v ? 1500 : 1600, h: v ? 1100 : 900, tab: 'bots', main: () => undefined });
  back.style.filter = 'blur(24px) var(--focus-pull)';
  s.append(back);
  s.append(filmLine(v ? 'Your AI plans,<br>on one {team}' : 'Your AI plans, on one {team}', { y: v ? 420 : 240, size: v ? 104 : 96 }));
  s.append(orb(BOTS.nina, { size: v ? 420 : 360, x: v ? 540 : 960, y: v ? 1180 : 720, reaction: 'happy', gaze: [0, 16], still: true }));
}

/** B18 at 42.5 s: mid-morph. nina's body has shrunk away behind her eyes (an opaque shape scaling down), her eyes are
    already the logo's two ovals in light ink, and the letters are springing in around them: b and p landed, the i's dot
    hopping, the s still arriving */
export function b18(s: HTMLElement, v: boolean): void {
  s.style.setProperty('--pool-x', '50%'); s.style.setProperty('--pool-y', v ? '46%' : '48%'); s.style.setProperty('--pool-w', '120%'); s.style.setProperty('--pool-h', '130%');
  const typeSize = v ? 170 : 200;
  const hgt = Math.round(typeSize * 0.907), wid = Math.round(hgt * 3091 / 907);
  const cx = v ? 540 : 960, cy = v ? 820 : 500;
  const wrap = h('div', '', logoSvg(), { position: 'absolute', left: Math.round(cx - wid / 2) + 'px', top: Math.round(cy - hgt / 2) + 'px', width: wid + 'px', height: hgt + 'px', color: 'var(--text-strong)' });
  const svg = wrap.querySelector('svg')!;
  svg.setAttribute('width', String(wid)); svg.setAttribute('height', String(hgt));
  const paths = [...svg.querySelectorAll('path')];
  /* the letters' springs, caught mid-move: [dx, dy, rotate, scaleY] in font units, around each letter's foot */
  const pose: Array<[number, number, number, number]> = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, -18, -2, 1.02], [0, -92, 6, 1], [70, -40, 7, .9]];
  paths.forEach((p, i) => {
    const [dx, dy, rot, sy] = pose[i] ?? [0, 0, 0, 1];
    if (!dx && !dy && !rot && sy === 1) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', 'translate(' + dx + ' ' + dy + ') rotate(' + rot + ') scale(1 ' + sy + ')');
    p.replaceWith(g); g.append(p);
  });
  /* nina's body, an opaque triangle scaled down to 28% behind the eyes */
  const eyes = paths.slice(1, 3).map((p) => p.getBoundingClientRect());
  s.append(wrap);
  const e1 = paths[1]!.getBoundingClientRect(), e2 = paths[2]!.getBoundingClientRect();
  const ex = (e1.left + e2.right) / 2, ey = (e1.top + e1.bottom) / 2;
  const body = orb(BOTS.nina, { size: Math.round((v ? 420 : 360) * 0.62), x: ex, y: ey + 8, reaction: 'happy', still: true, shadow: false });
  body.style.zIndex = '0'; wrap.style.zIndex = '1';
  body.querySelector('orb-avatar')!.setAttribute('eye-color', 'var(--bg-0)');
  s.append(body);
  void eyes;
}

/** B19 at 45.3 s: the end card, variant (b), the owner's (SC/decisions.md 2): the wordmark, the tagline set as its own line
    well below it (outside its protection area), and the platforms. No address and no handle, anywhere. */
export function endCard(s: HTMLElement, v: boolean, extra: 'tagline' | 'none'): void {
  s.style.setProperty('--pool-x', '50%'); s.style.setProperty('--pool-y', '46%'); s.style.setProperty('--pool-w', '130%'); s.style.setProperty('--pool-h', '140%');
  s.style.setProperty('--pool', 'var(--lamp-orbs)');
  const typeSize = v ? 170 : 200;
  const logo = document.createElement('boopis-logo');
  logo.setAttribute('blink', 'off'); logo.setAttribute('gaze', 'off');
  logo.style.fontSize = typeSize + 'px';
  const top = v ? 820 - typeSize * 0.55 : 500 - typeSize * 0.6;
  s.append(h('div', '', '', { position: 'absolute', left: '0', right: '0', top: Math.round(top) + 'px', display: 'flex', 'justify-content': 'center', color: 'var(--text-strong)' }));
  (s.lastElementChild as HTMLElement).append(logo);
  const lines = extra === 'tagline' ? '<p style="margin:0;font:500 ' + (v ? 56 : 52) + 'px/1.15 var(--sans);letter-spacing:-.012em;color:var(--text)">Your AI plans, on one team</p>' : '';
  s.append(h('div', '', lines + '<p style="margin:0;font:400 40px/1.3 var(--sans);color:var(--text-quiet)">For Linux, and early on Windows</p>', {
    position: 'absolute', left: '0', right: '0', top: (v ? 1060 : 760) + 'px', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '16px', 'text-align': 'center'
  }));
  void customElements.whenDefined('boopis-logo').then(() => setTimeout(() => logo.look(0.3, 0.16), 300));
}
export const b19b = (s: HTMLElement, v: boolean): void => endCard(s, v, 'tagline');
