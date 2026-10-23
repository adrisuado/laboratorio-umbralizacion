/* =====================================================================
   estadistica.js — estadística descriptiva, histogramas y ECDF.
   ===================================================================== */
(function (UL) {
  'use strict';

  /** Resumen robusto y clásico de un vector (como resumen_estadistico()). */
  const RESUMENES = new WeakMap(); /* por vector ordenado (UL.ordenar devuelve el mismo si no cambió) */
  UL.resumen = function (vals) {
    const n = vals.length;
    if (!n) return { n: 0 };
    const s = UL.ordenar(vals);
    if (RESUMENES.has(s)) return RESUMENES.get(s);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i];
    const media = sum / n;
    let m2 = 0, m3 = 0;
    for (let i = 0; i < n; i++) { const d = s[i] - media; m2 += d * d; m3 += d * d * d; }
    const de = Math.sqrt(m2 / Math.max(1, n - 1));
    const sdPob = Math.sqrt(m2 / n);
    const q = function (p) { return UL.cuantilOrdenado(s, p); };
    const mediana = q(0.5);
    const dev = new Float32Array(n);
    for (let i = 0; i < n; i++) dev[i] = Math.abs(s[i] - mediana);
    UL.ordenarEnSitio(dev);
    const res = {
      n: n, min: s[0], max: s[n - 1], media: media, mediana: mediana, de: de,
      riq: q(0.75) - q(0.25), mad: 1.4826 * UL.cuantilOrdenado(dev, 0.5),
      asimetria: sdPob > 0 ? (m3 / n) / Math.pow(sdPob, 3) : 0,
      p5: q(0.05), p25: q(0.25), p75: q(0.75), p95: q(0.95), ordenados: s
    };
    RESUMENES.set(s, res);
    return res;
  };

  /** Histograma con nb clases entre min y max. */
  UL.histograma = function (vals, nb, min, max) {
    if (min === undefined) {
      min = Infinity; max = -Infinity;
      for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (v < min) min = v; if (v > max) max = v; }
    }
    if (!(max > min)) { max = min + 1e-3; }
    const conteos = new Float64Array(nb), ancho = (max - min) / nb;
    for (let i = 0; i < vals.length; i++) {
      let b = Math.floor((vals[i] - min) / ancho);
      if (b < 0 || b >= nb) { if (vals[i] === max) b = nb - 1; else continue; }
      conteos[b]++;
    }
    const centros = new Float64Array(nb), bordes = new Float64Array(nb + 1);
    for (let b = 0; b <= nb; b++) bordes[b] = min + b * ancho;
    for (let b = 0; b < nb; b++) centros[b] = min + (b + 0.5) * ancho;
    return { conteos: conteos, centros: centros, bordes: bordes, ancho: ancho, min: min, max: max, n: vals.length };
  };

  /** Cajas (p5, p25, mediana, p75, p95) por clase temática. */
  UL.cajasPorClase = function (I, clases, idx, leyenda) {
    const grupos = {};
    const n = idx ? idx.length : I.length;
    for (let k = 0; k < n; k++) {
      const i = idx ? idx[k] : k;
      const c = clases[i];
      (grupos[c] = grupos[c] || []).push(I[i]);
    }
    return leyenda.map(function (L) {
      const g = grupos[L.id];
      if (!g || g.length < 3) return { id: L.id, nombre: L.nombre, color: L.color, n: g ? g.length : 0 };
      const s = UL.ordenar(g), q = function (p) { return UL.cuantilOrdenado(s, p); };
      return { id: L.id, nombre: L.nombre, color: L.color, n: s.length, p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
    });
  };

  /**
   * Densidad kernel gaussiana sobre una rejilla de m puntos entre min y max.
   * Ancho de banda de Silverman: h = 0,9 · min(DE, RIQ/1,34) · n^(−1/5).
   */
  UL.kde = function (vals, min, max, m, h) {
    m = m || 256;
    const n = vals.length, w = (max - min) / m, c = new Float64Array(m);
    if (!n) return { x: [], y: [], h: NaN };
    for (let i = 0; i < n; i++) { const b = Math.floor((vals[i] - min) / w); if (b >= 0 && b < m) c[b]++; }
    if (!(h > 0)) {
      const s = UL.ordenar(vals);
      let me = 0; for (let i = 0; i < n; i++) me += s[i];
      me /= n;
      let v = 0; for (let i = 0; i < n; i++) v += (s[i] - me) ** 2;
      const de = Math.sqrt(v / Math.max(1, n - 1)), riq = UL.cuantilOrdenado(s, 0.75) - UL.cuantilOrdenado(s, 0.25);
      const a = Math.min(de, riq / 1.34) || de || w;
      h = Math.max(0.9 * a * Math.pow(n, -0.2), w * 0.75);
    }
    const rad = Math.ceil(4 * h / w), k = new Float64Array(2 * rad + 1);
    for (let j = -rad; j <= rad; j++) k[j + rad] = Math.exp(-0.5 * (j * w / h) ** 2);
    const norm = 1 / (n * h * Math.sqrt(2 * Math.PI)), x = [], y = [];
    for (let i = 0; i < m; i++) {
      let acc = 0;
      for (let j = -rad; j <= rad; j++) { const q = i + j; if (q >= 0 && q < m && c[q]) acc += c[q] * k[j + rad]; }
      x.push(min + (i + 0.5) * w); y.push(acc * norm);
    }
    return { x: x, y: y, h: h };
  };
})(globalThis.UL = globalThis.UL || {});
