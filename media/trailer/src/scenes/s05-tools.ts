/* 5. No pile of tools (bars 16 to 18). A wall of the generic tool names agents usually carry, crowding the frame; it
   collapses into boopis's three: pack reads, exec computes in a sandbox, ship is the only way to write. Then exec's
   sandbox draws itself and ship ends at the gate: failed, rolled back, passed. */
import { ui } from '@boopis/ui';
import type { SceneDef } from '../engine/stage';
import { el, line, kinetic } from '../engine/stage';
import { EASE, SPRING, EASE_IO, step, clamp, lerp, noise } from '../engine/motion';
import { bar, BEAT, sfx } from '../engine/common';

const TOOLS = ('read_file write_file edit_file multi_edit apply_patch str_replace create_file delete_file move_file copy_file list_dir glob grep find_files search_files view_range outline ' +
  'list_symbols go_to_definition find_references rename_symbol bash terminal run_command shell kill_process read_output background_task web_fetch web_search http_request ' +
  'browser_open browser_click browser_type screenshot todo_write todo_read notebook_edit notebook_read git_status git_diff git_log git_commit git_checkout git_branch open_pr ' +
  'run_tests lint format install_package env_get env_set memory_read memory_write ask_user spawn_task plan think diagnostics upload download unzip sql_query read_image ' +
  'tail_log watch_files replace_all insert_lines patch_file read_many').split(' ');
const ROWS = 15, ROW_H = 72;
const T0 = bar(16), T_COL = bar(17), T_SAFE = bar(18), T_END = bar(19);
const COLS = [{ x: 400, word: 'pack', label: 'reads' }, { x: 960, word: 'exec', label: 'runs in a sandbox' }, { x: 1520, word: 'ship', label: 'the only way to write' }];

