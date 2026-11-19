/** Set by vite.config.ts: true only in `--mode e2e` builds, which expose `window.__hx` to the Playwright tests. */
declare const __HX_TEST_API__: boolean;

/** the vendored orb2 build is a script with side effects only (it defines <orb-avatar>); it is imported for them */
declare module '*/orb-avatar.min.js';
