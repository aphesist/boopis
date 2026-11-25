"use strict";
var SQ = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/components/squircle-path.ts
  var squircle_path_exports = {};
  __export(squircle_path_exports, {
    DEFAULT_SMOOTHING: () => DEFAULT_SMOOTHING,
    clearSegCache: () => clearSegCache,
    concavePath: () => concavePath,
    cornerParams: () => cornerParams,
    cornerSegment: () => cornerSegment,
    cornerTo: () => cornerTo,
    segCacheSize: () => segCacheSize,
    slabPath: () => slabPath,
    squirclePath: () => squirclePath
  });
  var DEFAULT_SMOOTHING = 0.6;
  var RAD = Math.PI / 180;
  var n = (x) => String(Math.round(x * 100) / 100);
  function cornerParams(r, smoothing, budget) {
    if (!(r > 0)) return null;
    let p = (1 + smoothing) * r;
    const sm = Math.min(smoothing, budget / r - 1);
    p = Math.min(p, budget);
    const arcMeasure = 90 * (1 - sm);
    const arc = Math.sin(arcMeasure / 2 * RAD) * r * Math.SQRT2;
    const alpha = (90 - arcMeasure) / 2;
    const p3p4 = r * Math.tan(alpha / 2 * RAD);
    const beta = 45 * sm;
    const c = p3p4 * Math.cos(beta * RAD);
    const d = c * Math.tan(beta * RAD);
    const b = (p - arc - c - d) / 3;
    return { a: 2 * b, b, c, d, p, arc, r };
  }
  function cornerSegment(q, ux, uy, vx, vy) {
    if (!q) return "";
    const pt = (pu, pv) => n(pu * ux + pv * vx) + " " + n(pu * uy + pv * vy);
    const { a, b, c, d, arc, r } = q;
    return "c" + pt(a, 0) + " " + pt(a + b, 0) + " " + pt(a + b + c, d) + "a" + n(r) + " " + n(r) + " 0 0 " + (ux * vy - uy * vx > 0 ? 1 : 0) + " " + pt(arc, arc) + "c" + pt(d, c) + " " + pt(d, b + c) + " " + pt(d, a + b + c);
  }
  var DIRS = [[0, -1, 1, 0], [1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1]];
  var NONE = ["", 0];
  var segCache = /* @__PURE__ */ new Map();
  var SEG_CACHE_MAX = 4e3;
  var segCacheSize = () => segCache.size;
  var clearSegCache = () => {
    segCache.clear();
  };
  function corner(r, smoothing, budget, dir) {
    const rr = Math.min(Math.max(0, r), budget);
    if (!(rr > 0)) return NONE;
    const key = rr + "|" + smoothing + "|" + ((1 + smoothing) * rr <= budget ? "" : budget) + "|" + dir;
    let v = segCache.get(key);
    if (!v) {
      const q = cornerParams(rr, smoothing, budget), D = DIRS[dir] ?? [0, -1, 1, 0];
      v = [cornerSegment(q, D[0], D[1], D[2], D[3]), q ? q.p : 0];
      if (segCache.size > SEG_CACHE_MAX) segCache.clear();
      segCache.set(key, v);
    }
    return v;
  }
  function squirclePath(w, h, r, o) {
    const sm = o?.smoothing ?? DEFAULT_SMOOTHING, x = o?.x ?? 0, y = o?.y ?? 0;
    const R = typeof r === "number" ? [r, r, r, r] : r;
    const budget = Math.min(w, h) / 2;
    const tl = corner(R[0], sm, budget, 0), tr = corner(R[1], sm, budget, 1), br = corner(R[2], sm, budget, 2), bl = corner(R[3], sm, budget, 3);
    return "M" + n(x + w - tr[1]) + " " + n(y) + tr[0] + "L" + n(x + w) + " " + n(y + h - br[1]) + br[0] + "L" + n(x + bl[1]) + " " + n(y + h) + bl[0] + "L" + n(x) + " " + n(y + tl[1]) + tl[0] + "Z";
  }
  function cornerTo(ax, ay, cx, cy, bx, by, o) {
    const sm = o?.round ? 0 : o?.smoothing ?? DEFAULT_SMOOTHING;
    const run = Math.hypot(cx - ax, cy - ay);
    if (!run) return "L" + n(bx) + " " + n(by);
    const ux = (cx - ax) / run, uy = (cy - ay) / run, vl = Math.hypot(bx - cx, by - cy) || 1, vx = (bx - cx) / vl, vy = (by - cy) / vl;
    return cornerSegment(cornerParams(run / (1 + sm), sm, run), ux, uy, vx, vy);
  }
  function slabPath(w, h, R, F, o) {
    const sm = o?.round ? 0 : o?.smoothing ?? DEFAULT_SMOOTHING;
    const x0 = o?.x ?? F, x1 = x0 + w;
    const top = cornerParams(Math.min(R, w / 2), sm, Math.max(0, Math.min(w / 2, h - F)));
    const pt = top ? top.p : 0;
    return "M" + n(x0 - F) + " " + n(h) + (F > 0 ? cornerTo(x0 - F, h, x0, h, x0, h - F, o) : "") + "L" + n(x0) + " " + n(pt) + cornerSegment(top, 0, -1, 1, 0) + "L" + n(x1 - pt) + " 0" + cornerSegment(top, 1, 0, 0, 1) + "L" + n(x1) + " " + n(h - F) + (F > 0 ? cornerTo(x1, h - F, x1, h, x1 + F, h, o) : "") + "Z";
  }
  function concavePath(size, at) {
    return at === "tr" ? "M" + n(size) + " 0L0 0" + cornerTo(0, 0, size, 0, size, size) + "Z" : "M0 0L" + n(size) + " 0" + cornerTo(size, 0, 0, 0, 0, size) + "Z";
  }
  return __toCommonJS(squircle_path_exports);
})();
