/* What a bot is doing, in words, from the name of the tool the engine says it is in. Pure: the room's presence line (a member's
   `member_activity.tool`) and a bot's own chat (`tool.start`'s `name`) read a tool the same way.

   The engine names a tool by its registry name: its own tools by a word ("read_file", "terminal"), a connected (MCP) server's tool
   as `mcp__<server>__<tool>` (`tools/mcp_tool_schema.py` `mcp_prefixed_tool_name`, each part with every character outside
   [A-Za-z0-9_] made "_"). A server is often named after its one tool ("fetch" serving "fetch"), so the two are said once: the
   tool's words, after the server's when they add something ("github create issue"), alone when they start with it ("fetch",
   "github search"). */

const TOOL_WORDS: Readonly<Record<string, string>> = {
  terminal: 'in the terminal', process: 'in the terminal', execute_code: 'running code', read_file: 'reading a file', search_files: 'searching files',
  write_file: 'writing a file', patch: 'editing a file', web_search: 'searching the web', web_extract: 'reading a page', todo: 'updating its list',
  memory: 'going through its memory', session_search: 'looking through past sessions', delegate_task: 'handing off a task', clarify: 'asking a question',
  vision_analyze: 'looking at an image', image_generate: 'making an image', skill_view: 'reading a skill', skills_list: 'looking at its skills',
  send_message: 'sending a message', text_to_speech: 'recording speech', cronjob: 'scheduling', ship: 'shipping its change'
};

/** the engine's prefix for a connected server's tool, and the boundary between the server and the tool */
const MCP = /^mcp__(.+?)__(.+)$/;
const words = (s: string): string[] => s.split(/[_\s-]+/).filter(Boolean);

/** a connected server's tool, its name said once: "fetch" for fetch's fetch, "github search" for github's github_search */
function serverTool(server: string, tool: string): string {
  const s = words(server), t = words(tool);
  if (!t.length) return s.join(' ');
  if (!s.length || t[0]?.toLowerCase() === s[0]?.toLowerCase()) return t.join(' ');
  return [...s, ...t].join(' ');
}

/** the tool a bot is in, as the words the presence line says ("reading a file", "using fetch"); '' for no tool */
export function toolWords(tool: string | null | undefined): string {
  const t = String(tool ?? '').trim();
  if (!t) return '';
  if (TOOL_WORDS[t]) return TOOL_WORDS[t];
  if (t.startsWith('browser_')) return 'in the browser';
  const m = MCP.exec(t);
  if (m) return 'using ' + serverTool(m[1] ?? '', m[2] ?? '');
  return 'using ' + words(t.replace(/^mcp_/, '')).join(' ');
}

/* ───────── a turn's work, in one line (the thread's work line: boards 10, S20, S23) ───────── */
const WORK: ReadonlyArray<readonly [verb: string, one: string, many: string, tools: readonly string[]]> = [
  ['read', 'file', 'files', ['read_file', 'skill_view', 'web_extract', 'vision_analyze']],
  ['searched', 'pattern', 'patterns', ['search_files', 'web_search', 'session_search']],
  ['changed', 'file', 'files', ['write_file', 'patch']],
  ['ran', 'command', 'commands', ['terminal', 'process', 'execute_code']]
];
/** what a turn's steps did, counted by kind in the order they first happened: "Read 6 files, ran 2 commands". Tools it has no word for
    are counted together ("3 other steps"); steps that are not tool calls at all (a provider that says its steps in words) are "8 steps".
    `count` is how many steps the turn had when its list is not at hand. Pure. */
export function workSummary(steps: ReadonlyArray<{ title: string; mono?: boolean | undefined }>, count = steps.length): string {
  const order: number[] = [], n = new Map<number, number>();
  let other = 0;
  for (const s of steps) {
    const i = s.mono ? WORK.findIndex((w) => w[3].includes(s.title)) : -1;
    if (i < 0) { other++; continue; }
    if (!n.has(i)) order.push(i);
    n.set(i, (n.get(i) ?? 0) + 1);
  }
  if (!order.length) { const c = Math.max(count, steps.length); return c + (c === 1 ? ' step' : ' steps'); }
  const parts = order.map((i) => { const w = WORK[i] as typeof WORK[number], k = n.get(i) ?? 0; return w[0] + ' ' + k + ' ' + (k === 1 ? w[1] : w[2]); });
  if (other) parts.push(other + (other === 1 ? ' other step' : ' other steps'));
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
