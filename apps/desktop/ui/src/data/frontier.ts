/* Which models are frontier, and which of those are heavy (ADR-0037). The list is one data file, apps/shared/data/frontier-models.json,
   read by the plugin (Python), the host (Rust) and this file; each is tested against the file's own `examples`, so none can drift
   quietly. A family marked `heavy` is frontier but token-heavy or costly: governed mode may run it only when the user asked, and
   nothing that picks a model by itself (Smart, the council's defaults) may pick it. This reader exists for those pickers; the
   plugin stays the authority for what governed mode accepts. Matching is by family and version after normalising the id, never
   a list of ids: a model that ships tomorrow in a listed family is recognised without a code change.

   Pure: no client, no DOM. */
import file from '../../../../shared/data/frontier-models.json';

interface Family { id: string; prefix: readonly string[]; suffix: readonly string[]; min: string; heavy?: boolean }
interface File { families: readonly Family[]; ignorable_suffixes: readonly string[]; aliases: Record<string, Record<string, string>> }
const F = file as unknown as File;

const BRACKET = /\[[^\]]*\]$/;
const SHORT = /^\d{1,2}$/;
const DATE8 = /^\d{8}$/;
const YEAR = /^\d{4}$/;
const MAX_VERSION_PARTS = 3;

/** the id as tokens: lower case, the part after the last '/', a bracketed suffix and anything after ':' dropped, dots and dashes the same */
export const normalise = (model: string): string[] => {
  let t = model.trim().toLowerCase().replace(BRACKET, '');
  t = t.slice(t.lastIndexOf('/') + 1);
  t = t.split(':')[0] ?? '';
  return t.split(/[.\-_]/).filter(Boolean);
};

const resolveAlias = (provider: string, model: string): string => F.aliases[provider.trim().toLowerCase()]?.[model.trim().toLowerCase().replace(BRACKET, '')] ?? model;

function tailIgnorable(rest: readonly string[]): boolean {
  let i = 0;
  while (i < rest.length) {
    const t = rest[i] as string;
    if (F.ignorable_suffixes.includes(t) || DATE8.test(t)) i += 1;
    else if (YEAR.test(t) && i + 2 < rest.length && SHORT.test(rest[i + 1] as string) && SHORT.test(rest[i + 2] as string)) i += 3;
    else return false;
  }
  return true;
}

const atLeast = (version: readonly number[], floor: readonly number[]): boolean => {
  for (let i = 0; i < Math.max(version.length, floor.length); i++) {
    const d = (version[i] ?? 0) - (floor[i] ?? 0);
    if (d) return d > 0;
  }
  return true;
};

interface Found { family: Family; frontier: boolean }
function find(provider: string, model: string): Found | null {
  const tokens = normalise(resolveAlias(provider, model));
  for (const family of F.families) {
    const n = family.prefix.length;
    if (tokens.slice(0, n).join(' ') !== family.prefix.join(' ')) continue;
    let i = n;
    const parts: number[] = [];
    while (i < tokens.length && parts.length < MAX_VERSION_PARTS && SHORT.test(tokens[i] as string)) { parts.push(Number(tokens[i])); i++; }
    if (!parts.length || tokens.slice(i, i + family.suffix.length).join(' ') !== family.suffix.join(' ')) continue;
    i += family.suffix.length;
    if (tailIgnorable(tokens.slice(i))) return { family, frontier: atLeast(parts, family.min.split('.').map(Number)) };
  }
  return null;
}

/** whether `provider`/`model` may do governed work; unknown, empty and unrecognised are not */
export const isFrontier = (provider: string, model: string): boolean => find(provider, model)?.frontier === true;

/** whether it is a frontier model of a heavy family (Claude Fable, Grok 4.7 and later): never an automatic pick, only the user's own choice */
export const isHeavy = (provider: string, model: string): boolean => { const f = find(provider, model); return f !== null && f.frontier && f.family.heavy === true; };
