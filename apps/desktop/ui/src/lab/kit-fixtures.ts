/* The fixtures the v7 kit's stories share, with no imports of their own, so a component's stories (and the kit's article, pnpm kit:docs)
   draw them without the rest of the lab's data: the hard text cases and the six teammates. fixtures.ts re-exports them. */
export const LONG_NAME = 'cassiopeia-staging-deploy-guardian';
export const LONG_TITLE = 'Reconcile the invoices_v2 backfill against the ledger before the quarterly close and the auditors arrive on Monday';
export const UNBROKEN = 'src/billing/integrations/stripe/webhooks/handlers/invoice_payment_succeeded_idempotency_guard_v2_final.ts';
/** Arabic and Hebrew: the app does not translate, but names and pasted text can be right to left */
export const RTL = 'مرحبا بالعالم، هذا نص طويل من اليمين إلى اليسار · שלום עולם';

/** the owner's six teammates as their saved records draw them (`<profile>/boopis/bot.json`, 22 November 2026): the looks every
    place must agree on (bot data, not interface colour) */
export const TEAM_SIX = [
  { id: 'kai', name: 'kai', shape: 'circle', color: '#4fc9a8', state: 'idle' },
  { id: 'nina', name: 'nina', shape: 'triangle', color: '#f23b5a', state: 'idle' },
  { id: 'moss', name: 'moss', shape: 'squircle', color: '#2fd26a', state: 'idle' },
  { id: 'iris', name: 'iris', shape: 'flower', color: '#3b82f6', state: 'idle' },
  { id: 'hex', name: 'hex', shape: 'hexagon', color: '#a6a6ab', state: 'idle' },
  { id: 'nimbus', name: 'nimbus', shape: 'cloud', color: '#9b5cf6', state: 'idle' }
] as const;
