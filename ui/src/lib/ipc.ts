import { invoke } from '@tauri-apps/api/core';

export type EventKind =
  | 'task_created'
  | 'task_claimed'
  | 'task_submitted'
  | 'gate_decided'
  | 'route_decided'
  | 'router_trained'
  | 'fork_created'
  | 'usage_recorded'
  | 'outcome_scored';

export interface LedgerEvent {
  seq: number;
  timestamp: string;
  kind: EventKind;
  prev_hash: string;
  hash: string;
  payload: Record<string, unknown>;
}

export type CascadeTier = 'tier1_fast' | 'tier2_balanced' | 'tier3_frontier';

export interface TaskBrief {
  id: string;
  goal: string;
  scope_globs: string[];
  lane_id: string;
  invariants: string[];
}

export interface PackRequest {
  root: string;
  query: string | null;
  files: string[];
  include_outlines: boolean;
  max_bytes: number;
}

export interface PackMatch {
  path: string;
  line: number;
  snippet: string;
}

export interface PackOutline {
  path: string;
  symbols: string[];
}

export interface PackResult {
  matches: PackMatch[];
  outlines: PackOutline[];
  git_status: string[];
  redacted_secrets: number;
  truncated: boolean;
}

export interface ShipEdit {
  path: string;
  old_text: string | null;
  new_text: string;
  create_if_missing: boolean;
}

export interface ShipRequest {
  root: string;
  brief: TaskBrief;
  edits: ShipEdit[];
  run_gate: boolean;
  human_approved: boolean;
}

export type ShipStatus =
  | 'SHIPPED_AND_VERIFIED'
  | 'ABORTED_BEFORE_WRITE'
  | 'FAILED_AND_ROLLED_BACK'
  | 'HELD_FOR_HUMAN_GATE';

export interface ShipDiagnostic {
  path: string;
  reason: string;
  closest_snippet: string | null;
  first_diff_line: number | null;
}

export interface ShipResult {
  status: ShipStatus;
  changed_files: string[];
  gate_passed: boolean;
  gate_output: string;
  diagnostics: ShipDiagnostic[];
  rolled_back: boolean;
  cost_saved_usd: number;
}

export type CompatSource =
  | 'hermes_plugin'
  | 'claude_skill'
  | 'claude_command'
  | 'claude_hook'
  | 'cursor_rule'
  | 'codex_agents_md'
  | 'antigravity_skill';

export interface CompatAsset {
  id: string;
  name: string;
  source: CompatSource;
  path: string;
  description: string;
  scope_globs: string[];
  trigger: string | null;
}

export interface ArtifactCommit {
  hash: string;
  version: number;
  message: string;
  timestamp: string;
}

export interface ArtifactRepoSummary {
  id: string;
  namespace: string;
  name: string;
  git_url: string;
  head_commit: string;
  versions: ArtifactCommit[];
}

export interface ArtifactForkResult {
  source_id: string;
  fork_id: string;
  fork_url: string;
  head_commit: string;
}

export type ArtifactActionRequest =
  | { action: 'list' }
  | { action: 'create'; namespace: string; name: string; message: string }
  | { action: 'fork'; source_id: string; fork_name: string | null };

export interface ArtifactActionResponse {
  active: ArtifactRepoSummary;
  fork_result: ArtifactForkResult | null;
  repos: ArtifactRepoSummary[];
}

export type AppleVmBackendKind =
  | 'remote_apple_ssh'
  | 'local_qemu_kvm'
  | 'simulated_preview';

export interface AppleVmConfig {
  backend: AppleVmBackendKind;
  ssh_host: string;
  ssh_user: string;
  ssh_port: number;
  repo_mount_path: string;
  scheme: string;
  simulator_device: string;
}

export interface AppleVmStatus {
  backend: AppleVmBackendKind;
  connected: boolean;
  host_os_supported: boolean;
  detail: string;
  stream_hint: string;
}

export interface XcodeBuildResult {
  backend: AppleVmBackendKind;
  succeeded: boolean;
  duration_ms: number;
  tests_passed: number;
  tests_total: number;
  log_lines: string[];
  simulator_screen_title: string;
}

