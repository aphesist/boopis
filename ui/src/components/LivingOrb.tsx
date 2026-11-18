import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  EYE_LOOPS_L,
  EYE_LOOPS_R,
  type EyeArchetype,
  type EyeLoopKind,
  N_BODY,
  N_EYE,
  type OrbState,
  expMap,
  getOrbEyeInk,
  interpolateEyeLoop,
  resolveEyeKey,
} from '../lib/orbMath';

export interface LivingOrbHandle {
  poke: () => void;
  kickJelly: (strength?: number) => void;
  setTemporaryState: (state: OrbState, durationMs: number) => void;
}

export interface LivingOrbProps {
  id: string;
  color: string;
  eyes: EyeArchetype;
  state: OrbState;
  size: number;
  jelly?: number;
  interactive?: boolean;
  mountSize?: number;
  className?: string;
  onPokeStageChange?: (stage: number, hint: string | null) => void;
}

interface PointerTracker {
  x: number;
  y: number;
  active: boolean;
}

const POINTER: PointerTracker = { x: 0, y: 0, active: false };
const ACTIVE_INSTANCES = new Set<LivingOrbEngine>();
let rafId: number | null = null;
let lastFrameMs = 0;
let listenersBound = false;

function ensureGlobalLoop() {
  if (typeof window === 'undefined') return;
  if (!listenersBound) {
    listenersBound = true;
    window.addEventListener('pointermove', (e) => {
      POINTER.x = e.clientX;
      POINTER.y = e.clientY;
      POINTER.active = true;
    });
    window.addEventListener('blur', () => {
      POINTER.active = false;
    });
  }
  if (rafId === null) {
    lastFrameMs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameMs) / 1000));
      lastFrameMs = now;
      const tSec = now / 1000;
      ACTIVE_INSTANCES.forEach((orb) => {
        if (orb.el.offsetParent !== null) {
          orb.step(dt, tSec, POINTER);
          orb.draw(tSec);
        }
      });
      if (ACTIVE_INSTANCES.size > 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  }
}

interface ZParticle {
  x: number;
  y: number;
  age: number;
}

class LivingOrbEngine {
  el: HTMLDivElement;
  id: string;
  color: string;
  eyeArchetype: EyeArchetype;
  baseState: OrbState;
  state: OrbState;
  size: number;
  jelly: number;
  interactive: boolean;
  onPokeStageChange?: (stage: number, hint: string | null) => void;

  boxSize: number;
  dpr: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  seed: number;

  yaw = -0.1;
  pitch = 0.04;
  roll = 0;
  vyaw = 0;
  vpitch = 0;
  vroll = 0;

  hopY = 0;
  vhop = 0;
  floorSquash = 0;

  qc = [0, 0, 0];
  qs = [0, 0, 0];
  vc = [0, 0, 0];
  vs = [0, 0, 0];

  curEyeL: Float32Array;
  curEyeR: Float32Array;
  fromEyeL: Float32Array;
  fromEyeR: Float32Array;
  targetEyeKey: EyeLoopKind;
  eyeMorphT = 1.0;

  matrixMix: number;
  dizzyMix = 0.0;

  overrideUntil = 0;
  pokeCount = 0;
  lastPokeAt = 0;
  dragging = false;
  dragYaw = 0;
  dragPitch = 0;

  zs: ZParticle[] = [];
  nextZ = 0;

  private cleanupPointer?: () => void;

