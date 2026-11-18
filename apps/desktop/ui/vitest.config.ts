import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __HX_TEST_API__: 'false' },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], restoreMocks: true }
});
