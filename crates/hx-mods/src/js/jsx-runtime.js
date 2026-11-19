// The automatic JSX runtime: `<Box gap={1}>…</Box>` compiles to `jsx(Box, { gap: 1, children })`.
import { Fragment } from 'claude-code';

export { Fragment };

export function jsx(type, props) {
  if (typeof type !== 'function') {
    throw new TypeError('JSX needs an element constructor or a function component, got ' + String(type));
  }
  return type(props || {});
}
export const jsxs = jsx;
export const jsxDEV = jsx;
