/* The sign-in cards the Providers section of Settings > Models mounts for the ways the host runs a sign-in for besides ChatGPT's
   (which it draws itself): SuperGrok's and GitHub Copilot's, both the shared card (`signin-card.ts`) with a lab's words. Registered
   through the section's `registerSigninCard` seam, so a row's Sign in opens the card in place of the list, Cancel ends the wait,
   and a finished sign-in returns to the list. Sign out is the section's own, over `provider_sign_out`. */
import { COPILOT_WAY, mountCopilotSignin, tauriCopilotBridge } from './copilot-signin';
import { registerSigninCard } from './providers-view';
import { mountXaiSignin, tauriXaiBridge, XAI_WAY } from './xai-signin';

/* Registered when this file is loaded (Settings > Models imports it). The bridges are made when a card is opened, so nothing
   reaches the host before then. A later `registerSigninCard` for the same way replaces these (the tests do). */
registerSigninCard(XAI_WAY, (host, signedIn) => mountXaiSignin(host, tauriXaiBridge(), { onSignedIn: signedIn }));
registerSigninCard(COPILOT_WAY, (host, signedIn) => mountCopilotSignin(host, tauriCopilotBridge(), { onSignedIn: signedIn }));
