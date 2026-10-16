import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* The build goes to dist/ and the Dockerfile copies it into nginx from there.
   Node does NOT run in production: that's why React costs no RAM on this VPS,
   which was the condition the stack was approved under (docs/RESEARCH.md §2).

   The build hash handles cache busting on its own — your main website needs
   tools/cachebust.js run by hand; here it's not needed. */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    /* No sourcemaps in production: they are the source code served in the clear. */
    sourcemap: false
  },
  server: {
    /* For local development against the container's API. */
    proxy: { '/api': 'http://127.0.0.1:3000' }
  }
});
