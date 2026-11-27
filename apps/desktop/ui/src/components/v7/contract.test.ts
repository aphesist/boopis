// @vitest-environment jsdom
/* The contracts (contract.ts) against the code: every component of the kit declares one beside its view, and what a contract says is
   true of the code. The docs (pnpm kit:docs) are written from these contracts, so this test keeps them honest. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kit } from './index';
import { LAYERS } from './contract';
import type { Contract } from './contract';
import { UI_EVENTS } from './events';

const HERE = __dirname;
const UI = join(HERE, '..', '..', '..');
/* theme/ is a foundation (the accent and a bot's colours at run time), not a component: it has no contract */
const FOUNDATIONS = ['theme'];
const views = import.meta.glob<{ contract?: Contract }>(['./*/*.ts', '!./*/*.test.ts', '!./*/*.stories.ts', '!./*/behaviour.ts', '!./*/editing.ts', '!./*/notify.ts'], { eager: true });
/* a component's view is <folder>/<folder>.ts */
const CONTRACTS: Contract[] = Object.entries(views).filter(([p]) => { const m = /^\.\/([^/]+)\/([^/]+)\.ts$/.exec(p); return !!m && m[1] === m[2] && !FOUNDATIONS.includes(m[1] as string); }).map(([p, m]) => {
  if (!m.contract) throw new Error(p + ' exports no contract');
  return m.contract;
});
const FOLDERS = readdirSync(HERE, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(HERE, d.name, d.name + '.ts')) && !FOUNDATIONS.includes(d.name)).map((d) => d.name);
const read = (folder: string, file: string): string => { const p = join(HERE, folder, file); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };
const SHEET = readFileSync(join(UI, 'src', 'styles', 'tokens.v7.css'), 'utf8');
const DECLARED = new Set([...SHEET.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string));
const BOARDS = Object.keys((JSON.parse(readFileSync(join(UI, 'tests', 'lab', 'boards.json'), 'utf8')) as { boards: Record<string, unknown> }).boards);
const boardKnown = (id: string): boolean => BOARDS.includes(id) || BOARDS.some((b) => b.split('-')[0] === id);

describe('every component has a contract', () => {
  it('each folder with a view exports one, named for its folder', () => {
    expect(CONTRACTS.map((c) => c.folder).sort()).toEqual([...FOLDERS].sort());
  });
  it('every function of kit.html is owned by exactly one contract', () => {
    const owned = CONTRACTS.flatMap((c) => c.exports);
    expect([...owned].sort()).toEqual(Object.keys(kit.html).sort());
    expect(new Set(owned).size).toBe(owned.length);
  });
  it('names are unique and the layers are the kit\'s', () => {
    expect(new Set(CONTRACTS.map((c) => c.name)).size).toBe(CONTRACTS.length);
    for (const c of CONTRACTS) expect(LAYERS, c.name).toContain(c.layer);
  });
});

describe.each(CONTRACTS.map((c) => [c.name, c] as const))('the contract of %s', (_name, c) => {
  const view = read(c.folder, c.folder + '.ts'), behaviour = read(c.folder, 'behaviour.ts') + read(c.folder, 'editing.ts'), css = read(c.folder, c.folder + '.css');
  it('says what it is and how a keyboard and a screen reader meet it', () => {
    expect(c.summary.length).toBeGreaterThan(20);
    expect(c.a11y.length).toBeGreaterThan(20);
    expect(c.folder).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
  it('is the component its root says it is (data-kit)', () => {
    expect(view.includes("kitAttrs('" + c.name + "'") || view.includes("blockAttrs('" + c.name + "'")).toBe(true);
  });
  it('names only events of the event map, and the ones its behaviour dispatches', () => {
    for (const e of c.events) expect(UI_EVENTS, e).toContain(e);
    const fired = [...behaviour.matchAll(/emit\(\w+, (?:\w+ \? )?'(ui:[\w-]+)'(?: : '(ui:[\w-]+)')?/g)].flatMap((m) => [m[1], m[2]]).filter((x): x is string => !!x);
    for (const e of fired) expect(c.events, c.name + ' dispatches ' + e).toContain(e);
  });
  it('lists the tokens its CSS reads, each one the v7 token sheet declares', () => {
    for (const t of c.tokens) expect(DECLARED.has(t), t + ' is not declared in tokens.v7.css').toBe(true);
    const read = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] as string).filter((t) => DECLARED.has(t)));
    expect([...read].filter((t) => !c.tokens.includes(t as `--${string}`)), 'tokens its CSS reads and its contract leaves out').toEqual([]);
  });
  it('names boards the lab compares (tests/lab/boards.json)', () => {
    for (const b of c.boards) expect(boardKnown(b), b).toBe(true);
  });
  it('names parts the code draws', () => {
    for (const p of c.parts) {
      const id = p.split(' ')[0] as string;
      if (/^k7-|^orb-avatar$/.test(id)) expect(view.includes(id) || css.includes(id), id).toBe(true);
      else expect(view.includes("'" + id + "'") || view.includes('"' + id + '"'), id).toBe(true);
    }
  });
  it('describes every prop', () => {
    for (const [k, v] of Object.entries(c.props)) expect(String(v).length, k).toBeGreaterThan(2);
  });
});
