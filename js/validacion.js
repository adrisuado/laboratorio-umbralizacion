/* =====================================================================
   validacion.js — clasificación, matriz de confusión, métricas,
   matriz multiclase y curva área–umbral.
   ===================================================================== */
(function (UL) {
  'use strict';
  const V = UL.validacion = {};

  /** Índice de clase (0..k−1) = número de cortes superados (I ≥ t). */
  V.clasificar = function (I, cortes) {
    const n = I.length, out = new Uint8Array(n), c = cortes.slice().sort(function (a, b) { return a - b; });
    for (let i = 0; i < n; i++) {
      let k = 0;
      while (k < c.length && I[i] >= c[k]) k++;
      out[i] = k;
    }
    return out;
  };

  /** Binario a partir de clases: el corte j separa la clase objetivo.
      dir = +1 → objetivo sobre el corte; dir = −1 → objetivo bajo el corte. */
  V.binario = function (clase, j, dir) {
    const n = clase.length, b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = dir > 0 ? (clase[i] > j ? 1 : 0) : (clase[i] <= j ? 1 : 0);
    return b;
  };

  /** Matriz de confusión binaria sobre un conjunto de índices (o todo). */
  V.matriz = function (pred, ref, idx) {
    let vp = 0, fp = 0, fn = 0, vn = 0;
    const n = idx ? idx.length : pred.length;
    for (let k = 0; k < n; k++) {
      const i = idx ? idx[k] : k, p = pred[i], r = ref[i];
      if (p && r) vp++; else if (p && !r) fp++; else if (!p && r) fn++; else vn++;
    }
    return { vp: vp, fp: fp, fn: fn, vn: vn, n: n };
  };

  /** Métricas con reglas de validez: no se informan si faltan clases o casos. */
  V.metricas = function (m) {
    const P = m.vp + m.fn, Nn = m.fp + m.vn, PP = m.vp + m.fp;
    const r = { n: m.n, P: P, N: Nn, avisos: [] };
    const minimo = 5;
    if (m.n < 20) r.avisos.push('menos de 20 casos');
    if (P < minimo) r.avisos.push('menos de ' + minimo + ' casos de la clase objetivo');
    if (Nn < minimo) r.avisos.push('menos de ' + minimo + ' casos del resto');
    const okP = P >= minimo && m.n >= 20, okN = Nn >= minimo && m.n >= 20;
    r.exactitud = okP && okN ? (m.vp + m.vn) / m.n : NaN;
    r.sensibilidad = okP ? m.vp / P : NaN;
    r.especificidad = okN ? m.vn / Nn : NaN;
    r.precision = okP && PP > 0 ? m.vp / PP : NaN;
    if (okP && PP === 0) r.avisos.push('el mapa no marca ningún caso como objetivo: precisión indefinida');
    r.f1 = isFinite(r.precision) && r.precision + r.sensibilidad > 0 ? 2 * r.precision * r.sensibilidad / (r.precision + r.sensibilidad) : (okP && PP === 0 ? 0 : NaN);
    r.iou = okP ? m.vp / (m.vp + m.fp + m.fn) : NaN;
    r.balanceada = isFinite(r.sensibilidad) && isFinite(r.especificidad) ? (r.sensibilidad + r.especificidad) / 2 : NaN;
    r.prevalencia = m.n ? P / m.n : NaN;
    r.valida = okP && okN;
    return r;
  };

  /** Matriz k × k (filas: referencia ordinal; columnas: clase del mapa). */
  V.matrizMulti = function (claseMapa, claseRef, k, kRef) {
    const M = [];
    for (let a = 0; a < kRef; a++) M.push(new Array(k).fill(0));
    for (let i = 0; i < claseMapa.length; i++) M[claseRef[i]][claseMapa[i]]++;
    let diag = 0, tot = 0;
    for (let a = 0; a < kRef; a++) for (let b = 0; b < k; b++) { tot += M[a][b]; if (a === b) diag += M[a][b]; }
    return { M: M, exactitud: k === kRef ? diag / tot : NaN, n: tot };
  };

  /** Área (km²) clasificada como objetivo para cada t de una rejilla. */
  V.curvaArea = function (ordenados, dir, tmin, tmax, pasos) {
    const t = [], a = [];
    for (let k = 0; k <= pasos; k++) {
      const tt = tmin + (tmax - tmin) * k / pasos;
      const c = dir > 0 ? UL.contarMayorIgual(ordenados, tt) : ordenados.length - UL.contarMayorIgual(ordenados, tt);
      t.push(tt); a.push(c * UL.PIX_KM2);
    }
    return { t: t, area: a };
  };

  /** Área del objetivo con un umbral (escena completa). */
  V.areaUmbral = function (ordenados, dir, t) {
    return (dir > 0 ? UL.contarMayorIgual(ordenados, t) : ordenados.length - UL.contarMayorIgual(ordenados, t)) * UL.PIX_KM2;
  };
})(globalThis.UL = globalThis.UL || {});
