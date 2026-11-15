// Surcos estimados en la foto: imágenes sintéticas que imitan una foto real (luz desigual a lo ancho y a lo
// largo, ruido, un reflejo que recorre solo parte de la hoja) con surcos en posiciones conocidas.
import { describe, expect, test } from 'bun:test';
const KB = require('../public/keyblade.js');

const L = 30;
const HB = 8.5;
const PX = 10; // px por mm: una foto de móvil normal a unos 25 cm

function keyOutline() {
  const pts = [{ x: -22, y: -3 }, { x: 0, y: -3 }, { x: 0, y: 0 }, { x: L - 2, y: 0 }, { x: L, y: 3 }, { x: L, y: 5.5 }, { x: L - 2.5, y: HB }];
  const cuts = [1.2, 2.4, 0.6, 1.8, 3.0];
  cuts.forEach((d, i) => {
    const cx = L - 6 - i * 4.2;
    pts.push({ x: cx + 1 + d, y: HB }, { x: cx + 1, y: HB - d }, { x: cx - 1, y: HB - d }, { x: cx - 1 - d, y: HB });
  });
  pts.push({ x: 0, y: HB }, { x: 0, y: HB + 3 }, { x: -22, y: HB + 3 });
  return pts;
}

let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

/** «Foto» de la cara de la llave: devuelve máscara y gris. grooves = [{ y0, y1 }] en mm desde el lomo. */
function photo(grooves, { angle = 25, glint = true } = {}) {
  const W = 900;
  const H = 700;
  const a = (angle * Math.PI) / 180;
  const ox = 520;
  const oy = 380;
  const outline = keyOutline().map((p) => ({ x: ox + (p.x * Math.cos(a) - p.y * Math.sin(a)) * PX, y: oy - (p.x * Math.sin(a) + p.y * Math.cos(a)) * PX }));
  const mask = new Uint8Array(W * H);
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const A = outline[i];
      const B = outline[j];
      if ((A.y > y + 0.5) !== (B.y > y + 0.5)) xs.push(A.x + ((y + 0.5 - A.y) * (B.x - A.x)) / (B.y - A.y));
    }
    xs.sort((p, q) => p - q);
    for (let x = 0; x < W; x++) {
      let inside = false;
      for (let k = 0; k + 1 < xs.length; k += 2) if (x >= xs[k] && x < xs[k + 1]) inside = true;
      // Coordenadas de la llave (mm) para sombrear
      const dx = (x - ox) / PX;
      const dy = -(y - oy) / PX;
      const kx = dx * Math.cos(a) + dy * Math.sin(a);
      const ky = -dx * Math.sin(a) + dy * Math.cos(a);
      if (!inside) {
        gray[y * W + x] = Math.max(0, Math.min(255, 238 + gauss() * 4));
        continue;
      }
      mask[y * W + x] = 1;
      // Metal: luz que cae a lo ancho y a lo largo
      let v = 150 + ky * 3 - kx * 0.8;
      for (const g of grooves) {
        if (kx < 0 || ky < g.y0 || ky > g.y1) continue;
        v -= 26; // fondo del surco, algo más oscuro
        if (ky < g.y0 + 0.25) v += 40; // pared iluminada
        if (ky > g.y1 - 0.25) v -= 25; // pared en sombra
      }
      // Reflejo: franja clara que solo cubre un tercio de la hoja
      if (glint && kx > 10 && kx < 16.5 && Math.abs(ky - 4.2) < 0.35) v += 60;
      gray[y * W + x] = Math.max(0, Math.min(255, v + gauss() * 7));
    }
  }
  return { mask, gray, W, H };
}

function analyse(img) {
  const fg = img.mask.reduce((p, q) => p + q, 0);
  const mask = KB.fillSmallHoles(img.mask, img.W, img.H, Math.round(fg * 0.08));
  const c = KB.autoDetect(mask, img.W, img.H)[0];
  const blade = KB.sampleBlade(mask, img.W, img.H, c.tip, c.shoulder);
  const key = KB.buildKeyOutline(blade, { type: 'height', mm: HB });
  const groove = KB.grooveProfile(img.gray, img.W, img.H, blade);
  const proposed = KB.proposeGrooves(groove).map((g) => ({ ...g, y0: g.from * key.mmPerPx, y1: g.to * key.mmPerPx }));
  return { groove, proposed };
}

describe('Surcos estimados en la foto', () => {
  test('una hoja lisa no da surcos falsos (aunque tenga un reflejo y luz desigual)', () => {
    const { groove, proposed } = analyse(photo([]));
    expect(groove.lowRes).toBe(false);
    expect(proposed.filter((g) => g.active).length).toBe(0);
  });

  test('encuentra dos surcos en su sitio (±0,4 mm)', () => {
    const truth = [{ y0: 1.5, y1: 2.6 }, { y0: 3.6, y1: 4.6 }];
    const { proposed } = analyse(photo(truth));
    const active = proposed.filter((g) => g.active);
    expect(active.length).toBe(2);
    truth.forEach((t, i) => {
      expect(Math.abs(active[i].y0 - t.y0)).toBeLessThan(0.4);
      expect(Math.abs(active[i].y1 - t.y1)).toBeLessThan(0.4);
    });
  });

  test('funciona con la llave girada al revés (el lomo en el otro lado)', () => {
    const truth = [{ y0: 2.0, y1: 3.2 }];
    const { proposed } = analyse(photo(truth, { angle: 200 }));
    const active = proposed.filter((g) => g.active);
    expect(active.length).toBe(1);
    expect(Math.abs(active[0].y0 - truth[0].y0)).toBeLessThan(0.4);
    expect(Math.abs(active[0].y1 - truth[0].y1)).toBeLessThan(0.4);
  });

  test('con la hoja demasiado pequeña en la foto avisa en vez de inventar', () => {
    const tiny = { cuts: Array.from({ length: 40 }, (_, i) => ({ s: i, a: 0, b: 9, width: 9 })), L: 40, typical: 9, T: { x: 0, y: 0 }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 } };
    const r = KB.grooveProfile(new Uint8Array(100 * 100), 100, 100, tiny);
    expect(r.lowRes).toBe(true);
    expect(r.bands.length).toBe(0);
  });
});