export type ProviderKind =
  | 'claude_direct_sdk'
  | 'gemini_nano_banana'
  | 'local_ollama'
  | 'custom_open_ai';

export interface ProviderProfile {
  id: string;
  kind: ProviderKind;
  model: string;
  display_name: string;
  connected: boolean;
  zero_api_cost: boolean;
}

export interface HermesBridgeStatus {
  hermes_found: boolean;
  hermes_version: string;
  hermes_home: string;
  claude_cli_found: boolean;
  cache_stabilizer_enabled: boolean;
  providers: ProviderProfile[];
}

export interface SystemStatus {
  app_name: string;
  version: string;
  workspace_root: string;
  hermes: HermesBridgeStatus;
  active_tier: CascadeTier;
  kv_cache_hit_rate: number;
  cost_saved_pct: number;
  ledger_len: number;
  ledger_head_hash: string;
  compat_count: number;
  artifact_port: number;
  runtime_mode: 'tauri' | 'offline_browser';
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
  );
}

// ============================================================================
// Deterministic Offline Simulation State (used outside Tauri webview / tests)
// ============================================================================

function fnvHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

interface OfflineState {
  ledger: LedgerEvent[];
  repos: ArtifactRepoSummary[];
  activeRepoId: string;
  forkCounter: number;
  compatAssets: CompatAsset[];
  appleConfig: AppleVmConfig;
}

function createInitialOfflineState(): OfflineState {
  const seedHash = fnvHex('0|genesis|hypotaxis');
  const repos: ArtifactRepoSummary[] = [
    {
      id: 'toast',
      namespace: 'default',
      name: 'CheckoutToast.tsx',
      git_url: 'http://127.0.0.1:53954/git/default/toast.git',
      head_commit: 'c94a10f',
      versions: [
        {
          hash: 'a10f82c',
          version: 1,
          message: 'Draft static pill',
          timestamp: '2026-11-18T01:40:00Z',
        },
        {
          hash: 'b38e19a',
          version: 2,
          message: 'Added countdown timer',
          timestamp: '2026-11-18T01:52:00Z',
        },
        {
          hash: 'c94a10f',
          version: 3,
          message: 'Final · 429 retry toast',
          timestamp: '2026-11-18T02:04:00Z',
        },
      ],
    },
  ];

  const compatAssets: CompatAsset[] = [
    {
      id: 'claude-skill-ship',
      name: 'atomic-ship-gate',
      source: 'claude_skill',
      path: '.claude/skills/atomic-ship/SKILL.md',
      description: 'Pre-write verified atomic edit + rollback discipline',
      scope_globs: ['src/**', 'crates/**'],
      trigger: 'ship',
    },
    {
      id: 'hermes-plugin-cache',
      name: 'cache-upto-stabilizer',
      source: 'hermes_plugin',
      path: '~/.hermes/plugins/cache_stabilizer.py',
      description: 'Pins Message.cache_upto >= 512 tok for 97.9% KV hit rate',
      scope_globs: ['*'],
      trigger: null,
    },
    {
      id: 'cursor-rule-monochrome',
      name: 'pure-nothing-monochrome',
      source: 'cursor_rule',
      path: '.cursor/rules/nothing-monochrome.mdc',
      description: 'Enforces R===G===B achromatic tokens & surgical crimson #D71921',
      scope_globs: ['ui/src/**'],
      trigger: '*.css,*.tsx',
    },
    {
      id: 'codex-agents',
      name: 'AGENTS.md',
      source: 'codex_agents_md',
      path: 'AGENTS.md',
      description: 'Sovereign workspace rules, aphesist authorship, lane isolation',
      scope_globs: ['*'],
      trigger: null,
    },
    {
      id: 'claude-hook-gate',
      name: 'pre-ship-hook',
      source: 'claude_hook',
      path: '.claude/hooks.json',
      description: 'Maps PreToolUse/PostToolUse checks into Kernel Gate invariants',
      scope_globs: ['src/**'],
      trigger: 'PreToolUse',
    },
    {
      id: 'antigravity-skill-orb',
      name: 'living-orb-physics',
      source: 'antigravity_skill',
      path: '.agents/skills/living-orb/SKILL.md',
      description: '96-vertex soft-body sphere + 32-pt exponential-map eyes',
      scope_globs: ['ui/src/components/LivingOrb.tsx'],
      trigger: 'orb',
    },
  ];

  return {
    ledger: [
      {
        seq: 1,
        timestamp: '2026-11-18T02:00:00Z',
        kind: 'route_decided',
        prev_hash: '0000000000000000',
        hash: seedHash,
        payload: { tier: 'tier1_fast', model: 'claude-haiku-4-5', cost_saved_pct: 61 },
      },
    ],
    repos,
    activeRepoId: 'toast',
    forkCounter: 0,
    compatAssets,
    appleConfig: {
      backend: 'local_qemu_kvm',
      ssh_host: '100.84.12.9',
      ssh_user: 'aphesist',
      ssh_port: 22,
      repo_mount_path: '/Volumes/core',
      scheme: 'CorePay',
      simulator_device: 'iPhone 16 Pro',
    },
  };
}

