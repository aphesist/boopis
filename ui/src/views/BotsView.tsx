import { useCallback, useEffect, useRef, useState } from 'react';
import { DitherCardStack, type DitherCardItem } from '../components/DitherCardStack';
import { LivingOrb, type LivingOrbHandle } from '../components/LivingOrb';
import {
  appendLedgerEvent,
  getAppleVmStatus,
  runShipGate,
  runXcodeBuild,
  type AppleVmBackendKind,
  type AppleVmConfig,
  type AppleVmStatus,
  type XcodeBuildResult,
} from '../lib/ipc';
import {
  EYE_ARCHETYPES,
  MATERIALS,
  type EyeArchetype,
  type OrbState,
} from '../lib/orbMath';

export interface BotMessage {
  id: string;
  who: 'user' | 'bot';
  text: string;
  mention?: string;
  monoToken?: string;
}

export interface BotTeammate {
  id: string;
  name: string;
  shortName: string;
  railBadge: string;
  subtitle: string;
  tag: string;
  color: string;
  eyes: EyeArchetype;
  defaultState: OrbState;
  jelly: number;
  showVm: boolean;
  messages: BotMessage[];
  cards: DitherCardItem[];
}

export const INITIAL_TEAMMATES: BotTeammate[] = [
  {
    id: 'runner',
    name: 'iOS & Mac Runner',
    shortName: 'Runner',
    railBadge: 'VM',
    subtitle: '2 CardStack approvals waiting',
    tag: 'SwiftUI · VirtioFS',
    color: '#F2F2F0',
    eyes: 'capsule',
    defaultState: 'working',
    jelly: 0.65,
    showVm: true,
    messages: [
      {
        id: 'r-1',
        who: 'user',
        text: 'Run SwiftUI checkout tests in the Mac VM and verify the 429 retry banner on iPhone 16 Pro.',
      },
      {
        id: 'r-2',
        who: 'bot',
        text: 'Synced via VirtioFS and ran xcodebuild test (14/14 passed). Coordinating with',
        mention: '@Gatekeeper',
        monoToken: 'before signing.',
      },
    ],
    cards: [
      {
        id: 'runner-card-1',
        title: 'iOS Runner wants to sign TestFlight archive',
        quote: '"Sign CorePay.ipa with dev provisioning profile"',
        host: 'apple-vm.local · Xcode Keychain',
        scope: '14/14 XCTests passed · Scope verified',
        cmd: 'xcodebuild -exportArchive -scheme CorePay',
      },
      {
        id: 'runner-card-2',
        title: 'Push CheckoutView artifact to staging TestFlight',
        quote: '"Upload verified archive #482 to internal test ring"',
        host: 'appstoreconnect.apple.com',
        scope: 'Queue #2 · Contract Lane A clear',
        cmd: 'xcrun altool --upload-app -f CorePay.ipa',
      },
    ],
  },
  {
    id: 'gatekeeper',
    name: 'PR Gatekeeper',
    shortName: 'Gate',
    railBadge: 'LANE',
    subtitle: 'Watching scope & immutable tests',
    tag: 'Contract Lanes · Read-Only',
    color: '#171717',
    eyes: 'slit',
    defaultState: 'idle',
    jelly: 0.55,
    showVm: false,
    messages: [
      {
        id: 'g-1',
        who: 'bot',
        text: 'Enforcing scope: boundaries across aphesist/core. Zero dirty working-tree escapes allowed.',
      },
    ],
    cards: [],
  },
  {
    id: 'nightshift',
    name: 'Night Shift',
    shortName: 'Shift',
    railBadge: 'ZZZ',
    subtitle: 'Asleep · 02:00 cron digest',
    tag: '02:00 Cron · Cascade',
    color: '#808080',
    eyes: 'crescent',
    defaultState: 'sleeping',
    jelly: 0.7,
    showVm: false,
    messages: [
      {
        id: 'n-1',
        who: 'bot',
        text: 'Morning digest ready. Solved 3/3 Contract Lanes overnight on local Qwen3-Coder ($0.00) and escalated 1 cache race to Opus (-62.5% cost).',
      },
    ],
    cards: [],
  },
  {
    id: 'scout',
    name: 'Kernel Scout',
    shortName: 'Scout',
    railBadge: 'LOCAL',
    subtitle: 'Qwen3-Coder · pack() indexed',
    tag: 'pack() · Qwen3 Local',
    color: '#CCCCCC',
    eyes: 'matrix',
    defaultState: 'idle',
    jelly: 0.65,
    showVm: false,
    messages: [
      {
        id: 's-1',
        who: 'bot',
        text: 'Indexed 412 Rust & TypeScript symbols in memory. Ready for zero-cost 1-turn pack() queries.',
      },
    ],
    cards: [],
  },
];

