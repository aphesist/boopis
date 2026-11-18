import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendLedgerEvent,
  createOrForkArtifact,
  getAppleVmStatus,
  getSystemStatus,
  isTauriRuntime,
  listCompatAssets,
  resetOfflineIpcState,
  runPack,
  runShipGate,
  runXcodeBuild,
} from './ipc';
import {
  EYE_ARCHETYPES,
  EYE_LOOPS_L,
  EYE_LOOPS_R,
  MATERIALS,
  N_EYE,
  type EyeLoopKind,
  buildEyeLoop,
  expMap,
  getOrbEyeInk,
  interpolateEyeLoop,
  resolveEyeKey,
  smoothstep01,
} from './orbMath';

function signedPolygonArea(pts: Float32Array): number {
  let area2 = 0;
  for (let i = 0; i < N_EYE; i++) {
    const j = (i + 1) % N_EYE;
    const x1 = pts[i * 2];
    const y1 = pts[i * 2 + 1];
    const x2 = pts[j * 2];
    const y2 = pts[j * 2 + 1];
    area2 += x1 * y2 - x2 * y1;
  }
  return area2 * 0.5;
}

describe('LivingOrb spherical exponential-map projection', () => {
  it('maps tangent origin (0,0) with zero pose to +Z unit normal', () => {
    const p = expMap(0, 0, 0, 0, 0);
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBeCloseTo(0, 12);
    expect(p.z).toBeCloseTo(1, 12);
  });

  it('preserves unit-sphere norm across tangent points and 3D head poses', () => {
    const coords = [
      [0, 0],
      [-0.21, 0.01],
      [0.21, 0.01],
      [0.34, -0.17],
      [-0.31, 0.18],
    ];
    const poses = [
      [0, 0, 0],
      [0.45, -0.22, 0.15],
      [-0.88, 0.76, -0.28],
      [1.2, 0.4, 0.5],
    ];

    for (const [a, b] of coords) {
      for (const [yaw, pitch, roll] of poses) {
        const p = expMap(a, b, yaw, pitch, roll);
        const norm = Math.hypot(p.x, p.y, p.z);
        expect(norm).toBeCloseTo(1.0, 10);
      }
    }
  });

  it('rotates along yaw/pitch axes and supports horizon culling at extreme yaw', () => {
    const rightTurn = expMap(0, 0, 0.5, 0, 0);
    expect(rightTurn.x).toBeCloseTo(Math.sin(0.5), 10);
    expect(rightTurn.z).toBeCloseTo(Math.cos(0.5), 10);

    const lookDown = expMap(0, 0, 0, 0.4, 0);
    expect(lookDown.y).toBeCloseTo(-Math.sin(0.4), 10);
    expect(lookDown.z).toBeCloseTo(Math.cos(0.4), 10);

    const beyondHorizon = expMap(0.21, 0.01, 1.8, 0, 0);
    expect(beyondHorizon.z).toBeLessThan(0.06);
  });

  it('produces foreshortened tangent span as eyes turn toward the limb', () => {
    const frontL = expMap(0.21 - 0.066, 0.01, 0, 0, 0);
    const frontR = expMap(0.21 + 0.066, 0.01, 0, 0, 0);
    const frontWidth = Math.abs(frontR.x - frontL.x);

    const sideL = expMap(0.21 - 0.066, 0.01, -0.95, 0, 0);
    const sideR = expMap(0.21 + 0.066, 0.01, -0.95, 0, 0);
    const sideWidth = Math.abs(sideR.x - sideL.x);

    expect(sideWidth).toBeLessThan(frontWidth);
  });
});

