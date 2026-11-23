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
