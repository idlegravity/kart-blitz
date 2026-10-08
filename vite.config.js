import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  optimizeDeps: {
    // build.rollupOptions.input limits the dependency crawl to index.html by default; also crawl the dev
    // pages so addons they import (OrbitControls, …) are pre-bundled up front — avoids "Outdated Optimize Dep"
    // reloads and duplicate Three.js instances when a dev page is opened first.
    entries: ['index.html', 'dev/**/*.html'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: 'index.html' },
  },
});
