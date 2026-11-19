/* What the user sees when the app cannot start: a plain, readable notice with the stable error code and a Retry. It uses
   the design tokens and invents nothing else (the v6 mock-up has no screen for this; the owner may design one). */
export function showStartupFailure(err: unknown): void {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.style.cssText = 'position:fixed;inset:0;display:grid;place-content:center;gap:12px;padding:32px;background:var(--bg-0);color:var(--text);font:inherit;text-align:center';
  const h = document.createElement('p');
  h.textContent = 'boopis could not reach Hermes';
  h.style.cssText = 'margin:0;font-weight:600';
  const m = document.createElement('p');
  m.textContent = message;
  m.style.cssText = 'margin:0;color:var(--text-dim);max-width:60ch';
  const c = document.createElement('p');
  c.textContent = code;
  c.style.cssText = 'margin:0;color:var(--text-faint)';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.addEventListener('click', () => { location.reload(); });
  box.append(h, m, ...(code ? [c] : []), retry);
  document.body.append(box);
  retry.focus();
}
