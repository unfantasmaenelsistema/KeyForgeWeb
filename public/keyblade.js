/**
 * KeyBlade: aísla la hoja de UNA llave en una máscara binaria (aunque la foto tenga varias llaves
 * y una anilla), mide su perfil de dentado y construye el contorno imprimible de una llave completa
 * (hoja medida + cabeza estándar con agujero), en milímetros.
 *
 * Trabaja sobre una máscara Uint8Array (1 = llave, 0 = fondo) de ancho w y alto h. No depende de
 * OpenCV, así que se puede probar fuera del navegador.
 */
(function (root) {
  'use strict';

  const idx = (x, y, w) => y * w + x;

  /** Cierre morfológico (dilatar y erosionar) con un cuadrado de radio r. */
  function closeMask(mask, w, h, r) {
    const pass = (src, dilate) => {
      const tmp = new Uint8Array(w * h);
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = dilate ? 0 : 1;
          for (let k = -r; k <= r; k++) {
            const xx = Math.min(w - 1, Math.max(0, x + k));
            const s = src[idx(xx, y, w)];
            if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
          }
          tmp[idx(x, y, w)] = v;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = dilate ? 0 : 1;
          for (let k = -r; k <= r; k++) {
            const yy = Math.min(h - 1, Math.max(0, y + k));
            const s = tmp[idx(x, yy, w)];
            if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
          }
          out[idx(x, y, w)] = v;
        }
      }
      return out;
    };
    return pass(pass(mask, true), false);
  }

  /**
   * Rellena los huecos de fondo encerrados por la llave que sean más pequeños que maxArea
   * (brillos del metal). Los grandes, como el interior de la anilla, se respetan.
   */
  function fillSmallHoles(mask, w, h, maxArea) {
    const out = mask.slice();
    const seen = new Uint8Array(w * h);
    const stack = [];
    for (let start = 0; start < w * h; start++) {
      if (mask[start] || seen[start]) continue;
      // Componente conexa de fondo
      const comp = [];
      let touchesBorder = false;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop();
        comp.push(p);
        const x = p % w;
        const y = (p - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
        const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
        for (const q of nb) {
          if (q >= 0 && !mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
      }
      if (!touchesBorder && comp.length <= maxArea) {
        for (const p of comp) out[p] = 1;
      }
    }
    return out;
  }

  /**
   * Corte perpendicular al eje en el punto c: devuelve el tramo continuo de llave [a, b] (en píxeles,
   * medido a lo largo de n desde c) que contiene c o el más cercano a c dentro de ±search.
   */
  function runAt(mask, w, h, c, n, search) {
    const at = (t) => {
      const x = Math.round(c.x + n.x * t);
      const y = Math.round(c.y + n.y * t);
      return x >= 0 && y >= 0 && x < w && y < h && mask[idx(x, y, w)] === 1;
    };
    let seed = null;
    for (let d = 0; d <= search; d += 0.5) {
      if (at(d)) { seed = d; break; }
      if (at(-d)) { seed = -d; break; }
    }
    if (seed === null) return null;
    let a = seed;
    let b = seed;
    while (a - 0.5 >= -search * 3 && at(a - 0.5)) a -= 0.5;
    while (b + 0.5 <= search * 3 && at(b + 0.5)) b += 0.5;
    return { a, b, width: b - a };
  }

  const median = (arr) => {
    const s = arr.slice().sort((p, q) => p - q);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };

  /**
   * Muestrea la hoja entre la punta T y el hombro S (píxeles). Devuelve un corte por paso con los
   * bordes a ambos lados del eje.
   */
  function sampleBlade(mask, w, h, T, S, steps) {
    const dx = S.x - T.x;
    const dy = S.y - T.y;
    const L = Math.hypot(dx, dy);
    if (L < 10) return null;
    const u = { x: dx / L, y: dy / L };
    const n = { x: -u.y, y: u.x };
    const N = steps || Math.max(80, Math.min(400, Math.round(L)));

    // Primer pase: anchura típica de la hoja para acotar la búsqueda y no saltar a otra llave
    const rough = [];
    for (let i = 0; i <= N; i++) {
      const s = (L * i) / N;
      const r = runAt(mask, w, h, { x: T.x + u.x * s, y: T.y + u.y * s }, n, L * 0.25);
      if (r) rough.push(r.width);
    }
    const typical = median(rough.filter((v) => v > 0)) || L * 0.25;
    const search = Math.max(3, typical * 0.75);
    const maxWidth = typical * 1.45;

    const cuts = [];
    for (let i = 0; i <= N; i++) {
      const s = (L * i) / N;
      const c = { x: T.x + u.x * s, y: T.y + u.y * s };
      const r = runAt(mask, w, h, c, n, search);
      if (!r) { cuts.push({ s, a: 0, b: 0, width: 0 }); continue; }
      // Si el corte se ensancha demasiado (se junta con otra llave o con la cabeza), se recorta
      let { a, b } = r;
      if (b - a > maxWidth) {
        const mid = (a + b) / 2;
        a = Math.max(a, mid - maxWidth / 2);
        b = Math.min(b, mid + maxWidth / 2);
      }
      cuts.push({ s, a, b, width: b - a });
    }
    return { cuts, L, u, n, typical, T, S };
  }

  /** Mediana móvil para quitar el ruido de bordes de un píxel. */
  function smooth(values, k) {
    const out = values.slice();
    for (let i = 0; i < values.length; i++) {
      const win = [];
      for (let j = Math.max(0, i - k); j <= Math.min(values.length - 1, i + k); j++) win.push(values[j]);
      out[i] = median(win);
    }
    return out;
  }

  /** Simplificación de Douglas-Peucker. */
  function simplify(points, eps) {
    if (points.length < 3) return points.slice();
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop();
      const p0 = points[i0];
      const p1 = points[i1];
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1e-9;
      let maxD = 0;
      let maxI = -1;
      for (let i = i0 + 1; i < i1; i++) {
        const p = points[i];
        const d = Math.abs((p1.y - p0.y) * p.x - (p1.x - p0.x) * p.y + p1.x * p0.y - p1.y * p0.x) / len;
        if (d > maxD) { maxD = d; maxI = i; }
      }
      if (maxD > eps && maxI > 0) {
        keep[maxI] = 1;
        stack.push([i0, maxI], [maxI, i1]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  /**
   * Convierte la hoja muestreada en el contorno de una llave imprimible (mm):
   * hoja medida (eje X: 0 en el hombro, positivo hacia la punta) + cuello + cabeza circular con agujero.
   * ref: { type: 'height' | 'length', mm } fija la escala.
   */
  function buildKeyOutline(blade, ref, opts) {
    const o = Object.assign({ bowDiameter: 24, holeDiameter: 5, shoulder: 1.6, neck: 4 }, opts || {});
    const cuts = blade.cuts;
    // Altura de la hoja en píxeles: percentil 90 de las anchuras (ignora la rampa de la punta)
    const widths = cuts.map((c) => c.width).filter((v) => v > 0).sort((p, q) => p - q);
    const heightPx = widths[Math.floor(widths.length * 0.9)] || blade.typical;
    const mmPerPx = ref && ref.type === 'length' ? ref.mm / blade.L : (ref && ref.mm ? ref.mm : 8.5) / heightPx;

    let top = smooth(cuts.map((c) => c.b), 1);
    let bottom = smooth(cuts.map((c) => c.a), 1);
    // El dentado queda arriba: es el borde que más varía una vez quitada la inclinación del eje
    const valid = cuts.map((c) => c.width > 0);
    // Para comparar bordes solo cuenta el tramo central: la rampa de la punta y el hombro mueven los dos
    const central = cuts.map((c, i) => valid[i] && c.s > blade.L * 0.15 && c.s < blade.L * 0.85);
    const fitLine = (arr) => {
      const xs = [], ys = [];
      arr.forEach((v, i) => { if (central[i]) { xs.push(cuts[i].s); ys.push(v); } });
      const mx = xs.reduce((p, q) => p + q, 0) / xs.length;
      const my = ys.reduce((p, q) => p + q, 0) / ys.length;
      let num = 0, den = 0;
      xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
      const k = den ? num / den : 0;
      const res = ys.map((y, i) => y - (my + k * (xs[i] - mx)));
      return { k, b: my - k * mx, varRes: res.reduce((p, q) => p + q * q, 0) / res.length };
    };
    if (fitLine(bottom).varRes > fitLine(top).varRes) {
      const t = top.map((v) => -v);
      top = bottom.map((v) => -v);
      bottom = t;
    }
    // El lomo (borde sin dentado) queda horizontal y en y = 0: se corrige la pequeña inclinación del eje
    const spine = fitLine(bottom);
    top = top.map((v, i) => v - (spine.k * cuts[i].s + spine.b));
    bottom = bottom.map((v, i) => v - (spine.k * cuts[i].s + spine.b));
    const base = 0;
    const toMm = (s, off) => ({ x: (blade.L - s) * mmPerPx, y: (off - base) * mmPerPx });

    const topPts = [];
    const bottomPts = [];
    for (let i = 0; i < cuts.length; i++) {
      if (!valid[i]) continue;
      topPts.push(toMm(cuts[i].s, top[i]));
      bottomPts.push(toMm(cuts[i].s, bottom[i]));
    }
    if (topPts.length < 5) return null;
    // Orden: hombro (x=0) -> punta
    topPts.reverse();
    bottomPts.reverse();
    const eps = 0.04;
    const topS = simplify(topPts, eps);
    const bottomS = simplify(bottomPts, eps);

    const topMax = Math.max(...topS.map((p) => p.y));
    const bottomMin = Math.min(...bottomS.map((p) => p.y));
    const midY = (topMax + bottomMin) / 2;
    const hNeck = (topMax - bottomMin) / 2 + o.shoulder;
    const R = Math.max(o.bowDiameter / 2, hNeck + 2);
    const cx = -(o.neck + R);
    const joinX = cx + Math.sqrt(Math.max(0, R * R - hNeck * hNeck));

    const outline = [];
    // Hoja: borde inferior del hombro a la punta y borde del dentado de vuelta
    outline.push({ x: 0, y: midY - hNeck });
    for (const p of bottomS) outline.push(p);
    for (let i = topS.length - 1; i >= 0; i--) outline.push(topS[i]);
    outline.push({ x: 0, y: midY + hNeck });
    // Cuello y cabeza circular
    outline.push({ x: joinX, y: midY + hNeck });
    const a0 = Math.asin(Math.min(1, hNeck / R));
    const arcN = 64;
    for (let i = 1; i < arcN; i++) {
      const ang = a0 + ((2 * Math.PI - 2 * a0) * i) / arcN;
      outline.push({ x: cx + R * Math.cos(ang), y: midY + R * Math.sin(ang) });
    }
    outline.push({ x: joinX, y: midY - hNeck });

    const bladeLengthMm = blade.L * mmPerPx;
    const bladeHeightMm = heightPx * mmPerPx;
    return {
      outline: outline.map((p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 })),
      bowHole: { x: cx - R * 0.35, y: midY, radius: o.holeDiameter / 2 },
      mmPerPx,
      bladeLengthMm,
      bladeHeightMm,
      totalLengthMm: bladeLengthMm + o.neck + 2 * R,
    };
  }

  /**
   * Sigue una hoja desde la punta: dirección inicial por PCA de los píxeles cercanos y después
   * avanza por los puntos medios de cada corte (la dirección se va corrigiendo), hasta que la
   * anchura se dispara (cabeza u otra llave) o se acaba la máscara.
   */
  function traceBlade(mask, w, h, tip, diag) {
    // Dirección inicial: PCA de los píxeles de ESTA hoja cerca de la punta (componente conexa dentro
    // de un disco), para no mezclarla con una llave vecina
    const r0 = Math.max(8, diag * 0.08);
    let mx = 0, my = 0, n0 = 0;
    const near = [];
    const start = { x: Math.round(tip.x), y: Math.round(tip.y) };
    if (!mask[idx(start.x, start.y, w)]) return null;
    const seen = new Set([idx(start.x, start.y, w)]);
    const queue = [start];
    while (queue.length) {
      const q = queue.pop();
      near.push([q.x, q.y]); mx += q.x; my += q.y; n0++;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = q.x + ox, y = q.y + oy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const k = idx(x, y, w);
        if (seen.has(k) || !mask[k] || Math.hypot(x - tip.x, y - tip.y) > r0) continue;
        seen.add(k);
        queue.push({ x, y });
      }
    }
    if (n0 < 10) return null;
    mx /= n0; my /= n0;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [x, y] of near) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let d = { x: Math.cos(ang), y: Math.sin(ang) };
    if ((mx - tip.x) * d.x + (my - tip.y) * d.y < 0) d = { x: -d.x, y: -d.y };

    const mids = [];
    const widths = [];
    let p = { x: tip.x, y: tip.y };
    let typical = 0;
    let maxGood = 0;
    const goodWidths = [];
    let bad = 0;
    let lastGood = -1;
    const maxSteps = Math.round(diag * 0.9);
    for (let k = 0; k < maxSteps; k++) {
      const c = { x: p.x + d.x, y: p.y + d.y };
      const n = { x: -d.y, y: d.x };
      const r = runAt(mask, w, h, c, n, typical ? typical * 0.6 : Math.max(4, diag * 0.02));
      if (!r || r.width < 1) break;
      const m = { x: c.x + n.x * ((r.a + r.b) / 2), y: c.y + n.y * ((r.a + r.b) / 2) };
      widths.push(r.width);
      mids.push(m);
      if (widths.length === 14) {
        typical = median(widths.slice(5));
        maxGood = typical * 1.1;
        goodWidths.push(...widths.slice(5));
      }
      if (typical && widths.length > 14) {
        // El hombro es el primer ensanchamiento sostenido por encima de la hoja más alta vista
        // (no antes de 3 anchuras desde la punta: ahí la rampa todavía está subiendo)
        const tooWide = mids.length > typical * 3 && r.width > maxGood * 1.18;
        if (tooWide || r.width < typical * 0.4) {
          bad++;
          if (bad > 4) break;
        } else {
          bad = 0;
          lastGood = mids.length - 1;
          typical = typical * 0.98 + r.width * 0.02;
          // Altura de referencia: percentil 90 de la hoja (no el máximo, que subiría con la rampa del hombro)
          goodWidths.push(r.width);
          if (goodWidths.length % 4 === 0) {
            const sorted = goodWidths.slice().sort((p, q) => p - q);
            maxGood = sorted[Math.floor(sorted.length * 0.9)];
          }
        }
      }
      // Avanzar por el centro del corte y corregir la dirección con la tendencia reciente
      p = { x: c.x + n.x * ((r.a + r.b) / 2) * 0.5, y: c.y + n.y * ((r.a + r.b) / 2) * 0.5 };
      if (mids.length > 12) {
        const back = mids[mids.length - 12];
        const t = { x: m.x - back.x, y: m.y - back.y };
        const tl = Math.hypot(t.x, t.y);
        if (tl > 0) {
          const nd = { x: d.x * 0.8 + (t.x / tl) * 0.2, y: d.y * 0.8 + (t.y / tl) * 0.2 };
          const nl = Math.hypot(nd.x, nd.y);
          d = { x: nd.x / nl, y: nd.y / nl };
        }
      }
    }
    if (!typical || lastGood < 0) return null;
    // Eje final: recta por los puntos medios de la hoja; el hombro es su último punto estable
    const used = mids.slice(0, lastGood + 1);
    const cx = used.reduce((q, v) => q + v.x, 0) / used.length;
    const cy = used.reduce((q, v) => q + v.y, 0) / used.length;
    let a = 0, b = 0, c2 = 0;
    for (const v of used) { a += (v.x - cx) ** 2; b += (v.y - cy) ** 2; c2 += (v.x - cx) * (v.y - cy); }
    const th = 0.5 * Math.atan2(2 * c2, a - b);
    let ax = { x: Math.cos(th), y: Math.sin(th) };
    const last = used[used.length - 1];
    if ((last.x - tip.x) * ax.x + (last.y - tip.y) * ax.y < 0) ax = { x: -ax.x, y: -ax.y };
    const proj = (v) => (v.x - cx) * ax.x + (v.y - cy) * ax.y;
    const t0 = proj(tip);
    const t1 = proj(last);
    const tipOnAxis = { x: cx + ax.x * t0, y: cy + ax.y * t0 };
    const shoulder = { x: cx + ax.x * t1, y: cy + ax.y * t1 };
    const lengthPx = t1 - t0;
    // Una hoja es recta: los puntos medios se separan poco del eje (la anilla, en cambio, se curva)
    const rms = Math.sqrt(used.reduce((q, v) => q + ((v.x - cx) * -ax.y + (v.y - cy) * ax.x) ** 2, 0) / used.length);
    if (rms > typical * 0.35) return null;
    return { tip: tipOnAxis, rawTip: tip, shoulder, lengthPx, widthPx: typical, aspect: lengthPx / typical, rms };
  }

  /**
   * Busca hojas de llave automáticamente: prueba como punta cada punto extremo del contorno,
   * sigue la hoja hacia dentro mientras su anchura se mantiene y puntúa por longitud y regularidad.
   * Devuelve candidatas { tip, shoulder, lengthPx, widthPx, score } ordenadas de mejor a peor.
   */
  function autoDetect(mask, w, h) {
    // Puntos de borde
    let cnt = 0;
    const edge = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!mask[idx(x, y, w)]) continue;
        cnt++;
        if (!mask[idx(x - 1, y, w)] || !mask[idx(x + 1, y, w)] || !mask[idx(x, y - 1, w)] || !mask[idx(x, y + 1, w)]) {
          edge.push({ x, y });
        }
      }
    }
    if (cnt < 50) return [];

    // Envolvente convexa (Andrew) de los puntos de borde
    const pts = edge.slice().sort((p, q) => p.x - q.x || p.y - q.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    const diag = Math.hypot(w, h);

    const candidates = [];
    for (const tip of hull) {
      const c = traceBlade(mask, w, h, tip, diag);
      if (c && c.aspect >= 2.5 && c.widthPx >= 4) candidates.push(c);
    }

    // Quedarse con una candidata por hoja (las puntas cercanas son la misma llave)
    candidates.sort((p, q) => q.lengthPx - p.lengthPx);
    const picked = [];
    for (const c of candidates) {
      if (picked.some((p) => Math.hypot(p.rawTip.x - c.rawTip.x, p.rawTip.y - c.rawTip.y) < Math.max(p.widthPx, c.widthPx) * 1.2)) continue;
      // Puntuación por superficie de hoja (largo × ancho): la anilla y los bordes finos quedan atrás
      c.score = c.lengthPx * c.widthPx;
      picked.push(c);
    }
    picked.sort((p, q) => q.score - p.score);
    // Los trozos de anilla o de cabeza puntúan muy por debajo de una hoja real
    return picked.filter((c) => c.score >= picked[0].score * 0.2);
  }

  const KeyBlade = { traceBlade, closeMask, fillSmallHoles, runAt, sampleBlade, buildKeyOutline, autoDetect, simplify };
  if (typeof module !== 'undefined' && module.exports) module.exports = KeyBlade;
  else root.KeyBlade = KeyBlade;
})(typeof window !== 'undefined' ? window : globalThis);