let offlineState: OfflineState = createInitialOfflineState();

export function resetOfflineIpcState(): void {
  offlineState = createInitialOfflineState();
}

function appendOfflineLedger(kind: EventKind, payload: Record<string, unknown>): LedgerEvent {
  const prev = offlineState.ledger[offlineState.ledger.length - 1];
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : '0000000000000000';
  const timestamp = `2026-11-18T02:${String(Math.min(59, seq)).padStart(2, '0')}:00Z`;
  const hash = fnvHex(`${seq}|${kind}|${prevHash}|${JSON.stringify(payload)}`);
  const evt: LedgerEvent = {
    seq,
    timestamp,
    kind,
    prev_hash: prevHash,
    hash,
    payload,
  };
  offlineState.ledger.push(evt);
  return evt;
}

async function callTauriOrFallback<T>(
  command: string,
  args: Record<string, unknown> | undefined,
  fallback: () => T,
): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, args);
  }
  return fallback();
}

export async function getSystemStatus(): Promise<SystemStatus> {
  return callTauriOrFallback('get_system_status', undefined, () => {
    const head = offlineState.ledger[offlineState.ledger.length - 1];
    return {
      app_name: 'Hypotaxis',
      version: '0.1.0',
      workspace_root: '~/core',
      hermes: {
        hermes_found: true,
        hermes_version: 'v0.23.2',
        hermes_home: '~/.hermes',
        claude_cli_found: true,
        cache_stabilizer_enabled: true,
        providers: [
          {
            id: 'claude-direct',
            kind: 'claude_direct_sdk',
            model: 'Claude Pro/Max',
            display_name: 'Claude Pro/Max',
            connected: true,
            zero_api_cost: true,
          },
          {
            id: 'gemini-banana',
            kind: 'gemini_nano_banana',
            model: 'Gemini + Nano Banana',
            display_name: 'Gemini + Nano Banana',
            connected: true,
            zero_api_cost: false,
          },
          {
            id: 'local-qwen3',
            kind: 'local_ollama',
            model: 'Qwen3-Coder / DeepSeek',
            display_name: 'Qwen3 / DeepSeek',
            connected: true,
            zero_api_cost: true,
          },
          {
            id: 'custom-openai',
            kind: 'custom_open_ai',
            model: 'GLM / Custom OpenAI',
            display_name: 'Custom OpenAI-Compat',
            connected: false,
            zero_api_cost: false,
          },
        ],
      },
      active_tier: 'tier1_fast',
      kv_cache_hit_rate: 97.9,
      cost_saved_pct: 61.0,
      ledger_len: offlineState.ledger.length,
      ledger_head_hash: head ? head.hash : '0000000000000000',
      compat_count: 18,
      artifact_port: 53954,
      runtime_mode: 'offline_browser',
    };
  });
}

