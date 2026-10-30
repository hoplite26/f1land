import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// Ad-hoc perf probes (not part of the unit suite): pnpm vitest run --config dev/vitest.perf.config.ts
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: { environment: 'node', include: ['dev/**/*.perf.ts'] },
});