const DEFAULT_DESK_HINT = 'Drag to turn · Click to poke · Type below to watch gaze';
const DEFAULT_SCULPT_HINT = 'Drag to rotate · Click rapidly to poke (3 stages)';

const VM_BACKEND_ORDER: readonly AppleVmBackendKind[] = [
  'local_qemu_kvm',
  'remote_apple_ssh',
  'simulated_preview',
];

export interface BotsRailProps {
  teammates: BotTeammate[];
  activeBotId: string;
  runnerHasPendingCards: boolean;
  onSelectBot: (id: string) => void;
  onOpenSculptor: () => void;
}

export function BotsRail({
  teammates,
  activeBotId,
  runnerHasPendingCards,
  onSelectBot,
  onOpenSculptor,
}: BotsRailProps) {
  const dockCrew = teammates.slice(0, 4);
  const shiftOrbRef = useRef<LivingOrbHandle | null>(null);

  return (
    <div className="flex-1 flex flex-col min-h-0 px-3 pt-2 pb-2 overflow-y-auto">
      {/* Living Crew Dock (4 Cohesive Orbs) */}
      <div className="px-1 pb-3">
        <div className="flex items-center justify-between mb-2">
          <span
            className="font-mono-tech text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--ink-tertiary)' }}
          >
            Living Crew
          </span>
          <button
            type="button"
            onClick={onOpenSculptor}
            className="text-[11px] font-medium transition-opacity hover:opacity-75"
            style={{ color: 'var(--ink-secondary)' }}
          >
            + Sculpt
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1">
          {dockCrew.map((bot) => {
            const active = bot.id === activeBotId;
            const isShift = bot.id === 'nightshift';
            const showDot = bot.id === 'runner' && runnerHasPendingCards;
            return (
              <button
                key={bot.id}
                type="button"
                onClick={() => onSelectBot(bot.id)}
                onMouseEnter={() => {
                  if (isShift) shiftOrbRef.current?.setTemporaryState('surprised', 550);
                }}
                onMouseLeave={() => {
                  if (isShift) shiftOrbRef.current?.setTemporaryState('sleeping', 0);
                }}
                className="flex flex-col items-center py-2 px-1 rounded-[10px] transition-colors relative"
                style={{ background: active ? 'var(--bg-selected)' : 'transparent' }}
              >
                {showDot && (
                  <span
                    className="w-[5px] h-[5px] rounded-full absolute top-1.5 right-1.5"
                    style={{ background: 'var(--accent-crimson)' }}
                  />
                )}
                <LivingOrb
                  ref={isShift ? shiftOrbRef : undefined}
                  id={`dock-${bot.id}`}
                  color={bot.color}
                  eyes={bot.eyes}
                  state={bot.defaultState}
                  size={34}
                  mountSize={40}
                  jelly={bot.jelly}
                />
                <span
                  className="mt-1 text-[10.5px] font-medium truncate w-full text-center"
                  style={{ color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
                >
                  {bot.shortName}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t hairline mx-1 my-1.5" />

      {/* Flat Teammate Conversations */}
      <div className="pt-1.5 space-y-0.5">
        {teammates.map((bot) => {
          const active = bot.id === activeBotId;
          return (
            <button
              key={bot.id}
              type="button"
              onClick={() => onSelectBot(bot.id)}
              className="w-full text-left px-3 py-2.5 rounded-[10px] transition-colors"
              style={{ background: active ? 'var(--bg-selected)' : 'transparent' }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[13px] font-medium truncate"
                  style={{ color: active ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
                >
                  {bot.name}
                </span>
                <span className="font-mono-tech text-[10px]" style={{ color: 'var(--ink-tertiary)' }}>
                  {bot.railBadge}
                </span>
              </div>
              <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--ink-tertiary)' }}>
                {bot.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpenSculptor}
        className="mt-3 w-full py-2 px-3 rounded-[10px] border hairline text-[12px] font-medium text-center transition-opacity hover:opacity-80"
        style={{ color: 'var(--ink-secondary)' }}
      >
        + Sculpt new teammate
      </button>
    </div>
  );
}

export interface BotsViewProps {
  teammates: BotTeammate[];
  activeBotId: string;
  mode: 'desk' | 'sculptor';
  cardIndices: Record<string, number>;
  onSelectBot: (id: string) => void;
  onChangeMode: (mode: 'desk' | 'sculptor') => void;
  onUpdateTeammateMessages: (botId: string, messages: BotMessage[]) => void;
  onAdvanceCardIndex: (botId: string, nextIndex: number) => void;
  onCreateTeammate: (bot: BotTeammate) => void;
  onLedgerChanged: () => void;
}

export function BotsView({
  teammates,
  activeBotId,
  mode,
  cardIndices,
  onSelectBot,
  onChangeMode,
  onUpdateTeammateMessages,
  onAdvanceCardIndex,
  onCreateTeammate,
  onLedgerChanged,
}: BotsViewProps) {
  const activeBot = teammates.find((b) => b.id === activeBotId) ?? teammates[0];
  const currentCardIdx = cardIndices[activeBot.id] ?? 0;

  const deskHeroRef = useRef<LivingOrbHandle | null>(null);
  const sculptHeroRef = useRef<LivingOrbHandle | null>(null);
  const deskScrollRef = useRef<HTMLDivElement | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  const [deskHint, setDeskHint] = useState(DEFAULT_DESK_HINT);
  const [deskInput, setDeskInput] = useState('');
  const [smokeSpeed, setSmokeSpeed] = useState(1.0);
  const [vmOpen, setVmOpen] = useState(activeBot.showVm);

  const [vmBackendIdx, setVmBackendIdx] = useState(0);
  const [vmStatus, setVmStatus] = useState<AppleVmStatus | null>(null);
  const [xcodeBuild, setXcodeBuild] = useState<XcodeBuildResult | null>(null);
  const [xcodeBuilding, setXcodeBuilding] = useState(false);

  // Sculptor state
  const [sculptColor, setSculptColor] = useState('#F2F2F0');
  const [sculptColorName, setSculptColorName] = useState('Ceramic');
  const [sculptEyes, setSculptEyes] = useState<EyeArchetype>('capsule');
  const [sculptState, setSculptState] = useState<OrbState>('idle');
  const [sculptJelly, setSculptJelly] = useState(0.65);
  const [sculptName, setSculptName] = useState('Hermes Companion');
  const [sculptHint, setSculptHint] = useState(DEFAULT_SCULPT_HINT);

  useEffect(() => {
    setVmOpen(activeBot.showVm);
    setDeskHint(DEFAULT_DESK_HINT);
    deskHeroRef.current?.kickJelly(0.12);
  }, [activeBot.id, activeBot.showVm]);

  const makeVmConfig = useCallback(
    (backend: AppleVmBackendKind): AppleVmConfig => ({
      backend,
      ssh_host: '100.84.12.9',
      ssh_user: 'aphesist',
      ssh_port: 22,
      repo_mount_path: '/Volumes/core',
      scheme: 'CorePay',
      simulator_device: 'iPhone 16 Pro',
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    getAppleVmStatus(makeVmConfig(VM_BACKEND_ORDER[vmBackendIdx])).then((st) => {
      if (!cancelled) setVmStatus(st);
    });
    return () => {
      cancelled = true;
    };
  }, [vmBackendIdx, makeVmConfig]);

  const handleDeskPokeChange = useCallback((_stage: number, hint: string | null) => {
    setDeskHint(hint ?? DEFAULT_DESK_HINT);
  }, []);

  const handleSculptPokeChange = useCallback((_stage: number, hint: string | null) => {
    setSculptHint(hint ?? DEFAULT_SCULPT_HINT);
  }, []);

  const handleTyping = (value: string) => {
    setDeskInput(value);
    deskHeroRef.current?.setTemporaryState('thinking', 1300);
    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = window.setTimeout(() => {
      typingTimerRef.current = null;
    }, 1350);
  };

  const handleSendDeskMsg = async () => {
    const txt = deskInput.trim();
    if (!txt) return;
    setDeskInput('');

    const userMsg: BotMessage = {
      id: `u-${Date.now()}`,
      who: 'user',
      text: txt,
    };
    const nextWithUser = [...activeBot.messages, userMsg];
    onUpdateTeammateMessages(activeBot.id, nextWithUser);
    deskHeroRef.current?.setTemporaryState('happy', 1100);

    requestAnimationFrame(() => {
      if (deskScrollRef.current) {
        deskScrollRef.current.scrollTop = deskScrollRef.current.scrollHeight;
      }
    });

    await appendLedgerEvent('task_created', {
      bot: activeBot.id,
      prompt: txt,
    });
    onLedgerChanged();

    window.setTimeout(() => {
      const reply: BotMessage = {
        id: `b-${Date.now()}`,
        who: 'bot',
        text: 'Packed symbols in 1 turn and dispatched via',
        monoToken: 'Cascade. Watching the gate now.',
      };
      onUpdateTeammateMessages(activeBot.id, [...nextWithUser, reply]);
      requestAnimationFrame(() => {
        if (deskScrollRef.current) {
          deskScrollRef.current.scrollTop = deskScrollRef.current.scrollHeight;
        }
      });
    }, 420);
  };

  const handleCardApprove = async (card: DitherCardItem) => {
    setSmokeSpeed(2.3);
    deskHeroRef.current?.setTemporaryState('happy', 1200);
    await runShipGate({
      root: '.',
      brief: {
        id: card.id,
        goal: card.title,
        scope_globs: ['ios/**', 'src/**'],
        lane_id: 'A',
        invariants: ['Immutable test fence preserved'],
      },
      edits: [],
      run_gate: true,
      human_approved: true,
    });
    onAdvanceCardIndex(activeBot.id, currentCardIdx + 1);
    onLedgerChanged();
    window.setTimeout(() => setSmokeSpeed(1.0), 750);
  };

  const handleCardHold = () => {
    setVmOpen(true);
  };

  const handleCycleVmBackend = () => {
    setVmBackendIdx((prev) => (prev + 1) % VM_BACKEND_ORDER.length);
  };

  const handleRunXcodeBuild = async () => {
    setXcodeBuilding(true);
    deskHeroRef.current?.setTemporaryState('working', 900);
    const cfg = makeVmConfig(VM_BACKEND_ORDER[vmBackendIdx]);
    const res = await runXcodeBuild(cfg);
    await appendLedgerEvent('outcome_scored', {
      scheme: cfg.scheme,
      tests_passed: res.tests_passed,
      tests_total: res.tests_total,
    });
    setXcodeBuild(res);
    setXcodeBuilding(false);
    deskHeroRef.current?.setTemporaryState('happy', 1100);
    onLedgerChanged();
  };

  const applyBlueprint = (name: string, hex: string, eyes: EyeArchetype) => {
    const mat = MATERIALS.find((m) => m.hex === hex) ?? MATERIALS[0];
    setSculptName(name);
    setSculptColor(hex);
    setSculptColorName(mat.name);
    setSculptEyes(eyes);
    setSculptState(name === 'Night Shift' ? 'sleeping' : 'idle');
    sculptHeroRef.current?.kickJelly(0.15);
  };

  const handleCreateTeammate = async () => {
    const trimmed = sculptName.trim() || 'Companion';
    const id = `bot_${Date.now()}`;
    const newBot: BotTeammate = {
      id,
      name: trimmed,
      shortName: trimmed.slice(0, 8),
      railBadge: 'NEW',
      subtitle: 'Sculpted companion',
      tag: 'Hermes Custom Role',
      color: sculptColor,
      eyes: sculptEyes,
      defaultState: sculptState,
      jelly: sculptJelly,
      showVm: false,
      messages: [
        {
          id: `${id}-init`,
          who: 'bot',
          text: `Ready. I'm ${trimmed} — tell me which Contract Lanes, subscriptions, or skills I own.`,
        },
      ],
      cards: [],
    };
    onCreateTeammate(newBot);
    await appendLedgerEvent('task_claimed', { bot_id: id, name: trimmed, eyes: sculptEyes });
    onLedgerChanged();
    onSelectBot(id);
    onChangeMode('desk');
  };

  if (mode === 'sculptor') {
    const stateOptions: { id: OrbState; label: string }[] = [
      { id: 'idle', label: 'Idle' },
      { id: 'working', label: 'Working' },
      { id: 'thinking', label: 'Thinking' },
      { id: 'sleeping', label: 'Sleeping' },
      { id: 'happy', label: 'Happy' },
    ];

    return (
      <section className="flex-1 flex flex-col min-h-0 anim-panel">
        <header className="h-[48px] px-7 border-b hairline flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onChangeMode('desk')}
              className="px-2.5 py-1 rounded-full border hairline text-[11.5px] font-medium transition-opacity hover:opacity-80"
              style={{ background: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
            >
              ← Desk
            </button>
            <span className="text-[13.5px] font-medium" style={{ color: 'var(--ink-primary)' }}>
              Sculpt Teammate
            </span>
          </div>
          <span className="font-mono-tech text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
            LivingOrb · aphesist/orb
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-7 sm:px-12 py-8 flex items-center justify-center">
          <div className="max-w-[800px] w-full grid grid-cols-1 md:grid-cols-12 gap-10 items-center">
            {/* Left: 120px Hero LivingOrb over Nothing 1px Dot-Matrix Stage + Live Reaction Tester */}
            <div className="md:col-span-6 flex flex-col items-center">
              <div className="relative w-[260px] h-[240px] flex items-center justify-center">
                <div className="absolute inset-0 dot-matrix-stage rounded-full" />
                <LivingOrb
                  ref={sculptHeroRef}
                  id="sculpt-hero"
                  color={sculptColor}
                  eyes={sculptEyes}
                  state={sculptState}
                  size={120}
                  mountSize={136}
                  jelly={sculptJelly}
                  interactive
                  className="relative z-10"
                  onPokeStageChange={handleSculptPokeChange}
                />
              </div>
              <div className="text-[11px] font-mono-tech mb-3" style={{ color: 'var(--ink-tertiary)' }}>
                {sculptHint}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {stateOptions.map((opt) => {
                  const active = sculptState === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSculptState(opt.id)}
                      className="px-2.5 py-1 rounded-full border hairline text-[11px] font-medium transition-colors"
                      style={{
                        background: active ? 'var(--ink-primary)' : 'transparent',
                        color: active ? 'var(--bg-app)' : 'var(--ink-secondary)',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => sculptHeroRef.current?.poke()}
                  className="px-2.5 py-1 rounded-full border hairline text-[11px] font-medium transition-opacity hover:opacity-80"
                  style={{ color: 'var(--ink-primary)' }}
                >
                  Poke
                </button>
              </div>
            </div>

            {/* Right: Flat Hairline Controls */}
            <div className="md:col-span-6 space-y-6">
              {/* 1. Material Finish */}
              <div className="space-y-2.5 pb-5 border-b hairline">
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                    Material Finish
                  </span>
                  <span className="font-mono-tech text-[11px]" style={{ color: 'var(--ink-tertiary)' }}>
                    {sculptColorName}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  {MATERIALS.map((mat) => {
                    const active = mat.hex === sculptColor;
                    return (
                      <button
                        key={mat.name}
                        type="button"
                        title={mat.name}
                        onClick={() => {
                          setSculptColor(mat.hex);
                          setSculptColorName(mat.name);
                          sculptHeroRef.current?.kickJelly(0.1);
                        }}
                        className="w-[24px] h-[24px] rounded-full transition-transform hover:scale-110"
                        style={{
                          background: mat.hex,
                          border: active
                            ? '2px solid var(--ink-primary)'
                            : '1px solid var(--border-strong)',
                          boxShadow: active ? '0 0 0 2px var(--bg-app) inset' : 'none',
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* 2. Eye Archetype + Jelly Softness */}
              <div className="space-y-3 pb-5 border-b hairline">
                <div className="text-[11.5px] font-medium" style={{ color: 'var(--ink-primary)' }}>
                  Eye Archetype
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EYE_ARCHETYPES.map((arch) => {
                    const active = arch.id === sculptEyes;
                    return (
                      <button
                        key={arch.id}
                        type="button"
                        onClick={() => {
                          setSculptEyes(arch.id);
                          sculptHeroRef.current?.kickJelly(0.1);
                        }}
                        className="px-3 py-1 rounded-full border hairline text-[11.5px] font-medium transition-colors"
                        style={{
                          background: active ? 'var(--ink-primary)' : 'transparent',
                          color: active ? 'var(--bg-app)' : 'var(--ink-secondary)',
                        }}
                      >
                        {arch.label}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 space-y-1.5">
                  <div className="flex justify-between text-[11px]" style={{ color: 'var(--ink-secondary)' }}>
                    <span>Jelly Softness</span>
                    <span className="font-mono-tech">{sculptJelly.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={0.2}
                    max={1.0}
                    step={0.05}
                    value={sculptJelly}
                    onChange={(e) => {
                      const next = Number.parseFloat(e.target.value);
                      setSculptJelly(next);
                      sculptHeroRef.current?.kickJelly(0.16);
                    }}
                    className="w-full accent-current"
                  />
                </div>
              </div>

              {/* 3. Name, Blueprint Presets & Create CTA */}
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyBlueprint('Night Shift', '#808080', 'crescent')}
                    className="px-2.5 py-1 rounded-full border hairline text-[11px] transition-opacity hover:opacity-80"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    Night Shift
                  </button>
                  <button
                    type="button"
                    onClick={() => applyBlueprint('Contract Gatekeeper', '#D71921', 'slit')}
                    className="px-2.5 py-1 rounded-full border hairline text-[11px] transition-opacity hover:opacity-80"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    Contract Gatekeeper
                  </button>
                  <button
                    type="button"
                    onClick={() => applyBlueprint('Apple Bubble Runner', '#F2F2F0', 'capsule')}
                    className="px-2.5 py-1 rounded-full border hairline text-[11px] transition-opacity hover:opacity-80"
                    style={{ color: 'var(--ink-secondary)' }}
                  >
                    Apple Bubble Runner
                  </button>
                </div>

                <div className="flex items-center gap-2.5 pt-1">
                  <input
                    type="text"
                    value={sculptName}
                    onChange={(e) => setSculptName(e.target.value)}
                    placeholder="Teammate name..."
                    className="flex-1 h-[38px] px-3.5 rounded-[10px] border hairline text-[13.5px] focus:outline-none"
                    style={{ background: 'var(--bg-surface)', color: 'var(--ink-primary)' }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateTeammate}
                    className="h-[38px] px-5 rounded-full text-[13px] font-medium shrink-0 transition-opacity hover:opacity-85"
                    style={{ background: 'var(--ink-primary)', color: 'var(--bg-app)' }}
                  >
                    Create Teammate
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex-1 flex flex-col min-h-0 relative anim-panel">
      <div className="flex-1 flex min-h-0 relative">
        {/* Main Companion Stage */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          <header className="h-[48px] px-6 border-b hairline flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <LivingOrb
                id="desk-mini"
                color={activeBot.color}
                eyes={activeBot.eyes}
                state="working"
                size={18}
                mountSize={22}
                jelly={activeBot.jelly}
              />
              <span className="text-[13.5px] font-medium truncate" style={{ color: 'var(--ink-primary)' }}>
                {activeBot.name}
              </span>
              <span className="font-mono-tech text-[11px] hidden sm:inline" style={{ color: 'var(--ink-tertiary)' }}>
                {activeBot.tag}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChangeMode('sculptor')}
                className="px-3 py-1 rounded-full border hairline text-[11.5px] font-medium transition-opacity hover:opacity-80"
                style={{ background: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
              >
                Sculpt Bot
              </button>
              <button
                type="button"
                onClick={() => setVmOpen((v) => !v)}
                className="px-3 py-1 rounded-full border hairline flex items-center gap-2 text-[11.5px] font-medium transition-opacity hover:opacity-80"
                style={{ background: 'var(--bg-surface)', color: 'var(--ink-primary)' }}
              >
                <span
                  className="w-[5px] h-[5px] rounded-full"
                  style={{ background: 'var(--accent-crimson)' }}
                />
                <span>Apple VM · 16:10</span>
              </button>
            </div>
          </header>

          <div ref={deskScrollRef} className="flex-1 overflow-y-auto px-6 sm:px-10 pt-5 pb-28">
            <div className="max-w-[600px] mx-auto space-y-5">
              {/* Interactive 76px Hero LivingOrb Presence */}
              <div className="flex flex-col items-center py-2">
                <div className="relative w-[136px] h-[112px] flex items-center justify-center">
                  <div className="absolute inset-0 dot-matrix-stage rounded-full" />
                  <LivingOrb
                    ref={deskHeroRef}
                    id="desk-hero"
                    color={activeBot.color}
                    eyes={activeBot.eyes}
                    state={activeBot.id === 'nightshift' ? 'sleeping' : 'idle'}
                    size={76}
                    mountSize={96}
                    jelly={activeBot.jelly}
                    interactive
                    className="relative z-10"
                    onPokeStageChange={handleDeskPokeChange}
                  />
                </div>
                <div className="text-[11px] font-mono-tech mt-1" style={{ color: 'var(--ink-tertiary)' }}>
                  {deskHint}
                </div>
              </div>

              {/* Corner-Anchored Spring Bubbles */}
              <div className="space-y-3.5">
                {activeBot.messages.map((msg) =>
                  msg.who === 'user' ? (
                    <div key={msg.id} className="flex justify-end anim-user-in">
                      <div
                        className="max-w-[82%] px-4 py-2.5 rounded-[16px] text-[14px] leading-[1.48]"
                        style={{
                          background: 'var(--bg-bubble-user)',
                          color: 'var(--ink-bubble-user)',
                        }}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ) : (
                    <div key={msg.id} className="flex justify-start anim-bot-in">
                      <div
                        className="max-w-[88%] px-4 py-2.5 rounded-[16px] text-[14px] leading-[1.52]"
                        style={{
                          background: 'var(--bg-bubble-agent)',
                          color: 'var(--ink-primary)',
                        }}
                      >
                        {msg.text}{' '}
                        {msg.mention && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium mx-0.5"
                            style={{
                              background: 'var(--bg-selected)',
                              color: 'var(--ink-primary)',
                            }}
                          >
                            {msg.mention}
                          </span>
                        )}
                        {msg.monoToken && (
                          <span className="font-mono-tech text-[12.5px]"> {msg.monoToken}</span>
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>

              {/* Hermes CardStack × dithercn 1-Bit Bayer Smoke Approvals */}
              <DitherCardStack
                cards={activeBot.cards}
                currentIndex={currentCardIdx}
                smokeSpeed={smokeSpeed}
                primaryLabel="Approve"
                secondaryLabel="Hold"
                compact
                canvasWidth={300}
                onApprove={handleCardApprove}
                onSecondary={handleCardHold}
                onReset={() => onAdvanceCardIndex(activeBot.id, 0)}
              />
            </div>
          </div>

          {/* Floating Lucent Capsule Composer */}
          <div
            className="absolute bottom-0 left-0 right-0 pt-6 pb-5 px-6 sm:px-10 pointer-events-none"
            style={{ background: 'var(--fade-scrim)' }}
          >
            <div className="max-w-[600px] mx-auto pointer-events-auto">
              <div
                className="h-[46px] pl-2.5 pr-2 rounded-full border hairline flex items-center gap-2.5 backdrop-blur-xl"
                style={{ background: 'var(--glass-pill)', boxShadow: 'var(--shadow-card)' }}
              >
                <button
                  type="button"
                  className="w-[30px] h-[30px] rounded-full border hairline flex items-center justify-center text-[15px] shrink-0"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  +
                </button>
                <input
                  type="text"
                  value={deskInput}
                  onChange={(e) => handleTyping(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendDeskMsg();
                  }}
                  placeholder="Message teammate or @Gatekeeper..."
                  className="flex-1 bg-transparent text-[13.5px] focus:outline-none"
                  style={{ color: 'var(--ink-primary)' }}
                />
                <button
                  type="button"
                  onClick={handleSendDeskMsg}
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[13px] font-medium shrink-0 transition-opacity hover:opacity-85"
                  style={{ background: 'var(--ink-primary)', color: 'var(--bg-app)' }}
                >
                  ↑
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Right 16:10 Apple Bubble VM Stage (410px) */}
        {vmOpen && (
          <aside
            className="w-[410px] shrink-0 border-l hairline p-4 flex flex-col justify-between min-h-0 anim-panel"
            style={{ background: 'var(--bg-rail)' }}
          >
            <div className="flex items-center justify-between pb-3">
              <div className="flex items-center gap-2">
                <span
                  className="w-[5px] h-[5px] rounded-full"
                  style={{ background: 'var(--accent-crimson)' }}
                />
                <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink-primary)' }}>
                  Apple Bubble VM
                </span>
                <span className="font-mono-tech text-[10.5px]" style={{ color: 'var(--ink-tertiary)' }}>
                  16:10
                </span>
              </div>
              <button
                type="button"
                onClick={handleCycleVmBackend}
                className="px-2.5 py-1 rounded-full border hairline font-mono-tech text-[10.5px] transition-opacity hover:opacity-80"
                style={{ background: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
              >
                {vmStatus?.stream_hint ?? 'QEMU/KVM · VirtioFS'}
              </button>
            </div>

            {/* 16:10 Virtual macOS 15 + Xcode 16 + Monochrome iPhone 16 Pro Simulator */}
            <div
              className="w-full aspect-[16/10] rounded-[20px] border hairline overflow-hidden flex flex-col relative"
              style={{
                background: '#050505',
                color: '#f2f2f2',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div
                className="h-[22px] px-3 flex items-center justify-between text-[10px] border-b"
                style={{
                  background: '#0e0e0e',
                  borderColor: 'rgba(255,255,255,0.08)',
                  color: '#d4d4d4',
                }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold"></span>
                  <span className="font-medium">Xcode 16</span>
                  <span style={{ color: '#8c8c8c' }}>Simulator</span>
                </div>
                <span className="font-mono-tech text-[9.5px]" style={{ color: '#8c8c8c' }}>
                  macOS 15 · Apple Silicon / KVM
                </span>
              </div>

              <div className="flex-1 p-3 grid grid-cols-12 gap-2.5 min-h-0 relative">
                <div
                  className="col-span-7 rounded-[12px] border p-2.5 flex flex-col justify-between font-mono-tech text-[9.5px]"
                  style={{
                    background: '#0e0e0e',
                    borderColor: 'rgba(255,255,255,0.09)',
                  }}
                >
                  <div className="space-y-1.5">
                    <div
                      className="flex items-center justify-between text-[10px] pb-1.5 border-b"
                      style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                    >
                      <span className="text-white font-medium">CheckoutView.swift</span>
                      <span style={{ color: '#8c8c8c' }}>
                        {xcodeBuild ? `${(xcodeBuild.duration_ms / 1000).toFixed(1)}s` : '1.4s'}
                      </span>
                    </div>
                    <div className="leading-relaxed" style={{ color: '#a3a3a3' }}>
                      <div>
                        <span style={{ color: '#525252' }}>14</span> struct RateLimitBanner: View {'{'}
                      </div>
                      <div>
                        <span style={{ color: '#525252' }}>15</span>   let retryAfter: Int
                      </div>
                      <div>
                        <span style={{ color: '#525252' }}>16</span>   var body: some View {'{'}
                      </div>
                      <div>
                        <span style={{ color: '#525252' }}>17</span>     Text(&quot;Retry \(retryAfter)s&quot;)
                      </div>
                      <div>
                        <span style={{ color: '#525252' }}>18</span>   {'}'}
                      </div>
                      <div>
                        <span style={{ color: '#525252' }}>19</span> {'}'}
                      </div>
                    </div>
                  </div>
                  <div
                    className="pt-1.5 border-t flex items-center justify-between text-[9.5px]"
                    style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                  >
                    <span className="text-white">
                      {xcodeBuilding
                        ? 'xcodebuild · RUNNING...'
                        : xcodeBuild
                          ? `xcodebuild · ${xcodeBuild.succeeded ? 'SUCCEEDED' : 'FAILED'} (${xcodeBuild.tests_passed}/${xcodeBuild.tests_total})`
                          : 'xcodebuild · SUCCEEDED'}
                    </span>
                    <button
                      type="button"
                      onClick={handleRunXcodeBuild}
                      disabled={xcodeBuilding}
                      className="px-2 py-0.5 rounded-full border hover:opacity-80 disabled:opacity-50"
                      style={{ borderColor: 'rgba(255,255,255,0.22)', color: '#f2f2f2' }}
                    >
                      Run XCTest
                    </button>
                  </div>
                </div>

                {/* Monochrome iPhone 16 Pro Simulator */}
                <div className="col-span-5 flex items-center justify-center">
                  <div
                    className="w-[104px] h-[188px] rounded-[20px] border p-2 flex flex-col justify-between"
                    style={{ background: '#000000', borderColor: '#333333' }}
                  >
                    <div className="w-[32px] h-[7px] rounded-full mx-auto" style={{ background: '#171717' }} />
                    <div className="space-y-2 my-auto text-center">
                      <div
                        className="text-[8.5px] font-mono-tech uppercase tracking-wider truncate"
                        style={{ color: '#737373' }}
                      >
                        {xcodeBuild?.simulator_screen_title ?? 'CorePay iOS'}
                      </div>
                      <div
                        className="p-2 rounded-[10px] border text-left space-y-1"
                        style={{
                          background: '#0e0e0e',
                          borderColor: 'rgba(255,255,255,0.12)',
                        }}
                      >
                        <div className="text-[9.5px] font-medium text-white">Checkout</div>
                        <div className="text-[8.5px]" style={{ color: '#8c8c8c' }}>
                          60s · 30 req guard
                        </div>
                        <div
                          className="mt-1 px-1.5 py-0.5 rounded-[5px] text-[8.5px] font-mono-tech text-center"
                          style={{ background: '#ffffff', color: '#000000' }}
                        >
                          Pay $48.00
                        </div>
                      </div>
                    </div>
                    <div className="w-[34px] h-[3px] rounded-full mx-auto" style={{ background: '#525252' }} />
                  </div>
                </div>

                {/* Autonomous Agent Cursor */}
                <div className="vm-cursor-anim absolute top-0 left-0 pointer-events-none flex items-center gap-1">
                  <span
                    className="w-[9px] h-[9px] rounded-full border-2"
                    style={{ background: '#ffffff', borderColor: '#000000' }}
                  />
                  <span
                    className="px-1.5 py-0.5 rounded-full font-mono-tech text-[8.5px]"
                    style={{ background: '#ffffff', color: '#000000' }}
                  >
                    runner
                  </span>
                </div>
              </div>

              {/* Mini macOS Dock */}
              <div
                className="h-[24px] mb-1.5 mx-auto px-2.5 rounded-full border flex items-center gap-2.5 text-[9.5px]"
                style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)' }}
              >
                <span className="text-white">Xcode</span>
                <span style={{ color: '#8c8c8c' }}>Sim</span>
                <span style={{ color: '#8c8c8c' }}>Term</span>
                <span style={{ color: '#8c8c8c' }}>VirtioFS</span>
              </div>
            </div>

            <div className="pt-3 space-y-1.5 text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
              <div className="flex items-center justify-between">
                <span>Host mount</span>
                <span className="font-mono-tech text-[11px]" style={{ color: 'var(--ink-primary)' }}>
                  /Volumes/core
                </span>
              </div>
              <div className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-tertiary)' }}>
                {vmStatus?.detail ??
                  'Local QEMU/KVM + OpenCore CLI builds, or pair a Remote Apple Silicon Mac over Tailscale for full Metal iOS Simulator speed.'}
              </div>
              {xcodeBuild && (
                <div
                  className="pt-1 font-mono-tech text-[10px] space-y-0.5 border-t hairline"
                  style={{ color: 'var(--ink-secondary)' }}
                >
                  {xcodeBuild.log_lines.map((line, i) => (
                    <div key={i} className="truncate">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}
