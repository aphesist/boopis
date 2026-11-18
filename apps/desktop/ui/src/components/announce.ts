/* one polite live region for the whole app */
let live: HTMLElement | null = null;
export function announce(text: string): void {
  if (!live || !live.isConnected) {
    live = document.createElement('div');
    live.className = 'ui-sr';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    document.body.appendChild(live);
  }
  const node = live;
  node.textContent = '';
  setTimeout(() => { node.textContent = text; }, 30);
}
