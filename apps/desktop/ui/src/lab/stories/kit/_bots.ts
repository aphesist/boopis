/* The bots the v7 kit's stories draw: the approved renders' six (ds-v7 kit.js LOOKS, the mock roster) and boopis. */
import { TEAM_SIX } from '../../fixtures';

export const [KAI, NINA, MOSS, IRIS, HEX, NIMBUS] = TEAM_SIX;
export const BOOPIS = { id: 'boopis', name: 'boopis', shape: 'squircle', color: '#f5f5f5', state: 'idle' } as const;
export const LONG_BOT = { id: 'cassiopeia-staging-deploy-guardian', name: 'cassiopeia-staging-deploy-guardian', shape: 'star', color: '#e8b04a', state: 'idle' } as const;
export const TEAM = TEAM_SIX;

/* orb.edges on the orbs that move (a state on orb3's alive-idle engine, a lively idle): orb3 3.0.2 leaves 1 to 3 px of residual edge
   shimmer or a lone flipping pixel there, on CI and not every run (ORBS.md measures 6 to 27 shimmer px and up to 1 lone flip per clip
   for this build). An upstream fix (aphesist/orb2), reported to the owner. orb.rest still holds every resting orb to 0 changed pixels */
export const ORB3_MOTION = 'orb3 3.0.2\'s residual edge shimmer and lone flips on orbs in motion (1 to 3 px, on CI, not every run; ORBS.md measures them for this build): an upstream fix, reported to the owner. orb.rest still blocks on every resting orb';
