/* Where a mod draws (docs/MODS.md section 3; 2b, the lead's decisions for conflict 32): the seam between the session module, which owns
   the places, and the mods module, which draws into them. This file is a leaf (it imports nothing of either), so the session can import
   it without a cycle. The session fills `band`, `place`, `redrawRight`, `openTools` and `redrawLine`; the mods module fills the hooks. */
import type { LineItem } from '@boopis/ui';

/** the tabs a mod's panes add to the tools, after their fixed tabs: each pane by its title, the one in front, and its body */
export interface PanelTabs {
  items: Array<{ value: string; label: string; tip?: string }>; value: string;
  /** the panel's name while a pane is in front ("Tests, test-runner mod") */ label: string;
  /** changes when the pane in front must be drawn again */ sig: string;
  /** the pane in front (its tree); null while the Diff is */ body(): HTMLElement | null;
  select(id: string): void;
}

export const surface = {
  /** the slot over the composer that the held or queued strip uses: a mod's band (an empty slot takes no room) */
  band: null as HTMLElement | null,
  /** the session puts a node at the end of the conversation (a placed row, a theme card) */
  place: null as ((node: HTMLElement, o: { quiet: boolean }) => void) | null,
  /** the session redraws its right panel (the mods' panes are tabs of its tools) */
  redrawRight: null as (() => void) | null,
  /** the session opens its tools (a mod's pane came forward) */
  openTools: null as (() => void) | null,
  /** the session draws its composer's line again (a mod's status joins it) */
  redrawLine: null as (() => void) | null,
  /** the mods module: the conversation of this session was drawn (again), so what belongs in it is placed again */
  onConversation: null as ((sessionId: string) => void) | null,
  /** the mods module: the session's turn started or ended (`AbovePrompt`'s `isWorking`) */
  onWorking: null as ((working: boolean) => void) | null,
  /** the mods module: the tabs the mods' panes add to the tools; null while there is none */
  panelTabs: null as (() => PanelTabs | null) | null,
  /** the mods module: the mods' status, as items of the composer's own line (no rise: 2b) */
  lineItems: null as (() => LineItem[]) | null
};
