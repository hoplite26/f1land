import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import base from '../vite.config';

// Standalone race-scene harness (no app shell): open /dev/scene.html?ch=ae-gp&q=high&cam=director.
// `vite build --config dev/vite.scene.config.ts` snapshots it (immune to HMR reloads while other files change);
// serve the snapshot with `vite preview --config dev/vite.scene.config.ts --port 5186` → /dev/scene.html.
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: 'node_modules/.vite-scene',
    server: { port: 5182, strictPort: true },
    build: {
      outDir: process.env.SCENE_OUT ?? 'node_modules/.scene-dist',
      emptyOutDir: true,
      reportCompressedSize: false,
      rollupOptions: { input: { scene: fileURLToPath(new URL('./scene.html', import.meta.url)) } },
    },
  }),
);
