/* The lab's report: lab-report/summary.json (machine-readable) and lab-report/index.html (every failing check by
   area, with a crop of the state, the place it showed, and the v6 mock's counterpart). Gitignored. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function writeReport(dir, run) {
  const fail = run.findings.filter((x) => x.severity !== 'warn');
  const warn = run.findings.filter((x) => x.severity === 'warn');
  const byArea = {}, byCheck = {}, byAreaCheck = {};
  for (const x of [...fail, ...run.static]) {
    byArea[x.area] = (byArea[x.area] ?? 0) + 1;
    byCheck[x.check] = (byCheck[x.check] ?? 0) + 1;
    (byAreaCheck[x.area] ??= {})[x.check] = (byAreaCheck[x.area][x.check] ?? 0) + 1;
  }
  const summary = {
    generated: run.generated, seconds: run.seconds, presets: run.presets, widths: run.widths, area: run.area, story: run.story,
    stories: run.stories, states: run.states, failures: fail.length + run.static.length, warnings: warn.length,
    byArea, byCheck, byAreaCheck,
    findings: [...fail, ...run.static].map((x) => ({ area: x.area, check: x.check, rule: x.rule ?? null, story: x.story ?? null, state: x.state ?? null, file: x.file ?? null, line: x.line ?? null, msg: x.msg, el: x.el ?? null, where: x.where ?? null, crop: x.crop ?? null, mock: x.mockShot ?? null, diff: x.diff ?? null })),
    warnings_list: warn.map((x) => ({ area: x.area, check: x.check, story: x.story, state: x.state, msg: x.msg, el: x.el }))
  };
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1));

  const areas = Object.keys(run.areas).filter((a) => byArea[a]);
  const card = (x) => `<article class="f"><header><b>${esc(x.check)}</b>${x.rule ? ` <code>${esc(x.rule)}</code>` : ''} <span class="where">${esc(x.story)} · ${esc(x.state)}</span></header>
    <p>${esc(x.msg)}</p>${x.el ? `<p class="el"><code>${esc(x.el)}</code>${x.label ? ' “' + esc(x.label) + '”' : ''}</p>` : ''}
    <p class="at">seen at ${esc((x.where ?? []).slice(0, 12).join(', '))}${(x.where ?? []).length > 12 ? ' …' : ''}</p>
    <div class="shots">${x.crop ? `<figure><img loading="lazy" src="${esc(x.crop)}" alt=""><figcaption>boopis</figcaption></figure>` : ''}${x.diff ? `<figure><img loading="lazy" src="${esc(x.diff)}" alt=""><figcaption>pixel difference</figcaption></figure>` : ''}${x.mockShot ? `<figure><img loading="lazy" src="${esc(x.mockShot)}" alt=""><figcaption>v6 mock</figcaption></figure>` : ''}</div>
    <p class="open"><a href="http://localhost:5173/lab.html#story=${encodeURIComponent(x.story)}">open in the lab</a> (pnpm lab)</p></article>`;
  const staticRow = (x) => `<tr><td><code>${esc(x.file)}:${x.line}</code></td><td>${esc(x.msg)}</td><td><code>${esc(x.snippet)}</code></td></tr>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>UI lab report</title><style>
  :root{color-scheme:dark;--bg:#181715;--fg:#e9e4da;--dim:#a59d90;--line:#2e2b27;--red:#f0646a}
  body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 system-ui,sans-serif}
  main{max-width:1200px;margin:0 auto;padding:24px 16px 80px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:16px;margin:40px 0 8px;border-top:1px solid var(--line);padding-top:16px} h3{font-size:13px;margin:20px 0 6px;color:var(--dim)}
  table{border-collapse:collapse;width:100%;margin:8px 0} td,th{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
  .f{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0} .f header{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
  .f p{margin:4px 0} .where,.at,.el{color:var(--dim)} .shots{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px}
  figure{margin:0} figure img{max-width:540px;max-height:360px;border:1px solid var(--line);border-radius:6px;background:#000} figcaption{color:var(--dim);font-size:11px}
  code{font:12px ui-monospace,monospace} .n{color:var(--red);font-weight:600} details{margin:8px 0} summary{cursor:pointer}
  </style></head><body><main>
  <h1>UI lab report</h1>
  <p>${run.states} states in ${run.stories} stories · presets ${esc(run.presets.join(', '))} · widths ${esc(run.widths.join(', '))}${run.area ? ' · area ' + esc(run.area.join(', ')) : ''}${run.story ? ' · story ' + esc(run.story) : ''} · ${esc(run.generated)} · ${run.seconds} s</p>
  <p><span class="n">${summary.failures}</span> failures, ${summary.warnings} warnings (tokens.spacing). JSON: <a href="summary.json">summary.json</a>.</p>
  <table><tr><th>Area</th>${Object.keys(run.checks).map((c) => `<th><code>${esc(c)}</code></th>`).join('')}<th>All</th></tr>
  ${areas.map((a) => `<tr><td><a href="#${a}">${esc(run.areas[a])}</a></td>${Object.keys(run.checks).map((c) => `<td>${byAreaCheck[a]?.[c] ?? ''}</td>`).join('')}<td><b>${byArea[a]}</b></td></tr>`).join('')}</table>
  <details><summary>What each check does</summary><table>${Object.entries(run.checks).map(([k, c]) => `<tr><td><code>${esc(k)}</code></td><td>${esc(c.title)}</td><td>${esc(c.how)}</td><td>DESIGN-SYSTEM.md ${esc(c.ds)}${c.rule ? ' · ' + esc(c.rule) : ''}</td></tr>`).join('')}</table></details>
  ${areas.map((a) => {
    const mine = fail.filter((x) => x.area === a), st = run.static.filter((x) => x.area === a);
    const checks = [...new Set(mine.map((x) => x.check))];
    return `<h2 id="${a}">${esc(run.areas[a])} <span class="n">${byArea[a]}</span></h2>` +
      checks.map((c) => `<h3>${esc(c)} (${mine.filter((x) => x.check === c).length})</h3>` + mine.filter((x) => x.check === c).map(card).join('')).join('') +
      (st.length ? `<h3>tokens.static (${st.length})</h3><table>${st.map(staticRow).join('')}</table>` : '');
  }).join('')}
  ${warn.length ? `<h2>Warnings</h2><details><summary>${warn.length} spacing values off the scale</summary><table>${warn.map((x) => `<tr><td>${esc(x.area)}</td><td>${esc(x.story)} · ${esc(x.state)}</td><td><code>${esc(x.el)}</code></td><td>${esc(x.msg)}</td></tr>`).join('')}</table></details>` : ''}
  </main></body></html>`;
  writeFileSync(join(dir, 'index.html'), html);
  return summary;
}
