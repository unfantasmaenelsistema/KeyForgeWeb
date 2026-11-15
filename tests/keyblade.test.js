// Pruebas del extractor de hojas (bun test). Se fabrica una "foto" sintética con dos llaves giradas y una
// anilla, se extrae cada hoja y se compara con el dentado original en milímetros.
import { describe, expect, test } from 'bun:test';
const KB = require('../public/keyblade.js');

const PX_PER_MM = 12;

/** Contorno (mm) de una llave: hoja con 5 cortes, punta en rampa, hombro y cabeza rectangular. */
function keyOutline(cuts) {
  const L = 30;
  const Hb = 8.5;
  const pts = [{ x: -22, y: -3 }, { x: 0, y: -3 }, { x: 0, y: 0 }, { x: L - 2, y: 0 }, { x: L, y: 3 }, { x: L, y: 5.5 }, { x: L - 2.5, y: Hb }];
  // Cortes de 2 mm de valle con flancos de 45°, cada 4 mm desde la punta
  for (let i = 0; i < cuts.length; i++) {
    const cx = L - 6 - i * 4.2;
    const d = cuts[i];
    pts.push({ x: cx + 1 + d, y: Hb }, { x: cx + 1, y: Hb - d }, { x: cx - 1, y: Hb - d }, { x: cx - 1 - d, y: Hb });
  }
  pts.push({ x: 0, y: Hb }, { x: 0, y: Hb + 3 }, { x: -22, y: Hb + 3 });
  return pts;
}

/** Borde del dentado de la llave de referencia en x (mm). */
function bittingAt(cuts, x) {
  const L = 30;
  const Hb = 8.5;
  let y = Hb;
  for (let i = 0; i < cuts.length; i++) {
    const cx = L - 6 - i * 4.2;
    const d = cuts[i];
    const dist = Math.abs(x - cx);
    if (dist <= 1) y = Math.min(y, Hb - d);
    else if (dist <= 1 + d) y = Math.min(y, Hb - (1 + d - dist));
  }
  return y;
}

function rasterize(polys, W, H) {
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (const pts of polys) {
      const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i];
        const b = pts[j];
        if ((a.y > y + 0.5) !== (b.y > y + 0.5)) xs.push(a.x + ((y + 0.5 - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x < xs[k + 1]; x++) if (x >= 0 && x < W) mask[y * W + x] = 1;
      }
    }
  }
  return mask;
}

const place = (pts, angDeg, ox, oy) => {
  const a = (angDeg * Math.PI) / 180;
  return pts.map((p) => ({
    x: ox + (p.x * Math.cos(a) - p.y * Math.sin(a)) * PX_PER_MM,
    y: oy - (p.x * Math.sin(a) + p.y * Math.cos(a)) * PX_PER_MM,
  }));
};

const W = 1200;
const H = 1000;
const cutsA = [1.2, 2.4, 0.6, 1.8, 3.0];
const cutsB = [2.6, 0.8, 2.0, 1.0, 1.6];
const keyA = place(keyOutline(cutsA), 205, 760, 640);
const keyB = place(keyOutline(cutsB), 150, 900, 430);
// Anilla: corona circular (se rasteriza como disco menos disco interior)
const disc = (cx, cy, r) => Array.from({ length: 72 }, (_, i) => ({ x: cx + r * Math.cos((i * Math.PI) / 36), y: cy + r * Math.sin((i * Math.PI) / 36) }));
let mask = rasterize([keyA, keyB, disc(1000, 380, 90)], W, H);
const hole = rasterize([disc(1000, 380, 78)], W, H);
for (let i = 0; i < mask.length; i++) if (hole[i]) mask[i] = 0;
// Brillos: un hueco pequeño en mitad de la hoja de la llave A
const glint = place([{ x: 15, y: 4 }], 205, 760, 640)[0];
const gx = Math.round(glint.x);
const gy = Math.round(glint.y);
for (let y = gy - 3; y < gy + 3; y++) for (let x = gx - 5; x < gx + 5; x++) mask[y * W + x] = 0;
const fg = mask.reduce((p, q) => p + q, 0);
mask = KB.fillSmallHoles(mask, W, H, Math.round(fg * 0.08));