  constructor(
    el: HTMLDivElement,
    props: {
      id: string;
      color: string;
      eyes: EyeArchetype;
      state: OrbState;
      size: number;
      jelly: number;
      interactive: boolean;
      onPokeStageChange?: (stage: number, hint: string | null) => void;
    },
  ) {
    this.el = el;
    this.id = props.id;
    this.color = props.color;
    this.eyeArchetype = props.eyes;
    this.baseState = props.state;
    this.state = props.state;
    this.size = props.size;
    this.jelly = props.jelly;
    this.interactive = props.interactive;
    this.onPokeStageChange = props.onPokeStageChange;

    this.boxSize = Math.round(this.size * 2.2);
    this.dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.boxSize * this.dpr;
    this.canvas.height = this.boxSize * this.dpr;
    this.canvas.style.width = `${this.boxSize}px`;
    this.canvas.style.height = `${this.boxSize}px`;
    this.el.replaceChildren(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.seed = Array.from(this.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) * 0.63;

    const initKey = resolveEyeKey(this.state, this.eyeArchetype);
    this.curEyeL = new Float32Array(EYE_LOOPS_L[initKey]);
    this.curEyeR = new Float32Array(EYE_LOOPS_R[initKey]);
    this.fromEyeL = new Float32Array(this.curEyeL);
    this.fromEyeR = new Float32Array(this.curEyeR);
    this.targetEyeKey = initKey;
    this.matrixMix = this.eyeArchetype === 'matrix' && this.state === 'idle' ? 1.0 : 0.0;

    if (this.interactive) {
      this.bindInteractive();
    }
  }

  destroy() {
    this.cleanupPointer?.();
    this.canvas.remove();
  }

  setConfig(next: {
    color?: string;
    eyes?: EyeArchetype;
    state?: OrbState;
    jelly?: number;
    onPokeStageChange?: (stage: number, hint: string | null) => void;
  }) {
    if (next.onPokeStageChange !== undefined) {
      this.onPokeStageChange = next.onPokeStageChange;
    }
    const colorChanged = next.color && next.color !== this.color;
    const eyesChanged = next.eyes && next.eyes !== this.eyeArchetype;
    if (next.color) this.color = next.color;
    if (next.eyes) this.eyeArchetype = next.eyes;
    if (typeof next.jelly === 'number') this.jelly = next.jelly;

    if (next.state && next.state !== this.baseState) {
      this.baseState = next.state;
      this.setState(next.state, 0);
    } else if (eyesChanged) {
      this.triggerEyeMorph(resolveEyeKey(this.state, this.eyeArchetype));
    }

    if (colorChanged || eyesChanged) {
      this.kickJelly(0.08);
    }
  }

  setState(nextState: OrbState, durationMs = 0) {
    this.state = nextState;
    this.overrideUntil = durationMs > 0 ? performance.now() + durationMs : 0;
    this.triggerEyeMorph(resolveEyeKey(nextState, this.eyeArchetype));
    if (nextState === 'happy' || nextState === 'surprised') {
      this.vhop = -2.9;
      this.kickJelly(0.14);
    }
  }

  triggerEyeMorph(key: EyeLoopKind) {
    if (key === this.targetEyeKey) return;
    this.fromEyeL.set(this.curEyeL);
    this.fromEyeR.set(this.curEyeR);
    this.targetEyeKey = key;
    this.eyeMorphT = 0.0;
  }

  kickJelly(strength = 0.14) {
    const amp = strength * (0.45 + this.jelly * 0.85);
    this.vc[0] += (Math.random() - 0.5) * amp * 12 + amp * 7;
    this.vs[0] += (Math.random() - 0.5) * amp * 11;
    this.vc[1] += (Math.random() - 0.5) * amp * 9;
    this.vs[2] += (Math.random() - 0.5) * amp * 7;
  }

  poke() {
    const now = performance.now();
    this.pokeCount = now - this.lastPokeAt < 1500 ? this.pokeCount + 1 : 1;
    this.lastPokeAt = now;

    if (this.pokeCount === 1) {
      this.setState('surprised', 1700);
      this.vhop = -3.1;
      this.kickJelly(0.18);
      this.onPokeStageChange?.(1, '1st poke · surprised');
    } else if (this.pokeCount === 2) {
      this.setState('happy', 2000);
      this.vhop = -3.6;
      this.vroll += 3.4;
      this.kickJelly(0.22);
      this.onPokeStageChange?.(2, '2nd poke · giggle (^ ^)');
    } else {
      this.setState('dizzy', 2700);
      this.vyaw += 5.8;
      this.kickJelly(0.25);
      this.onPokeStageChange?.(3, '3rd poke · dizzy! (settling)');
    }
  }

  private bindInteractive() {
    let downX = 0;
    let downY = 0;
    let moved = false;

    const onDown = (e: PointerEvent) => {
      this.dragging = true;
      downX = e.clientX;
      downY = e.clientY;
      moved = false;
      this.el.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (Math.hypot(dx, dy) > 4) moved = true;
      this.dragYaw = Math.max(-0.88, Math.min(0.88, dx * 0.012));
      this.dragPitch = Math.max(-0.76, Math.min(0.76, -dy * 0.01));
    };

    const onRelease = () => {
      if (!this.dragging) return;
      this.dragging = false;
      if (!moved) {
        this.poke();
      }
      this.dragYaw = 0;
      this.dragPitch = 0;
    };

    this.el.addEventListener('pointerdown', onDown);
    this.el.addEventListener('pointermove', onMove);
    this.el.addEventListener('pointerup', onRelease);
    this.el.addEventListener('pointercancel', onRelease);

    this.cleanupPointer = () => {
      this.el.removeEventListener('pointerdown', onDown);
      this.el.removeEventListener('pointermove', onMove);
      this.el.removeEventListener('pointerup', onRelease);
      this.el.removeEventListener('pointercancel', onRelease);
    };
  }

  step(dt: number, tSec: number, pointer: PointerTracker) {
    const now = performance.now();
    if (this.overrideUntil > 0 && now > this.overrideUntil) {
      this.overrideUntil = 0;
      this.pokeCount = 0;
      this.setState(this.baseState, 0);
      this.onPokeStageChange?.(0, null);
    }

    if (this.eyeMorphT < 1.0) {
      this.eyeMorphT = Math.min(1.0, this.eyeMorphT + dt / 0.34);
      interpolateEyeLoop(this.fromEyeL, EYE_LOOPS_L[this.targetEyeKey], this.eyeMorphT, this.curEyeL);
      interpolateEyeLoop(this.fromEyeR, EYE_LOOPS_R[this.targetEyeKey], this.eyeMorphT, this.curEyeR);
    }

    const wantMatrix =
      this.eyeArchetype === 'matrix' && (this.state === 'idle' || this.state === 'working')
        ? 1
        : 0;
    this.matrixMix += (wantMatrix - this.matrixMix) * Math.min(1, dt * 10);
    const wantDizzy = this.state === 'dizzy' ? 1 : 0;
    this.dizzyMix += (wantDizzy - this.dizzyMix) * Math.min(1, dt * 10);

    let tyaw = 0.06 * Math.sin(tSec * 0.8 + this.seed);
    let tpitch = 0.04 * Math.cos(tSec * 0.65 + this.seed);
    let troll = 0.025 * Math.sin(tSec * 0.7 + this.seed);

    if (this.dragging) {
      tyaw = this.dragYaw;
      tpitch = this.dragPitch;
    } else if (this.state === 'sleeping') {
      tyaw = -0.08 + 0.04 * Math.sin(tSec * 0.7 + this.seed);
      tpitch = 0.24 + 0.04 * Math.sin(tSec * 1.4);
      troll = 0.06 * Math.sin(tSec * 0.7);
    } else if (this.state === 'thinking') {
      tyaw = 0.14 * Math.sin(tSec * 1.2);
      tpitch = 0.22;
      troll = -0.07;
    } else if (this.state === 'working') {
      tyaw = 0.26 * Math.sin(tSec * 2.2 + this.seed);
      tpitch = 0.04;
    } else if (this.state === 'happy') {
      troll = 0.15 * Math.sin(tSec * 13);
      tpitch = -0.08;
    } else if (this.state === 'dizzy') {
      tyaw = 0.28 * Math.cos(tSec * 6.5);
      tpitch = 0.18 * Math.sin(tSec * 6.5);
      troll = 0.14 * Math.sin(tSec * 4.5);
    } else if (pointer.active) {
      const rect = this.el.getBoundingClientRect();
      if (rect.width > 0) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        tyaw += 0.34 * Math.tanh((pointer.x - cx) / 165);
        tpitch += 0.22 * Math.tanh((pointer.y - cy) / 165);
      }
    }

    const K = 95;
    const D = 11;
    this.vyaw += ((tyaw - this.yaw) * K - this.vyaw * D) * dt;
    this.vpitch += ((tpitch - this.pitch) * K - this.vpitch * D) * dt;
    this.vroll += ((troll - this.roll) * K - this.vroll * D) * dt;
    this.yaw += this.vyaw * dt;
    this.pitch += this.vpitch * dt;
    this.roll += this.vroll * dt;

    const prevHop = this.hopY;
    this.vhop += (-this.hopY * 135 - this.vhop * 11) * dt;
    this.hopY += this.vhop * dt;
    if (prevHop < 0 && this.hopY >= 0 && this.vhop > 0.6) {
      this.floorSquash = Math.min(0.28, this.vhop * 0.06);
      this.kickJelly(0.11);
    }
    this.floorSquash *= Math.exp(-dt * 9);

    const w = 22 - this.jelly * 7;
    const damp = 9.5 - this.jelly * 5.2;
    for (let m = 0; m < 3; m++) {
      this.vc[m] += (-(w * w) * this.qc[m] - damp * this.vc[m]) * dt;
      this.vs[m] += (-(w * w) * this.qs[m] - damp * this.vs[m]) * dt;
      this.qc[m] += this.vc[m] * dt;
      this.qs[m] += this.vs[m] * dt;
    }

    if (this.state === 'sleeping' && tSec > this.nextZ) {
      this.nextZ = tSec + 1.15;
      this.zs.push({ x: 0.35, y: -0.55, age: 0 });
    }
    for (const z of this.zs) {
      z.age += dt;
      z.y -= dt * 0.55;
      z.x += Math.sin(z.age * 4) * dt * 0.14;
    }
    this.zs = this.zs.filter((z) => z.age < 1.9);
  }

