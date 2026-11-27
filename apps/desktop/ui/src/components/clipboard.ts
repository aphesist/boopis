/* Copy to the clipboard, and say so only when it happened: the async API first, the old copy command where a webview refuses it. */
import { notify } from './v7/notice/notify';

function legacyCopy(text: string): boolean {
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.append(t); t.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { t.remove(); }
}
/** copy `text`; the floating Notice says "Copied" (or `done`), or that copying is blocked */
export async function copyText(text: string, done = 'Copied'): Promise<boolean> {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch { ok = legacyCopy(text); }
  notify(ok ? done : 'Copy is blocked here');
  return ok;
}
