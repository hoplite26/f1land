import { mergeConfig } from 'vite';
import base from '../vite.config';

// Dev-only showcase for procedural environment props: /dev/props.html
export default mergeConfig(base, {
  cacheDir: 'node_modules/.vite-props',
  server: { port: 5176, strictPort: true, host: true },
});
