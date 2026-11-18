import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSystemStatus,
  listCompatAssets,
  type CompatAsset,
  type SystemStatus,
} from './lib/ipc';
import {
  BotsRail,
  BotsView,
  INITIAL_TEAMMATES,
  type BotMessage,
  type BotTeammate,
} from './views/BotsView';
import {
  INITIAL_SESSIONS,
  SessionsRail,
  SessionsView,
  type SessionSummary,
} from './views/SessionsView';

export function App() {
  const [theme, setTheme] = useState<'carbon' | 'paper'>('carbon');
  const [section, setSection] = useState<'sessions' | 'bots'>('bots');
  const [brainsOpen, setBrainsOpen] = useState(false);

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [compatAssets, setCompatAssets] = useState<CompatAsset[]>([]);

  // Sessions state
  const [sessions] = useState<SessionSummary[]>(INITIAL_SESSIONS);
  const [activeSessionId, setActiveSessionId] = useState<string>('checkout');
  const sessComposerRef = useRef<HTMLInputElement | null>(null);

  // Bots state
  const [teammates, setTeammates] = useState<BotTeammate[]>(INITIAL_TEAMMATES);
  const [activeBotId, setActiveBotId] = useState<string>('runner');
  const [botMode, setBotMode] = useState<'desk' | 'sculptor'>('desk');
  const [cardIndices, setCardIndices] = useState<Record<string, number>>({ runner: 0 });

  const refreshSystemStatus = useCallback(() => {
    getSystemStatus().then(setSystemStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refreshSystemStatus();
    listCompatAssets().then(setCompatAssets).catch(() => {});
  }, [refreshSystemStatus]);

  useEffect(() => {
    const close = () => setBrainsOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const handleRailCreate = () => {
    if (section === 'bots') {
      setBotMode('sculptor');
    } else {
      sessComposerRef.current?.focus();
    }
  };

  const handleSelectBot = (id: string) => {
    setActiveBotId(id);
    setSection('bots');
    setBotMode('desk');
  };

  const handleUpdateTeammateMessages = (botId: string, messages: BotMessage[]) => {
    setTeammates((prev) => prev.map((b) => (b.id === botId ? { ...b, messages } : b)));
  };

  const handleAdvanceCardIndex = (botId: string, nextIndex: number) => {
    setCardIndices((prev) => ({ ...prev, [botId]: nextIndex }));
  };

  const handleCreateTeammate = (bot: BotTeammate) => {
    setTeammates((prev) => [bot, ...prev]);
  };

  const runnerBot = teammates.find((b) => b.id === 'runner');
  const runnerHasPendingCards =
    (cardIndices.runner ?? 0) < (runnerBot?.cards.length ?? 0);

  const compatCount = systemStatus?.compat_count ?? (compatAssets.length || 18);
  const connectedBrainsCount =
    systemStatus?.hermes.providers.filter((p) => p.connected).length ?? 4;

  return (
    <div id="app" data-theme={theme}>
      {/* =====================================================================
           LEFT RAIL (256px · Pure Neutral Monochrome · Flat, Not Boxed)
           ===================================================================== */}
      <aside
        className="w-[256px] shrink-0 h-full flex flex-col border-r hairline select-none"
        style={{ background: 'var(--bg-rail)' }}
      >
        {/* Top Bar (52px): Nothing 3x3 Dot-Matrix Mark + [ Sessions | Bots ] + (+) */}
        <div className="h-[52px] px-4 flex items-center justify-between shrink-0">
          {/* Nothing OS 3x3 Dot-Matrix Emblem (1 surgical Crimson pixel) */}
          <div className="grid grid-cols-3 gap-[2.5px]" title="Contraprova // Hermes">
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-primary)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-primary)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--accent-crimson)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-primary)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-tertiary)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-primary)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-tertiary)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-primary)' }} />
            <span className="w-[3px] h-[3px]" style={{ background: 'var(--ink-primary)' }} />
          </div>

          {/* Primary Section Switcher */}
          <div
            className="p-[3px] rounded-full border hairline flex items-center text-[11.5px] font-medium"
            style={{ background: 'var(--bg-surface)' }}
          >
            <button
              type="button"
              onClick={() => {
                setSection('sessions');
                setBrainsOpen(false);
              }}
              className="px-3 py-1 rounded-full transition-all duration-200"
              style={{
                background: section === 'sessions' ? 'var(--ink-primary)' : 'transparent',
                color: section === 'sessions' ? 'var(--bg-app)' : 'var(--ink-secondary)',
              }}
            >
              Sessions
            </button>
            <button
              type="button"
              onClick={() => {
                setSection('bots');
                setBrainsOpen(false);
              }}
              className="px-3 py-1 rounded-full transition-all duration-200"
              style={{
                background: section === 'bots' ? 'var(--ink-primary)' : 'transparent',
                color: section === 'bots' ? 'var(--bg-app)' : 'var(--ink-secondary)',
              }}
            >
              Bots
            </button>
          </div>

          {/* Quick Create (+) */}
          <button
            type="button"
            onClick={handleRailCreate}
            title="New Session / Sculpt Bot"
            className="w-[28px] h-[28px] rounded-full border hairline flex items-center justify-center text-[14px] transition-opacity hover:opacity-75"
            style={{ background: 'var(--bg-surface)', color: 'var(--ink-primary)' }}
          >
            +
          </button>
        </div>

        {/* RAIL BODY */}
        {section === 'sessions' ? (
          <SessionsRail
            sessions={sessions}
            activeSessionId={activeSessionId}
            compatCount={compatCount}
            onSelectSession={setActiveSessionId}
          />
        ) : (
          <BotsRail
            teammates={teammates}
            activeBotId={activeBotId}
            runnerHasPendingCards={runnerHasPendingCards}
            onSelectBot={handleSelectBot}
            onOpenSculptor={() => {
              setSection('bots');
              setBotMode('sculptor');
            }}
          />
        )}

        {/* Rail Footer (48px): aphesist + Brains & Compat Popover + Carbon/Paper Toggle */}
        <div className="h-[48px] px-3.5 border-t hairline flex items-center justify-between shrink-0 relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setBrainsOpen((o) => !o);
            }}
            className="flex items-center gap-2 py-1 px-1 rounded-[8px] transition-opacity hover:opacity-80"
          >
            <span
              className="w-[24px] h-[24px] rounded-full border hairline flex items-center justify-center font-mono-tech text-[10px]"
              style={{ background: 'var(--bg-surface)', color: 'var(--ink-primary)' }}
            >
              AP
            </span>
            <div className="text-left leading-tight">
              <div className="text-[12px] font-medium" style={{ color: 'var(--ink-primary)' }}>
                aphesist
              </div>
              <div className="text-[10px]" style={{ color: 'var(--ink-tertiary)' }}>
                {connectedBrainsCount} brains · 0 co-author
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setTheme((t) => (t === 'carbon' ? 'paper' : 'carbon'))}
            className="px-2.5 py-1 rounded-full border hairline font-mono-tech text-[10.5px] transition-opacity hover:opacity-80"
            style={{ background: 'var(--bg-surface)', color: 'var(--ink-secondary)' }}
          >
            {theme === 'carbon' ? 'Paper' : 'Carbon'}
          </button>

          {/* Connected Brains & Compat Loader Popover */}
          {brainsOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute left-3 bottom-[54px] z-40 w-[280px] rounded-[14px] border hairline p-3.5 text-[12px] space-y-2.5 anim-panel"
              style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-popover)' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                  Hermes {systemStatus?.hermes.hermes_version ?? 'v0.23.2'} Broker
                </span>
                <span className="font-mono-tech text-[10px]" style={{ color: 'var(--ink-tertiary)' }}>
                  DirectSDK
                </span>
              </div>

              <div className="space-y-1.5 text-[11.5px]" style={{ color: 'var(--ink-secondary)' }}>
                {(systemStatus?.hermes.providers ?? []).map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span>{p.display_name}</span>
                    <span
                      className="font-mono-tech"
                      style={{
                        color: p.connected ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
                      }}
                    >
                      {p.zero_api_cost && p.connected
                        ? 'DirectSDK'
                        : p.connected
                          ? 'Active'
                          : 'Standby'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t hairline space-y-1">
                <div className="flex items-center justify-between text-[10.5px]">
                  <span style={{ color: 'var(--ink-secondary)' }}>Compat Loader</span>
                  <span className="font-mono-tech" style={{ color: 'var(--ink-tertiary)' }}>
                    {compatCount} active
                  </span>
                </div>
                <div className="space-y-1 max-h-[84px] overflow-y-auto">
                  {compatAssets.slice(0, 4).map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between text-[10.5px]">
                      <span className="truncate pr-2" style={{ color: 'var(--ink-primary)' }}>
                        {asset.name}
                      </span>
                      <span className="font-mono-tech shrink-0" style={{ color: 'var(--ink-tertiary)' }}>
                        {asset.source.replace(/_/g, '.')}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] pt-1" style={{ color: 'var(--ink-tertiary)' }}>
                  Loaded: .claude/skills · Hermes · .cursor/rules · AGENTS.md
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* =====================================================================
           MAIN STAGE
           ===================================================================== */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        {section === 'sessions' ? (
          <SessionsView
            sessions={sessions}
            activeSessionId={activeSessionId}
            systemStatus={systemStatus}
            compatCount={compatCount}
            composerInputRef={sessComposerRef}
            onOpenBrainsPopover={() => setBrainsOpen(true)}
            onLedgerChanged={refreshSystemStatus}
          />
        ) : (
          <BotsView
            teammates={teammates}
            activeBotId={activeBotId}
            mode={botMode}
            cardIndices={cardIndices}
            onSelectBot={handleSelectBot}
            onChangeMode={setBotMode}
            onUpdateTeammateMessages={handleUpdateTeammateMessages}
            onAdvanceCardIndex={handleAdvanceCardIndex}
            onCreateTeammate={handleCreateTeammate}
            onLedgerChanged={refreshSystemStatus}
          />
        )}
      </main>
    </div>
  );
}

export default App;