describe('LivingOrb eye morph loop continuity', () => {
  const loopKinds: EyeLoopKind[] = [
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

  it('builds finite, bounded 32-vertex closed loops with uniform CCW orientation', () => {
    for (const kind of loopKinds) {
      for (const side of [-1, 1] as const) {
        const pts = buildEyeLoop(kind, side);
        expect(pts.length).toBe(N_EYE * 2);

        let maxStep = 0;
        for (let i = 0; i < N_EYE; i++) {
          const da = pts[i * 2];
          const db = pts[i * 2 + 1];
          expect(Number.isFinite(da)).toBe(true);
          expect(Number.isFinite(db)).toBe(true);
          expect(Math.abs(da)).toBeLessThanOrEqual(0.25);
          expect(Math.abs(db)).toBeLessThanOrEqual(0.25);

          const next = (i + 1) % N_EYE;
          const step = Math.hypot(pts[next * 2] - da, pts[next * 2 + 1] - db);
          if (step > maxStep) maxStep = step;
        }

        // Adjacent vertices remain closely spaced around the closed loop
        expect(maxStep).toBeLessThan(0.08);
        // Same CCW orientation parity across all expressions avoids twist during morphing
        expect(signedPolygonArea(pts)).toBeGreaterThan(0);
      }
    }
  });

  it('interpolates smoothly between archetypes without jumps or NaN', () => {
    const from = EYE_LOOPS_L.capsule;
    const to = EYE_LOOPS_L.happy;

    const atStart = interpolateEyeLoop(from, to, 0);
    const atMid = interpolateEyeLoop(from, to, 0.5);
    const atEnd = interpolateEyeLoop(from, to, 1);

    for (let i = 0; i < N_EYE * 2; i++) {
      expect(atStart[i]).toBeCloseTo(from[i], 6);
      expect(atEnd[i]).toBeCloseTo(to[i], 6);
      expect(atMid[i]).toBeCloseTo((from[i] + to[i]) * 0.5, 6);
    }

    expect(smoothstep01(-0.5)).toBe(0);
    expect(smoothstep01(1.5)).toBe(1);
    expect(smoothstep01(0.5)).toBe(0.5);
  });

  it('keeps thinking eyes asymmetric and maps archetypes/inks cleanly', () => {
    expect(EYE_ARCHETYPES).toHaveLength(5);
    expect(MATERIALS).toHaveLength(8);
    expect(resolveEyeKey('idle', 'matrix')).toBe('round');
    expect(resolveEyeKey('sleeping', 'capsule')).toBe('sleeping');
    expect(resolveEyeKey('dizzy', 'slit')).toBe('round');

    // Right eye squint in thinking mode differs from left eye
    expect(EYE_LOOPS_R.thinking[1]).not.toBeCloseTo(EYE_LOOPS_L.thinking[1], 4);

    // Pure achromatic ink contrast
    expect(getOrbEyeInk('#F2F2F0')).toBe('#111111');
    expect(getOrbEyeInk('#171717')).toBe('#FFFFFF');
    expect(getOrbEyeInk('#D71921')).toBe('#FFFFFF');
  });
});

describe('Tauri IPC offline fallback', () => {
  beforeEach(() => {
    resetOfflineIpcState();
  });

  it('detects non-Tauri browser test environment and returns deterministic system status', async () => {
    expect(isTauriRuntime()).toBe(false);
    const status = await getSystemStatus();
    expect(status.runtime_mode).toBe('offline_browser');
    expect(status.kv_cache_hit_rate).toBeCloseTo(97.9, 1);
    expect(status.cost_saved_pct).toBeCloseTo(61.0, 1);
    expect(status.ledger_len).toBe(1);
    expect(status.hermes.providers.length).toBeGreaterThanOrEqual(4);
  });

  it('runs pack(), ship_gate(), and maintains hash-chained ledger events', async () => {
    const pack = await runPack({
      root: '.',
      query: 'checkout',
      files: [],
      include_outlines: true,
      max_bytes: 4096,
    });
    expect(pack.matches.length).toBeGreaterThan(0);
    expect(pack.outlines.length).toBeGreaterThan(0);
    expect(pack.redacted_secrets).toBe(1);

    const held = await runShipGate({
      root: '.',
      brief: {
        id: 'lane-a',
        goal: 'Rate limit',
        scope_globs: ['src/**'],
        lane_id: 'A',
        invariants: [],
      },
      edits: [],
      run_gate: true,
      human_approved: false,
    });
    expect(held.status).toBe('HELD_FOR_HUMAN_GATE');

    const denied = await runShipGate({
      root: '.',
      brief: {
        id: 'lane-a',
        goal: 'Rate limit',
        scope_globs: ['src/**'],
        lane_id: 'A',
        invariants: [],
      },
      edits: [],
      run_gate: false,
      human_approved: false,
    });
    expect(denied.status).toBe('ABORTED_BEFORE_WRITE');
    expect(denied.rolled_back).toBe(true);

    const approved = await runShipGate({
      root: '.',
      brief: {
        id: 'lane-a',
        goal: 'Rate limit',
        scope_globs: ['src/**'],
        lane_id: 'A',
        invariants: [],
      },
      edits: [],
      run_gate: true,
      human_approved: true,
    });
    expect(approved.status).toBe('SHIPPED_AND_VERIFIED');
    expect(approved.gate_passed).toBe(true);

    const evt1 = await appendLedgerEvent('outcome_scored', { passed: 14 });
    const evt2 = await appendLedgerEvent('usage_recorded', { tokens: 512 });
    expect(evt2.seq).toBe(evt1.seq + 1);
    expect(evt2.prev_hash).toBe(evt1.hash);
  });

  it('lists compat assets, forks local artifacts with CoW, and queries Apple VM status & builds', async () => {
    const compat = await listCompatAssets('.');
    expect(compat.length).toBeGreaterThanOrEqual(5);

    const forked = await createOrForkArtifact({
      action: 'fork',
      source_id: 'toast',
      fork_name: null,
    });
    expect(forked.fork_result?.source_id).toBe('toast');
    expect(forked.fork_result?.fork_url).toContain('toast-fork-1.git');
    expect(forked.repos).toHaveLength(2);

    const vmStatus = await getAppleVmStatus({
      backend: 'remote_apple_ssh',
      ssh_host: '100.84.12.9',
      ssh_user: 'aphesist',
      ssh_port: 22,
      repo_mount_path: '/Volumes/core',
      scheme: 'CorePay',
      simulator_device: 'iPhone 16 Pro',
    });
    expect(vmStatus.backend).toBe('remote_apple_ssh');
    expect(vmStatus.connected).toBe(true);

    const build = await runXcodeBuild({
      backend: 'local_qemu_kvm',
      ssh_host: '100.84.12.9',
      ssh_user: 'aphesist',
      ssh_port: 22,
      repo_mount_path: '/Volumes/core',
      scheme: 'CorePay',
      simulator_device: 'iPhone 16 Pro',
    });
    expect(build.succeeded).toBe(true);
    expect(build.tests_passed).toBe(build.tests_total);
  });
});
