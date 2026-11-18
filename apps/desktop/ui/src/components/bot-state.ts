/* Bot states: one map for every module (list, dock, header, cards, tooltips). state -> the orb2 reaction, the one
   word shown beside the name, and its tone. Idle shows no word in lists. */

/** what the library needs to draw and describe a bot */
export interface BotLike {
  id?: string | undefined; name?: string | undefined; role?: string | undefined;
  shape?: string | undefined; color?: string | undefined; eyes?: string | undefined;
  state?: string | undefined; attention?: string | null | undefined; paused?: boolean | undefined;
}
export type Tone = 'busy' | 'attention';
export interface StateDef { reaction: string; word: string; tone?: Tone }

export const STATES: Readonly<Record<string, StateDef>> = {
  idle:      { reaction: 'idle',      word: 'idle' },
  listening: { reaction: 'listening', word: 'listening', tone: 'busy' },
  thinking:  { reaction: 'thinking',  word: 'thinking',  tone: 'busy' },
  working:   { reaction: 'working',   word: 'working',   tone: 'busy' },
  compute:   { reaction: 'compute',   word: 'running',   tone: 'busy' },
  speaking:  { reaction: 'speaking',  word: 'replying',  tone: 'busy' },
  needs:     { reaction: 'needs',     word: 'needs you', tone: 'attention' },
  done:      { reaction: 'done',      word: 'done' },
  happy:     { reaction: 'happy',     word: 'done' },
  sleeping:  { reaction: 'sleeping',  word: 'asleep' },
  paused:    { reaction: 'sleeping',  word: 'paused' },
  error:     { reaction: 'error',     word: 'failed',    tone: 'attention' }
};

export interface BotStateInfo { key: string; reaction: string; word: string; tone: Tone | 'none'; attention: boolean; busy: boolean }

export function botState(bot: BotLike | string | null | undefined): BotStateInfo {
  const b: BotLike = typeof bot === 'string' ? { state: bot } : (bot ?? {});
  const key = b.paused ? 'paused' : (b.attention && b.state !== 'error' ? 'needs' : (b.state && STATES[b.state] ? b.state : 'idle'));
  const s = STATES[key] ?? STATES['idle']!;
  /* attention outranks work: a bot that needs you shows the needs face and the red word, whatever it was doing */
  return { key, reaction: s.reaction, word: s.word, tone: s.tone ?? 'none', attention: s.tone === 'attention', busy: s.tone === 'busy' };
}
export const botLabel = (b: BotLike): string => {
  const s = botState(b);
  return (b.name ?? '') + (b.role ? ', ' + b.role : '') + (s.key === 'idle' ? '' : ', ' + s.word);
};
