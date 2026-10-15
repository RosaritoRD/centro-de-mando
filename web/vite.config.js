import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* El build sale a dist/ y de ahí lo copia el Dockerfile a nginx. En
   producción NO corre Node: por eso React no cuesta RAM en esta VPS, que es
   la condición con la que se aprobó el stack (docs/RESEARCH.md §2).

   El hash de build resuelve el cache busting solo — en tu web principal hay que
   correr tools/cachebust.js a mano, y aquí no hace falta. */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    /* Sin sourcemaps en producción: son el código fuente servido en claro. */
    sourcemap: false
  },
  server: {
    /* Para desarrollo local contra la API del contenedor. */
    proxy: { '/api': 'http://127.0.0.1:3000' }
  }
});
