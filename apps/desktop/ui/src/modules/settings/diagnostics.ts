/* Settings › Diagnostics (a page of its own on board 14's nav; today's section of General, in the desktop app only): the graphics card
   (Auto, Integrated, Dedicated; saved at once, applied at the next start, with what runs now and Restart to switch), the renderer
   report to copy (what to send when the app is slow or blank), Measure frames (how the window's motion runs: the dock under the
   pointer) and WebKitGTK's own GPU page. Its content is derived (COVERAGE conflict 16): the kit's Card of rows, Segmented and Buttons. */
import { kit } from '@boopis/ui';
import { diagnosticsHost } from './host';
import type { DiagnosticsHost } from './host';
import { fill, pageEl } from './page';
import type { Page } from './page';
import { actionsHTML, buttonHTML, said, section, segHTML } from './rows';

type Gpu = 'auto' | 'integrated' | 'dedicated';

export function diagnosticsPage(): Page {
  const { el, body } = pageEl('diagnostics', 'Diagnostics');
  let host: DiagnosticsHost | null = null;
  let gpu: Awaited<ReturnType<DiagnosticsHost['gpu']>> | null = null, chosen: Gpu = 'auto', measured = false;
  const draw = (): void => {
    if (!host) { fill(body, kit.html.emptyState({ text: 'Diagnostics are in the desktop app.' })); return; }
    fill(body,
      section('Graphics', [{ label: 'Graphics card', sub: (gpu ? gpu.lines(chosen) : ['Reading what runs now.']).join(' '), control: (gpu ? segHTML('gpu', 'Graphics card', [{ value: 'auto', label: 'Auto' }, { value: 'integrated', label: 'Integrated' }, { value: 'dedicated', label: 'Dedicated' }], chosen) : '') + (gpu?.restart(chosen) ? actionsHTML(buttonHTML('Restart to switch', { attrs: { 'data-act': 'restart' } })) : '') }], { 'data-part': 'gpu' }) +
      section('Renderer', [
        { label: 'Graphics renderer', sub: measured ? 'Includes the frames you measured.' : 'For when the app is slow or blank.', control: buttonHTML('Copy report', { attrs: { 'data-act': 'copy' } }) },
        { label: 'Motion', sub: 'Move the pointer along the dock for 5 seconds.', control: buttonHTML('Measure frames', { variant: 'ghost', attrs: { 'data-act': 'measure' } }) },
        { label: 'WebKit GPU page', sub: 'WebKitGTK’s own graphics report.', control: buttonHTML('Open', { variant: 'ghost', attrs: { 'data-act': 'gpu-page', 'aria-label': 'Open the WebKit GPU page' } }) }
      ], { 'data-part': 'renderer' }));
  };
  const load = async (): Promise<void> => {
    host = await diagnosticsHost();
    draw();
    if (!host) return;
    try { gpu = await host.gpu(); chosen = gpu.policy; } catch (e) { kit.notify(said(e)); }
    draw();
  };
  body.addEventListener('ui:change', (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset['set'] !== 'gpu' || !host) return;
    const v = (e as CustomEvent<{ value: string }>).detail.value as Gpu;
    void host.setGpu(v).then(() => { chosen = v; draw(); }, (err: unknown) => { kit.notify(said(err)); draw(); });
  });
  body.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (!b || !host) return;
    const h = host, fail = (err: unknown): void => { kit.notify(said(err)); };
    switch (b.dataset['act']) {
      case 'restart': void h.restart().catch(fail); return;
      case 'copy': void h.report(measured).then(async (text) => { try { await navigator.clipboard.writeText(text); kit.notify('Copied'); } catch { kit.notify('Copy is blocked here'); } }, fail); return;
      case 'measure': kit.notify('Measuring: move the pointer along the dock', { ms: 6000 }); void h.measure(5000).then((words) => { measured = true; kit.notify(words, { ms: 6000 }); draw(); }, fail); return;
      case 'gpu-page': void h.gpuPage().catch(fail); return;
      default: return;
    }
  });
  draw();
  void load();
  return { el, refresh: load };
}
