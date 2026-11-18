export const N_BODY = 96;
export const N_EYE = 32;

export type EyeArchetype = 'capsule' | 'slit' | 'round' | 'crescent' | 'matrix';

export type OrbState =
  | 'idle'
  | 'working'
  | 'thinking'
  | 'happy'
  | 'sleeping'
  | 'needs'
  | 'surprised'
  | 'dizzy';

export type EyeLoopKind =
  | 'capsule'
  | 'slit'
  | 'round'
  | 'crescent'
  | 'working'
  | 'thinking'
  | 'happy'
  | 'sleeping'
  | 'surprised';

export interface EyeArchetypeOption {
  id: EyeArchetype;
  label: string;
}

export interface OrbMaterial {
  name: string;
  hex: string;
  eye: string;
}

export const EYE_ARCHETYPES: readonly EyeArchetypeOption[] = [
  { id: 'capsule', label: 'Capsule ||' },
  { id: 'slit', label: 'Slit —' },
  { id: 'round', label: 'Round ●' },
  { id: 'crescent', label: 'Crescent ◡' },
  { id: 'matrix', label: 'Matrix ∷' },
];

export const MATERIALS: readonly OrbMaterial[] = [
  { name: 'Ceramic', hex: '#F2F2F0', eye: '#111111' },
  { name: 'Chalk', hex: '#FFFFFF', eye: '#0A0A0A' },
  { name: 'Silver', hex: '#CCCCCC', eye: '#111111' },
  { name: 'Titanium', hex: '#808080', eye: '#FFFFFF' },
  { name: 'Gunmetal', hex: '#333333', eye: '#FFFFFF' },
  { name: 'Carbon', hex: '#171717', eye: '#FFFFFF' },
  { name: 'Void', hex: '#080808', eye: '#FFFFFF' },
  { name: 'Crimson', hex: '#D71921', eye: '#FFFFFF' },
];

export function getOrbEyeInk(hex: string): string {
  const match = MATERIALS.find((x) => x.hex.toLowerCase() === hex.toLowerCase());
  if (match) return match.eye;
  const clean = hex.replace('#', '');
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return '#111111';
  }
  return 0.299 * r + 0.587 * g + 0.114 * b > 135 ? '#111111' : '#FFFFFF';
}

export function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Builds a closed 32-point loop (da, db) around eye center for seamless
 * point-by-point morphing without orientation twist.
 */
export function buildEyeLoop(kind: EyeLoopKind, side: -1 | 1): Float32Array {
  const pts = new Float32Array(N_EYE * 2);
  for (let i = 0; i < N_EYE; i++) {
    const u = i / N_EYE;
    const ang = u * Math.PI * 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    let da = 0;
    let db = 0;

    if (kind === 'capsule') {
      const p = Math.pow(Math.pow(Math.abs(ca), 3.6) + Math.pow(Math.abs(sa), 3.6), 1 / 3.6);
      da = (ca / p) * 0.066;
      db = (sa / p) * 0.168;
    } else if (kind === 'slit' || kind === 'working') {
      const ry = kind === 'working' ? 0.044 : 0.036;
      const rx = kind === 'working' ? 0.145 : 0.135;
      const p = Math.pow(Math.pow(Math.abs(ca), 4.0) + Math.pow(Math.abs(sa), 4.0), 1 / 4.0);
      da = (ca / p) * rx;
      db = (sa / p) * ry;
    } else if (kind === 'round') {
      da = ca * 0.105;
      db = sa * 0.105;
    } else if (kind === 'surprised') {
      da = ca * 0.128;
      db = sa * 0.155;
    } else if (kind === 'crescent' || kind === 'happy') {
      const half = N_EYE / 2;
      const span = kind === 'happy' ? 0.135 : 0.125;
      const archH = kind === 'happy' ? 0.095 : 0.055;
      const thick = kind === 'happy' ? 0.036 : 0.03;
      if (i < half) {
        const s = 1 - (i / (half - 1)) * 2; // +1 -> -1
        const taper = 0.45 + 0.55 * (1 - s * s);
        da = s * span;
        db = -archH * (1 - s * s) + thick * 0.5 * taper + archH * 0.35;
      } else {
        const s = ((i - half) / (half - 1)) * 2 - 1; // -1 -> +1
        const taper = 0.45 + 0.55 * (1 - s * s);
        da = s * span;
        db = -archH * (1 - s * s) - thick * 0.5 * taper + archH * 0.35;
      }
    } else if (kind === 'sleeping') {
      const half = N_EYE / 2;
      const span = 0.118;
      const drop = 0.048;
      const thick = 0.028;
      if (i < half) {
        const s = 1 - (i / (half - 1)) * 2;
        const taper = 0.45 + 0.55 * (1 - s * s);
        da = s * span;
        db = drop * (1 - s * s) + thick * 0.5 * taper + 0.02;
      } else {
        const s = ((i - half) / (half - 1)) * 2 - 1;
        const taper = 0.45 + 0.55 * (1 - s * s);
        da = s * span;
        db = drop * (1 - s * s) - thick * 0.5 * taper + 0.02;
      }
    } else if (kind === 'thinking') {
      const ry = side > 0 ? 0.052 : 0.125;
      const p = Math.pow(Math.pow(Math.abs(ca), 3.6) + Math.pow(Math.abs(sa), 3.6), 1 / 3.6);
      da = (ca / p) * 0.088;
      db = (sa / p) * ry + (side > 0 ? -0.025 : 0);
    } else {
      da = ca * 0.075;
      db = sa * 0.15;
    }

    pts[i * 2] = da;
    pts[i * 2 + 1] = db;
  }
  return pts;
}

