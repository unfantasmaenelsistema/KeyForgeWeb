import { defineConfig } from 'vite';

// App estática (HTML + JS en línea; OpenCV.js y Three.js desde CDN con versión fija).
// Vite compila Tailwind y copia public/ (sample.png, keyblade.js y el logo). Base relativa para Pages.
export default defineConfig({
  base: './',
});
