import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    target: 'esnext',
    modulePreload: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    https: false,
    host: true,
  },
});