const ALL_EYE_LOOP_KINDS: readonly EyeLoopKind[] = [
  'capsule',
  'slit',
  'round',
  'crescent',
  'working',
  'thinking',
  'happy',
  'sleeping',
  'surprised',
];

export const EYE_LOOPS_L: Record<EyeLoopKind, Float32Array> = Object.fromEntries(
  ALL_EYE_LOOP_KINDS.map((k) => [k, buildEyeLoop(k, -1)]),
) as Record<EyeLoopKind, Float32Array>;

export const EYE_LOOPS_R: Record<EyeLoopKind, Float32Array> = Object.fromEntries(
  ALL_EYE_LOOP_KINDS.map((k) => [k, buildEyeLoop(k, 1)]),
) as Record<EyeLoopKind, Float32Array>;

export function interpolateEyeLoop(
  from: Float32Array,
  to: Float32Array,
  t: number,
  out?: Float32Array,
): Float32Array {
  const s = smoothstep01(t);
  const dst = out ?? new Float32Array(N_EYE * 2);
  for (let i = 0; i < N_EYE * 2; i++) {
    dst[i] = from[i] + (to[i] - from[i]) * s;
  }
  return dst;
}

export interface SpherePoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Exponential-map projection of tangent coordinates (a, b) onto the unit sphere,
 * rotated by head pose (yaw, pitch, roll).
 */
export function expMap(
  a: number,
  b: number,
  yaw: number,
  pitch: number,
  roll: number,
): SpherePoint {
  const th = Math.hypot(a, b);
  let x = 0;
  let y = 0;
  let z = 1;
  if (th > 1e-5) {
    const s = Math.sin(th) / th;
    x = a * s;
    y = b * s;
    z = Math.cos(th);
  }
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const xr = x * cr - y * sr;
  const yr = x * sr + y * cr;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const yp = yr * cp - z * sp;
  const zp = yr * sp + z * cp;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return {
    x: xr * cy + zp * sy,
    y: yp,
    z: -xr * sy + zp * cy,
  };
}

export function resolveEyeKey(state: OrbState, eyeArchetype: EyeArchetype): EyeLoopKind {
  if (state === 'sleeping') return 'sleeping';
  if (state === 'happy') return 'happy';
  if (state === 'surprised') return 'surprised';
  if (state === 'working') return 'working';
  if (state === 'thinking') return 'thinking';
  if (state === 'dizzy') return 'round';
  if (eyeArchetype === 'matrix') return 'round';
  return eyeArchetype;
}
