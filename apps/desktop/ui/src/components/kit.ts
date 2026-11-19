/* The kit build's entry (`pnpm kit`, vite.kit.config.ts): the library's public API (index.ts) and its stylesheet (kit.css). The app
   does not import this file: it imports `@boopis/ui` (index.ts) and loads kit.css through styles/index.ts. */
import './kit.css';

export * from './index';
