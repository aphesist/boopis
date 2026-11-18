/* The one logging module (STANDARDS section 4). Levels: error needs action, warn is degraded, info is lifecycle,
   debug is per request. The host forwards these to the profile's log files; until it does they go to the console.
   Prompts, file contents and tool payloads never go above `debug`. */

export type Level = 'error' | 'warn' | 'info' | 'debug';
export type Sink = (level: Level, scope: string, message: string, data?: unknown) => void;

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };
let threshold: Level = 'info';
let sink: Sink = (level, scope, message, data) => {
  const line = '[hx:' + scope + '] ' + message;
  if (data === undefined) console[level === 'debug' ? 'log' : level](line);
  else console[level === 'debug' ? 'log' : level](line, data);
};

export function setLogSink(s: Sink): void { sink = s; }
export function setLogLevel(l: Level): void { threshold = l; }

export function logger(scope: string) {
  const at = (level: Level) => (message: string, data?: unknown): void => { if (ORDER[level] <= ORDER[threshold]) sink(level, scope, message, data); };
  return { error: at('error'), warn: at('warn'), info: at('info'), debug: at('debug') };
}
