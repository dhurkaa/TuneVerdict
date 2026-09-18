import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite's config runs in Node; we avoid a dependency on @types/node for a single lookup.
declare const process: { env: Record<string, string | undefined> };

/**
 * GitHub Pages serves a project page from https://<user>.github.io/<repo>/, so the
 * bundle needs that prefix on every asset URL. The workflow sets BASE_PATH; local
 * dev and `vite preview` fall back to the root.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
