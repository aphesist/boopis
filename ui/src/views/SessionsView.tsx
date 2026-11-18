import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { DitherCardStack, type DitherCardItem } from '../components/DitherCardStack';
import {
  appendLedgerEvent,
  createOrForkArtifact,
  runPack,
  runShipGate,
  type ArtifactRepoSummary,
  type PackResult,
  type SystemStatus,
} from '../lib/ipc';

export interface SessionSummary {
  id: string;
  title: string;
  subtitle: string;
  lane: string;
}

export const INITIAL_SESSIONS: SessionSummary[] = [
  {
    id: 'checkout',
    title: 'Checkout rate-limit & Redis',
    subtitle: 'CardStack held · 2 files packed',
    lane: 'Lane A',
  },
  {
    id: 'artifacts',
    title: 'Local Artifacts git-fs',
    subtitle: '127.0.0.1:53954 · v3 forked',
    lane: 'Lane B',
  },
  {
    id: 'swiftui',
    title: 'SwiftUI Widget · Apple VM',
    subtitle: 'xcodebuild · 14 assertions passed',
    lane: 'Lane C',
  },
];

interface SessionExtraMessage {
  id: string;
  prompt: string;
  reply: string;
}

const SESSION_GATE_CARDS: DitherCardItem[] = [
  {
    id: 'sess-gate-1',
    title: 'ship() wants to use a secret & verify gate',
    quote: '"final gate check before atomic ship on lane A"',
    host: 'staging-redis.internal',
    hostMeta: 'REDIS_URL · vault secret',
    scope: 'Scope PASS (2/2 files, +38/-6) · Protected tests untouched',
    cmd: "'pnpm vitest run checkout.spec.ts' in ~/core",
    footerNote: '1 queued · rollback journal armed (#9f2c04)',
  },
  {
    id: 'sess-gate-2',
    title: 'Promote CheckoutToast artifact to local Git mirror',
    quote: '"commit v3 verified 429 retry toast into artifact store"',
    host: '127.0.0.1:53954',
    hostMeta: 'ArtifactFS · blobless',
    scope: 'Queue #2 · Contract Lane A verified',
    cmd: 'git push origin main',
  },
];

export interface SessionsRailProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  compatCount: number;
  onSelectSession: (id: string) => void;
}