export async function runPack(request: PackRequest): Promise<PackResult> {
  return callTauriOrFallback('run_pack', { request }, () => {
    const query = (request.query ?? 'rateLimit|checkout').trim() || 'rateLimit|checkout';
    return {
      matches: [
        {
          path: 'src/middleware/rateLimit.ts',
          line: 18,
          snippet: `export function applyLimit(userId: string) // matched "${query}"`,
        },
        {
          path: 'src/routes/checkout.ts',
          line: 42,
          snippet: 'router.post("/api/checkout", applyLimit, handleCheckout)',
        },
      ],
      outlines: request.include_outlines
        ? [
            {
              path: 'src/middleware/rateLimit.ts',
              symbols: ['RateWindowConfig', 'applyLimit', 'fallbackPolicy'],
            },
            {
              path: 'src/routes/checkout.ts',
              symbols: ['handleCheckout', 'CheckoutPayload'],
            },
          ]
        : [],
      git_status: ['M src/middleware/rateLimit.ts', 'M src/routes/checkout.ts'],
      redacted_secrets: 1,
      truncated: false,
    };
  });
}

export async function runShipGate(request: ShipRequest): Promise<ShipResult> {
  return callTauriOrFallback('run_ship_gate', { request }, () => {
    if (!request.human_approved && !request.run_gate) {
      appendOfflineLedger('gate_decided', {
        lane: request.brief.lane_id,
        decision: 'DENIED',
        rolled_back: true,
      });
      return {
        status: 'ABORTED_BEFORE_WRITE',
        changed_files: [],
        gate_passed: false,
        gate_output: 'gate.decided(DENIED) · 0 dirty files · working tree restored byte-for-byte',
        diagnostics: [
          {
            path: request.edits[0]?.path ?? 'src/middleware/rateLimit.ts',
            reason: 'Human gate denied ship; rollback journal restored pre-image.',
            closest_snippet: null,
            first_diff_line: null,
          },
        ],
        rolled_back: true,
        cost_saved_usd: 0,
      };
    }

    if (!request.human_approved) {
      return {
        status: 'HELD_FOR_HUMAN_GATE',
        changed_files: request.edits.map((e) => e.path),
        gate_passed: false,
        gate_output: 'Held for human approval on Contract Lane',
        diagnostics: [],
        rolled_back: false,
        cost_saved_usd: 0,
      };
    }

    appendOfflineLedger('gate_decided', {
      lane: request.brief.lane_id,
      decision: 'PASS',
      files: request.edits.map((e) => e.path),
    });

    return {
      status: 'SHIPPED_AND_VERIFIED',
      changed_files:
        request.edits.length > 0
          ? request.edits.map((e) => e.path)
          : ['src/middleware/rateLimit.ts', 'src/routes/checkout.ts'],
      gate_passed: true,
      gate_output: 'gate.decided(PASS) · 14/14 assertions passed · $0.038 vs $0.112 Opus',
      diagnostics: [],
      rolled_back: false,
      cost_saved_usd: 0.074,
    };
  });
}

export async function listCompatAssets(root: string | null = null): Promise<CompatAsset[]> {
  return callTauriOrFallback('list_compat_assets', { root }, () => [...offlineState.compatAssets]);
}

