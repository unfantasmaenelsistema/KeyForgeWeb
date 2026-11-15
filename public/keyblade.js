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
   * Marco de referencia de la hoja: qué borde es el lomo (el que menos varía una vez quitada la
   * inclinación; el otro es el dentado) y la recta del lomo. En «unidades con signo» el interior de la
   * hoja queda siempre hacia valores crecientes desde el lomo.
   */
  function spineFrame(blade) {
    const cuts = blade.cuts;
    const topRaw = smooth(cuts.map((c) => c.b), 1);
    const bottomRaw = smooth(cuts.map((c) => c.a), 1);
    const valid = cuts.map((c) => c.width > 0);
    // Para comparar bordes solo cuenta el tramo central: la rampa de la punta y el hombro mueven los dos
    const central = cuts.map((c, i) => valid[i] && c.s > blade.L * 0.15 && c.s < blade.L * 0.85);
    const fitLine = (arr) => {
      const xs = [];
      const ys = [];
      arr.forEach((v, i) => {
        if (central[i]) {
          xs.push(cuts[i].s);
          ys.push(v);
        }
      });
      const mx = xs.reduce((p, q) => p + q, 0) / xs.length;
      const my = ys.reduce((p, q) => p + q, 0) / ys.length;
      let num = 0;
      let den = 0;
      xs.forEach((x, i) => {
        num += (x - mx) * (ys[i] - my);
        den += (x - mx) ** 2;
      });
      const k = den ? num / den : 0;
      const res = ys.map((y, i) => y - (my + k * (xs[i] - mx)));
      return { k, b: my - k * mx, varRes: res.reduce((p, q) => p + q * q, 0) / res.length };
    };
    // Si el borde «a» varía más que el «b», el dentado está en «a» y el lomo en «b»
    const swapped = fitLine(bottomRaw).varRes > fitLine(topRaw).varRes;
    const spine = fitLine(swapped ? topRaw.map((v) => -v) : bottomRaw);
    return { swapped, spine, topRaw, bottomRaw, valid, central };
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

    const F = spineFrame(blade);
    let top = F.swapped ? F.bottomRaw.map((v) => -v) : F.topRaw;
    let bottom = F.swapped ? F.topRaw.map((v) => -v) : F.bottomRaw;
    const valid = F.valid;
    // El lomo (borde sin dentado) queda horizontal y en y = 0: se corrige la pequeña inclinación del eje
    top = top.map((v, i) => v - (F.spine.k * cuts[i].s + F.spine.b));
    bottom = bottom.map((v, i) => v - (F.spine.k * cuts[i].s + F.spine.b));
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
    // Piezas para la malla con surcos: la hoja (cerrada por x = 0) y la cabeza (cuello + círculo)
    const r4 = (p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 });
    const bladePoly = [];
    if (bottomS[0].x > 0) bladePoly.push({ x: 0, y: bottomS[0].y });
    for (const p of bottomS) bladePoly.push(p);
    for (let i = topS.length - 1; i >= 0; i--) bladePoly.push(topS[i]);
    if (topS[0].x > 0) bladePoly.push({ x: 0, y: topS[0].y });
    const headPoly = outline.slice(outline.length - (arcN + 1)).concat([{ x: 0, y: midY - hNeck }]);
    headPoly.unshift({ x: 0, y: midY + hNeck });
    return {
      parts: {
        blade: bladePoly.map(r4),
        head: headPoly.map(r4),
        bottom: (bottomS[0].x > 0 ? [{ x: 0, y: bottomS[0].y }] : []).concat(bottomS).map(r4),
        top: (topS[0].x > 0 ? [{ x: 0, y: topS[0].y }] : []).concat(topS).map(r4),
      },
      outline: outline.map((p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 })),
      bowHole: { x: cx - R * 0.35, y: midY, radius: o.holeDiameter / 2 },
      mmPerPx,
      bladeLengthMm,
      bladeHeightMm,
      totalLengthMm: bladeLengthMm + o.neck + 2 * R,
    };
  }

  const percentile = (arr, q) => {
    const sorted = arr.slice().sort((p, r) => p - r);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))] : 0;
  };

  /**
   * Surcos laterales estimados en la foto de la cara de la llave. Los surcos recorren la hoja de punta a
   * hombro, así que se promedia el brillo a lo largo de la hoja y se obtiene un perfil a lo ancho, medido
   * desde el lomo hasta el fondo de los cortes (la zona que siempre es metal).
   *
   * Pensado para fotos reales, no para una imagen concreta: cada corte se normaliza por su mediana (luz
   * desigual a lo largo), se usa la mediana entre cortes (reflejos puntuales), se quita la pendiente a lo
   * ancho (luz lateral) y solo se aceptan bandas que superan el ruido medido en la propia foto.
   * Devuelve posiciones en píxeles desde el lomo; la profundidad no se puede medir en una foto de frente.
   */
  function grooveProfile(gray, w, h, blade) {
    const F = spineFrame(blade);
    const sign = F.swapped ? -1 : 1;
    const cuts = blade.cuts;
    const centralCuts = cuts.filter((c, i) => F.valid[i] && c.s > blade.L * 0.2 && c.s < blade.L * 0.85);
    const widths = centralCuts.map((c) => c.width);
    const heightPx = percentile(widths, 0.9);
    // Fondo de los cortes: por debajo siempre hay metal en toda la hoja
    const depthPx = percentile(widths, 0.1) * 0.92;
    const result = { heightPx, depthPx, bins: 0, profile: [], threshold: 0, bands: [], lowRes: false, rows: centralCuts.length, spine: { sign, k: F.spine.k, b: F.spine.b } };
    if (heightPx < 22 || depthPx < 10 || centralCuts.length < 8) {
      result.lowRes = true;
      return result;
    }
    const N = Math.max(12, Math.min(64, Math.round(depthPx)));
    result.bins = N;

    const at = (x, y) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) return NaN;
      const fx = x - x0;
      const fy = y - y0;
      const i = y0 * w + x0;
      return gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy;
    };

    const rows = [];
    for (const c of centralCuts) {
      const sp = F.spine.k * c.s + F.spine.b; // posición del lomo (unidades con signo)
      const vals = [];
      for (let i = 0; i < N; i++) {
        const t = sign * (sp + ((i + 0.5) / N) * depthPx);
        vals.push(at(blade.T.x + blade.u.x * c.s + blade.n.x * t, blade.T.y + blade.u.y * c.s + blade.n.y * t));
      }
      if (vals.some((v) => Number.isNaN(v))) continue;
      const med = median(vals);
      rows.push(vals.map((v) => v - med));
    }
    if (rows.length < 8) {
      result.lowRes = true;
      return result;
    }
    let prof = [];
    const noise = [];
    for (let i = 0; i < N; i++) {
      const col = rows.map((r) => r[i]);
      const m = median(col);
      prof.push(m);
      noise.push((1.4826 * median(col.map((v) => Math.abs(v - m)))) / Math.sqrt(col.length));
    }
    // Quitar la pendiente a lo ancho (luz que entra de un lado) con un ajuste de mínima mediana de
    // cuadrados: aguanta hasta la mitad de puntos atípicos, y los surcos de una llave pueden ocupar el
    // 40 % del ancho (un ajuste normal se torcía y el metal liso entre surcos parecía un «brillo»)
    const xm = (N - 1) / 2;
    let line = { k: 0, c: median(prof) };
    let bestScore = Infinity;
    for (let i1 = 0; i1 < N; i1++) {
      for (let i2 = i1 + 2; i2 < N; i2++) {
        const k = (prof[i2] - prof[i1]) / (i2 - i1);
        const res = prof.map((v, i) => v - k * (i - xm));
        const c = median(res);
        const score = median(res.map((v) => (v - c) ** 2));
        if (score < bestScore) {
          bestScore = score;
          line = { k, c };
        }
      }
    }
    prof = prof.map((v, i) => v - (line.c + line.k * (i - xm)));
    const rowsDetrended = rows.map((r) => r.map((v, i) => v - (line.c + line.k * (i - xm))));
    const raw = prof;
    prof = raw.map((_, i) => (raw[Math.max(0, i - 1)] + raw[i] + raw[Math.min(N - 1, i + 1)]) / 3);
    const centre = median(prof);
    const mad = 1.4826 * median(prof.map((v) => Math.abs(v - centre)));
    const thr = Math.max(6, 3.5 * median(noise), mad);
    result.profile = prof;
    result.threshold = thr;

    // Bandas con histéresis: núcleo por encima del umbral y bordes hasta la mitad del umbral
    const pxPerBin = depthPx / N;
    const edge = Math.max(1, Math.round(N * 0.08)); // bisel junto al lomo
    let i = 0;
    while (i < N) {
      if (Math.abs(prof[i]) <= thr) {
        i++;
        continue;
      }
      const sg = Math.sign(prof[i]);
      let a = i;
      let b = i;
      while (b + 1 < N && Math.sign(prof[b + 1]) === sg && Math.abs(prof[b + 1]) > thr / 2) b++;
      while (a - 1 >= 0 && Math.sign(prof[a - 1]) === sg && Math.abs(prof[a - 1]) > thr / 2) a--;
      i = b + 1;
      const widthPx = (b - a + 1) * pxPerBin;
      if (a < edge) continue;
      if (b - a + 1 < 2 || widthPx < heightPx * 0.03 || widthPx > depthPx * 0.45) continue;
      // Un surco recorre toda la hoja: la banda tiene que verse en más de la mitad de los cortes. Un
      // reflejo o una mancha solo cubren un tramo (y un surco medio tapado por un reflejo sigue pasando)
      const support =
        rowsDetrended.filter((r) => {
          let sum = 0;
          for (let j = a; j <= b; j++) sum += r[j];
          return Math.sign(sum) === sg && Math.abs(sum / (b - a + 1)) > thr / 3;
        }).length / rowsDetrended.length;
      if (support < 0.55) continue;
      let peak = 0;
      for (let j = a; j <= b; j++) if (Math.abs(prof[j]) > Math.abs(peak)) peak = prof[j];
      result.bands.push({ from: a * pxPerBin, to: (b + 1) * pxPerBin, contrast: Math.round(Math.abs(peak)), kind: sg < 0 ? 'dark' : 'bright', support: Math.round(support * 100) / 100 });
    }
    return result;
  }

  /**
   * Agrupa las bandas en surcos propuestos. Con luz lateral un surco se ve como una pareja oscura y clara
   * (una pared en sombra y la otra iluminada), así que una banda estrecha contigua de distinto tipo se une.
   * Un surco con parte oscura se propone activo; una banda solo clara puede ser un nervio o un reflejo y
   * se propone desactivada para que decida el usuario.
   */
  function proposeGrooves(groove) {
    const bands = groove.bands.slice().sort((p, q) => p.from - q.from);
    const gap = groove.bins ? (groove.depthPx / groove.bins) * 1.01 : 0;
    const out = [];
    for (const b of bands) {
      const last = out[out.length - 1];
      // Solo se une la banda clara estrecha (el brillo de una pared) a la oscura contigua, o al revés
      const narrowWall = last && Math.min(b.to - b.from, last.to - last.from) <= 0.5 * Math.max(b.to - b.from, last.to - last.from);
      if (last && b.from - last.to <= gap && !last.kinds.includes(b.kind) && narrowWall) {
        last.to = b.to;
        last.kinds.push(b.kind);
        last.contrast = Math.max(last.contrast, b.contrast);
      } else {
        out.push({ from: b.from, to: b.to, kinds: [b.kind], contrast: b.contrast });
      }
    }
    return out.map((g) => ({ from: g.from, to: g.to, contrast: g.contrast, kind: g.kinds.length > 1 ? 'pair' : g.kinds[0], active: g.kinds.includes('dark') }));
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

  /* ---------------------------------------------------------------------------------------------
   * Malla 3D con surcos sin CSG. La llave es un sólido de «dos alturas y media»: la planta se parte
   * por las líneas de los surcos y cada trozo tiene una altura constante (llena o rebajada). Se
   * construyen techo, suelo y paredes compartiendo vértices exactos, así que la malla es estanca.
   * ------------------------------------------------------------------------------------------- */

  const P_EPS = 1e-9;
  const pkey = (p) => p.x.toFixed(6) + ',' + p.y.toFixed(6);

  /** Parte cada arista donde cruza una de las rectas y = c (los puntos quedan exactamente en la recta). */
  function refineByLines(poly, lines) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      out.push(p);
      const hits = [];
      for (const c of lines) {
        if ((p.y < c - P_EPS && q.y > c + P_EPS) || (p.y > c + P_EPS && q.y < c - P_EPS)) {
          const t = (c - p.y) / (q.y - p.y);
          hits.push({ t, x: p.x + t * (q.x - p.x), y: c });
        }
      }
      hits.sort((a, b) => a.t - b.t);
      for (const hp of hits) out.push({ x: hp.x, y: hp.y });
    }
    return out;
  }

  /** Recorte de Sutherland-Hodgman contra y >= c (keepAbove) o y <= c, sin crear puntos nuevos si el polígono ya está refinado. */
  function clipY(poly, c, keepAbove) {
    const inside = (p) => (keepAbove ? p.y >= c - P_EPS : p.y <= c + P_EPS);
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (inside(p)) out.push(p);
      if (inside(p) !== inside(q)) {
        const t = (c - p.y) / (q.y - p.y);
        const x = p.x + t * (q.x - p.x);
        // En un polígono refinado no debería ocurrir; por si acaso se crea el punto
        if (Math.abs(p.y - c) > P_EPS && Math.abs(q.y - c) > P_EPS) out.push({ x, y: c });
      }
    }
    // Quitar duplicados consecutivos
    const clean = [];
    for (const p of out) {
      const last = clean[clean.length - 1];
      if (!last || Math.abs(last.x - p.x) > P_EPS || Math.abs(last.y - p.y) > P_EPS) clean.push(p);
    }
    while (clean.length > 1 && Math.abs(clean[0].x - clean[clean.length - 1].x) <= P_EPS && Math.abs(clean[0].y - clean[clean.length - 1].y) <= P_EPS) clean.pop();
    return clean;
  }

  const area = (poly) => {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a / 2;
  };

  /** Triangulación por recorte de orejas que conserva los puntos colineales (hacen falta para no dejar uniones en T). */
  function triangulate(poly) {
    const idxs = poly.map((_, i) => i);
    const tris = [];
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const inTri = (p, a, b, c) => {
      const d1 = cross(a, b, p);
      const d2 = cross(b, c, p);
      const d3 = cross(c, a, p);
      return d1 > 1e-12 && d2 > 1e-12 && d3 > 1e-12;
    };
    let guard = 0;
    while (idxs.length > 3 && guard++ < 100000) {
      let clipped = false;
      // Primero orejas convexas de verdad; si no hay, una colineal (triángulo degenerado pero coherente)
      for (const allowFlat of [false, true]) {
        for (let k = 0; k < idxs.length; k++) {
          const ia = idxs[(k + idxs.length - 1) % idxs.length];
          const ib = idxs[k];
          const ic = idxs[(k + 1) % idxs.length];
          const a = poly[ia];
          const b = poly[ib];
          const c = poly[ic];
          const cr = cross(a, b, c);
          if (allowFlat ? cr < -1e-12 : cr <= 1e-12) continue;
          let ok = true;
          for (const j of idxs) {
            if (j === ia || j === ib || j === ic) continue;
            if (inTri(poly[j], a, b, c)) { ok = false; break; }
          }
          if (!ok) continue;
          tris.push([ia, ib, ic]);
          idxs.splice(k, 1);
          clipped = true;
          break;
        }
        if (clipped) break;
      }
      if (!clipped) break;
    }
    if (idxs.length === 3) tris.push([idxs[0], idxs[1], idxs[2]]);
    return tris;
  }

  /**
   * Construye la malla de la llave con surcos. key = resultado de buildKeyOutline; grooves =
   * [{ y0, y1, depth, faces: 'front' | 'both' }] en mm desde el lomo; thickness en mm.
   * Devuelve un Float32Array de posiciones (triángulos sueltos) o null si no se puede.
   */
  function buildGroovedMesh(key, grooves, thickness) {
    const parts = key.parts;
    if (!parts || !parts.bottom || !parts.top) return null;
    const T = thickness;
    // Misma cota (redondeada) para la hoja y la cabeza: si no, quedan puntos casi repetidos en la costura
    // Rejilla de 1 µm para cotas y columnas: evita franjas de menos de una micra que, al pasar a coma
    // flotante de 32 bits y exportar el STL, fundirían vértices distintos
    const Q = 1e-3;
    const q = (v) => Math.round(v / Q) * Q;
    const hy = q(key.bowHole.y);
    const bladeYs = parts.bottom.concat(parts.top).map((p) => p.y);
    const yMin = Math.min(...bladeYs);
    const yMax = Math.max(...bladeYs);
    const gs = grooves
      .map((g) => {
        const both = g.faces === 'both';
        const maxDepth = both ? (T - 0.6) / 2 : T - 0.6;
        return { y0: Math.max(g.y0, yMin), y1: Math.min(g.y1, yMax), d: Math.max(0.1, Math.min(g.depth, maxDepth)), both };
      })
      .filter((g) => g.y1 - g.y0 > 0.05);
    const lines = Array.from(new Set([hy, ...gs.flatMap((g) => [q(g.y0), q(g.y1)])]))
      .filter((c) => c > yMin + 1e-6 && c < yMax - 1e-6)
      .sort((a, b) => a - b);

    // --- Celdas de la hoja por columnas. Los bordes inferior y superior son funciones de x, así que
    // cada columna entre dos x consecutivas se parte por las rectas de los surcos en trapecios simples,
    // aunque el borde medido de la punta sea irregular y cruce varias veces una recta.
    const bottom = parts.bottom;
    const top = parts.top;
    const evalChain = (chain, x) => {
      if (x <= chain[0].x) return chain[0].y;
      for (let i = 0; i + 1 < chain.length; i++) {
        const p = chain[i];
        const q = chain[i + 1];
        if (x <= q.x) return q.x === p.x ? q.y : p.y + ((x - p.x) * (q.y - p.y)) / (q.x - p.x);
      }
      return chain[chain.length - 1].y;
    };
    const xEnd = Math.min(bottom[bottom.length - 1].x, top[top.length - 1].x);
    const xsSet = new Set();
    for (const chain of [bottom, top]) {
      for (let i = 0; i < chain.length; i++) {
        if (chain[i].x <= xEnd) xsSet.add(chain[i].x);
        if (i + 1 < chain.length) {
          const p = chain[i];
          const q = chain[i + 1];
          for (const c of lines) {
            if ((p.y - c) * (q.y - c) < 0 && q.x !== p.x) {
              const x = p.x + ((c - p.y) * (q.x - p.x)) / (q.y - p.y);
              if (x > 0 && x < xEnd) xsSet.add(x);
            }
          }
        }
      }
    }
    xsSet.add(0);
    xsSet.add(xEnd);
    const xs = Array.from(new Set(Array.from(xsSet).map((x) => Math.min(xEnd, Math.max(0, Math.round(x / Q) * Q))))).sort((a, b) => a - b);
    const bandHeights = [];
    const bounds = [-Infinity, ...lines, Infinity];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const lo = Number.isFinite(bounds[k]) ? bounds[k] : yMin;
      const hi = Number.isFinite(bounds[k + 1]) ? bounds[k + 1] : yMax;
      const ymid = (lo + hi) / 2;
      let zb = 0;
      let zt = T;
      for (const g of gs) {
        if (ymid > g.y0 && ymid < g.y1) {
          zt = Math.min(zt, T - g.d);
          if (g.both) zb = Math.max(zb, g.d);
        }
      }
      bandHeights.push({ zb, zt });
    }
    const cells = [];
    const snapToLine = (y) => {
      for (const c of lines) if (Math.abs(y - c) < Q) return c;
      return y;
    };
    const bandAt = (x, k) => {
      const yb = snapToLine(evalChain(bottom, x));
      const yt = snapToLine(evalChain(top, x));
      let lo = Number.isFinite(bounds[k]) ? Math.max(bounds[k], yb) : yb;
      let hi = Number.isFinite(bounds[k + 1]) ? Math.min(bounds[k + 1], yt) : yt;
      if (hi - lo < Q) hi = lo = Math.min(Math.max(lo, yb), yt);
      return { lo, hi };
    };
    for (let i = 0; i + 1 < xs.length; i++) {
      const xl = xs[i];
      const xr = xs[i + 1];
      if (xr - xl < 1e-9) continue;
      for (let k = 0; k + 1 < bounds.length; k++) {
        const L0 = bandAt(xl, k);
        const R0 = bandAt(xr, k);
        if (L0.hi - L0.lo < 1e-9 && R0.hi - R0.lo < 1e-9) continue;
        const pts = [{ x: xl, y: L0.lo }, { x: xr, y: R0.lo }, { x: xr, y: R0.hi }, { x: xl, y: L0.hi }];
        const poly = pts.filter((p, j) => {
          const q = pts[(j + 1) % pts.length];
          return Math.abs(p.x - q.x) > 1e-9 || Math.abs(p.y - q.y) > 1e-9;
        });
        if (poly.length < 3 || Math.abs(area(poly)) < 1e-9) continue;
        cells.push({ poly, zb: bandHeights[k].zb, zt: bandHeights[k].zt });
      }
    }

    // --- Cabeza: dos mitades (arriba y abajo del agujero), cada una con medio agujero como entrante
    const head = refineByLines(parts.head, [hy]);
    const r = key.bowHole.radius;
    const hx = key.bowHole.x;
    const arcN = 24;
    const halves = [
      { poly: clipY(head, hy, true), upper: true },
      { poly: clipY(head, hy, false), upper: false },
    ];
    for (const half of halves) {
      const poly = half.poly;
      // Localizar la cuerda sobre y = hy que contiene el agujero
      let at = -1;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        if (Math.abs(p.y - hy) < 1e-7 && Math.abs(q.y - hy) < 1e-7 && Math.min(p.x, q.x) < hx - r && Math.max(p.x, q.x) > hx + r) at = i;
      }
      if (at < 0) return null;
      const p = poly[at];
      const q = poly[(at + 1) % poly.length];
      const ins = [];
      if (q.x > p.x) {
        // Recorrido de izquierda a derecha (mitad de arriba): semicírculo superior en sentido horario
        ins.push({ x: hx - r, y: hy });
        for (let k = 1; k < arcN; k++) {
          const ang = Math.PI - (Math.PI * k) / arcN;
          ins.push({ x: hx + r * Math.cos(ang), y: hy + r * Math.sin(ang) });
        }
        ins.push({ x: hx + r, y: hy });
      } else {
        // De derecha a izquierda (mitad de abajo): semicírculo inferior en sentido horario
        ins.push({ x: hx + r, y: hy });
        for (let k = 1; k < arcN; k++) {
          const ang = -(Math.PI * k) / arcN;
          ins.push({ x: hx + r * Math.cos(ang), y: hy + r * Math.sin(ang) });
        }
        ins.push({ x: hx - r, y: hy });
      }
      poly.splice(at + 1, 0, ...ins);
      cells.push({ poly, zb: 0, zt: T });
    }

    // --- Unificar puntos casi idénticos (< 1e-6 mm) para que todas las celdas usen el mismo vértice
    const canon = new Map();
    const canonOf = (p) => {
      const k = Math.round(p.x * 1e6) + ',' + Math.round(p.y * 1e6);
      if (!canon.has(k)) canon.set(k, p);
      return canon.get(k);
    };
    for (const c of cells) {
      const pts = c.poly.map(canonOf);
      c.poly = pts.filter((p, i) => p !== pts[(i + 1) % pts.length]);
    }

    // --- Resolver uniones en T en planta: cada vértice que cae sobre una arista ajena se inserta en ella
    const all = new Map();
    for (const c of cells) for (const p of c.poly) all.set(pkey(p), p);
    const allPts = Array.from(all.values());
    for (const c of cells) {
      const out = [];
      for (let i = 0; i < c.poly.length; i++) {
        const a = c.poly[i];
        const b = c.poly[(i + 1) % c.poly.length];
        out.push(a);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-14) continue;
        const mids = [];
        for (const v of allPts) {
          const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / len2;
          if (t <= 1e-9 || t >= 1 - 1e-9) continue;
          const ex = a.x + dx * t - v.x;
          const ey = a.y + dy * t - v.y;
          if (ex * ex + ey * ey < 1e-12) mids.push({ t, v });
        }
        mids.sort((m1, m2) => m1.t - m2.t);
        for (const m of mids) out.push(m.v);
      }
      c.poly = out;
    }

    // --- Triángulos: techo, suelo y paredes (troceadas en todos los niveles z para casar los cantos)
    const levels = Array.from(new Set([0, T, ...cells.flatMap((c) => [c.zb, c.zt])])).sort((a, b) => a - b);
    const out = [];
    const push = (p, z) => out.push(p.x, p.y, z);
    const edgeOwner = new Map();
    cells.forEach((c, ci) => {
      if (area(c.poly) < 0) c.poly.reverse();
      for (let i = 0; i < c.poly.length; i++) {
        edgeOwner.set(pkey(c.poly[i]) + '>' + pkey(c.poly[(i + 1) % c.poly.length]), ci);
      }
    });
    cells.forEach((c, ci) => {
      for (const [ia, ib, ic] of triangulate(c.poly)) {
        push(c.poly[ia], c.zt); push(c.poly[ib], c.zt); push(c.poly[ic], c.zt);
        push(c.poly[ia], c.zb); push(c.poly[ic], c.zb); push(c.poly[ib], c.zb);
      }
      for (let i = 0; i < c.poly.length; i++) {
        const a = c.poly[i];
        const b = c.poly[(i + 1) % c.poly.length];
        const nb = edgeOwner.get(pkey(b) + '>' + pkey(a));
        const other = nb === undefined ? null : cells[nb];
        for (let l = 0; l + 1 < levels.length; l++) {
          const z0 = levels[l];
          const z1 = levels[l + 1];
          const mine = z0 >= c.zb - 1e-9 && z1 <= c.zt + 1e-9;
          const theirs = other && z0 >= other.zb - 1e-9 && z1 <= other.zt + 1e-9;
          if (!mine || theirs) continue;
          // Pared hacia fuera de esta celda (a la derecha de a->b)
          push(a, z0); push(b, z0); push(b, z1);
          push(a, z0); push(b, z1); push(a, z1);
        }
      }
    });
    return new Float32Array(out);
  }

  const KeyBlade = { buildGroovedMesh, triangulate, spineFrame, grooveProfile, proposeGrooves, traceBlade, closeMask, fillSmallHoles, runAt, sampleBlade, buildKeyOutline, autoDetect, simplify };
  if (typeof module !== 'undefined' && module.exports) module.exports = KeyBlade;
  else root.KeyBlade = KeyBlade;
})(typeof window !== 'undefined' ? window : globalThis);
