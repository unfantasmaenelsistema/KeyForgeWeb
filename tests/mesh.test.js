// Malla con surcos: tiene que ser estanca (cada arista en exactamente dos triángulos, con orientación
// coherente) y con el volumen esperado, para que cualquier laminador la imprima sin reparaciones.
import { describe, expect, test } from 'bun:test';
const KB = require('../public/keyblade.js');

const PX = 12;
function keyMask() {
  const L = 30;
  const Hb = 8.5;
  const pts = [{ x: -22, y: -3 }, { x: 0, y: -3 }, { x: 0, y: 0 }, { x: L - 2, y: 0 }, { x: L, y: 3 }, { x: L, y: 5.5 }, { x: L - 2.5, y: Hb }];
  [1.2, 2.4, 0.6, 1.8, 3.0].forEach((d, i) => {
    const cx = L - 6 - i * 4.2;
    pts.push({ x: cx + 1 + d, y: Hb }, { x: cx + 1, y: Hb - d }, { x: cx - 1, y: Hb - d }, { x: cx - 1 - d, y: Hb });
  });
  pts.push({ x: 0, y: Hb }, { x: 0, y: Hb + 3 }, { x: -22, y: Hb + 3 });
  const W = 900;
  const H = 600;
  const a = (30 * Math.PI) / 180;
  const poly = pts.map((p) => ({ x: 520 + (p.x * Math.cos(a) - p.y * Math.sin(a)) * PX, y: 330 - (p.x * Math.sin(a) + p.y * Math.cos(a)) * PX }));
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].y > y + 0.5) !== (poly[j].y > y + 0.5)) xs.push(poly[i].x + ((y + 0.5 - poly[i].y) * (poly[j].x - poly[i].x)) / (poly[j].y - poly[i].y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k]); x < xs[k + 1]; x++) mask[y * W + x] = 1;
  }
  return { mask, W, H };
}

function meshStats(pos) {
  const key = (i) => `${pos[i].toFixed(5)},${pos[i + 1].toFixed(5)},${pos[i + 2].toFixed(5)}`;
  const directed = new Map();
  let volume = 0;
  let degenerate = 0;
  for (let t = 0; t < pos.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) degenerate++;
    for (let e = 0; e < 3; e++) {
      const k = v[e] + '>' + v[(e + 1) % 3];
      directed.set(k, (directed.get(k) || 0) + 1);
    }
    // Volumen con signo (teorema de la divergencia)
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.from(pos.slice(t, t + 9));
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  let unmatched = 0;
  let duplicated = 0;
  for (const [k, n] of directed) {
    const [a, b] = k.split('>');
    if (n > 1) duplicated++;
    if (!directed.has(b + '>' + a)) unmatched++;
  }
  return { triangles: pos.length / 9, unmatched, duplicated, degenerate, volume };
}

const { mask, W, H } = keyMask();
const cand = KB.autoDetect(mask, W, H)[0];
const key = KB.buildKeyOutline(KB.sampleBlade(mask, W, H, cand.tip, cand.shoulder), { type: 'height', mm: 8.5 });
const T = 2.2;
const outlineArea = (() => {
  let a = 0;
  const o = key.outline;
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2) - Math.PI * key.bowHole.radius ** 2;
})();

describe('Malla con surcos', () => {
  for (const [name, grooves] of [
    ['sin surcos', []],
    ['un surco en la cara de la foto', [{ y0: 1.5, y1: 2.6, depth: 0.6, faces: 'front' }]],
    ['dos surcos en las dos caras', [{ y0: 1.5, y1: 2.6, depth: 0.6, faces: 'both' }, { y0: 3.6, y1: 4.6, depth: 0.5, faces: 'front' }]],
    ['surco que toca la rampa de la punta', [{ y0: 4.2, y1: 5.4, depth: 0.8, faces: 'front' }]],
  ]) {
    test(`${name}: estanca, bien orientada y con el volumen esperado`, () => {
      const pos = KB.buildGroovedMesh(key, grooves, T);
      expect(pos).toBeTruthy();
      const st = meshStats(pos);
      // Como en el navegador: Float32 y centrado; con 4 decimales no se puede fundir ningún vértice
      const f32 = new Float32Array(pos);
      const c = [0, 1, 2].map((k) => {
        let mn = Infinity, mx = -Infinity;
        for (let i = k; i < f32.length; i += 3) { mn = Math.min(mn, f32[i]); mx = Math.max(mx, f32[i]); }
        return (mn + mx) / 2;
      });
      for (let i = 0; i < f32.length; i++) f32[i] -= c[i % 3];
      const r = (i) => `${f32[i].toFixed(4)},${f32[i + 1].toFixed(4)},${f32[i + 2].toFixed(4)}`;
      let collapsed = 0;
      for (let t = 0; t < f32.length; t += 9) {
        const v = [r(t), r(t + 3), r(t + 6)];
        if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) collapsed++;
      }
      expect(collapsed).toBe(0);
      expect(st.unmatched).toBe(0);
      expect(st.duplicated).toBe(0);
      expect(st.volume).toBeGreaterThan(0);
      // Volumen: planta × grosor menos los canales (dentro de la hoja; la punta recorta algo)
      let removed = 0;
      for (const g of grooves) removed += (g.y1 - g.y0) * key.bladeLengthMm * g.depth * (g.faces === 'both' ? 2 : 1);
      const full = outlineArea * T;
      expect(st.volume).toBeLessThanOrEqual(full + 1);
      expect(st.volume).toBeGreaterThan(full - removed - 1);
      if (grooves.length) expect(st.volume).toBeLessThan(full - removed * 0.6);
    });
  }
});
