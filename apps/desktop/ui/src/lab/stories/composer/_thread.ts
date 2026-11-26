/* A session's thread on a v7 root, for the stories of what a turn shows (6e): the kit's session thread (the 30 gutter, the column's
   width), themed as the app themes a v7 island (s0.ts `asV7`). */
import { kit } from '@boopis/ui';
import { asV7 } from '../../../modules/session/s0';

export function sessionThread(...parts: readonly (HTMLElement | null | undefined)[]): HTMLElement {
  const t = document.createElement('div');
  t.className = 'k7-thread';
  t.dataset['kind'] = 'session';
  for (const p of parts) if (p) t.append(p);
  return asV7(t);
}
/** a reply as the session draws it: the Bubble with the answering model's mark in the gutter */
export const reply = (text: string, model: string): HTMLElement => kit.bubble({ kind: 'agent', text, brand: model });
/** your message */
export const asked = (text: string): HTMLElement => kit.bubble({ kind: 'user', text });
