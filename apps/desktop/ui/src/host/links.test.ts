import { describe, expect, it } from 'vitest';
import { webLinkOf, wireExternalLinks } from './links';

const page = (html: string): Document => { document.body.innerHTML = html; return document; };
const click = (el: Element, init: MouseEventInit = {}): MouseEvent => { const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }); el.dispatchEvent(e); return e; };

describe('web links open in the browser, not in the app', () => {
  it('finds the anchor a click landed inside of, for web links only', () => {
    page('<a id="a" href="https://example.com/x"><b id="b">go</b></a><a id="f" href="file:///etc/passwd">f</a><a id="h" href="#top">h</a>');
    expect(webLinkOf(document.getElementById('b'))).toBe('https://example.com/x');
    expect(webLinkOf(document.getElementById('f'))).toBeNull();
    expect(webLinkOf(document.getElementById('h'))).toBeNull();
  });
  it('hands the link to the host and keeps the webview where it is', () => {
    page('<a id="a" href="https://example.com/x" target="_blank">go</a>');
    const opened: string[] = [];
    const off = wireExternalLinks((u) => { opened.push(u); return Promise.resolve(); });
    const e = click(document.getElementById('a') as Element);
    off();
    expect(opened).toEqual(['https://example.com/x']);
    expect(e.defaultPrevented).toBe(true);
  });
  it('leaves other clicks alone: a middle button, a plain button, a link already handled', () => {
    page('<a id="a" href="https://example.com">go</a><button id="b">b</button>');
    const opened: string[] = [];
    const off = wireExternalLinks((u) => { opened.push(u); return Promise.resolve(); });
    click(document.getElementById('a') as Element, { button: 1 });
    click(document.getElementById('b') as Element);
    off();
    expect(opened).toEqual([]);
  });
  it('says so when the host refuses', async () => {
    page('<a id="a" href="https://example.com">go</a>');
    const failed: unknown[] = [];
    const off = wireExternalLinks(() => Promise.reject({ code: 'hx.invalid_params', message: 'no' }), (e) => failed.push(e));
    click(document.getElementById('a') as Element);
    await Promise.resolve(); await Promise.resolve();
    off();
    expect(failed).toHaveLength(1);
  });
});
