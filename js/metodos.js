/* =====================================================================
   metodos.js — métodos de umbralización implementados de verdad.
   Enfoque I  : Otsu, percentiles, k-means 1D, GMM (EM), multi-Otsu.
   Enfoque II : tabla de umbrales (ROC), Youden, F1 / Fβ.
   Enfoque III: calibración lineal Z = β0 + β1·I e inversión t = f⁻¹(z0).
   Convención: un corte t asigna la clase alta a I ≥ t.
   ===================================================================== */
(function (UL) {
  'use strict';
  const M = UL.metodos = {};
  const LN2PI = Math.log(2 * Math.PI);

  /* ------------------------------ Otsu ------------------------------ */
  M.otsu = function (vals, nb) {
    const h = UL.histograma(vals, nb);
    const n = h.n, p = new Float64Array(nb);
    let mT = 0;
    for (let b = 0; b < nb; b++) { p[b] = h.conteos[b] / n; mT += p[b] * h.centros[b]; }
    let sT = 0;
    for (let b = 0; b < nb; b++) sT += p[b] * (h.centros[b] - mT) ** 2;
    const ct = [], cs = [];
    let w0 = 0, m0 = 0, best = -1;
    for (let b = 0; b < nb - 1; b++) {
      w0 += p[b]; m0 += p[b] * h.centros[b];
      const w1 = 1 - w0;
      let s = NaN;
      if (w0 > 1e-12 && w1 > 1e-12) s = (mT * w0 - m0) ** 2 / (w0 * w1);
      ct.push(h.bordes[b + 1]); cs.push(s);
      if (isFinite(s) && s > best) best = s;
    }
    /* empates: punto medio de la meseta de máximos */
    const emp = [];
    for (let k = 0; k < cs.length; k++) if (isFinite(cs[k]) && cs[k] >= best * (1 - 1e-9)) emp.push(k);
    const kb = emp[Math.floor((emp.length - 1) / 2)];
    const t = ct[kb];
    let W0 = 0, S0 = 0;
    for (let b = 0; b <= kb; b++) { W0 += p[b]; S0 += p[b] * h.centros[b]; }
    return {
      cortes: [t], curva: { t: ct, s: cs }, sB: best, sT: sT, eta: sT > 0 ? best / sT : NaN,
      w0: W0, w1: 1 - W0, mu0: S0 / W0, mu1: (mT - S0) / (1 - W0), hist: h
    };
  };

  /* --------------------------- Percentiles -------------------------- */
  M.percentil = function (vals, p) {
    const s = UL.ordenar(vals);
    return { cortes: [UL.cuantilOrdenado(s, p)], p: p, ordenados: s };
  };

  /* ------------------------- k-means en 1D -------------------------- */
  M.kmeans = function (vals, k, nstart, rng) {
    const s = Float64Array.from(UL.ordenar(vals)), n = s.length;
    const S = new Float64Array(n + 1), S2 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { S[i + 1] = S[i] + s[i]; S2[i + 1] = S2[i] + s[i] * s[i]; }
    function lb(t) { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < t) lo = m + 1; else hi = m; } return lo; }
    function correr(c0) {
      let c = c0.slice().sort(function (a, b) { return a - b; });
      const tray = [c.slice()];
      let it = 0;
      for (; it < 200; it++) {
        const lim = [0];
        for (let j = 0; j < k - 1; j++) lim.push(lb((c[j] + c[j + 1]) / 2));
        lim.push(n);
        const nc = c.slice();
        for (let j = 0; j < k; j++) { const m = lim[j + 1] - lim[j]; if (m > 0) nc[j] = (S[lim[j + 1]] - S[lim[j]]) / m; }
        nc.sort(function (a, b) { return a - b; });
        let cambio = 0;
        for (let j = 0; j < k; j++) cambio = Math.max(cambio, Math.abs(nc[j] - c[j]));
        c = nc; tray.push(c.slice());
        if (cambio < 1e-9) break;
      }
      const lim = [0];
      for (let j = 0; j < k - 1; j++) lim.push(lb((c[j] + c[j + 1]) / 2));
      lim.push(n);
      let sse = 0;
      for (let j = 0; j < k; j++) {
        const a = lim[j], b = lim[j + 1], m = b - a;
        if (m > 0) sse += (S2[b] - S2[a]) - (S[b] - S[a]) ** 2 / m;
      }
      return { centros: c, sse: sse, iter: it + 1, tray: tray };
    }
    let mejor = null;
    const ssePorArranque = [];
    for (let r = 0; r < nstart; r++) {
      let c0 = [];
      if (r === 0) for (let j = 0; j < k; j++) c0.push(UL.cuantilOrdenado(s, (j + 0.5) / k));
      else for (let j = 0; j < k; j++) c0.push(s[Math.floor(rng() * n)]);
      const res = correr(c0);
      ssePorArranque.push(res.sse);
      if (!mejor || res.sse < mejor.sse - 1e-12) mejor = res;
    }
    const cortes = [];
    for (let j = 0; j < k - 1; j++) cortes.push((mejor.centros[j] + mejor.centros[j + 1]) / 2);
    return { cortes: cortes, centros: mejor.centros, sse: mejor.sse, iter: mejor.iter, trayectoria: mejor.tray, ssePorArranque: ssePorArranque };
  };

  /* ----------------- Mezcla de gaussianas (EM, 1D) ------------------ */
  function lnNorm(x, mu, sd) { const z = (x - mu) / sd; return -0.5 * z * z - Math.log(sd) - 0.5 * LN2PI; }

  M.gmm = function (vals, K, rng, opciones) {
    /* EM sobre el histograma fino de toda la población (512 clases, cada una con su
       conteo como peso): el mismo ajuste que con los píxeles, pero el coste ya no
       depende del número de píxeles, y cambiar K responde al instante. */
    const op = Object.assign({ nInit: 3, maxIter: 300, clases: 512 }, opciones || {});
    const n = vals.length;
    let mn = Infinity, mx = -Infinity, sum = 0, sum2 = 0;
    for (let i = 0; i < n; i++) { const v = vals[i]; if (v < mn) mn = v; if (v > mx) mx = v; sum += v; sum2 += v * v; }
    let x, w;
    if (n > 4 * op.clases && mx > mn) {
      const nb = op.clases, ancho = (mx - mn) / nb, cnt = new Float64Array(nb);
      for (let i = 0; i < n; i++) { let k = Math.floor((vals[i] - mn) / ancho); if (k >= nb) k = nb - 1; cnt[k]++; }
      let nz = 0;
      for (let k = 0; k < nb; k++) if (cnt[k] > 0) nz++;
      x = new Float64Array(nz); w = new Float64Array(nz);
      for (let k = 0, j = 0; k < nb; k++) if (cnt[k] > 0) { x[j] = mn + (k + 0.5) * ancho; w[j] = cnt[k]; j++; }
    } else {
      x = Float64Array.from(vals); w = new Float64Array(n).fill(1);
    }
    const m = x.length;
    const sdG = Math.sqrt(Math.max(sum2 / n - (sum / n) ** 2, 1e-10));
    const sdMin = Math.max(1e-3, 0.004 * (mx - mn));
    const R = new Float64Array(m * K);

    function em(mu0, sd0, pi0) {
      let mu = mu0.slice(), sd = sd0.slice(), pi = pi0.slice();
      let LL = -Infinity, it = 0;
      const lt = new Float64Array(K), lpi = new Float64Array(K), lsd = new Float64Array(K);
      for (; it < op.maxIter; it++) {
        for (let k = 0; k < K; k++) { lpi[k] = Math.log(Math.max(pi[k], 1e-12)); lsd[k] = Math.log(sd[k]) + 0.5 * LN2PI; }
        let ll = 0;
        for (let i = 0; i < m; i++) {
          let mxl = -Infinity;
          const xi = x[i];
          for (let k = 0; k < K; k++) { const z = (xi - mu[k]) / sd[k]; const v = lpi[k] - 0.5 * z * z - lsd[k]; lt[k] = v; if (v > mxl) mxl = v; }
          let se = 0;
          for (let k = 0; k < K; k++) se += Math.exp(lt[k] - mxl);
          const lse = mxl + Math.log(se);
          ll += w[i] * lse;
          for (let k = 0; k < K; k++) R[i * K + k] = Math.exp(lt[k] - lse);
        }
        for (let k = 0; k < K; k++) {
          let nk = 0, sx = 0;
          for (let i = 0; i < m; i++) { const r = R[i * K + k] * w[i]; nk += r; sx += r * x[i]; }
          if (nk < 1e-8) { pi[k] = 1e-8; continue; }
          const mk = sx / nk;
          let sv = 0;
          for (let i = 0; i < m; i++) { const d = x[i] - mk; sv += R[i * K + k] * w[i] * d * d; }
          mu[k] = mk; sd[k] = Math.max(Math.sqrt(sv / nk), sdMin); pi[k] = nk / n;
        }
        if (Math.abs(ll - LL) < 1e-8 * Math.abs(ll)) { LL = ll; break; }
        LL = ll;
      }
      return { mu: mu, sd: sd, pi: pi, LL: LL, iter: it + 1 };
    }

    let mejor = null;
    const km = M.kmeans(vals, K, 1, rng);
    for (let r = 0; r < op.nInit; r++) {
      let mu0, sd0, pi0;
      if (r === 0) { mu0 = km.centros.slice(); sd0 = mu0.map(function () { return sdG / K; }); pi0 = mu0.map(function () { return 1 / K; }); }
      else {
        mu0 = []; for (let k = 0; k < K; k++) mu0.push(vals[Math.floor(rng() * n)]);
        sd0 = mu0.map(function () { return sdG / Math.sqrt(K); }); pi0 = mu0.map(function () { return 1 / K; });
      }
      const res = em(mu0, sd0, pi0);
      if (!mejor || res.LL > mejor.LL) mejor = res;
    }
    const comps = [];
    for (let k = 0; k < K; k++) comps.push({ pi: mejor.pi[k], mu: mejor.mu[k], sd: mejor.sd[k] });
    comps.sort(function (a, b) { return a.mu - b.mu; });
    const cortes = [];
    let sinCruce = false;
    for (let j = 0; j < K - 1; j++) {
      const A = comps[j], B = comps[j + 1];
      const g = function (t) { return Math.log(A.pi) + lnNorm(t, A.mu, A.sd) - Math.log(B.pi) - lnNorm(t, B.mu, B.sd); };
      let a = A.mu, b = B.mu, t = NaN;
      if (g(a) > 0 && g(b) < 0) {
        for (let k = 0; k < 80; k++) { const c = (a + b) / 2; if (g(c) > 0) a = c; else b = c; }
        t = (a + b) / 2;
      } else {
        let prev = g(mn), tp = mn;
        for (let k = 1; k <= 600; k++) {
          const tt = mn + (mx - mn) * k / 600, gv = g(tt);
          if (prev > 0 && gv <= 0) { t = (tp + tt) / 2; break; }
          prev = gv; tp = tt;
        }
        if (!isFinite(t)) { t = (A.mu + B.mu) / 2; sinCruce = true; }
      }
      cortes.push(t);
    }
    cortes.sort(function (a, b) { return a - b; });
    const p = 3 * K - 1;
    return {
      cortes: cortes, comps: comps, LL: mejor.LL, BIC: 2 * mejor.LL - p * Math.log(n),
      iter: mejor.iter, n: n, sinCruce: sinCruce, rango: [mn, mx]
    };
  };

  /** Probabilidad a posteriori de cada componente para un valor. */
  M.posteriorGmm = function (comps, v) {
    const lt = comps.map(function (c) { return Math.log(Math.max(c.pi, 1e-12)) + lnNorm(v, c.mu, c.sd); });
    const mx = Math.max.apply(null, lt);
    const e = lt.map(function (l) { return Math.exp(l - mx); });
    const s = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v2) { return v2 / s; });
  };
  M.densidadComp = function (c, v) { return c.pi * Math.exp(lnNorm(v, c.mu, c.sd)); };

  /* --------------------------- Multi-Otsu --------------------------- */
  M.multiOtsu = function (vals, k, nb) {
    nb = nb || 64;
    const h = UL.histograma(vals, nb), n = h.n;
    const P = new Float64Array(nb + 1), S = new Float64Array(nb + 1);
    for (let b = 0; b < nb; b++) { const p = h.conteos[b] / n; P[b + 1] = P[b] + p; S[b + 1] = S[b] + p * h.centros[b]; }
    const mT = S[nb];
    let sT = 0;
    for (let b = 0; b < nb; b++) sT += (h.conteos[b] / n) * (h.centros[b] - mT) ** 2;
    function term(a, b) { const w = P[b] - P[a]; return w > 1e-12 ? (S[b] - S[a]) ** 2 / w : 0; }
    let best = -Infinity, bestC = null;
    const mapa = k === 3 ? new Float64Array(nb * nb).fill(NaN) : null;
    const c = new Array(k - 1);
    (function rec(j, desde, acc) {
      if (j === k - 1) {
        const v = acc + term(c[k - 2], nb) - mT * mT;
        if (mapa) mapa[c[0] * nb + c[1]] = v;
        if (v > best) { best = v; bestC = c.slice(); }
        return;
      }
      const hasta = nb - (k - 1 - j);
      for (let ci = desde; ci <= hasta; ci++) {
        c[j] = ci;
        rec(j + 1, ci + 1, acc + term(j === 0 ? 0 : c[j - 1], ci));
      }
    })(0, 1, 0);
    return { cortes: bestC.map(function (ci) { return h.bordes[ci]; }), indices: bestC, sB: best, sT: sT, eta: sT > 0 ? best / sT : NaN, mapa: mapa, hist: h };
  };

  /* ------------------ Enfoque II: tabla de umbrales ------------------ */
  /** I, Y: valores y etiquetas (1/0). dir = +1 si la clase está en valores altos. */
  M.tablaUmbrales = function (I, Y, dir) {
    const n = I.length;
    const ord = Array.from({ length: n }, function (_, i) { return i; });
    ord.sort(function (a, b) { return dir * I[b] - dir * I[a]; });
    let P = 0;
    for (let i = 0; i < n; i++) P += Y[i];
    const Nn = n - P;
    const t = [Infinity * dir], tpr = [0], fpr = [0], prec = [NaN], vpA = [0], fpA = [0];
    let tp = 0, fp = 0, k = 0;
    while (k < n) {
      const v = I[ord[k]];
      while (k < n && I[ord[k]] === v) { if (Y[ord[k]]) tp++; else fp++; k++; }
      t.push(dir > 0 ? v : v + 1e-7); vpA.push(tp); fpA.push(fp);
      tpr.push(P ? tp / P : NaN); fpr.push(Nn ? fp / Nn : NaN); prec.push(tp + fp ? tp / (tp + fp) : NaN);
    }
    let auc = 0;
    for (let j = 1; j < t.length; j++) auc += (fpr[j] - fpr[j - 1]) * (tpr[j] + tpr[j - 1]) / 2;
    return { t: t, tpr: tpr, fpr: fpr, prec: prec, vp: vpA, fp: fpA, P: P, N: Nn, n: n, auc: auc, dir: dir };
  };

  function elegir(tab, valor) {
    let best = -Infinity;
    const v = [];
    for (let j = 1; j < tab.t.length; j++) { const x = valor(j); v.push(x); if (isFinite(x) && x > best) best = x; }
    const emp = [];
    for (let j = 1; j < tab.t.length; j++) if (isFinite(v[j - 1]) && v[j - 1] >= best - 1e-12) emp.push(j);
    if (!emp.length) return { j: -1, best: NaN, curva: v };
    let tm = 0;
    for (const j of emp) tm += tab.t[j];
    tm /= emp.length;
    /* el corte de la meseta se representa por su punto medio */
    let jm = emp[0];
    for (const j of emp) if (Math.abs(tab.t[j] - tm) < Math.abs(tab.t[jm] - tm)) jm = j;
    return { j: jm, best: best, curva: v, tMedio: tm, empates: emp.length };
  }

  M.youden = function (I, Y, dir) {
    const tab = M.tablaUmbrales(I, Y, dir);
    if (!tab.P || !tab.N) return { error: 'Las muestras de calibración necesitan ambas clases (presencia y ausencia).' };
    const r = elegir(tab, function (j) { return tab.tpr[j] - tab.fpr[j]; });
    return { cortes: [tab.t[r.j]], J: r.best, tabla: tab, curvaJ: r.curva, j: r.j, empates: r.empates };
  };

  M.fbeta = function (I, Y, dir, beta) {
    const tab = M.tablaUmbrales(I, Y, dir);
    if (!tab.P || !tab.N) return { error: 'Las muestras de calibración necesitan ambas clases (presencia y ausencia).' };
    const b2 = beta * beta;
    const r = elegir(tab, function (j) {
      const P = tab.prec[j], R = tab.tpr[j];
      return P + R > 0 && isFinite(P) ? (1 + b2) * P * R / (b2 * P + R) : 0;
    });
    return { cortes: [tab.t[r.j]], F: r.best, tabla: tab, curvaF: r.curva, j: r.j, beta: beta };
  };

  /* ------------------ Enfoque III: calibración lineal ----------------- */
  function ols(x, z) {
    const n = x.length;
    let mx = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += x[i]; mz += z[i]; }
    mx /= n; mz /= n;
    let sxx = 0, sxz = 0, szz = 0;
    for (let i = 0; i < n; i++) { const dx = x[i] - mx, dz = z[i] - mz; sxx += dx * dx; sxz += dx * dz; szz += dz * dz; }
    const b1 = sxz / sxx, b0 = mz - b1 * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) { const r = z[i] - b0 - b1 * x[i]; sse += r * r; }
    return { b0: b0, b1: b1, r2: szz > 0 ? 1 - sse / szz : NaN, seB1: Math.sqrt(sse / Math.max(1, n - 2) / sxx), sxx: sxx, mx: mx, sigma: Math.sqrt(sse / Math.max(1, n - 2)) };
  }
  M.ols = ols;

  M.calibracionLineal = function (I, Z, z0, rng, B) {
    const n = I.length;
    if (n < 10) return { error: 'Se necesitan al menos 10 pares (I, Z) para ajustar la recta.' };
    const f = ols(I, Z);
    if (!isFinite(f.b1) || Math.abs(f.b1) < 1e-9) return { error: 'La pendiente es nula: el índice no explica la fracción Z en estos pares.' };
    const t = (z0 - f.b0) / f.b1;
    const res = new Float64Array(n);
    for (let i = 0; i < n; i++) res[i] = Z[i] - f.b0 - f.b1 * I[i];
    const s = UL.ordenar(I);
    const rango = [UL.cuantilOrdenado(s, 0.02), UL.cuantilOrdenado(s, 0.98)];
    const tb = [];
    B = B || 200;
    const xb = new Float64Array(n), zb = new Float64Array(n);
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); xb[i] = I[j]; zb[i] = Z[j]; }
      const fb = ols(xb, zb);
      const v = (z0 - fb.b0) / fb.b1;
      if (isFinite(v)) tb.push(v);
    }
    tb.sort(function (a, b) { return a - b; });
    const ic = tb.length > 20 ? [tb[Math.floor(0.025 * tb.length)], tb[Math.floor(0.975 * tb.length) - 1]] : [NaN, NaN];
    return {
      cortes: [t], ajuste: f, residuos: res, z0: z0, rango: rango, extrapola: t < rango[0] || t > rango[1],
      ic: ic, B: B, dirModelo: f.b1 > 0 ? 1 : -1, n: n
    };
  };

  /** Pares estratificados por tramos de Z (como pares_calibracion()). */
  M.paresEstratificados = function (Z, idxPoblacion, nTotal, rng) {
    const tramos = [[], [], [], [], []];
    const n = idxPoblacion ? idxPoblacion.length : Z.length;
    for (let k = 0; k < n; k++) {
      const i = idxPoblacion ? idxPoblacion[k] : k;
      tramos[Math.min(4, Math.floor(Z[i] * 5))].push(i);
    }
    const porTramo = Math.round(nTotal / 5), out = [];
    for (const tr of tramos) for (const i of UL.muestrear(tr, porTramo, rng)) out.push(i);
    return out;
  };

  /** Media de Z por tramo de I (toda la escena) para dibujar la relación. */
  M.mediaPorTramo = function (I, Z, nb, min, max) {
    const s = new Float64Array(nb), c = new Float64Array(nb), w = (max - min) / nb;
    for (let i = 0; i < I.length; i++) {
      const b = Math.floor((I[i] - min) / w);
      if (b >= 0 && b < nb) { s[b] += Z[i]; c[b]++; }
    }
    const x = [], y = [];
    for (let b = 0; b < nb; b++) if (c[b] >= 15) { x.push(min + (b + 0.5) * w); y.push(s[b] / c[b]); }
    return { x: x, y: y };
  };

  /* ------------------ Enfoque II: regresión logística ------------------ */
  function sigm(z) { return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }
  M.sigmoide = sigm;

  /** Resuelve A·x = b (eliminación de Gauss con pivoteo parcial). */
  function resolver(A, b) {
    const n = b.length, a = A.map(function (f, i) { return f.concat([b[i]]); });
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      const t = a[c]; a[c] = a[piv]; a[piv] = t;
      if (Math.abs(a[c][c]) < 1e-14) return null;
      for (let r = c + 1; r < n; r++) { const k = a[r][c] / a[c][c]; for (let q = c; q <= n; q++) a[r][q] -= k * a[c][q]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s2 = a[r][n]; for (let q = r + 1; q < n; q++) s2 -= a[r][q] * x[q]; x[r] = s2 / a[r][r]; }
    return x;
  }
  M.resolver = resolver;

  /**
   * Logística binaria P(Y = 1 | I) = 1 / (1 + e^−(β0 + β1·I)) ajustada por Newton (IRLS)
   * sobre el índice estandarizado. Una penalización mínima en la pendiente evita que
   * β1 diverja cuando un corte separa perfectamente las muestras.
   */
  M.logistica = function (I, Y, opciones) {
    const op = Object.assign({ lambda: 1e-3, maxIter: 80 }, opciones || {});
    const n = I.length;
    let P = 0, mx = 0;
    for (let i = 0; i < n; i++) { P += Y[i] ? 1 : 0; mx += I[i]; }
    if (n < 10) return { error: 'La regresión logística necesita al menos 10 muestras de calibración.' };
    if (P === 0 || P === n) return { error: 'Las muestras de calibración necesitan ambas clases (presencia y ausencia).' };
    mx /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (I[i] - mx) ** 2;
    const sd = Math.sqrt(v / n) || 1;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = (I[i] - mx) / sd;
    let b0 = Math.log(P / (n - P)), b1 = 0, it = 0, conv = false, H00 = 0, H01 = 0, H11 = 0;
    for (; it < op.maxIter; it++) {
      let g0 = 0, g1 = -op.lambda * b1;
      H00 = 0; H01 = 0; H11 = op.lambda;
      for (let i = 0; i < n; i++) {
        const p = sigm(b0 + b1 * x[i]), w = Math.max(p * (1 - p), 1e-12), r = (Y[i] ? 1 : 0) - p;
        g0 += r; g1 += r * x[i];
        H00 += w; H01 += w * x[i]; H11 += w * x[i] * x[i];
      }
      const det = H00 * H11 - H01 * H01;
      let d0 = (H11 * g0 - H01 * g1) / det, d1 = (H00 * g1 - H01 * g0) / det;
      const paso = Math.max(Math.abs(d0), Math.abs(d1));
      if (paso > 5) { d0 *= 5 / paso; d1 *= 5 / paso; }
      b0 += d0; b1 += d1;
      if (paso < 1e-9) { conv = true; break; }
    }
    /* desempeño y probabilidades ajustadas */
    let LL = 0, brier = 0, intermedios = 0;
    for (let i = 0; i < n; i++) {
      const p = sigm(b0 + b1 * x[i]), y = Y[i] ? 1 : 0;
      LL += y ? Math.log(Math.max(p, 1e-15)) : Math.log(Math.max(1 - p, 1e-15));
      brier += (p - y) ** 2;
      if (p > 0.02 && p < 0.98) intermedios++;
    }
    const p0 = P / n, LL0 = P * Math.log(p0) + (n - P) * Math.log(1 - p0);
    const det = H00 * H11 - H01 * H01;
    const v0 = H11 / det, v1 = H00 / det, c01 = -H01 / det;
    const B1 = b1 / sd, B0 = b0 - b1 * mx / sd;
    const vB1 = v1 / (sd * sd), vB0 = v0 + (mx / sd) ** 2 * v1 - 2 * (mx / sd) * c01;
    return {
      b0: B0, b1: B1, se0: Math.sqrt(Math.max(vB0, 0)), se1: Math.sqrt(Math.max(vB1, 0)),
      LL: LL, desvianza: -2 * LL, desvianzaNula: -2 * LL0, r2McF: 1 - LL / LL0, brier: brier / n,
      iter: it + 1, convergio: conv, separacion: Math.abs(b1) > 12 || intermedios < 3, n: n, P: P, prevMuestra: P / n
    };
  };

  /** Índice donde la probabilidad alcanza el nivel p: t(p) = [logit(p) − β0] / β1. */
  M.umbralLogistica = function (b0, b1, p) { return (Math.log(p / (1 - p)) - b0) / b1; };

  /** Corrección del intercepto por prevalencia (muestra estratificada → población). */
  M.corregirIntercepto = function (b0, prevPob, prevMuestra) {
    return b0 + Math.log(prevPob / (1 - prevPob)) - Math.log(prevMuestra / (1 - prevMuestra));
  };

  /** Curva de fiabilidad: probabilidad predicha frente a frecuencia observada por tramos. */
  M.curvaFiabilidad = function (p, y, nb) {
    nb = nb || 10;
    const sp = new Float64Array(nb), so = new Float64Array(nb), c = new Float64Array(nb);
    let brier = 0;
    for (let i = 0; i < p.length; i++) {
      const b = Math.min(nb - 1, Math.floor(p[i] * nb));
      sp[b] += p[i]; so[b] += y[i]; c[b]++;
      brier += (p[i] - y[i]) ** 2;
    }
    const pred = [], obs = [], n = [];
    for (let b = 0; b < nb; b++) if (c[b] >= 3) { pred.push(sp[b] / c[b]); obs.push(so[b] / c[b]); n.push(c[b]); }
    return { pred: pred, obs: obs, n: n, brier: p.length ? brier / p.length : NaN };
  };

  /**
   * Logística multinomial: ln[P(Y = k) / P(Y = 0)] = βk0 + Σj βkj·Xj, con softmax.
   * X: arreglo de filas con p predictores; y: clase 0..K−1 (0 = referencia).
   */
  M.multinomial = function (X, y, K, opciones) {
    const op = Object.assign({ lambda: 1e-3, maxIter: 60 }, opciones || {});
    const n = X.length, p = X[0].length, q = p + 1, D = (K - 1) * q;
    const med = new Array(p).fill(0), de = new Array(p).fill(0);
    for (const f of X) for (let j = 0; j < p; j++) med[j] += f[j] / n;
    for (const f of X) for (let j = 0; j < p; j++) de[j] += (f[j] - med[j]) ** 2 / n;
    for (let j = 0; j < p; j++) de[j] = Math.sqrt(de[j]) || 1;
    const Z = X.map(function (f) { const z = [1]; for (let j = 0; j < p; j++) z.push((f[j] - med[j]) / de[j]); return z; });
    let beta = new Array(D).fill(0), it = 0, conv = false;
    const probs = function (z, b) {
      const eta = [0];
      for (let k = 1; k < K; k++) { let e = 0; for (let j = 0; j < q; j++) e += b[(k - 1) * q + j] * z[j]; eta.push(e); }
      const m = Math.max.apply(null, eta), ex = eta.map(function (e) { return Math.exp(e - m); }), s = ex.reduce(function (a, c) { return a + c; }, 0);
      return ex.map(function (e) { return e / s; });
    };
    for (; it < op.maxIter; it++) {
      const g = new Array(D).fill(0), Hm = [];
      for (let a = 0; a < D; a++) Hm.push(new Array(D).fill(0));
      for (let i = 0; i < n; i++) {
        const z = Z[i], pr = probs(z, beta);
        for (let k = 1; k < K; k++) {
          const r = (y[i] === k ? 1 : 0) - pr[k];
          for (let j = 0; j < q; j++) g[(k - 1) * q + j] += r * z[j];
          for (let l = 1; l < K; l++) {
            const w = pr[k] * ((k === l ? 1 : 0) - pr[l]);
            for (let j = 0; j < q; j++) for (let m = 0; m < q; m++) Hm[(k - 1) * q + j][(l - 1) * q + m] += w * z[j] * z[m];
          }
        }
      }
      for (let k = 1; k < K; k++) for (let j = 1; j < q; j++) { const a = (k - 1) * q + j; Hm[a][a] += op.lambda; g[a] -= op.lambda * beta[a]; }
      let d = resolver(Hm, g);
      if (!d) break;
      const paso = Math.max.apply(null, d.map(Math.abs));
      if (paso > 5) d = d.map(function (v2) { return v2 * 5 / paso; });
      beta = beta.map(function (b, a) { return b + d[a]; });
      if (paso < 1e-8) { conv = true; break; }
    }
    /* coeficientes en la escala original */
    const coef = [new Array(q).fill(0)];
    for (let k = 1; k < K; k++) {
      const c = new Array(q).fill(0);
      c[0] = beta[(k - 1) * q];
      for (let j = 1; j < q; j++) { c[j] = beta[(k - 1) * q + j] / de[j - 1]; c[0] -= beta[(k - 1) * q + j] * med[j - 1] / de[j - 1]; }
      coef.push(c);
    }
    const predecir = function (f) {
      const eta = coef.map(function (c) { let e = c[0]; for (let j = 0; j < p; j++) e += c[j + 1] * f[j]; return e; });
      const m = Math.max.apply(null, eta), ex = eta.map(function (e) { return Math.exp(e - m); }), s = ex.reduce(function (a, c2) { return a + c2; }, 0);
      return ex.map(function (e) { return e / s; });
    };
    return { coef: coef, predecir: predecir, iter: it + 1, convergio: conv, n: n, p: p, K: K };
  };
})(globalThis.UL = globalThis.UL || {});
