import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// public/keyblade.js se sirve tal cual y GitHub Pages lo cachea 10 minutos: tras un despliegue, un
// navegador podía juntar el index.html nuevo con el keyblade.js antiguo y fallar. Se añade a su URL
// una huella del contenido, así cada versión tiene su propia dirección.
const versionKeyBlade = () => ({
  name: 'version-keyblade',
  transformIndexHtml(html) {
    const hash = createHash('sha256').update(readFileSync('public/keyblade.js')).digest('hex').slice(0, 10);
    return html.replace('src="./keyblade.js"', `src="./keyblade.js?v=${hash}"`);
  },
});

// App estática (HTML + JS en línea; OpenCV.js y Three.js desde CDN con versión fija).
// Vite compila Tailwind y copia public/ (sample.png, keyblade.js y el logo). Base relativa para Pages.
export default defineConfig({
  base: './',
  plugins: [versionKeyBlade()],
});
