/* The app window, composed from the kit: title bar with the still mark, the open sidebar (wordmark, Session | Bots,
   the session list), the conversation (a request, an agent's answer with its model in the call number) and the
   composer. And the dock's slab: one path with continuous top corners and concave flares, rebuilt each frame from its
   size, the way the app's dock draws its outline. */
import { ui } from '@boopis/ui';
import { el } from './stage';

export interface AppWin { win: HTMLElement; main: HTMLElement; convo: HTMLElement; composer: HTMLElement & { setValue(s: string): void } }
export function appWindow(parent: HTMLElement, w = 1440, h = 820, o: { dock?: boolean; title?: string } = {}): AppWin {
  const win = el('div', 'win', parent);
  win.style.width = w + 'px'; win.style.height = h + 'px';
  win.innerHTML = `
    <div class="win__bar"><boopis-logo mark still style="width:18px"></boopis-logo><span class="win__title">${o.title ?? 'proration drift in src/billing'}</span></div>
    <div class="win__side">
      <div class="win__brand"><boopis-logo still style="font-size:20px"></boopis-logo></div>
      <div class="win__seg"></div>
      <div class="win__new"></div>
      <div class="win__group">billing-api</div>
      <ul class="ui-rows win__rows"></ul>
    </div>
    <div class="win__main"><div class="win__convo"></div><div class="win__comp"></div></div>`;
  const seg = ui.segmented({ options: [{ value: 'session', label: 'Session' }, { value: 'bots', label: 'Bots' }], value: 'session', label: 'View', fill: true });
  win.querySelector('.win__seg')!.append(seg);
  win.querySelector('.win__new')!.append(ui.button({ label: 'New session', icon: 'plus', variant: 'secondary' }));
  const rows = win.querySelector('.win__rows') as HTMLElement;
  rows.innerHTML = [['proration drift in src/billing', 'now', true], ['webhook retries and idempotency', '2h'], ['audit log export', 'yesterday'], ['pricing page copy', 'yesterday'], ['release notes for 2.4', 'mon']]
    .map(([t, e, c]) => '<li>' + ui.html.row({ title: t as string, end: e as string, current: !!c }) + '</li>').join('');
  const convo = win.querySelector('.win__convo') as HTMLElement;
  convo.append(ui.entry({ kind: 'user', who: 'you', callno: ['14:01'], body: ui.html.request('proration drifts by a cent on long invoices. move src/billing to integer cents and keep the public API.') }));
  convo.append(ui.entry({ kind: 'agent', callno: ['claude-opus-5-5', '3m 42s', '$0.37'], body: '<p>' + ui.html.inline('Everything under `src/billing` now works as integer cents. `prorateCents` rounds once, at the end, so a 31-day invoice split three ways no longer drifts.') + '</p>' }));
  const comp = ui.composer({ placeholder: 'Describe the change', spend: { spent: '$0.37', cap: '$0.60' }, chips: [{ label: 'Governed', pressed: true }, { label: 'Smart', pressed: true }] }) as AppWin['composer'];
  win.querySelector('.win__comp')!.append(comp);
  return { win, main: win.querySelector('.win__main') as HTMLElement, convo, composer: comp };
}

/** the slab's outline: width w, height h, bottom edge at y = h, top corners and flares of radius r */
export function slabPath(w: number, h: number, r = 30): string {
  const k = 0.62, c = Math.min(r, h / 2, w / 2);
  return [
    `M ${-c} ${h}`,
    `C ${-c + k * c} ${h} 0 ${h - c + k * c} 0 ${h - c}`,
    `L 0 ${c}`,
    `C 0 ${c - k * c} ${c - k * c} 0 ${c} 0`,
    `L ${w - c} 0`,
    `C ${w - c + k * c} 0 ${w} ${c - k * c} ${w} ${c}`,
    `L ${w} ${h - c}`,
    `C ${w} ${h - c + k * c} ${w + c - k * c} ${h} ${w + c} ${h}`,
    'Z'
  ].join(' ');
}
export function slab(parent: HTMLElement): { el: HTMLElement; set(w: number, h: number): void } {
  const box = el('div', 'slab', parent);
  box.setAttribute('data-ground', 'dock');
  box.innerHTML = '<svg class="slab__svg" overflow="visible"><path fill="#000"/></svg><div class="slab__in"></div>';
  const svg = box.querySelector('svg') as SVGSVGElement, path = box.querySelector('path') as SVGPathElement;
  return {
    el: box,
    set(w, h) {
      box.style.width = w + 'px'; box.style.height = h + 'px';
      svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h));
      path.setAttribute('d', slabPath(w, h));
    }
  };
}
