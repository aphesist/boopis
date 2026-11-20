/* Links in the desktop app open in the person's browser. A web link inside the webview would navigate the app itself
   away from the page (or do nothing: `target="_blank"` has no window to open), so a click on an `http` or `https` anchor is
   handed to the host, which opens it with the system (and refuses anything but web links: `os::validate_external_url`). */
import { commands } from './bindings';
import { asHostError } from './bridge';

/** the anchor a click landed on, when it points at the web */
export function webLinkOf(target: EventTarget | null): string | null {
  const a = target instanceof Element ? target.closest('a[href]') : null;
  const href = a?.getAttribute('href') ?? '';
  return /^https?:\/\//i.test(href) ? href : null;
}

/** listen for clicks on web links for the lifetime of the page; returns the function that stops listening */
export function wireExternalLinks(open: (url: string) => Promise<unknown> = (url) => commands.openExternal(url), fail: (e: unknown) => void = () => undefined, root: Document = document): () => void {
  const onClick = (e: MouseEvent): void => {
    if (e.defaultPrevented || e.button !== 0) return;
    const url = webLinkOf(e.target);
    if (!url) return;
    e.preventDefault();
    open(url).catch((err: unknown) => { fail(asHostError(err)); });
  };
  root.addEventListener('click', onClick);
  return () => { root.removeEventListener('click', onClick); };
}
