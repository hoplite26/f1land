import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

// Verification server without HMR: edits never reload a page mid-run (pnpm vite --config dev/vite.nohmr.config.ts --port 5193).
export default mergeConfig(base, defineConfig({ server: { hmr: false, port: 5193, strictPort: true } }));