export const tools: SceneDef = {
  id: 'tools', start: T0, end: T_END,
  setup(root, ctx) {
    const wall = el('div', 'abs tw', root);
    const rows: Array<{ el: HTMLElement; words: Array<{ el: HTMLElement; x: number; w: number; tgt: number; d: number }>; speed: number; dir: number; off: number }> = [];
    for (let r = 0; r < ROWS; r++) {
      const row = el('div', 'tw__row', wall);
      row.style.top = (r * ROW_H + 6) + 'px';
      const words = [];
      for (let i = 0; i < 16; i++) {
        const name = TOOLS[(r * 7 + i * 3) % TOOLS.length]!;
        const w = el('span', 'tw__w', row); w.textContent = name;
        if ((r + i) % 5 === 0) w.classList.add('is-q');
        words.push({ el: w, x: 0, w: 0, tgt: 0, d: 0 });
      }
      rows.push({ el: row, words, speed: 38 + 34 * (0.5 + 0.5 * noise(r + 3)), dir: r % 2 ? 1 : -1, off: -300 - 400 * (0.5 + 0.5 * noise(r * 1.7)) });
    }
    const band = el('div', 'abs tw__band', root);
    const h1 = line('no pile of tools.', 'h2', root);
    const h2 = line('three tools.', 'h2', root);
    const h3 = line('sandboxed, and reversible.', 'h2', root);
    const cols = COLS.map((c) => {
      const w = el('div', 'abs tw__tool mono-xl', root); w.textContent = c.word;
      const l = el('div', 'abs tw__label', root); l.textContent = c.label;
      return { ...c, w, l };
    });
    /* exec's sandbox: a dashed boundary that draws itself, with its edges named */
    const box = el('div', 'abs tw__box', root, '<svg width="560" height="330" viewBox="0 0 560 330"><rect x="2" y="2" width="556" height="326" rx="30" ry="30" fill="none" stroke="var(--line-strong)" stroke-width="2" stroke-dasharray="10 9"/></svg>');
    const rect = box.querySelector('rect') as SVGRectElement;
    const edges = ['network off', 'workspace read-only, secrets left out'].map((s) => { const e = el('div', 'abs tw__edge', root); e.textContent = s; return e; });
    /* ship's gate */
    const gate = el('div', 'abs tw__gate', root);
    const gateStates = [
      ['<span class="tw__mono">npm test</span><span class="tw__run"></span>', T_SAFE + 0.15],
      [ui.html.stamp('failed') + '<span class="tw__mono tw__q">invoice.test.ts</span>', T_SAFE + 0.6],
      ['<span class="tw__mono">rolled back, byte for byte</span>', T_SAFE + 1.0],
      ['<span class="tw__mono tw__ok">142 passed</span>', T_SAFE + 1.5]
    ] as const;
    const packNote = el('div', 'abs tw__edge', root); packNote.textContent = 'files, symbols, diffs; secrets redacted';

    sfx(T0, 'riser', { len: T_COL - T0 }); sfx(T0, 'board', { len: T_COL - T0 - 0.2 });
    sfx(T_COL - 0.3, 'suck'); COLS.forEach((_, i) => sfx(T_COL + i * BEAT, 'hit', { n: i }));
    sfx(T_SAFE, 'draw'); sfx(gateStates[1][1], 'thud'); sfx(gateStates[2][1], 'rewind'); sfx(gateStates[3][1], 'chime');

    let measured = false;
    const rowX = (r: (typeof rows)[number], t: number): number => {
      const tt = Math.min(t, T_COL) - T0;
      return r.off + r.dir * (r.speed * tt + 26 * tt * tt);
    };
    return (t) => {
      if (!measured) {
        measured = true;
        rows.forEach((r, ri) => r.words.forEach((w, i) => {
          w.x = w.el.offsetLeft; w.w = w.el.offsetWidth;
          w.tgt = (ri * 16 + i) % 3; w.d = 0.3 * (0.5 + 0.5 * noise(ri * 31 + i * 7));
        }));
      }
      /* the wall: rows fade in from the middle out, drift, then every word flies into its column */
      rows.forEach((r, ri) => {
        const x = rowX(r, t);
        r.el.style.transform = `translateX(${x}px)`;
        const fromMid = Math.abs(ri - (ROWS - 1) / 2);
        r.el.style.opacity = String(step(t, T0 + fromMid * 0.04, 0.35, EASE));
        const ry = ri * ROW_H + 6 + 22;
        r.words.forEach((w) => {
          const p = step(t, T_COL - 0.32 + w.d, 0.42, EASE_IO);
          const c = COLS[w.tgt]!;
          const dx = (c.x - (x + w.x + w.w / 2)) * p, dy = (500 - ry) * p;
          w.el.style.transform = `translate(${dx}px, ${dy}px) scale(${1 - 0.85 * p})`;
          w.el.style.opacity = String(1 - clamp((p - 0.6) / 0.4));
        });
      });
      wall.style.visibility = t < T_COL + 0.3 ? 'visible' : 'hidden';
      band.style.opacity = String(step(t, T0 + 0.5, 0.4, EASE) * (1 - step(t, T_COL - 0.4, 0.3, EASE)));
      kinetic(h1, t, T0 + 0.6, T_COL - 0.45);
      kinetic(h2, t, T_COL + 0.05, T_SAFE - 0.25);
      kinetic(h3, t, T_SAFE, T_END - 0.3);
      for (const h of [h1, h2, h3]) { h.style.left = '50%'; h.style.translate = '-50% 0'; }
      h1.style.top = '492px'; h2.style.top = '150px'; h3.style.top = '150px';
      /* the three, on the beats */
      cols.forEach((c, i) => {
        const at = T_COL + i * BEAT;
        const p = step(t, at, 0.5, SPRING), out = step(t, T_END - 0.35, 0.3, EASE);
        c.w.style.transform = `translate(${c.x}px, ${500 + (1 - p) * 26}px) translate(-50%, -50%) scale(${lerp(1.18, 1, p)})`;
        c.w.style.opacity = String(clamp(p * 1.5) * (1 - out));
        c.w.style.visibility = t >= at ? 'visible' : 'hidden';
        const lp = step(t, at + 0.12, 0.5, SPRING);
        c.l.style.transform = `translate(${c.x}px, ${590 + (1 - lp) * 16}px) translate(-50%, 0)`;
        c.l.style.opacity = String(lp * (1 - out));
      });
      /* the sandbox draws itself around exec */
      const d = step(t, T_SAFE, 0.8, EASE_IO), bo = 1 - step(t, T_END - 0.35, 0.3, EASE);
      const len = 2 * (556 + 326);
      rect.style.strokeDashoffset = String(len * (1 - d));
      rect.setAttribute('stroke-dasharray', d < 1 ? `${len * d} ${len}` : '10 9');
      box.style.transform = 'translate(680px, 380px)'; box.style.opacity = String(bo * clamp(d * 4));
      box.style.visibility = t >= T_SAFE ? 'visible' : 'hidden';
      const ep: Array<[number, number]> = [[960, 381], [960, 709]];
      edges.forEach((e, i) => {
        const p = step(t, T_SAFE + 0.4 + i * 0.15, 0.4, SPRING);
        const [x, y] = ep[i]!;
        e.style.transform = `translate(${x}px, ${y + (1 - p) * 8}px) translate(-50%, -50%)`;
        e.style.opacity = String(p * bo); e.style.visibility = t >= T_SAFE ? 'visible' : 'hidden';
      });
      const pp = step(t, T_SAFE + 0.3, 0.4, SPRING);
      packNote.style.transform = `translate(400px, ${680 + (1 - pp) * 8}px) translate(-50%, -50%)`; packNote.style.opacity = String(pp * bo);
      packNote.style.visibility = t >= T_SAFE ? 'visible' : 'hidden';
      /* the gate under ship */
      let cur = -1; gateStates.forEach(([, at], i) => { if (t >= at) cur = i; });
      if (cur >= 0 && gate.dataset['s'] !== String(cur)) { gate.dataset['s'] = String(cur); gate.innerHTML = gateStates[cur]![0]; }
      const gp = step(t, gateStates[0][1], 0.35, SPRING);
      const pulse = cur >= 0 ? 1 - step(t, gateStates[cur]![1], 0.25, EASE) : 0;
      gate.style.transform = `translate(1520px, ${680 + (1 - gp) * 10}px) translate(-50%, -50%) scale(${1 + pulse * 0.04})`;
      gate.style.opacity = String(gp * bo); gate.style.visibility = t >= gateStates[0][1] ? 'visible' : 'hidden';
      const run = gate.querySelector('.tw__run') as HTMLElement | null;
      if (run) run.style.opacity = String(0.35 + 0.65 * (0.5 + 0.5 * Math.sin((t - T_SAFE) * Math.PI * 2 / 1.8)));
      void ctx;
    };
  }
};