  draw(tSec: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.boxSize;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, w);

    const R = this.size * 0.45;
    const cx = w / 2;
    const breath = Math.sin(tSec * 2.1 + this.seed) * 0.012;
    const idleBob =
      this.state === 'sleeping'
        ? Math.sin(tSec * 1.4 + this.seed) * (R * 0.04)
        : Math.sin(tSec * 2.2 + this.seed) * (R * 0.05);
    const cyRest = w / 2 + R * 0.05;
    const cy = cyRest + idleBob + this.hopY * (R * 0.24);
    const floorY = cyRest + R * 0.98;

    const heightAboveFloor = Math.max(0, cyRest - cy);
    const shadowScale = Math.max(0.55, 1.0 - heightAboveFloor / (R * 1.6));
    const themeRoot = this.el.closest('[data-theme]') ?? document.documentElement;
    const appStyle = getComputedStyle(themeRoot);
    ctx.fillStyle = appStyle.getPropertyValue('--orb-ground-shadow').trim() || 'rgba(128,128,128,0.1)';
    ctx.beginPath();
    ctx.ellipse(
      cx,
      floorY + R * 0.06,
      R * 0.72 * shadowScale,
      R * 0.12 * shadowScale,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    const airStretch = Math.max(-0.1, Math.min(0.1, -this.vhop * 0.02));
    const squash = this.floorSquash + airStretch;
    const sx = 1.0 + squash * 0.48 + breath * 0.6;
    const sy = 1.0 - squash * 0.38 - breath * 0.4;

    ctx.beginPath();
    for (let i = 0; i < N_BODY; i++) {
      const theta = (i / N_BODY) * Math.PI * 2;
      let wobble = 0;
      for (let m = 0; m < 3; m++) {
        const k = m + 2;
        wobble += this.qc[m] * Math.cos(k * theta) + this.qs[m] * Math.sin(k * theta);
      }
      const r = R * (1.0 + wobble);
      let px = cx + Math.cos(theta) * r * sx;
      let py = cy + Math.sin(theta) * r * sy;
      if (py > floorY) {
        const excess = py - floorY;
        py = floorY + excess * 0.08;
        px += Math.sign(px - cx) * excess * 0.25;
      }
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = this.color;
    ctx.fill();

    ctx.lineWidth = 0.85;
    ctx.strokeStyle = 'rgba(128,128,128,0.22)';
    ctx.stroke();

    const eyeInk = getOrbEyeInk(this.color);
    const blinkCycle = (tSec + this.seed * 1.9) % 4.1;
    const doubleBlink = Math.floor((tSec + this.seed * 1.9) / 4.1) % 5 === 0;
    let blinkScale = 1.0;
    if (this.state !== 'sleeping' && this.state !== 'dizzy') {
      if (blinkCycle < 0.16) {
        blinkScale = Math.max(0.08, Math.abs(blinkCycle - 0.08) / 0.08);
      } else if (doubleBlink && blinkCycle > 0.28 && blinkCycle < 0.44) {
        blinkScale = Math.max(0.08, Math.abs(blinkCycle - 0.36) / 0.08);
      }
    }

    const drawEyePoly = (loopPts: Float32Array, centerA: number, centerB: number) => {
      const cProj = expMap(centerA, centerB, this.yaw, this.pitch, this.roll);
      if (cProj.z < 0.06) return;
      ctx.beginPath();
      for (let i = 0; i < N_EYE; i++) {
        const da = loopPts[i * 2];
        const db = loopPts[i * 2 + 1] * blinkScale;
        const p = expMap(centerA + da, centerB + db, this.yaw, this.pitch, this.roll);
        const px = cx + p.x * R * sx;
        const py = cy + p.y * R * sy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = eyeInk;
      ctx.fill();
    };

    const baseAlpha = Math.max(0, 1 - Math.max(this.matrixMix, this.dizzyMix));
    if (baseAlpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = baseAlpha;
      drawEyePoly(this.curEyeL, -0.21, 0.01);
      drawEyePoly(this.curEyeR, 0.21, 0.01);
      ctx.restore();
    }

    if (this.matrixMix > 0.02) {
      ctx.save();
      ctx.globalAlpha = this.matrixMix;
      ctx.fillStyle = eyeInk;
      [-0.21, 0.21].forEach((centerA) => {
        for (let row = -1; row <= 1; row++) {
          for (let col = -0.5; col <= 0.5; col += 1) {
            const p = expMap(
              centerA + col * 0.075,
              0.01 + row * 0.075 * blinkScale,
              this.yaw,
              this.pitch,
              this.roll,
            );
            if (p.z < 0.06) continue;
            const px = cx + p.x * R * sx;
            const py = cy + p.y * R * sy;
            const dotR = Math.max(1.1, R * 0.032 * Math.max(0.4, p.z));
            ctx.beginPath();
            ctx.arc(px, py, dotR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
      ctx.restore();
    }

    if (this.dizzyMix > 0.02) {
      ctx.save();
      ctx.globalAlpha = this.dizzyMix;
      ctx.strokeStyle = eyeInk;
      ctx.fillStyle = eyeInk;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.5, R * 0.06);
      [-0.21, 0.21].forEach((centerA, idx) => {
        const cp = expMap(centerA, 0.01, this.yaw, this.pitch, this.roll);
        if (cp.z < 0.06) return;
        const ex = cx + cp.x * R * sx;
        const ey = cy + cp.y * R * sy;
        const dir = idx === 0 ? -1 : 1;
        ctx.beginPath();
        for (let k = 0; k <= 18; k++) {
          const ang = tSec * 12 * dir + k * 0.55;
          const rad = (k / 18) * (R * 0.16);
          const sxp = ex + Math.cos(ang) * rad * Math.max(0.4, cp.z);
          const syp = ey + Math.sin(ang) * rad;
          if (k === 0) ctx.moveTo(sxp, syp);
          else ctx.lineTo(sxp, syp);
        }
        ctx.stroke();
      });
      for (let i = 0; i < 3; i++) {
        const ang = tSec * 4.6 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(ang) * (R * 0.86),
          cy - R * 1.05 + Math.sin(ang) * (R * 0.2),
          Math.max(1.6, R * 0.06),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }

    if (this.zs.length > 0) {
      ctx.fillStyle =
        eyeInk === '#111111' || eyeInk === '#0A0A0A'
          ? appStyle.getPropertyValue('--ink-secondary').trim() || '#8c8c8c'
          : '#8c8c8c';
      ctx.font = `600 ${Math.max(8, Math.round(R * 0.34))}px "Geist Mono", monospace`;
      ctx.textAlign = 'center';
      this.zs.forEach((z) => {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - z.age / 1.9) * 0.75;
        ctx.fillText('z', cx + z.x * R, cy + z.y * R);
        ctx.restore();
      });
    }

    ctx.restore();
  }
}

export const LivingOrb = forwardRef<LivingOrbHandle, LivingOrbProps>(
  (
    {
      id,
      color,
      eyes,
      state,
      size,
      jelly = 0.65,
      interactive = false,
      mountSize,
      className = '',
      onPokeStageChange,
    },
    ref,
  ) => {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<LivingOrbEngine | null>(null);
    const boxDim = mountSize ?? Math.round(size * 1.15);

    useImperativeHandle(
      ref,
      () => ({
        poke: () => engineRef.current?.poke(),
        kickJelly: (strength = 0.14) => engineRef.current?.kickJelly(strength),
        setTemporaryState: (nextState: OrbState, durationMs: number) =>
          engineRef.current?.setState(nextState, durationMs),
      }),
      [],
    );

    useEffect(() => {
      const el = mountRef.current;
      if (!el) return;
      const engine = new LivingOrbEngine(el, {
        id,
        color,
        eyes,
        state,
        size,
        jelly,
        interactive,
        onPokeStageChange,
      });
      engineRef.current = engine;
      ACTIVE_INSTANCES.add(engine);
      ensureGlobalLoop();
      return () => {
        ACTIVE_INSTANCES.delete(engine);
        engine.destroy();
        engineRef.current = null;
      };
      // Only rebuild canvas if mount identity, base geometry size, or interactivity changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, size, interactive]);

    useEffect(() => {
      engineRef.current?.setConfig({
        color,
        eyes,
        state,
        jelly,
        onPokeStageChange,
      });
    }, [color, eyes, state, jelly, onPokeStageChange]);

    return (
      <div
        ref={mountRef}
        data-orb-id={id}
        style={{ width: `${boxDim}px`, height: `${boxDim}px` }}
        className={`orb-mount ${interactive ? 'orb-interactive' : ''} ${className}`.trim()}
      />
    );
  },
);

LivingOrb.displayName = 'LivingOrb';