describe('KeyBlade', () => {
  test('rellena los brillos pero no el interior de la anilla', () => {
    expect(mask[gy * W + gx]).toBe(1);
    expect(mask[380 * W + 1000]).toBe(0);
  });

  const cands = KB.autoDetect(mask, W, H);

  test('detecta las dos hojas y descarta la anilla', () => {
    expect(cands.length).toBe(2);
    for (const c of cands) expect(c.widthPx).toBeGreaterThan(8.5 * PX_PER_MM * 0.5);
  });

  for (const [name, cuts] of [['A', cutsA], ['B', cutsB]]) {
    test(`recupera la llave ${name}: longitud y dentado`, () => {
      // La hoja de cada llave se identifica por su dirección
      const target = name === 'A' ? 205 : 150;
      const c = cands.find((k) => {
        const ang = (Math.atan2(-(k.tip.y - k.shoulder.y), k.tip.x - k.shoulder.x) * 180) / Math.PI;
        return Math.abs(((ang - target + 540) % 360) - 180) < 10;
      });
      expect(c).toBeTruthy();
      const key = KB.buildKeyOutline(KB.sampleBlade(mask, W, H, c.tip, c.shoulder), { type: 'height', mm: 8.5 });
      expect(Math.abs(key.bladeLengthMm - 30)).toBeLessThan(0.6);
      // Error del dentado entre 3 y 27 mm de la hoja
      const topAt = (x) => {
        let best = -1e9;
        const o = key.outline;
        for (let i = 0; i < o.length; i++) {
          const a = o[i];
          const b = o[(i + 1) % o.length];
          if (a.x !== b.x && (a.x - x) * (b.x - x) <= 0 && a.x >= -0.01 && b.x >= -0.01) {
            const y = a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
            if (y > best) best = y;
          }
        }
        return best;
      };
      let err = 0;
      let n = 0;
      for (let x = 3; x < 27; x += 0.25) {
        err += Math.abs(topAt(x) - bittingAt(cuts, x));
        n++;
      }
      expect(err / n).toBeLessThan(0.2);
    });
  }

  test('contorno imprimible: sin cruces y con el agujero dentro de la cabeza', () => {
    const c = cands[0];
    const key = KB.buildKeyOutline(KB.sampleBlade(mask, W, H, c.tip, c.shoulder), { type: 'height', mm: 8.5 });
    const o = key.outline;
    const orient = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    let crossings = 0;
    for (let i = 0; i < o.length; i++) {
      for (let j = i + 2; j < o.length; j++) {
        if (i === 0 && j === o.length - 1) continue;
        const a = o[i], b = o[(i + 1) % o.length], c2 = o[j], d = o[(j + 1) % o.length];
        if (orient(a, b, c2) * orient(a, b, d) < 0 && orient(c2, d, a) * orient(c2, d, b) < 0) crossings++;
      }
    }
    expect(crossings).toBe(0);
    const inside = (pt) => {
      let inn = false;
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        if ((o[i].y > pt.y) !== (o[j].y > pt.y) && pt.x < ((o[j].x - o[i].x) * (pt.y - o[i].y)) / (o[j].y - o[i].y) + o[i].x) inn = !inn;
      }
      return inn;
    };
    const hl = key.bowHole;
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      expect(inside({ x: hl.x + Math.cos(ang) * (hl.radius + 0.8), y: hl.y + Math.sin(ang) * (hl.radius + 0.8) })).toBe(true);
    }
  });

  test('calibrar por longitud de hoja escala todo el perfil', () => {
    const c = cands[0];
    const blade = KB.sampleBlade(mask, W, H, c.tip, c.shoulder);
    const key = KB.buildKeyOutline(blade, { type: 'length', mm: 45 });
    expect(Math.abs(key.bladeLengthMm - 45)).toBeLessThan(1e-6);
    expect(key.bladeHeightMm).toBeGreaterThan(12);
  });
});
