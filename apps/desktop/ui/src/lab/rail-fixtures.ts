/* The collapsed sidebar (the rail) with a roster and groups of a chosen size: no bots, one, the owner's seven (0.1.9's report,
   23 November 2026: a grey hexagon, a blue flower, a teal circle, an orange diamond, a green square, a purple cloud, a red
   triangle, in name order) or twelve; and no groups, one, the owner's two ("release crew" and "paper past") or five, whose
   sizes run from two members to six (the engine's room size). Bot data, not interface colour. */
import type { DataProvider } from '../data/provider';
import type { Bot, Group, GroupMember } from '../data/types';

type Look = { id: string; shape: string; color: string; state: string; attention?: string };
/** the owner's seven, in the order the roster drew them */
const SEVEN: readonly Look[] = [
  { id: 'hex', shape: 'hexagon', color: '#a6a6ab', state: 'sleeping' },
  { id: 'iris', shape: 'flower', color: '#3b82f6', state: 'idle' },
  { id: 'kai', shape: 'circle', color: '#4fc9a8', state: 'working' },
  { id: 'lark', shape: 'diamond', color: '#f5a337', state: 'idle' },
  { id: 'moss', shape: 'squircle', color: '#2fd26a', state: 'speaking' },
  { id: 'nimbus', shape: 'cloud', color: '#9b5cf6', state: 'idle' },
  { id: 'nina', shape: 'triangle', color: '#f23b5a', state: 'needs', attention: 'approval' }
];
/** five more for twelve */
const FIVE: readonly Look[] = [
  { id: 'atlas', shape: 'circle', color: '#efece6', state: 'idle' },
  { id: 'sol', shape: 'star', color: '#e8b04a', state: 'thinking' },
  { id: 'terra', shape: 'drop', color: '#c4834a', state: 'idle' },
  { id: 'vox', shape: 'clover', color: '#6d5cf0', state: 'compute' },
  { id: 'umbra', shape: 'ghost', color: '#1c1c24', state: 'happy' }
];
export type RailBots = 0 | 1 | 7 | 12;
export type RailGroups = 0 | 1 | 2 | 5;
export const railLooks = (n: RailBots): readonly Look[] => [...SEVEN, ...FIVE].slice(0, n === 1 ? 0 : n).concat(n === 1 ? [SEVEN[2]!] : []);
const member = (id: string): GroupMember => ({ id, profile: id, handle: id, name: id });
/** the groups, from the owner's two up: six members, three, then two, four and five */
const GROUPS: ReadonlyArray<{ id: string; name: string; members: readonly string[] }> = [
  { id: 'room-release', name: 'release crew', members: ['kai', 'nina', 'iris'] },
  { id: 'room-paper', name: 'paper past', members: ['kai', 'nina', 'moss', 'iris', 'hex', 'nimbus'] },
  { id: 'room-pair', name: 'pair', members: ['nina', 'lark'] },
  { id: 'room-night', name: 'night desk', members: ['nimbus', 'hex', 'lark', 'moss'] },
  { id: 'room-launch', name: 'the launch review with design, docs and the platform team', members: ['iris', 'moss', 'lark', 'nina', 'hex'] }
];
export const railGroups = (n: RailGroups): ReadonlyArray<{ id: string; name: string; members: readonly string[] }> => GROUPS.slice(0, n);

/** the provider with that roster and those groups; a group keeps members that are no longer bots of the user (one bot left
    of a group of three draws one orb) */
export function railRoster(bots: RailBots, groups: RailGroups) {
  return (p: DataProvider): DataProvider => {
    const tpl = p.bots.snapshot().bots[0] as Bot;
    const roster: Bot[] = railLooks(bots).map((l) => ({ ...tpl, id: l.id, name: l.id, role: l.id + ', on the team', shape: l.shape, color: l.color, state: l.state, attention: l.attention ?? null, activity: '', last: null }));
    const gs: Group[] = railGroups(groups).map((g) => ({ id: g.id, name: g.name, members: g.members.map(member), working: [], busy: false, queued: [] }));
    return {
      ...p,
      bots: { ...p.bots, snapshot: () => ({ bots: roster, threads: Object.fromEntries(roster.map((b) => [b.id, []])) }) },
      waits: { ...p.waits, snapshot: () => [] },
      groups: { ...p.groups, snapshot: () => ({ groups: gs, threads: Object.fromEntries(gs.map((g) => [g.id, []])) }) }
    };
  };
}

