// Builds the two probe variants of orb2 from the owner's source (aphesist/orb2, orb-avatar.js at 03d9094):
//   lib/orb-avatar.snap.js   the clarity fixes only (ORBS.md, part 1: C1-C4)
//   lib/orb-avatar.tuned.js  the clarity fixes and the animation tuning (ORBS.md, part 2: T1-T5)
// Every change is a literal replacement of one line of orb2; the script stops if a line is not found, so it cannot
// silently drift from the source. Usage: node gen-variants.cjs /path/to/orb2/orb-avatar.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(process.argv[2] || '/home/user/orb2/orb-avatar.js', 'utf8');
const rep = (s, [from, to, id]) => { if (!s.includes(from)) throw new Error('not found: ' + id); return s.split(from).join(to); };

const SNAP = [
  // C1: the canvas is placed by script on whole device pixels (no translate(-50%,-50%), no fractional CSS size)
  ["canvas{position:absolute;left:50%;top:50%;width:${(CANVAS_SCALE * 100).toFixed(2)}%;height:${(CANVAS_SCALE * 100).toFixed(2)}%;transform:translate(-50%,-50%);pointer-events:none}",
   "canvas{position:absolute;left:0;top:0;pointer-events:none}", 'C1 css'],
  // C2: the backing store always matches the screen (the quality ladder keeps its stride and half rate, not a lower dpr)
  ["    const dpr = Math.min(window.devicePixelRatio || 1, LEVELS[Q.level].dpr);\n    const px = Math.max(0, Math.round(this._cssW * CANVAS_SCALE * dpr));\n    if (px !== this._cw) { this._canvas.width = this._canvas.height = px; this._cw = px; this._sig = null; }\n  }",
   "    const dpr = window.devicePixelRatio || 1;\n    const px = Math.max(0, Math.round(this._cssW * CANVAS_SCALE * dpr));\n    if (px !== this._cw) { this._canvas.width = this._canvas.height = px; this._cw = px; this._sig = null; }\n    this._snap();\n  }\n" +
   "  _snap() {\n    const dpr = window.devicePixelRatio || 1, px = this._cw, cs = this._canvas.style;\n    if (!px || !cs || !this.isConnected) return;   // an OffscreenCanvas (the worker) has no style: the page places it\n    const r = this.getBoundingClientRect(), hx = r.left * dpr, hy = r.top * dpr, b = this._cssW * dpr;\n" +
   "    const ox = Math.round(hx + b / 2 - px / 2) - hx, oy = Math.round(hy + b / 2 - px / 2) - hy;\n    cs.width = cs.height = px / dpr + 'px'; cs.left = ox / dpr + 'px'; cs.top = oy / dpr + 'px';\n  }", 'C2 fit'],
  // C3: re-snap when layout moves (the loop already counts scroll and resize in layoutVer) and refit when the dpr changes
  ["  const bump = () => { layoutVer++; };",
   "  const bump = () => { layoutVer++; for (const o of live) o._snap(); };\n  const watchDpr = () => matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { for (const o of live) { o._fit(); o._sig = null; } watchDpr(); }, { once: true });\n  watchDpr();", 'C3 bump'],
];
const TUNE = [
  // T1: a blink as long as Grok-Bot's (0.20 s, was 0.155 s)
  ["    const bl = (t - this._blinkAt) / .155;", "    const bl = (t - this._blinkAt) / .2;", 'T1 blink'],
  // T2: calm idle glances and comes back: a glance (0.7-1.5 s) then the rest pose (1.6-3.8 s), smaller turns
  ["        this._idYaw = g[0] + (Math.random() * 2 - 1) * .38;\n        this._idPitch = g[1] + (Math.random() * 2 - 1) * .24;\n        this._idRoll = (Math.random() * 2 - 1) * .10;\n        this._idNext = t + 1.8 + Math.random() * 2.4;",
   "        const back = this._idStep % 2 === 0;\n        this._idYaw = back ? g[0] : g[0] + sgn() * (.2 + Math.random() * .22);\n        this._idPitch = back ? g[1] : g[1] + (Math.random() * 2 - 1) * .16;\n        this._idRoll = back ? 0 : (this._idYaw - g[0]) * .12;\n        this._idNext = t + (back ? 1.6 + Math.random() * 2.2 : .7 + Math.random() * .8);", 'T2 calm'],
  // T3: the micro-drift on a held calm pose is a quarter of the lively one (the pose holds, as Grok-Bot's does)
  ["      yaw: this._idYaw + .05 * Math.sin(t * 1.1 + ph),\n      pitch: this._idPitch + .04 * Math.cos(t * 1.35 + ph * 1.4),\n      roll: this._idRoll + .025 * Math.sin(t * 0.95 + ph * 2),",
   "      yaw: this._idYaw + (this._idleMotion === 'calm' ? .25 : 1) * .05 * Math.sin(t * 1.1 + ph),\n      pitch: this._idPitch + (this._idleMotion === 'calm' ? .25 : 1) * .04 * Math.cos(t * 1.35 + ph * 1.4),\n      roll: this._idRoll + (this._idleMotion === 'calm' ? .25 : 1) * .025 * Math.sin(t * 0.95 + ph * 2),", 'T3 drift'],
  // T4: no float or breath under 44 px (the same threshold orb2 already uses for its outline stride): no sub-pixel swim
  ["    const floatOn = !calm && !fixed && this._idleMotion !== 'off';", "    const floatOn = !calm && !fixed && this._idleMotion !== 'off' && this._cssW >= 44;", 'T4 float'],
  // T5: the rest gaze faces front (was 8 degrees right, 4.6 up)
  ["const g = this._gaze || [.14, .08];", "const g = this._gaze || [0, .05];", 'T5 gaze'],
];
const out = path.join(__dirname, 'lib');
fs.writeFileSync(path.join(out, 'orb-avatar.snap.js'), SNAP.reduce(rep, src));
fs.writeFileSync(path.join(out, 'orb-avatar.tuned.js'), TUNE.reduce(rep, SNAP.reduce(rep, src)));
console.log('ok', SNAP.length, 'clarity and', TUNE.length, 'tuning changes');
