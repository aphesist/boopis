# boopis mock-up v6 — shared contract for the five agents

Root: /tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/v6/  (all paths below are relative to it)

## The owner's brief (verbatim intent)
- The program has TWO TABS: **session** and **bots** (the pill toggle top-left of the sidebar in the Figma frame).
- The DOCK sits at the BOTTOM, flush to the window's bottom edge with concave flares (Panacea's notch, upside down).
  It is MULTIFUNCTIONAL, like Panacea's island: page 1 is the bot dock (like the Grok Bot dock — orbs of the bots, a "+"),
  other pages hold other widgets (page dots under it, as in the Figma). It morphs/expands; everything inside travels with it.
- The dock is ALWAYS CENTRED WITH THE CHATBOX: when sidebars open/close, it moves with the composer.
- The dock is toggleable on/off. Nothing in the UI may depend on it (everything it shows is reachable elsewhere).
- Bots are drawn with **aphesist/orb2** (`vendor/orb-avatar.min.js`, the `<orb-avatar>` web component — read
  `vendor/orb2-README.md` and `vendor/orb-avatar.d.ts`; open `vendor/orb-avatar.js` for behaviour). Inspect how it works first.
- Everything else follows what normal harnesses (Claude Code desktop, Codex, Antigravity) already do: standard, clean.
- Antigravity-like restraint: things don't appear unless needed. RIGHT SIDEBAR: collapsed it shows only a quiet context
  measure (dots/circles, not a big bar); opened it shows everything: Context, Connectors (MCP), Output, Environment,
  Tasks/todo, Changes, Governance… (like Claude Code's panels).
- Cards (approval, ship result, blank, teammate…) must feel PLACED IN with the rest of the system. The Gemini mock-up's
  heavy dither looks out of place. Dither may survive only if it is subtle and integrated, or not at all — cards agent decides.
- All references are INSPIRATION ONLY (palette, organisation): don't copy. Focus on the owner's ideas.
- The coding agent has NO name: answers show only the model ("sonnet 5.5", "qwen3-coder → sonnet 5.5"). Bots/teammates have names + orbs.
- Brand: φ mark (white/neutral in the Figma top-left), lowercase "boopis". Red is only for attention (blank waiting,
  approval, failure) — the Figma shows a red dot on the open blank.

## FRESH START (owner, latest)
Throw every earlier boopis mock-up we made out of the window: make something completely new. It must feel TASTEFUL and THOUGHTFUL, neat and professional. Do not reuse code, layouts or styling from earlier mock-ups. Before designing, read `/mnt/skills/public/frontend-design/SKILL.md` and follow it; when reviewing your screenshots, run the `design:design-critique` skill (Skill tool) on them and act on its findings; use `design:accessibility-review` before you report. The owner's favourite design skills are now installed and MANDATORY: Impeccable at `/root/.claude/skills/impeccable/SKILL.md` (an app UI is its "Operate" mode: precision and restraint; read its references for your job: craft, layout, typeset, animate, polish, critique, component-review, quieter) and Taste at `/root/.claude/skills/taste-skill/SKILL.md` (built for websites; apply its anti-slop rules, copy rules, cards and motion references to an app UI). Read both SKILL.md files and the references relevant to your piece before designing further, and run Impeccable's critique/audit on your result. If the skill tool lists them (`impeccable`, `design-taste-frontend`), invoke them with the Skill tool; otherwise read the files directly.

## References (in ref/)
- `figma-694-149.png` — THE owner's current design (1920×1080). Primary reference. `dock-crop.png`, `top-left-crop.png` zooms.
- `grokbot-new-bot.png` — Grok Bot's "new bot" screen (orb preview, colour + shape pickers, name, suggestions). Bots tab inspiration.
- `gemini-mockup_v3.html` — the owner's Gemini mock-up (inspiration, don't copy; its dither is too heavy).
- `taste-a-closed.png`, `taste-b-dock-open.png`, `taste-c-sidebar-collapsed.png` — the owner's previous Figma iteration.
- `halftone-card-reference.png` — the 1-bit card the owner liked originally.
- `s.png`, `desktop.png`, `calendar.png`, `settings.png` — Panacea Shell (Nothing-OS-inspired island) screenshots.

