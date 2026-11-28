/* Helpers the session module's files share. */
import { copyText as copyToClipboard } from '@boopis/ui';

/** copy to the clipboard and say so only when it happened (the kit's one copy) */
export async function copyText(text: string): Promise<void> { await copyToClipboard(text); }
export const kTokens = (n: number): string => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
export const mdOf = (node: HTMLElement): string => node.innerText.replace(/\n{3,}/g, '\n\n');
export const randomId = (prefix: string): string => prefix + Math.random().toString(36).slice(2, 7);
