import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

// Standalone race-scene harness (no app shell): open /dev/scene.html?ch=ae-gp&q=high&cam=director.
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: 'node_modules/.vite-scene',
    server: { port: 5182, strictPort: true },
  }),
);
