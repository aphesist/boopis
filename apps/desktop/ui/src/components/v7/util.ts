/* The v7 kit's shared string helpers. Every component's root carries `data-kit="<Name>"` (DESIGN-SYSTEM.md v7 21.2's name),
   a part `data-kit-part="<Name>"`: the lab's v7 checks find components by these (tests/lab/v7.mjs ROLES), never by class. */
import { attrs, esc } from '../../core/dom';
import type { Attrs } from '../../core/dom';
import { icon } from '../icons';

export { attrs, esc };
export type { Attrs };
export type U<T> = T | undefined;

/** the root attributes of a kit component */
export const kitAttrs = (name: string, more?: Attrs | null): string => attrs({ 'data-kit': name, ...(more ?? {}) });
/** a part of a component (a Segmented item, a dock's row) */
export const partAttrs = (name: string, more?: Attrs | null): string => attrs({ 'data-kit-part': name, ...(more ?? {}) });
/** a glyph from the kit's icon set at the kit's 16 px */
export const glyph = (name: string | undefined, cls?: string): string => (name ? icon(name, { size: 'm', class: cls ? 'k7-ic ' + cls : 'k7-ic' }) : '');
/** classes, dropping the empty ones */
export const cls = (...a: unknown[]): string => a.filter(Boolean).join(' ');
/** text or trusted HTML */
export const textOr = (text: U<string>, htmlStr?: U<string>): string => htmlStr ?? esc(text ?? '');
