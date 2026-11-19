import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __HX_TEST_API__: 'false' },
  resolve: { alias: { '@boopis/ui': fileURLToPath(new URL('./src/components/index.ts', import.meta.url)) } },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], restoreMocks: true }
});
