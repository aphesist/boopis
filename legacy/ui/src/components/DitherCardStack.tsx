import { useEffect, useRef } from 'react';
import { paintBayerSmoke } from '../lib/ditherMath';

export interface DitherCardItem {
  id: string;
  title: string;
  quote: string;
  host: string;
  hostMeta?: string;
  scope: string;
  cmd: string;
  footerNote?: string;
}

export interface DitherCardStackProps {
  cards: DitherCardItem[];
  currentIndex: number;
  smokeSpeed?: number;
  smokePower?: number;
  verifying?: boolean;
  resolvedTitle?: string;
  resolvedQuote?: string;
  resolvedFooter?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  emptyClearedText?: string;
  onApprove: (card: DitherCardItem) => void;
  onSecondary: (card: DitherCardItem) => void;
  onReset?: () => void;
  canvasWidth?: number;
  compact?: boolean;
}

export function DitherCardStack({
  cards,
  currentIndex,
  smokeSpeed = 1.0,
  smokePower = 1.0,
  verifying = false,
  resolvedTitle,
  resolvedQuote,
  resolvedFooter,
  primaryLabel = 'Touch to approve',
  secondaryLabel = 'Deny',
  emptyClearedText,
  onApprove,
  onSecondary,
  onReset,
  canvasWidth = 330,
  compact = false,
}: DitherCardStackProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animParamsRef = useRef({ speed: smokeSpeed, power: smokePower, t: 0 });

  useEffect(() => {
    animParamsRef.current.speed = smokeSpeed;
    animParamsRef.current.power = smokePower;
  }, [smokeSpeed, smokePower]);

  const card = cards[currentIndex];
  const hasQueued = currentIndex + 1 < cards.length;
  const allCleared = cards.length > 0 && currentIndex >= cards.length;

  useEffect(() => {
    if (!card && !resolvedTitle) return;
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      animParamsRef.current.t += dt * 0.55 * animParamsRef.current.speed;
      if (canvasRef.current) {
        paintBayerSmoke(canvasRef.current, animParamsRef.current.t, animParamsRef.current.power);
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [card?.id, resolvedTitle]);

  if (cards.length === 0) {
    return null;
  }

  if (allCleared && !resolvedTitle) {
    return (
      <div
        className="rounded-[14px] border hairline px-5 py-3.5 flex items-center justify-between anim-card-promote"
        style={{ background: 'var(--bg-surface)' }}
      >
        <span className="font-mono-tech text-[12px]" style={{ color: 'var(--ink-secondary)' }}>
          {emptyClearedText ??
            `All CardStack gates cleared (${cards.length}/${cards.length}) · hash-chain verified`}
        </span>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1 rounded-full border hairline font-mono-tech text-[11px] transition-opacity hover:opacity-80"
            style={{ color: 'var(--ink-primary)' }}
          >
            Reset stack
          </button>
        )}
      </div>
    );
  }

  const displayCard = card ?? cards[cards.length - 1];
  const titleText = resolvedTitle ?? displayCard.title;
  const quoteText = resolvedQuote ?? displayCard.quote;
  const footerText =
    resolvedFooter ??
    displayCard.footerNote ??
    `${hasQueued ? `${cards.length - currentIndex} in CardStack · ` : ''}${displayCard.cmd}`;

  return (
    <div className="relative" key={displayCard.id}>
      {hasQueued && !resolvedTitle && (
        <div
          className="mx-auto w-[96%] h-[16px] rounded-t-[14px] border border-b-0 -mb-[8px]"
          style={{ background: '#0e0e0e', borderColor: 'rgba(255,255,255,0.12)' }}
        />
      )}

      <div
        className="relative rounded-[14px] overflow-hidden border anim-card-promote"
        style={{
          background: '#000000',
          borderColor: 'rgba(255,255,255,0.18)',
          boxShadow: 'var(--shadow-card)',
          color: '#f2f2f2',
        }}
      >
        <div className="relative w-full h-[82px] select-none" style={{ background: '#000000' }}>
          <canvas
            ref={canvasRef}
            className="dither-smoke-canvas"
            width={canvasWidth}
            height={41}
          />
          <div
            className="absolute left-5 bottom-2 px-2 py-0.5 rounded-[4px] font-mono-tech text-[12px] font-medium"
            style={{ background: '#000000', color: '#ffffff' }}
          >
            {titleText}
          </div>
        </div>

        <div
          className={`${compact ? 'px-5 pt-2.5 pb-4 space-y-3' : 'px-6 pt-3 pb-5 space-y-3.5'} font-mono-tech`}
        >
          <div className="text-[12px]" style={{ color: '#a3a3a3' }}>
            {quoteText}
          </div>

          <div className="pl-3 border-l space-y-1 text-[11.5px]" style={{ borderColor: '#333333' }}>
            <div>
              <span className="font-medium text-white">{displayCard.host}</span>
              {displayCard.hostMeta && (
                <span className="ml-2" style={{ color: '#737373' }}>
                  {displayCard.hostMeta}
                </span>
              )}
            </div>
            <div className="text-[11px]" style={{ color: '#737373' }}>
              {displayCard.scope}
            </div>
          </div>

          {!compact && (
            <div className="text-[11.5px] leading-relaxed" style={{ color: '#a3a3a3' }}>
              Passed to <span className="text-white">ship()</span> →{' '}
              <span className="text-white">$HARNESS_GATE_CMD</span> ({displayCard.cmd})
            </div>
          )}

          <div className="pt-1 flex flex-wrap items-center justify-between gap-2.5">
            <span className="text-[11px] truncate" style={{ color: '#737373' }}>
              {footerText}
            </span>

            <div className="flex items-center gap-2 ml-auto shrink-0">
              {verifying ? (
                <span className="text-[11px]" style={{ color: '#a3a3a3' }}>
                  verifying...
                </span>
              ) : resolvedTitle ? (
                onReset && (
                  <button
                    type="button"
                    onClick={onReset}
                    className="px-3 py-1 rounded-[8px] border text-[11px] transition-opacity hover:opacity-80"
                    style={{ borderColor: '#333333', color: '#a3a3a3' }}
                  >
                    Reset
                  </button>
                )
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSecondary(displayCard)}
                    className={`${
                      compact ? 'px-3.5 py-1 rounded-full' : 'px-3.5 py-1.5 rounded-[8px]'
                    } border text-[11.5px] transition-opacity hover:opacity-80`}
                    style={{
                      background: '#000000',
                      borderColor: '#333333',
                      color: '#ededed',
                    }}
                  >
                    {secondaryLabel}
                  </button>
                  <button
                    type="button"
                    onClick={() => onApprove(displayCard)}
                    className={`${
                      compact ? 'px-4 py-1 rounded-full' : 'px-4 py-1.5 rounded-[8px]'
                    } text-[11.5px] font-medium transition-opacity hover:opacity-90`}
                    style={{ background: '#ffffff', color: '#000000' }}
                  >
                    {primaryLabel}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