/** what is wrong with the rail as drawn, in words: the switch, New bot and the list each below the one before, nothing over
    another; every row's orb (or a group's cluster) centred on the sidebar's x = 28 axis and inside its row; the bots, then the
    groups, then New group, top to bottom */
export function railProblems(): string[] {
  const out: string[] = [];
  const side = document.querySelector<HTMLElement>('#hx-side'), seg = document.querySelector<HTMLElement>('.hx-rail__seg');
  const add = document.querySelector<HTMLElement>('.hx-rail__new'), list = document.querySelector<HTMLElement>('#hx-list-bots');
  if (!side || !seg || !add || !list) return ['the rail has no switch, New bot or list'];
  const box = (e: Element): DOMRect => e.getBoundingClientRect();
  const s = box(seg), a = box(add), l = box(list), axis = box(side).left + 28;
  if (a.top < s.bottom - 0.5) out.push('New bot starts ' + (s.bottom - a.top).toFixed(1) + 'px over the switch');
  if (l.top < a.bottom - 0.5) out.push('the list starts ' + (a.bottom - l.top).toFixed(1) + 'px under New bot');
  for (const [name, r] of [['the switch', s], ['New bot', a]] as const) if (Math.abs((r.left + r.right) / 2 - axis) > 1) out.push(name + ' is ' + ((r.left + r.right) / 2 - axis).toFixed(1) + 'px off the axis');
  const rows = [...list.querySelectorAll<HTMLElement>('.bt-rows .ui-row, .bt-group-rows .ui-row')];
  let prev: DOMRect | null = null, prevName = '';
  for (const row of rows) {
    const r = box(row), name = row.getAttribute('aria-label') ?? row.dataset['gid'] ?? 'a row';
    if (!r.height) { out.push(name + ' takes no room'); continue; }
    if (prev && r.top < prev.bottom - 0.5) out.push(name + ' starts ' + (prev.bottom - r.top).toFixed(1) + 'px over ' + prevName);
    prev = r; prevName = name;
    const marks = [...row.querySelectorAll<HTMLElement>('.ui-row__lead .ui-orb, .ui-row__lead .ui-stack__more, .ui-row__lead .ui-icon')].map(box).filter((b) => b.width > 0);
    if (!marks.length) { out.push(name + ' shows nothing in the rail'); continue; }
    const left = Math.min(...marks.map((b) => b.left)), right = Math.max(...marks.map((b) => b.right)), top = Math.min(...marks.map((b) => b.top)), bottom = Math.max(...marks.map((b) => b.bottom));
    if (Math.abs((left + right) / 2 - axis) > 1) out.push(name + ': its orbs are ' + ((left + right) / 2 - axis).toFixed(1) + 'px off the axis');
    if (Math.abs((top + bottom) / 2 - (r.top + r.bottom) / 2) > 1) out.push(name + ': its orbs are ' + ((top + bottom) / 2 - (r.top + r.bottom) / 2).toFixed(1) + 'px off the row\'s middle');
    if (left < r.left - 0.5 || right > r.right + 0.5 || top < r.top - 0.5 || bottom > r.bottom + 0.5) out.push(name + ': its orbs reach outside the row');
  }
  return out;
}
/** `railProblems` once the page has drawn the rail: the sidebar's change of size settles over a frame or two (more on a loaded
    machine), so it is asked again for up to two seconds and only what stays wrong is returned */
export async function railSettled(): Promise<string[]> {
  const frame = (): Promise<void> => new Promise((r) => { requestAnimationFrame(() => { requestAnimationFrame(() => { r(); }); }); });
  let bad: string[] = [];
  for (let i = 0; i < 8; i++) {
    await frame();
    bad = railProblems();
    if (!bad.length) return bad;
    await new Promise((r) => setTimeout(r, 250));
  }
  return bad;
}
