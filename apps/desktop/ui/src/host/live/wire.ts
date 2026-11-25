/* The shapes the live sources read: the canonical gateway's results that Hermes's vendored contract does not type
   (it lags the backend), and the boopis-v1 plugin RPC (docs/PROTOCOL.md section 3). Every field a source reads is
   optional here, because a field the sender leaves out is unknown, never zero. */
import type { GatewayError } from '../gateway';

export interface UsageWire {
  model?: string; input?: number; output?: number; reasoning?: number; calls?: number;
  context_used?: number | null; context_max?: number | null; context_estimated?: boolean | null;
}
export interface InfoWire {
  model?: string | null; provider?: string | null; cwd?: string | null; branch?: string | null; version?: string | null; release_date?: string | null;
  usage?: UsageWire | null; running?: boolean; turn_started_at?: number | null;
}
export interface BreakdownWire { categories?: { id: string; label: string; tokens: number }[]; context_max?: number; context_used?: number; context_estimated?: boolean }
export interface McpStatusWire { servers?: { name: string; tools: number; connected: boolean; disabled: boolean; status: string; needs_auth?: boolean }[] }
export interface TierWire { name: string; model: { provider: string; id: string }; effort?: string }
export interface CascadeWire { ladder?: TierWire[]; status?: string; task_id?: string; tier?: string; tier_index?: number; attempt?: number }
export interface StatsWire {
  tokens?: { input_uncached?: number; output?: number; cache_read?: number; reasoning?: number; cache_write?: number };
  cost_usd?: number | null; cost_api_equivalent_usd?: number | null; subscription?: boolean; unpriced_models?: string[]; round_trips?: number; escalations?: number;
  rollbacks?: number; blanks?: number; approvals?: number;
}
export interface DescribeWire {
  session?: {
    session_id: string; mode: 'governed' | 'ungoverned'; locked: boolean; cwd: string | null;
    /** the Session tab's permission step and surface, whether a turn runs, whether files can be rewound (ADR-0057, ADR-0058) */
    careful?: string | null; careful_next?: string | null; surface?: string; running?: boolean; continued_from?: string | null; rewind?: { ok?: boolean; why?: string } | null;
  } | null;
  version?: string; capabilities?: string[]; hx?: { ok?: boolean; why?: string; version?: string } | null; kernel?: { ok?: boolean } | null;
  approvals?: { mode?: string | null } | null;
  config?: { mode?: 'governed' | 'ungoverned'; cost_cap_usd?: number | null };
  /** the frontier list, whether the ladder is all frontier, and, for a session that has begun, whether its own model is (ADR-0037) */
  frontier?: {
    allowed: string[]; sentence: string; available: boolean; why: string | null;
    tiers?: { tier: string; provider: string; model: string; frontier: boolean }[];
    session_model?: { provider: string; model: string; frontier: boolean; why: string | null };
  };
}
export interface DiffWire {
  files?: { path: string; status?: string; add: number; del: number; binary?: boolean; truncated?: boolean; hunks: { header: string; lines: string[] }[] }[];
  truncated?: boolean; unavailable?: string;
}
export interface InventoryWire { items?: { kind: string; name: string; status: string; reason?: string }[] }
export interface TodoWire { id?: string; content?: string; status?: string }
export interface BlankWire { blank_id: string; question?: string; options?: string[]; blocks?: string[]; answer?: string }
export interface ShipWire { ship_id: string; status: string; files?: { path: string }[]; gate?: { verdict?: string; gates?: string[] } }
export interface CompletionWire { items?: { text: string; display?: string; meta?: string }[] }

/** the gateway answered that it has no such method (an older or newer Hermes than the UI) */
export function isUnknownMethod(e: unknown): boolean {
  const err = e as Partial<GatewayError> | null;
  const data = err?.data as { reason?: unknown } | undefined;
  return err?.rpcCode === -32601 || data?.reason === 'unknown_method';
}

/** `model.options`: the providers the engine can run, each with its models (ids, no labels), and the engine's current model */
export interface ModelOptionsWire {
  providers?: { slug: string; name?: string; models?: string[]; featured_models?: string[] | null; authenticated?: boolean | null }[];
  model?: string; provider?: string;
}