export function SessionsRail({
  sessions,
  activeSessionId,
  compatCount,
  onSelectSession,
}: SessionsRailProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 px-3 pt-3 pb-2 overflow-y-auto">
      <div
        className="px-2 pb-2 flex items-center justify-between text-[11px]"
        style={{ color: 'var(--ink-tertiary)' }}
      >
        <span className="font-mono-tech">aphesist/core · main</span>
        <span>{sessions.length}</span>
      </div>

      <div className="space-y-0.5">
        {sessions.map((sess) => {
          const active = sess.id === activeSessionId;
          return (
            <button
              key={sess.id}
              type="button"
              onClick={() => onSelectSession(sess.id)}
              className="w-full text-left px-3 py-2.5 rounded-[10px] transition-colors"
              style={{ background: active ? 'var(--bg-selected)' : 'transparent' }}
            >
              <div
                className="text-[13px] font-medium truncate"
                style={{ color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
              >
                {sess.title}
              </div>
              <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--ink-tertiary)' }}>
                {sess.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      <div
        className="mt-auto pt-4 px-2 border-t hairline text-[11px] space-y-1"
        style={{ color: 'var(--ink-tertiary)' }}
      >
        <div className="flex justify-between">
          <span>Compat Loader</span>
          <span className="font-mono-tech" style={{ color: 'var(--ink-secondary)' }}>
            {compatCount} active
          </span>
        </div>
        <div className="leading-relaxed">Hermes v0.23 · .claude · .cursor · AGENTS.md</div>
      </div>
    </div>
  );
}

export interface SessionsViewProps {
  sessions: SessionSummary[];
  activeSessionId: string;
  systemStatus: SystemStatus | null;
  compatCount: number;
  composerInputRef?: RefObject<HTMLInputElement | null>;
  onOpenBrainsPopover: () => void;
  onLedgerChanged: () => void;
}

export function SessionsView({
  sessions,
  activeSessionId,
  systemStatus,
  compatCount,
  composerInputRef,
  onOpenBrainsPopover,
  onLedgerChanged,
}: SessionsViewProps) {
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? sessions[0];
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Header & Drawer state
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [artifactsOpen, setArtifactsOpen] = useState(false);

  // pack() trace
  const [packExpanded, setPackExpanded] = useState(false);
  const [packData, setPackData] = useState<PackResult | null>(null);

  // @liu_xingyu Leaving Blanks
  const [rateLimitReq, setRateLimitReq] = useState(30);
  const [failPolicy, setFailPolicy] = useState<string | null>(null);
  const [openBlank, setOpenBlank] = useState<'window' | 'failmode' | null>(null);

  // Gate CardStack
  const [gateCardIdx, setGateCardIdx] = useState(0);
  const [gateVerifying, setGateVerifying] = useState(false);
  const [gateResolved, setGateResolved] = useState<{
    title: string;
    quote: string;
    footer: string;
  } | null>(null);
  const [smokeSpeed, setSmokeSpeed] = useState(1.0);
  const [smokePower, setSmokePower] = useState(1.0);

  // Local Artifacts Drawer
  const [artifactRepo, setArtifactRepo] = useState<ArtifactRepoSummary>({
    id: 'toast',
    namespace: 'default',
    name: 'CheckoutToast.tsx',
    git_url: 'http://127.0.0.1:53954/git/default/toast.git',
    head_commit: 'c94a10f',
    versions: [
      { hash: 'a10f82c', version: 1, message: 'Draft static pill', timestamp: '2026-11-18T01:40:00Z' },
      { hash: 'b38e19a', version: 2, message: 'Added countdown timer', timestamp: '2026-11-18T01:52:00Z' },
      { hash: 'c94a10f', version: 3, message: 'Final · 429 retry toast', timestamp: '2026-11-18T02:04:00Z' },
    ],
  });
  const [artVer, setArtVer] = useState(3);
  const [artTab, setArtTab] = useState<'preview' | 'diff'>('preview');
  const [forkBadge, setForkBadge] = useState<string | null>(null);
  const [forkCount, setForkCount] = useState(0);

  // Feedforward composer
  const [sessInput, setSessInput] = useState(
    'Update the 429 retry toast animation and test it on iPhone 16 Pro simulator',
  );
  const [routeLabel, setRouteLabel] = useState('Haiku → Opus (-61%)');
  const [ffOpen, setFfOpen] = useState(false);
  const [extraMessages, setExtraMessages] = useState<SessionExtraMessage[]>([]);

  useEffect(() => {
    let cancelled = false;
    createOrForkArtifact({ action: 'list' }).then((res) => {
      if (!cancelled) {
        setArtifactRepo(res.active);
        const latest = res.active.versions[res.active.versions.length - 1]?.version ?? 3;
        setArtVer(latest);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const closePopovers = () => {
      setLedgerOpen(false);
      setOpenBlank(null);
      setFfOpen(false);
    };
    window.addEventListener('click', closePopovers);
    return () => window.removeEventListener('click', closePopovers);
  }, []);

  const feedforward = useMemo(() => {
    const l = sessInput.toLowerCase();
    const pills = ['pack + ship'];
    if (l.includes('simulator') || l.includes('ios') || l.includes('swift')) {
      pills.unshift('macOS VM');
    }
    if (l.includes('icon') || l.includes('image') || l.includes('nano')) {
      pills.unshift('nano-banana');
    }
    if (l.includes('repl') || l.includes('script')) {
      pills.unshift('exec REPL');
    }
    const scope =
      l.includes('simulator') || l.includes('ios')
        ? 'scope: ios/CheckoutView.swift, src/ui/CheckoutToast.tsx'
        : l.includes('toast')
          ? 'scope: src/ui/CheckoutToast.tsx'
          : 'scope: inferred on pack';
    return { pills, scope };
  }, [sessInput]);

  const handleTogglePackTrace = async () => {
    const nextExpanded = !packExpanded;
    setPackExpanded(nextExpanded);
    if (nextExpanded && !packData) {
      const res = await runPack({
        root: '.',
        query: 'rateLimit|checkout',
        files: ['src/middleware/rateLimit.ts', 'src/routes/checkout.ts'],
        include_outlines: true,
        max_bytes: 4096,
      });
      setPackData(res);
    }
  };

  const handleApproveGate = async (card: DitherCardItem) => {
    setSmokeSpeed(2.3);
    setGateVerifying(true);
    const res = await runShipGate({
      root: '.',
      brief: {
        id: card.id,
        goal: 'Wire sliding-window rate limiting into /api/checkout',
        scope_globs: ['src/middleware/rateLimit.ts', 'src/routes/checkout.ts'],
        lane_id: 'A',
        invariants: ['Protected tests untouched'],
      },
      edits: [
        {
          path: 'src/middleware/rateLimit.ts',
          old_text: null,
          new_text: `// budget: 60s / ${rateLimitReq} req (${failPolicy ?? 'fail-closed (HTTP 429)'})`,
          create_if_missing: false,
        },
      ],
      run_gate: true,
      human_approved: true,
    });
    window.setTimeout(() => {
      setGateVerifying(false);
      setSmokeSpeed(0.5);
      setSmokePower(0.65);
      setGateResolved({
        title: `${res.status} · lane A`,
        quote: '"14/14 assertions passed · Haiku solved on 1st attempt"',
        footer: res.gate_output,
      });
      onLedgerChanged();
    }, 520);
  };

  const handleDenyGate = async (card: DitherCardItem) => {
    setGateVerifying(true);
    const res = await runShipGate({
      root: '.',
      brief: {
        id: card.id,
        goal: 'Wire sliding-window rate limiting into /api/checkout',
        scope_globs: ['src/middleware/rateLimit.ts'],
        lane_id: 'A',
        invariants: [],
      },
      edits: [],
      run_gate: false,
      human_approved: false,
    });
    setGateVerifying(false);
    setSmokeSpeed(0.35);
    setSmokePower(0.45);
    setGateResolved({
      title: 'ABORTED · rolled back cleanly',
      quote: '"working tree restored byte-for-byte via rollback journal"',
      footer: res.gate_output,
    });
    onLedgerChanged();
  };

  const handleResetGate = () => {
    setSmokeSpeed(1.0);
    setSmokePower(1.0);
    setGateResolved(null);
    setGateCardIdx(0);
  };

  const handleForkArtifact = async () => {
    const res = await createOrForkArtifact({
      action: 'fork',
      source_id: artifactRepo.id,
      fork_name: null,
    });
    setArtifactRepo(res.active);
    const nextCount = forkCount + 1;
    setForkCount(nextCount);
    setForkBadge(`Forked #${nextCount}`);
    onLedgerChanged();
    window.setTimeout(() => setForkBadge(null), 1800);
  };

  const handleSelectRoute = async (label: string) => {
    setRouteLabel(label);
    setFfOpen(false);
    await appendLedgerEvent('route_decided', { route: label });
    onLedgerChanged();
  };

  const handleSendSessMsg = async () => {
    const txt = sessInput.trim();
    if (!txt) return;
    setSessInput('');
    const nextItem: SessionExtraMessage = {
      id: `sm-${Date.now()}`,
      prompt: txt,
      reply: `Queued on Contract Lane B — routing via ${routeLabel}.`,
    };
    setExtraMessages((prev) => [...prev, nextItem]);
    await appendLedgerEvent('task_created', { session: activeSession.id, prompt: txt });
    onLedgerChanged();
    requestAnimationFrame(() => {
      if (transcriptRef.current) {
        transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
      }
    });
  };

  const latestVersion = artifactRepo.versions[artifactRepo.versions.length - 1]?.version ?? 3;
  const activeVersionCommit =
    artifactRepo.versions.find((v) => v.version === artVer) ??
    artifactRepo.versions[artifactRepo.versions.length - 1];

  return (
    <section className="flex-1 flex flex-col min-h-0 relative anim-panel">
      {/* Airy 48px Header */}
      <header className="h-[48px] px-7 border-b hairline flex items-center justify-between shrink-0 relative">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--ink-primary)' }}>
            {activeSession.title}
          </span>
          <span className="font-mono-tech text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
            {activeSession.lane}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpenBlank(null);
              setFfOpen(false);
              setLedgerOpen((o) => !o);
            }}
            className="px-3 py-1 rounded-full border hairline text-[11.5px] font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
          >
            Cascade · -{Math.round(systemStatus?.cost_saved_pct ?? 61)}%
          </button>
          <button
            type="button"
            onClick={() => setArtifactsOpen((o) => !o)}
            className="px-3 py-1 rounded-full border hairline text-[11.5px] font-medium transition-opacity hover:opacity-80"
            style={{ background: 'var(--bg-elevated)', color: 'var(--ink-primary)' }}
          >
            Artifacts · v{latestVersion}
          </button>
        </div>

        {ledgerOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-7 top-[52px] z-40 w-[284px] rounded-[14px] border hairline p-4 text-[12px] space-y-2.5 anim-panel"
            style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-popover)' }}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                Contraprova Ledger
              </span>
              <span className="font-mono-tech text-[10px]" style={{ color: 'var(--ink-tertiary)' }}>
                Hash-chained ({systemStatus?.ledger_len ?? 1})
              </span>
            </div>
            <div className="space-y-1.5 text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
              <div className="flex justify-between">
                <span>Cascade tier</span>
                <span className="font-mono-tech" style={{ color: 'var(--ink-primary)' }}>
                  Haiku 5.5 (1st try)
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tool surface</span>
                <span className="font-mono-tech" style={{ color: 'var(--ink-primary)' }}>
                  pack · exec · ship
                </span>
              </div>
              <div className="flex justify-between">
                <span>KV-cache hit</span>
                <span className="font-mono-tech" style={{ color: 'var(--ink-primary)' }}>
                  {(systemStatus?.kv_cache_hit_rate ?? 97.9).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Cost delta</span>
                <span className="font-mono-tech" style={{ color: 'var(--ink-primary)' }}>
                  $0.038 vs $0.112
                </span>
              </div>
              <div className="flex justify-between">
                <span>Head hash</span>
                <span className="font-mono-tech" style={{ color: 'var(--ink-tertiary)' }}>
                  {(systemStatus?.ledger_head_hash ?? 'c94a10f').slice(0, 10)}
                </span>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Sessions Content + Local Artifacts Drawer */}
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div ref={transcriptRef} className="flex-1 overflow-y-auto px-7 sm:px-12 py-8">
            <div className="max-w-[660px] mx-auto space-y-7">
              {/* User Prompt */}
              <div className="flex justify-end">
                <div
                  className="max-w-[80%] px-4 py-2.5 rounded-[16px] text-[14px] leading-relaxed"
                  style={{
                    background: 'var(--bg-bubble-user)',
                    color: 'var(--ink-bubble-user)',
                  }}
                >
                  Wire sliding-window rate limiting into{' '}
                  <code className="font-mono-tech text-[12.5px] opacity-85">/api/checkout</code>, verify
                  against staging Redis, and stage a subtle toast artifact.
                </div>
              </div>

              {/* 1-Line Collapsible pack() + Unboxed Prose with @liu_xingyu Leaving Blanks */}
              <div className="space-y-3.5 relative">
                <div>
                  <button
                    type="button"
                    onClick={handleTogglePackTrace}
                    className="inline-flex items-center gap-2 font-mono-tech text-[11.5px] transition-opacity hover:opacity-75"
                    style={{ color: 'var(--ink-tertiary)' }}
                  >
                    <span>{packExpanded ? '▾' : '▸'}</span>
                    <span>Packed 4 symbols &amp; AST outlines in 1 turn · 0.9s</span>
                  </button>

                  {packExpanded && (
                    <div
                      className="mt-2 ml-3 pl-3 border-l hairline font-mono-tech text-[11px] space-y-1 anim-panel"
                      style={{ color: 'var(--ink-tertiary)' }}
                    >
                      <div>pack(&quot;rateLimit|checkout&quot;, outlines=true) → 2.4 KB</div>
                      <div>
                        {(packData?.outlines ?? [])
                          .map((o) => `${o.path}#${o.symbols[0] ?? 'symbol'}`)
                          .join(' · ') || 'src/middleware/rateLimit.ts#applyLimit · src/routes/checkout.ts'}
                      </div>
                      <div>
                        Secret shield PASS ({packData?.redacted_secrets ?? 1} redacted) · Contract Lane A
                        locked
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-[14.5px] leading-[1.68]" style={{ color: 'var(--ink-primary)' }}>
                  Mapped the checkout middleware and route handler. Enforcing a{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLedgerOpen(false);
                      setFfOpen(false);
                      setOpenBlank((b) => (b === 'window' ? null : 'window'));
                    }}
                    className="blank-chip"
                    data-unresolved="false"
                  >
                    <span>60s · {rateLimitReq} req</span>
                    <span style={{ color: 'var(--ink-tertiary)' }}>▾</span>
                  </button>{' '}
                  budget per user ID, with Redis outage behavior set to{' '}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLedgerOpen(false);
                      setFfOpen(false);
                      setOpenBlank((b) => (b === 'failmode' ? null : 'failmode'));
                    }}
                    className="blank-chip"
                    data-unresolved={failPolicy === null ? 'true' : 'false'}
                  >
                    <span>{failPolicy ?? 'choose Redis fallback'}</span>
                    <span
                      style={{
                        color: failPolicy === null ? 'var(--accent-crimson)' : 'var(--ink-tertiary)',
                      }}
                    >
                      ▾
                    </span>
                  </button>{' '}
                  before atomic ship runs the staging verification suite.
                </div>

                {openBlank !== null && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-4 top-20 z-30 w-[270px] rounded-[12px] border hairline p-3.5 text-[12px] anim-panel"
                    style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-popover)' }}
                  >
                    {openBlank === 'window' ? (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                            Rate budget per user
                          </span>
                          <button
                            type="button"
                            onClick={() => setOpenBlank(null)}
                            style={{ color: 'var(--ink-tertiary)' }}
                          >
                            ✕
                          </button>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={100}
                          step={10}
                          value={rateLimitReq}
                          onChange={(e) => setRateLimitReq(Number.parseInt(e.target.value, 10))}
                          className="w-full accent-current"
                        />
                        <div
                          className="flex justify-between mt-1.5 font-mono-tech text-[11px]"
                          style={{ color: 'var(--ink-secondary)' }}
                        >
                          <span>10</span>
                          <span style={{ color: 'var(--ink-primary)' }}>{rateLimitReq} req / 60s</span>
                          <span>100</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                            Redis outage fallback
                          </span>
                          <button
                            type="button"
                            onClick={() => setOpenBlank(null)}
                            style={{ color: 'var(--ink-tertiary)' }}
                          >
                            ✕
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {[
                            { label: 'fail-closed (HTTP 429)', val: 'fail-closed (429)' },
                            { label: 'in-memory LRU fallback', val: 'in-memory LRU fallback' },
                            { label: 'fail-open + metric', val: 'fail-open + metric' },
                          ].map((opt) => (
                            <button
                              key={opt.val}
                              type="button"
                              onClick={() => {
                                setFailPolicy(opt.val);
                                setOpenBlank(null);
                              }}
                              className="w-full text-left px-2.5 py-1.5 rounded-[8px] border hairline transition-opacity hover:opacity-80"
                              style={{ color: 'var(--ink-primary)' }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* CardStack: 1-Bit Bayer Smoke Gate & Ship Card */}
              <div className="pt-3">
                <DitherCardStack
                  cards={SESSION_GATE_CARDS}
                  currentIndex={gateCardIdx}
                  smokeSpeed={smokeSpeed}
                  smokePower={smokePower}
                  verifying={gateVerifying}
                  resolvedTitle={gateResolved?.title}
                  resolvedQuote={gateResolved?.quote}
                  resolvedFooter={gateResolved?.footer}
                  primaryLabel="Touch to approve"
                  secondaryLabel="Deny"
                  onApprove={handleApproveGate}
                  onSecondary={handleDenyGate}
                  onReset={handleResetGate}
                />
              </div>

              {/* Flat 1-Line Local Artifact Link */}
              <button
                type="button"
                onClick={() => setArtifactsOpen(true)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-[12px] border hairline text-left transition-colors hover:opacity-85"
                style={{ background: 'var(--bg-surface)' }}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate" style={{ color: 'var(--ink-primary)' }}>
                    {artifactRepo.name} · Local Git Artifact
                  </div>
                  <div className="font-mono-tech text-[11px] truncate" style={{ color: 'var(--ink-tertiary)' }}>
                    {artifactRepo.git_url} · v{latestVersion}
                  </div>
                </div>
                <span className="text-[12px] font-medium ml-3 shrink-0" style={{ color: 'var(--ink-secondary)' }}>
                  Open ↗
                </span>
              </button>

              {/* Appended turns from Feedforward composer */}
              {extraMessages.map((msg) => (
                <div key={msg.id} className="space-y-4">
                  <div className="flex justify-end anim-user-in">
                    <div
                      className="max-w-[80%] px-4 py-2.5 rounded-[16px] text-[14px]"
                      style={{
                        background: 'var(--bg-bubble-user)',
                        color: 'var(--ink-bubble-user)',
                      }}
                    >
                      {msg.prompt}
                    </div>
                  </div>
                  <div className="text-[14.5px] leading-[1.68] anim-panel" style={{ color: 'var(--ink-primary)' }}>
                    {msg.reply}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sessions 18px Composer + Quiet Feedforward Strip */}
          <div className="px-7 sm:px-12 pb-5 pt-2 shrink-0">
            <div className="max-w-[660px] mx-auto relative">
              {ffOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-[106px] left-0 z-30 w-[290px] rounded-[12px] border hairline p-3.5 text-[12px] anim-panel"
                  style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-popover)' }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                      Route before send
                    </span>
                    <button
                      type="button"
                      onClick={() => setFfOpen(false)}
                      style={{ color: 'var(--ink-tertiary)' }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-1.5" style={{ color: 'var(--ink-secondary)' }}>
                    {[
                      { name: 'Cascade · Haiku → Opus (-61%)', val: 'Haiku → Opus (-61%)' },
                      { name: 'Local · Qwen3-Coder ($0.00)', val: 'Qwen3-Coder Local ($0)' },
                      { name: 'Gemini · Nano Banana visual', val: 'Gemini + Nano Banana' },
                    ].map((opt) => (
                      <label key={opt.val} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="sff"
                          checked={routeLabel === opt.val}
                          onChange={() => handleSelectRoute(opt.val)}
                        />
                        <span>{opt.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div
                className="rounded-[18px] border hairline"
                style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
              >
                <div
                  className="px-4 py-2 border-b hairline flex items-center justify-between gap-2 text-[11px]"
                  style={{ color: 'var(--ink-tertiary)' }}
                >
                  <div className="truncate">
                    Routes via{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLedgerOpen(false);
                        setOpenBlank(null);
                        setFfOpen((o) => !o);
                      }}
                      className="ff-token font-medium"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      {routeLabel}
                    </button>{' '}
                    · <span className="font-mono-tech">{feedforward.scope}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {feedforward.pills.map((pill) => (
                      <span
                        key={pill}
                        className="px-2 py-0.5 rounded-full border hairline font-mono-tech text-[10px]"
                        style={{ color: 'var(--ink-secondary)' }}
                      >
                        {pill}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="px-4 pt-3 pb-2">
                  <input
                    ref={composerInputRef}
                    type="text"
                    value={sessInput}
                    onChange={(e) => setSessInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSendSessMsg();
                    }}
                    placeholder="Ask anything — scope & capabilities resolve live..."
                    className="w-full bg-transparent text-[13.5px] focus:outline-none"
                    style={{ color: 'var(--ink-primary)' }}
                  />
                </div>

                <div
                  className="px-3.5 pb-2.5 flex items-center justify-between text-[11.5px]"
                  style={{ color: 'var(--ink-tertiary)' }}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="w-[26px] h-[26px] rounded-full border hairline flex items-center justify-center"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenBrainsPopover();
                      }}
                      className="px-2.5 py-1 rounded-full border hairline transition-opacity hover:opacity-80"
                      style={{ color: 'var(--ink-secondary)' }}
                    >
                      {compatCount} Skills (.claude + Hermes)
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleSendSessMsg}
                    className="w-[28px] h-[28px] rounded-full flex items-center justify-center text-[13px] font-medium transition-opacity hover:opacity-85"
                    style={{ background: 'var(--ink-primary)', color: 'var(--bg-app)' }}
                  >
                    ↑
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Local Artifacts Drawer (@dinasaur_404) */}
        {artifactsOpen && (
          <aside
            className="w-[350px] shrink-0 border-l hairline flex flex-col min-h-0 anim-panel"
            style={{ background: 'var(--bg-rail)' }}
          >
            <div className="h-[48px] px-4 border-b hairline flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--ink-primary)' }}>
                  Local Artifact
                </div>
                <div className="font-mono-tech text-[10px] truncate" style={{ color: 'var(--ink-tertiary)' }}>
                  {artifactRepo.git_url.replace(/^http:\/\//, '')}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleForkArtifact}
                  className="px-2.5 py-1 rounded-full border hairline text-[11px] font-medium transition-opacity hover:opacity-80"
                  style={{ background: 'var(--bg-surface)', color: 'var(--ink-primary)' }}
                >
                  {forkBadge ?? 'Fork (CoW)'}
                </button>
                <button
                  type="button"
                  onClick={() => setArtifactsOpen(false)}
                  className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[12px]"
                  style={{ color: 'var(--ink-tertiary)' }}
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="px-4 py-2.5 border-b hairline flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1 font-mono-tech">
                {artifactRepo.versions.map((ver) => {
                  const active = ver.version === artVer;
                  return (
                    <button
                      key={ver.version}
                      type="button"
                      onClick={() => setArtVer(ver.version)}
                      className="px-2 py-0.5 rounded-full transition-colors"
                      style={{
                        background: active ? 'var(--ink-primary)' : 'transparent',
                        color: active ? 'var(--bg-app)' : 'var(--ink-tertiary)',
                      }}
                    >
                      v{ver.version}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setArtTab('preview')}
                  className="px-2 py-0.5 rounded-[6px] font-medium"
                  style={{
                    background: artTab === 'preview' ? 'var(--bg-selected)' : 'transparent',
                    color: artTab === 'preview' ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
                  }}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setArtTab('diff')}
                  className="px-2 py-0.5 rounded-[6px] font-medium"
                  style={{
                    background: artTab === 'diff' ? 'var(--bg-selected)' : 'transparent',
                    color: artTab === 'diff' ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
                  }}
                >
                  Diff
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {artTab === 'diff' ? (
                <div
                  className="rounded-[12px] border hairline p-3 font-mono-tech text-[11px] leading-relaxed"
                  style={{ background: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
                >
                  <div style={{ color: 'var(--ink-tertiary)' }}>
                    commit v{artVer} ({activeVersionCommit?.hash ?? 'c94a10f'}) · local-artifacts
                  </div>
                  <div className="mt-2" style={{ color: 'var(--ink-primary)' }}>
                    + export function CheckoutToast({'{ retryAfter }'}) {'{'}
                  </div>
                  <div>+   return &lt;div className=&quot;rounded-full px-4 py-2&quot;&gt;</div>
                  <div>
                    +     {artVer === 3 ? 'Cooling down · retry in {retryAfter}s' : 'Rate limit active'}
                  </div>
                  <div>+   &lt;/div&gt;</div>
                  <div>+ {'}'}</div>
                </div>
              ) : (
                <>
                  <div
                    className="rounded-[14px] border hairline p-4 space-y-3"
                    style={{ background: 'var(--bg-surface)' }}
                  >
                    <div
                      className="flex items-center justify-between text-[11px]"
                      style={{ color: 'var(--ink-tertiary)' }}
                    >
                      <span>Preview · v{artVer}</span>
                      <span className="font-mono-tech">
                        {activeVersionCommit?.message ?? 'Final · 429 retry toast'}
                      </span>
                    </div>
                    <div
                      className="p-3.5 rounded-[12px] border hairline flex items-center justify-between"
                      style={{ background: 'var(--bg-app)' }}
                    >
                      <div>
                        <div className="text-[12.5px] font-medium" style={{ color: 'var(--ink-primary)' }}>
                          Too many checkout attempts
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                          {artVer >= 3
                            ? 'Cooling down · auto-retrying in 12s'
                            : 'Please wait before retrying'}
                        </div>
                      </div>
                      <span
                        className="px-3 py-1 rounded-full text-[11px] font-medium"
                        style={{ background: 'var(--ink-primary)', color: 'var(--bg-app)' }}
                      >
                        {artVer >= 3 ? 'Retry' : 'Wait'}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-tertiary)' }}>
                    Backed by loopback Git (<span className="font-mono-tech">ArtifactFS</span> blobless
                    mount). Fork any revision in O(1).
                  </div>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