export async function createOrForkArtifact(
  request: ArtifactActionRequest,
): Promise<ArtifactActionResponse> {
  return callTauriOrFallback('create_or_fork_artifact', { request }, () => {
    if (request.action === 'fork') {
      const source =
        offlineState.repos.find((r) => r.id === request.source_id) ?? offlineState.repos[0];
      offlineState.forkCounter += 1;
      const forkId = `${source.id}-fork-${offlineState.forkCounter}`;
      const forkUrl = `http://127.0.0.1:53954/git/${source.namespace}/${forkId}.git`;
      const forked: ArtifactRepoSummary = {
        id: forkId,
        namespace: source.namespace,
        name: request.fork_name ?? `${source.name} (fork-${offlineState.forkCounter})`,
        git_url: forkUrl,
        head_commit: source.head_commit,
        versions: [...source.versions],
      };
      offlineState.repos.push(forked);
      offlineState.activeRepoId = forkId;
      appendOfflineLedger('fork_created', {
        source_id: source.id,
        fork_id: forkId,
        fork_url: forkUrl,
      });
      return {
        active: forked,
        fork_result: {
          source_id: source.id,
          fork_id: forkId,
          fork_url: forkUrl,
          head_commit: source.head_commit,
        },
        repos: [...offlineState.repos],
      };
    }

    if (request.action === 'create') {
      const existing = offlineState.repos.find((r) => r.id === request.name);
      if (existing) {
        const nextVer = existing.versions.length + 1;
        const nextHash = fnvHex(`${existing.id}|v${nextVer}|${request.message}`).slice(0, 7);
        existing.versions.push({
          hash: nextHash,
          version: nextVer,
          message: request.message,
          timestamp: '2026-11-18T02:15:00Z',
        });
        existing.head_commit = nextHash;
        offlineState.activeRepoId = existing.id;
        return {
          active: existing,
          fork_result: null,
          repos: [...offlineState.repos],
        };
      }
      const created: ArtifactRepoSummary = {
        id: request.name,
        namespace: request.namespace,
        name: request.name,
        git_url: `http://127.0.0.1:53954/git/${request.namespace}/${request.name}.git`,
        head_commit: 'd12e001',
        versions: [
          {
            hash: 'd12e001',
            version: 1,
            message: request.message,
            timestamp: '2026-11-18T02:15:00Z',
          },
        ],
      };
      offlineState.repos.push(created);
      offlineState.activeRepoId = created.id;
      return {
        active: created,
        fork_result: null,
        repos: [...offlineState.repos],
      };
    }

    const active =
      offlineState.repos.find((r) => r.id === offlineState.activeRepoId) ?? offlineState.repos[0];
    return {
      active,
      fork_result: null,
      repos: [...offlineState.repos],
    };
  });
}

export async function getAppleVmStatus(
  config: AppleVmConfig | null = null,
): Promise<AppleVmStatus> {
  return callTauriOrFallback('get_apple_vm_status', { config }, () => {
    if (config) {
      offlineState.appleConfig = config;
    }
    const cfg = offlineState.appleConfig;
    if (cfg.backend === 'remote_apple_ssh') {
      return {
        backend: 'remote_apple_ssh',
        connected: true,
        host_os_supported: true,
        detail: `Connected to Mac mini M4 (${cfg.ssh_host}) via Tailscale SSH — native Metal-accelerated iOS Simulator & Xcode previews.`,
        stream_hint: 'Tailscale · Mac M4',
      };
    }
    if (cfg.backend === 'simulated_preview') {
      return {
        backend: 'simulated_preview',
        connected: true,
        host_os_supported: true,
        detail: 'Deterministic local Apple Simulator preview runner active for offline/CI verification.',
        stream_hint: 'Simulated · Local',
      };
    }
    return {
      backend: 'local_qemu_kvm',
      connected: true,
      host_os_supported: true,
      detail:
        'Local QEMU/KVM + OpenCore CLI builds, or pair a Remote Apple Silicon Mac over Tailscale for full Metal iOS Simulator speed.',
      stream_hint: 'QEMU/KVM · VirtioFS',
    };
  });
}

export async function runXcodeBuild(config: AppleVmConfig): Promise<XcodeBuildResult> {
  return callTauriOrFallback('run_xcode_build', { config }, () => {
    offlineState.appleConfig = config;
    const isRemote = config.backend === 'remote_apple_ssh';
    return {
      backend: config.backend,
      succeeded: true,
      duration_ms: isRemote ? 840 : 1120,
      tests_passed: 14,
      tests_total: 14,
      log_lines: [
        `Syncing ${config.repo_mount_path} over VirtioFS...`,
        `xcodebuild test -scheme ${config.scheme} -destination "platform=iOS Simulator,name=${config.simulator_device}"`,
        'Test Suite CheckoutRateLimitTests passed (14/14 assertions)',
      ],
      simulator_screen_title: 'CorePay iOS · 429 Retry Guard',
    };
  });
}

export async function appendLedgerEvent(
  kind: EventKind,
  payload: Record<string, unknown>,
): Promise<LedgerEvent> {
  return callTauriOrFallback('append_ledger_event', { kind, payload }, () =>
    appendOfflineLedger(kind, payload),
  );
}
