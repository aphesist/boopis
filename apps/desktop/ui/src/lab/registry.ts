/* Every story, found by file name: `src/lab/stories/<area>/<thing>.stories.ts`, each exporting its story as `default`
   (or an array of stories). The lab, the checker and the coverage gate all read this list. */
import type { Allowance, Story } from './types';

const mods = import.meta.glob<{ default: Story | readonly Story[] }>('./stories/**/*.stories.ts', { eager: true });

export const STORIES: readonly Story[] = Object.keys(mods).sort().flatMap((k) => {
  const d = mods[k]?.default;
  return d ? (Array.isArray(d) ? d : [d as Story]) : [];
});
export const storyById = (id: string): Story | undefined => STORIES.find((s) => s.id === id);

/** the flat list the checker walks: one row per story and state */
export interface StateRow { story: string; state: string; area: string; kind: string; app: boolean; tags: readonly string[]; width?: number; zoom?: number; allow: Readonly<Record<string, Allowance>>; interact: number; overlay: boolean; mock: { url: string; crop?: string } | null; v7?: boolean }
export function manifest(): StateRow[] {
  return STORIES.flatMap((s) => Object.entries(s.states).map(([name, st]) => {
    const mock = st.mock ?? s.mock ?? null;
    const row: StateRow = { story: s.id, state: name, area: s.area, kind: s.kind, app: !!st.app, tags: st.tags, allow: (st.allow ?? {}) as Record<string, Allowance>, interact: st.interact?.length ?? 0, overlay: !!st.overlay, mock: mock ? { url: mock.url, ...(mock.crop ? { crop: mock.crop } : {}) } : null };
    if (s.v7) row.v7 = true;
    if (st.width) row.width = st.width;
    if (st.zoom) row.zoom = st.zoom;
    return row;
  }));
}