## Palette sampled from the Figma frame (starting tokens — tokens.css)
- `--bg-0 #000000` dock, cards · `--bg-1 #0b0b0b` window chrome, sidebars, composer · `--bg-2 #111111` main ground
- `--bg-3 #1f1f1f` user bubble, raised · `--chip #1c1c1c` inline code chips · text `#e8e8e8`, dim `#8f8f8f`, faint `#4a4a4a`
- hairline `rgba(255,255,255,.07)` · attention red `#e5484d` (to refine) · Type: Geist Mono throughout (as the Figma), Google Fonts.
- Dark is the primary theme. A light mirror is optional; keep tokens so it's possible.

## Files and owners (each agent writes ONLY its own files)
| File(s) | Owner |
|---|---|
| `index.html`, `shell.css`, `shell.js`, `tokens.css` | wireframe agent (also integrates at the end) |
| `dock.js`, `dock.css`, `dock.test.html` | dock agent |
| `session.js`, `session.css`, `session.test.html` (session tab + right sidebar + composer) | session agent |
| `bots.js`, `bots.css`, `bots.test.html` (bots tab) | bots agent |
| `cards.js`, `cards.css`, `cards.test.html` (card system + gallery) | cards agent |
| `data.js` (shared mock data) | coordinator (already written; propose additions in your report) |
Others' files are read-only to you. Need a token? Add it in your own CSS under your prefix (`--dock-*`, `--ss-*`, `--bt-*`, `--cd-*`) and list it in your report so the wireframe agent can promote it.

## Runtime API (vanilla JS, no framework, no build step)
`shell.js` defines `window.HX` FIRST; every module file then registers itself. Until the shell exists, each agent's
`*.test.html` includes `tokens.css` (or a copy of the values), `data.js` and a tiny stub of HX with the same API.

```js
window.HX = {
  state: { tab: 'session'|'bots', left: 'open'|'rail'|'closed', right: 'closed'|'open', dock: 'on'|'off', theme: 'dark' },
  on(type, fn), off(type, fn), emit(type, detail),   // a tiny event bus (EventTarget under the hood)
  register(name, { mount(root, HX) }),               // shell calls mount(root) with the module's slot element
  setState(patch),                                   // shell applies + emits 'hx:state' {state, changed}
  cards: null,                                       // set by cards.js: HX.cards.create(kind, data) -> HTMLElement
  data: window.HX_DATA                               // from data.js
};
```
Slots the shell provides (module mounts into its slot):
- `#hx-sidebar-list` → owned by session.js when tab=session, by bots.js when tab=bots (each renders its own list; register as
  `session-list` / `bots-list`).
- `#hx-view-session` → `session` (conversation column + composer), `#hx-view-bots` → `bots`.
- `#hx-right` → `session-right` (right sidebar: collapsed context dots + expanded panels).
- `#hx-dock` → `dock`.
Events:
- `hx:layout` {centerX, colLeft, colWidth, viewportW, viewportH} — emitted by the shell on every layout change (sidebars,
  resize, tab). The composer and the dock centre themselves on `centerX`. Animate with the same spring.
- `hx:state` — any state change. `hx:tab` {tab}. `hx:bot-select` {id} (dock or bots list picked a bot).
- `hx:attention` {source, count} — something needs the user (blank, approval); the dock/right bar/sidebar can show a dot.
- `hx:open-panel` {panel} — ask the right sidebar to open a panel (e.g. 'context', 'connectors').
Shared motion: `--ease: cubic-bezier(.2,.8,.2,1)`; springs `--spring: cubic-bezier(.3,1.15,.4,1)`; honour prefers-reduced-motion.

## Delivery rules for every agent
- Vanilla HTML/CSS/JS; Google Fonts only for fonts; no other CDNs (orb2 is local in vendor/).
- localStorage only inside try/catch. No network calls.
- Test with Playwright (pre-installed: `require('playwright')`, `chromium.launch()`), deviceScaleFactor 1, at 1920×1080 and
  1440×900 (and 390 wide if your piece is visible on phones). Fix console errors. Save screenshots in `shots/<your-module>/`.
- Look at your screenshots next to `ref/figma-694-149.png` and judge them honestly: is it tasteful, calm, consistent with
  the owner's design? Iterate at least twice.
- Report: files written, screenshots, decisions you made (and why), tokens you added, open questions, under 350 words.
