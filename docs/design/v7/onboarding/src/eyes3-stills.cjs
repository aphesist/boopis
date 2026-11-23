// orb3's eye-constraint check (character/probes/tools/eyecheck.py) on the stills: every bot at rest in the pose (the Bots
// sidebar), measured on the rendered 2x screen. node eyes3-stills.cjs <eyecheck.py> <screens dir>
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const { execFileSync } = require('child_process');
const [EC, DIR] = process.argv.slice(2);
const L = JSON.parse(fs.readFileSync(path.join(__dirname, 'screens3.json'), 'utf8')).filter(([s]) => /^o3(B|X04)/.test(s));
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const tmp = fs.mkdtempSync('/tmp/claude-0/-home-user/b86134f0-5066-55eb-9eed-e7bff27da970/scratchpad/eyes-');
  let tot = [0, 0, 0, 0], n = 0;
  for (const [s, q, name] of L) for (const t of ['dark', 'light']) {
    await p.goto('file://' + path.join(__dirname, 'ob3.html') + `?s=${s}&${q}&theme=${t}`); await p.waitForTimeout(300);
    const rects = await p.evaluate(() => [...document.querySelectorAll('orb-avatar[reaction="pose"]')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8, half: 1, bot: e.getAttribute('shape') + '@' + Math.round(r.width), shape: e.getAttribute('shape') }; }));
    if (!rects.length) continue;
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp); fs.copyFileSync(path.join(DIR, `${name}-${t}.jpg`), path.join(tmp, '0000.jpg'));
    fs.writeFileSync(path.join(tmp, 'rects.json'), JSON.stringify({ dpr: 2, rects }));
    const out = execFileSync('python3', ['-I', EC, tmp]).toString().trim().split('\n'); const last = out.pop();
    const m = last.match(/width (\d+), gap (\d+), margin (\d+); merged or hidden (\d+)/); m.slice(1).forEach((v, i) => { tot[i] += +v; }); n += rects.length;
    console.log(`${name}-${t}: ${rects.length} pose orbs; ${last}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`ALL: ${n} pose orbs; below floors: width ${tot[0]}, gap ${tot[1]}, margin ${tot[2]}; merged or hidden ${tot[3]}`); await b.close(); })();
