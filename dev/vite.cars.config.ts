import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

// Car-model preview server: separate cache dir and port so it never clashes
// with the app dev server. Open /dev/cars.html.
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: 'node_modules/.vite-cars',
    server: { port: 5175, strictPort: true },
  }),
);
