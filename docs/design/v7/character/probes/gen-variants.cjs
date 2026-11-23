// Builds the two probe variants of orb2 from the owner's source (aphesist/orb2, orb-avatar.js at 03d9094):
//   lib/orb-avatar.snap.js   the clarity fixes only (ORBS.md, part 1: C1-C3, C7, C8, G1-G3)
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
  // C8: the outline and the eyes keep every point at every size and quality level. orb2 drops every second point under
  // 44 px and on ladder levels 1-2, and a turned body (a glance, a rim peek) then shows straight chords across its corners
  ["    const stride = Math.max(LEVELS[Q.level].stride, this._cssW < 44 ? 2 : 1);", "    const stride = 1;", 'C8 stride'],
  // G1: a turned body keeps a clean outline. orb2 traces a turned extruded body (squircle, hexagon, wide, tall...) by
  // casting 160 rays from its pole against the swept spine discs and the bitangents between them, filtered by which way
  // they face; on a far turn that misses parts of the outline and leaves dents and steps along the edges and a bite out
  // of the side the eyes sit on (probes/turn.html). Every such body whose front outline is convex is convex in 3D, so its
  // exact silhouette is the hull of its projected discs: taken here from the support function, as orb2 already does for
  // its convex solids (solidOutline). Non-convex bodies (flower, clover, star, cloud...) keep the ray cast.
  ["function compileBodyShape(rawPts, opts = {}) {",
   "function polyConvex(P) {\n  let sgn = 0;\n  for (let i = 0, n = P.length; i < n; i++) {\n    const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n];\n    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);\n    if (Math.abs(cr) < 1e-7) continue;\n    if (!sgn) sgn = Math.sign(cr); else if (Math.sign(cr) !== sgn) return false;\n  }\n  return true;\n}\nfunction compileBodyShape(rawPts, opts = {}) {", 'G1 helper'],
  ["    pts, spine, slabH, coreR, camber, zHalf, taperY,", "    pts, spine, slabH, coreR, camber, zHalf, taperY, convex: !opts.isCircle && polyConvex(pts),", 'G1 flag'],
  ["  const totalSph = N * nL;",
   "  if (body.convex) {\n    const tot = N * nL, cT = body.coreR * p0;\n    for (let i = 0; i < BODY_N; i += stride) {\n      const nx = RAY_DIRS[i][0], ny = RAY_DIRS[i][1];\n      let best = cT, bx = nx * cT, by = ny * cT;\n      for (let k = 0; k < tot; k++) {\n        const h = _QX[k] * nx + _QY[k] * ny + _AK[k];\n        if (h > best) { best = h; bx = _QX[k] + nx * _AK[k]; by = _QY[k] + ny * _AK[k]; }\n      }\n      let x = (ox0 + bx) * s, y = (oy0 + by) * s;\n      if (jiggle) { const jr = jellyScale(jx, Math.atan2(y, x)); x *= jr; y *= jr; }\n      if (flat > 0 && y > fy) y = fy + (y - fy) * .28;\n      out.push([x + dxOff, y + dyOff]);\n    }\n    return { pts: out, dx: dxOff, sh: dyOff };\n  }\n  const totalSph = N * nL;", 'G1 hull'],
  // G2: the eyes stay on the visible face on a far turn: a group the turn carries past the outline slides back inside it
  // instead of being cut by the body's clip (keepOnFace, below drawFaceCells' projection; the contour is passed in warp)
  ["    for (const cell of grp) {\n      const op0 = cell.op ?? 1;\n      if (op0 <= .01) continue;\n      const P = cell.pts, n = P.length;\n      c.beginPath();\n      for (let i = 0; i < n; i += stride) {\n        const p = projEye3D(P[i][0], P[i][1], localFr, M, body, faceScale);\n        let X = p[0] * warp.s, Y = p[1] * warp.s;\n        if (jiggle) {\n          const r = jellyScale(jx, Math.atan2(Y, X));\n          X *= r; Y *= r;\n        }\n        X += warp.dx;\n        Y += warp.sh;\n        i ? c.lineTo(X, Y) : c.moveTo(X, Y);\n      }\n      c.closePath();",
   "    const gp = [];\n    for (const cell of grp) {\n      const P = cell.pts, n = P.length, q = [];\n      if ((cell.op ?? 1) > .01) for (let i = 0; i < n; i += stride) {\n        const p = projEye3D(P[i][0], P[i][1], localFr, M, body, faceScale);\n        let X = p[0] * warp.s, Y = p[1] * warp.s;\n        if (jiggle) {\n          const r = jellyScale(jx, Math.atan2(Y, X));\n          X *= r; Y *= r;\n        }\n        q.push([X + warp.dx, Y + warp.sh]);\n      }\n      gp.push(q);\n    }\n    keepOnFace(gp, warp);\n    for (let ci = 0; ci < grp.length; ci++) {\n      const cell = grp[ci], q = gp[ci];\n      const op0 = cell.op ?? 1;\n      if (op0 <= .01 || !q.length) continue;\n      c.beginPath();\n      for (let i = 0; i < q.length; i++) i ? c.lineTo(q[i][0], q[i][1]) : c.moveTo(q[i][0], q[i][1]);\n      c.closePath();", 'G2 loop'],
  ["function drawFaceCells(", "/* G2: an eye group that a far turn carries past the body's outline slides back onto the visible face (it is never cut by\n   the clip): every point of the group must sit inside 0.9 of the outline's radius (0.84 on a lobed body, whose valleys are near) in its own direction, and the group\n   moves toward the body's centre by what the worst point overshoots (two passes). */\nfunction keepOnFace(gp, warp) {\n  const B = warp.pts; if (!B || !B.length) return;\n  const cx = warp.dx, cy = warp.sh, rel = warp._rel || (warp._rel = B.map((b) => [b[0] - cx, b[1] - cy]));\n  for (let pass = 0; pass < 2; pass++) {\n    let worst = 0, gx = 0, gy = 0, n = 0;\n    for (const q of gp) for (const [X, Y] of q) {\n      const x = X - cx, y = Y - cy, r = Math.hypot(x, y); gx += x; gy += y; n++;\n      if (r < 1e-6) continue;\n      const R = rayHit(rel, x / r, y / r);\n      const k = warp.lobed ? .84 : .9;\n      if (R > 0 && r - k * R > worst) worst = r - k * R;\n    }\n    if (worst <= 0 || !n) return;\n    const gl = Math.hypot(gx, gy) || 1, sx = -gx / gl * worst * 1.05, sy = -gy / gl * worst * 1.05;\n    for (const q of gp) for (const p of q) { p[0] += sx; p[1] += sy; }\n  }\n}\nfunction drawFaceCells(", 'G2 helper'],
  ["    const warp = { s, dx: contour.dx, sh: contour.sh };", "    const warp = { s, dx: contour.dx, sh: contour.sh, pts: contour.pts, lobed: !body.isCircle && !body.convex && !body.mix };", 'G2 warp'],
  // G3: the one limit left, per shape, at the largest turn that renders clean (probes/turn.html): a lobed body (flower,
  // clover, star, cloud: not convex) holds its eyes to 0.75 rad of turn and 0.3 of pitch, past which the far eye folds behind a lobe; convex
  // bodies and the circle keep their whole range (lookAt 1.18 rad, rim peeks 1.26)
  ["  _followMode() {", "  _eyeCap(v, m = .75) { const b = this._bodyTo; return (!b || b.isCircle || b.convex) ? v : clamp(v, -m, m); }\n  _followMode() {", 'G3 cap'],
  ["      this._eyaw = T[0]; this._epitch = T[1]; this._eroll = T[2];", "      this._eyaw = this._eyeCap(T[0]); this._epitch = this._eyeCap(T[1], .3); this._eroll = T[2];", 'G3 static'],
  ["      [this._eyaw, this._vey] = stepEye(this._eyaw, this._vey, T[0]);\n      [this._epitch, this._vep] = stepEye(this._epitch, this._vep, T[1]);", "      [this._eyaw, this._vey] = stepEye(this._eyaw, this._vey, this._eyeCap(T[0]));\n      [this._epitch, this._vep] = stepEye(this._epitch, this._vep, this._eyeCap(T[1], .3));", 'G3 spring'],
  // G4: the body turns with the face (owner, 23 Nov). orb2 turns the head by only 0.54 of the eye turn on a flat body, so a
  // turned square or hexagon keeps its body nearly front-on while its eyes slide over: it reads as eyes looking, not as a
  // turned bot. Grok-Bot turns the whole body (avatar-shapes-idle-and-pointer.mp4; its 3/4 sidebar pose). The head ratio is
  // 0.85 on every extruded body (the eyes still lead a little), and a reaction can lock it to the eyes with the motion key hk
  // (0..1, blended by orb2's morph like every motion key): the fixed pose uses hk 1. The domed solids (the diamond, a lozenge, and
  // the lobed cloud, clover, flower and star) take 0.65, their largest clean turn: past it the near eye sits on a lobe bulging toward the camera and
  // swells while the far one thins (probes/pose.html, ORBS.md section 23). A circle keeps 0.68 (a sphere looks the same).
  ["const MKEYS = { dy: 0, s: 1, bodyRoll: 0, yawAdd: 0, spinYaw: 0, spinEyeLead: 0, eroll: 0, w: 0 };",
   "const MKEYS = { dy: 0, s: 1, bodyRoll: 0, yawAdd: 0, spinYaw: 0, spinEyeLead: 0, eroll: 0, w: 0, hk: 0 };", 'G4 key'],
  ["    const hR = b => b.isCircle ? .68 : .54;\n    const hRatio = this._btp < 1 ? lerp(hR(this._bodyFrom), hR(this._bodyTo), easeMorph(this._btp)) : hR(this._bodyTo);",
   "    const domed = b => !!b.solid && (!b.solid.convex || b.label === 'Lozenge');\n    const hR = b => b.isCircle ? .68 : domed(b) ? .65 : .85;\n    const hRatio = lerp(this._btp < 1 ? lerp(hR(this._bodyFrom), hR(this._bodyTo), easeMorph(this._btp)) : hR(this._bodyTo), 1, clamp(this._bodyTo.isCircle || domed(this._bodyTo) ? 0 : (m.hk || 0), 0, 1));", 'G4 ratio'],
  ["    const hRatio = body.isCircle ? .68 : .54;", "    const hRatio = body.isCircle ? .68 : (body.solid && (!body.solid.convex || body.label === 'Lozenge')) ? .65 : .85;", 'G4 svg'],
  // G5: a bot at rest is exactly still (owner, 23 Nov: "the flickering on the borders still happen"). orb2's springs and
  // jelly decay forever; whenever the residue passes the redraw threshold (1e-4) the canvas is redrawn a hair off, and on a
  // small bot the anti-aliased edge pixels flip. Each spring now lands exactly on its goal once it is within 2e-3 rad and
  // slow (under 0.09 device px at 44 px), and the jelly stops below an energy of 2e-3, so the signature stops changing and
  // the canvas is never redrawn while the bot rests
  ["      [this._bRoll, this._vbr] = stepHead(this._bRoll, this._vbr, T[3]);",
   "      [this._bRoll, this._vbr] = stepHead(this._bRoll, this._vbr, T[3]);\n      { const land = (k, vk, g) => { if (Math.abs(g - this[k]) < 2e-3 && Math.abs(this[vk]) < 2e-2) { this[k] = g; this[vk] = 0; } };\n        land('_eyaw', '_vey', this._eyeCap(T[0])); land('_epitch', '_vep', this._eyeCap(T[1], .3)); land('_eroll', '_ver', T[2]);\n        land('_hyaw', '_vhy', T[0] * hRatio); land('_hpitch', '_vhp', T[1] * hRatio); land('_bRoll', '_vbr', T[3]); }", 'G5 springs'],
  ["        x[i] = clamp(x[i] + v[i] * h, -.28, .28);\n      }\n    }\n  }",
   "        x[i] = clamp(x[i] + v[i] * h, -.28, .28);\n      }\n    }\n    let en = 0; for (let i = 0; i < 6; i++) en += Math.abs(x[i]) + Math.abs(v[i]) * .02;\n    if (en < 2e-3) for (let i = 0; i < 6; i++) x[i] = v[i] = 0;\n  }", 'G5 jelly'],
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
  // T4: no float or breath under 44 px in the calm idle (the threshold orb2 already uses for its outline stride); lively keeps them
  ["    const floatOn = !calm && !fixed && this._idleMotion !== 'off';", "    const floatOn = !calm && !fixed && this._idleMotion !== 'off' && (this._idleMotion !== 'calm' || this._cssW >= 44);", 'T4 float'],
  // T5: the rest gaze faces front (was 8 degrees right, 4.6 up)
  ["const g = this._gaze || [.14, .08];", "const g = this._gaze || [0, .05];", 'T5 gaze'],
];
const out = path.join(__dirname, 'lib');
fs.writeFileSync(path.join(out, 'orb-avatar.snap.js'), SNAP.reduce(rep, src));
fs.writeFileSync(path.join(out, 'orb-avatar.tuned.js'), TUNE.reduce(rep, SNAP.reduce(rep, src)));
console.log('ok', SNAP.length, 'clarity and', TUNE.length, 'tuning changes');
