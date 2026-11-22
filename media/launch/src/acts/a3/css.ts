/* Act 3's few styles: tokens only (the product's, through the look). */
export const A3_CSS = `
.a3-group { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }
.a3-ch { white-space: pre; }
.a3-w { display: inline-block; }
.a3 .sel::before { clip-path: inset(0 calc((1 - var(--sel, 1)) * 100%) 0 0); }
.a3 .sel[data-caret]::after { opacity: var(--caret, 1); }
.a3-roll { display: inline-block; height: 1.45em; overflow: clip; vertical-align: top; }
.a3-roll__strip { display: flex; flex-direction: column; }
.a3-roll__strip > span { display: block; height: 1.45em; line-height: 1.45; }
.a3-bar { position: absolute; display: block; transform-origin: 0 50%; pointer-events: none; }
.a3-bar--s { background: color-mix(in srgb, var(--text) 40%, transparent); }
.a3-bar--m { background: color-mix(in srgb, var(--text) 22%, transparent); }
.a3-bar--q { background: color-mix(in srgb, var(--text) 11%, transparent); }
.a3-bars { position: absolute; left: 0; top: 0; width: 0; height: 0; }
.a3-window .tabs > span { position: relative; z-index: 1; }
.a3-thumb { position: absolute; z-index: 0; display: block; border-radius: inherit; background: var(--selected); }
.a3 .ui-steps .ui-step::before { transform-origin: 50% 0; transform: scaleY(var(--sp, 1)); }
.a3-tl { min-height: 1.5em; }
.a3-caret { display: inline-block; width: .6em; height: 1.1em; vertical-align: -.2em; background: var(--text); }
.a3-marker { position: absolute; border-radius: 999px; background: var(--brass); pointer-events: none; }
.a3-strip { position: absolute; border-radius: 26px; background: var(--bg-0); box-shadow: inset 0 0 0 1px var(--hair); overflow: hidden; }
.a3-strip i { position: absolute; display: block; height: 12px; border-radius: 6px; transform-origin: 0 50%; }
.a3-strip i.o { background: color-mix(in srgb, var(--text) 13%, transparent); }
.a3-strip i.a { background: color-mix(in srgb, var(--add) 42%, transparent); }
`;
