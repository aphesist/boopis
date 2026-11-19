/* Forced pseudo-states, without touching a component. The lab copies every rule that styles :hover, :focus-visible,
   :focus, :focus-within or :active into a stylesheet of its own, with the pseudo-class replaced by an attribute
   (`data-lab-hover`, `data-lab-focus`, `data-lab-active`). Setting the attribute on an element then shows that state,
   in the gallery and under Playwright alike, several at once if need be. Rules inside @media, @supports and @layer
   keep their condition. Shadow roots (orbs, the logo) are out of reach and stay at rest. */
import type { Forced } from './types';

const ATTR: Record<Forced, string> = { hover: 'data-lab-hover', focus: 'data-lab-focus', active: 'data-lab-active' };
const PSEUDO = /:(hover|focus-visible|focus-within|focus|active)(?![\w-])/;

function rewrite(sel: string): string {
  return sel
    .replace(/:hover(?![\w-])/g, '[data-lab-hover]')
    .replace(/:active(?![\w-])/g, '[data-lab-active]')
    .replace(/:focus-visible(?![\w-])/g, '[data-lab-focus]')
    .replace(/:focus-within(?![\w-])/g, ':has([data-lab-focus])')
    .replace(/:focus(?![\w-])/g, '[data-lab-focus]');
}

function collect(rules: CSSRuleList, out: string[]): void {
  for (const r of Array.from(rules)) {
    if (r instanceof CSSStyleRule) {
      if (PSEUDO.test(r.selectorText)) {
        const body = r.cssText.slice(r.cssText.indexOf('{'));
        out.push(rewrite(r.selectorText) + ' ' + body);
      }
      if (r.cssRules && r.cssRules.length) { const inner: string[] = []; collect(r.cssRules, inner); if (inner.length) out.push(r.selectorText + ' { ' + inner.join('\n') + ' }'); }
    } else if (r instanceof CSSMediaRule || r instanceof CSSSupportsRule || (typeof CSSLayerBlockRule !== 'undefined' && r instanceof CSSLayerBlockRule)) {
      const inner: string[] = [];
      collect(r.cssRules, inner);
      if (!inner.length) continue;
      const head = r instanceof CSSMediaRule ? '@media ' + r.conditionText : r instanceof CSSSupportsRule ? '@supports ' + r.conditionText : '@layer ' + (r as CSSLayerBlockRule).name;
      out.push(head + ' { ' + inner.join('\n') + ' }');
    }
  }
}

let installed: HTMLStyleElement | null = null;
/** (re)builds the forced-state stylesheet from every stylesheet in the document */
export function installForcing(): void {
  const out: string[] = [];
  for (const s of Array.from(document.styleSheets)) {
    if (s.ownerNode === installed) continue;
    try { collect(s.cssRules, out); } catch { /* a cross-origin sheet: nothing of ours */ }
  }
  installed?.remove();
  installed = document.createElement('style');
  installed.id = 'lab-forced';
  installed.textContent = out.join('\n');
  document.head.appendChild(installed);
}

/** the interactive elements of a subtree: what "force hover everywhere" means */
export const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="switch"], [role="textbox"], [tabindex]:not([tabindex="-1"]), .ui-row';

export function force(root: ParentNode, sel: string | null, state: Forced, on = true): number {
  const els = sel ? Array.from(root.querySelectorAll(sel)) : Array.from(root.querySelectorAll(INTERACTIVE));
  for (const el of els) el.toggleAttribute(ATTR[state], on);
  return els.length;
}
export function clearForced(root: ParentNode): void {
  for (const a of Object.values(ATTR)) for (const el of Array.from(root.querySelectorAll('[' + a + ']'))) el.removeAttribute(a);
}
