/* Where a mod draws (docs/MODS.md section 3): the seam between the session module, which owns the places, and the mods module,
   which draws into them. This file is a leaf (it imports nothing of either), so the session can import it without a cycle.
   The session fills `slots`, `place`, `redrawRight`; the mods module fills the hooks. */

/** the two slots in the composer's host: the band above the composer and the status line under it. Empty slots take no room. */
export interface ModSlots { band: HTMLElement; status: HTMLElement }

export const surface = {
  slots: null as ModSlots | null,
  /** the session puts a node at the end of the conversation (a placed row, a theme card) */
  place: null as ((node: HTMLElement, o: { quiet: boolean }) => void) | null,
  /** the session redraws its details panel (the mods' panes are its tabs) */
  redrawRight: null as (() => void) | null,
  /** the mods module: the conversation of this session was drawn (again), so what belongs in it is placed again */
  onConversation: null as ((sessionId: string) => void) | null,
  /** the mods module: the session's turn started or ended (`AbovePrompt`'s `isWorking`) */
  onWorking: null as ((working: boolean) => void) | null,
  /** the mods module: the details panel was drawn; may return it with its tabs. null leaves the panel as it was */
  decoratePanel: null as ((panel: HTMLElement) => HTMLElement | null) | null
};
