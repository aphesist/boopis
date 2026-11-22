/* Paths a message names, from the page's side: the host says which exist (inside the given workspaces, or absolute and there),
   opens one with the default app or an editor it found, and shows one in the file manager (`paths.rs`). The page never opens a
   path itself, and the host resolves every path it is asked to open again. */
import { commands } from './bindings';
import { asHostError } from './bridge';
import type { PathEditor, PathsSource, ResolvedPath } from '../data/provider';

/** what the host needs: the four commands (tests pass their own) */
export interface PathCommands {
  resolve(candidates: string[], roots: string[]): Promise<Array<{ path: string; abs: string; kind: string; rel: string | null } | null>>;
  open(path: string, editor: string | null): Promise<null>;
  reveal(path: string): Promise<null>;
  editors(): Promise<PathEditor[]>;
}
const HOST: PathCommands = {
  resolve: (c, r) => commands.pathResolve(c, r),
  open: (p, e) => commands.pathOpen(p, e),
  reveal: (p) => commands.pathReveal(p),
  editors: () => commands.pathEditors()
};
const call = async <T>(p: Promise<T>): Promise<T> => { try { return await p; } catch (e) { throw asHostError(e); } };

export function hostPaths(c: PathCommands = HOST): PathsSource {
  let editors: Promise<readonly PathEditor[]> | null = null;
  return {
    async resolve(paths, roots) {
      if (!paths.length) return [];
      const got = await call(c.resolve([...paths], roots.filter(Boolean)));
      return paths.map((_, i): ResolvedPath | null => {
        const r = got[i];
        return r && (r.kind === 'file' || r.kind === 'folder') ? { path: r.path, abs: r.abs, kind: r.kind, rel: r.rel } : null;
      });
    },
    async open(abs, editor) { await call(c.open(abs, editor ?? null)); },
    async reveal(abs) { await call(c.reveal(abs)); },
    editors() { editors ??= call(c.editors()).catch((e: unknown) => { editors = null; throw e; }); return editors; }
  };
}
