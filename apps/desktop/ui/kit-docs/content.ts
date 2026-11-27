/* The article's own words: the chapters in the kit's dependency order, the rule each one teaches, and the prompts for agents. The rest
   of the page is read from the component folders (their contracts, files and stories) and from docs/kit/*.md. */
import type { Layer } from '../src/components/v7/contract';

export interface Chapter { id: string; title: string; layers: readonly Layer[]; rule: string; more?: string }

/** in dependency order: each chapter uses only what the ones before it taught */
export const CHAPTERS: readonly Chapter[] = [
  { id: 'controls', title: 'Base controls', layers: ['control', 'inline'],
    rule: '<strong>A control draws its state, and its behaviour changes it in place.</strong> Every control is a native element named by its words. Pressed, chosen or on is an ARIA attribute the view writes from props; a press flips it and dispatches one <code>ui:</code> event, cancelable where an action follows.',
    more: 'The inline pieces sit in running text and never make a line taller: a chip, a mark, a status word. They have no behaviour of their own except the Mark, which opens what it means.' },
  { id: 'rows', title: 'Rows and fields', layers: ['row'],
    rule: '<strong>A row is one line, and its name never wraps.</strong> A row or a field is built from controls: a label, a value or a control at its end. A row that acts is one tab stop, pressed with Enter or Space; a list of rows is one tab stop, and the arrows move inside it.' },
  { id: 'blocks', title: 'Blocks and surfaces', layers: ['block', 'surface'],
    rule: '<strong>A surface holds rows; its corner is the outer radius less its inset.</strong> A Block is 22 with an 8 inset, so the 28 controls in its corners are concentric with it. A surface never knows what it holds: it takes markup from the kit, and the corner, the line and the fill come from tokens.' },
  { id: 'thread', title: 'The thread', layers: ['thread'],
    rule: '<strong>A turn is drawn from what the engine reported, and only that.</strong> A tool call, an ask, a changed file or a reply is a component fed by a Source; unknown is shown as unknown. An answer comes back as an event, and the screen turns it into a command.' },
  { id: 'compose', title: 'The composer', layers: ['compose'],
    rule: '<strong>The composer keeps its own editing, and the app keeps the rest.</strong> Undo, chips, paste, dropped files and the mic are the composer\'s (behaviour.ts and editing.ts). What a message means, where a file goes and what the mic hears are the app\'s: they come in as props and go out as events.' },
  { id: 'dock', title: 'The dock', layers: ['dock'],
    rule: '<strong>One component, three geometries, black in every theme.</strong> The dock is a row, a compact row or open; its height, corner, flares, padding and orb size never change, and its width fits its content. Its inside is the dark theme.' },
  { id: 'notify', title: 'Notices', layers: ['notify'],
    rule: '<strong>One line about the app, at most two actions, one at a time.</strong> A Notice above the composer, in a page, or floating: polite unless it is red. Opened at a control, it says why the control cannot act yet and offers the one way on.' }
];

export interface Prompt { id: string; title: string; text: string }
export const PROMPTS: Record<'component' | 'state' | 'source', Prompt> = {
  component: { id: 'prompt-component', title: 'Add a component', text: `Add a component to the boopis v7 kit (apps/desktop/ui/src/components/v7/). Read docs/kit/RULES.md and docs/kit/TERMS.md first.
1. Check the approved boards and the kit: prefer a new prop or variant of an existing component to a new one.
2. Make the folder components/v7/<name>/ (the public name in kebab-case) with:
   - <name>.ts: an exported <Name>Opts interface and a view function that returns markup, kitAttrs('<Name>') on its root, partAttrs on named parts, state in ARIA and data attributes; and under it export const contract = defineContract<<Name>Opts>({ ... }) describing every prop, its events, states, parts, tokens, a11y and boards.
   - behaviour.ts (only if it has keys, focus or pointer behaviour): a wire function that changes attributes in place and dispatches through emit() from events.ts; add new events to UiEvents first; add one line to WIRES in wire.ts.
   - <name>.css: tokens only; import it in kit-v7.css after what it builds on.
   - <name>.stories.ts (id kit/<name>: typical, long, the forced hover, focus and pressed states) and <name>.test.ts with describe('story: <Name>') and describe('scene: <Name>').
3. Export it from components/v7/index.ts (html, its type, its variants).
4. Run pnpm typecheck, pnpm test, pnpm lab:static, pnpm lab:check --story kit/<name>, and pnpm kit:docs. No visual change to anything else.` },
  state: { id: 'prompt-state', title: 'Add a state', text: `Add a state to a component of the boopis v7 kit. Read docs/kit/STATE.md first and decide where the state lives: the element (ARIA or data attributes), the screen module, a Source (src/data/provider.ts) or the host.
If it is the element's:
1. Draw it in the view from a prop (an aria-* or data-* attribute on the root or the part it belongs to); describe the prop in the contract and add the attribute to the contract's states.
2. If a person changes it, change it in the folder's behaviour.ts in place (never redraw) and dispatch the matching ui: event through emit(), cancelable when an action follows; a cancelled event leaves the state as it was.
3. Style it in <name>.css from tokens, selected by the attribute.
4. Add a story state to <name>.stories.ts, a story case (props to the attribute) and a scene case (the key or click to the event and the attribute) to <name>.test.ts.
5. Run pnpm typecheck, pnpm test and pnpm lab:check --story kit/<name>.` },
  source: { id: 'prompt-source', title: 'Wire a Source', text: `Wire a Source to a screen in the boopis desktop UI. Read docs/kit/STATE.md and docs/kit/RULES.md (props down, events up) first.
1. Declare the Source in src/data/provider.ts: a Watch (a value that changes), a Feed (a snapshot and the events after it) or commands that return when the provider accepted them. Unknown is null; nothing is invented.
2. Implement it in both providers (the mock and the live one), with tests.
3. In the screen module, read the Source and draw kit components from its values (props down): kit.<name>({ ... }). Draw again when the value changes.
4. Listen once on the screen's container for the components' ui: events (kit.on(root, 'ui:change', ...)) and turn each into a command on the Source (events up). Do not import a component's file; use @boopis/ui.
5. The component does not change: it gets props and dispatches events. Keep the screen's own arrangement (which card is open) in the module, never a copy of the Source's data.
6. Run pnpm typecheck, pnpm test, and the module's lab stories.` }
};
