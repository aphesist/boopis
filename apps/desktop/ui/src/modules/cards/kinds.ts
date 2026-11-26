/* The card kinds the <hx-card> host draws: only the form (form.ts), the kit's AskCard block. The v6 kinds went to the kit: ship,
   teammate, escalation, error and schedule at step 6e (asks.ts, the session's FilesCard); approval, blank and connector at step 6f
   (a bot's approval is the room's and the dock's AskCard, a session's is its approval-shaped form; a blank is the session's AskCard
   question with the kit's Mark in its sentence; a connector's sign-in is the form kinds `signin` and `connector`).
   tone: what the card owes the user. red = an ask; pulse = sending; ink = done; ring = closed without effect. Hosts can read data-tone. */
import type { CardKind } from '@boopis/ui';
import type { Kind } from './types';
import { formKind } from './form';

export const KINDS: Record<CardKind, Kind> = { form: formKind };
