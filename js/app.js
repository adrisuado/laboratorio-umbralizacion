/* =====================================================================
   app.js — estado, ciclo de cálculo e interfaz del laboratorio.
   Flujo: escena → población → método → clasificación → validación →
   mapa, histograma, panel analítico y mensajes.
   ===================================================================== */
(function (UL) {
  'use strict';
  const W = UL.W, H = UL.H, N = UL.N, M = UL.metodos, V = UL.validacion, G = UL.graficos;
  const f = UL.fmt, km = UL.fmtKm2, pct = UL.fmtPct, ent = UL.fmtEntero;
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  const METODOS = {
    I: [['otsu', 'Otsu'], ['percentil', 'Percentiles'], ['kmeans', 'k-means'], ['gmm', 'GMM'], ['multiotsu', 'Multi-Otsu']],
    II: [['youden', 'Youden (ROC)'], ['f1', 'F1 / Fβ'], ['logistica', 'Logística'], ['manual', 'Manual']],
    III: [['calib', 'Calibración lineal']]
  };
  const NO_SUP = { otsu: 1, percentil: 1, kmeans: 1, gmm: 1, multiotsu: 1 };
  const CAPAS = { indice: 'Índice', clasificacion: 'Clasificación', referencia: 'Referencia', errores: 'Aciertos y errores', fraccion: 'Fracción Z', prob: 'Probabilidad', diferencia: 'Diferencia A–B' };

  /* ------------------------------ Estado ------------------------------ */
  const S = {
    escena: 'A', sim: null, variable: null, enfoque: 'I', metodo: 'otsu',
    p: {
      otsu: { bins: 256 }, percentil: { p: 0.95 }, kmeans: { k: 2, nstart: 5 }, gmm: { k: 2 }, multiotsu: { k: 3 },
      youden: {}, f1: { beta: 1 }, manual: { t: null }, calib: { z0: null, n: 400, fuente: 'auto' },
      logistica: { tipo: 'binaria', p: 0.5, corregir: false, predictores: 'NDSI', nClase: 150 }
    },
    corteObj: null, compuesta: false, submuestra: false,
    capa: 'indice', relieve: true,
    hist: { log: false, porClase: false, fondo: true, tipo: 'hist', bins: 120 },
    muestras: { cal: [], val: [], diseno: 'estratificada', nCal: 200, nVal: 300, semilla: 1, auto: false }, /* sin muestras hasta pulsar «Generar muestras» */
    geoms: [], B: null, tab: 'est', fijado: -1, bic: null,
    anterior: null, actualMet: null, tUltima: 0
  };
  let E = null, R = null, visor = null, versionEscena = 0, cacheCompleta = {}, cacheHistEsc = {};

  function simDefecto(id) {
    const m = UL.ESCENARIOS[id];
    const o = Object.assign({ semilla: 2026, prop: m.prop.defecto, esp: m.esp.defecto, esp2: m.esp2 ? m.esp2.defecto : undefined, L: 0.5 }, m.defectos);
    for (const x of m.extras || []) o[x.clave] = x.defecto;
    return o;
  }
  const COL3 = ['#d9b57b', '#eef7fc', '#2f78c4'], NOM3 = ['Resto', 'Glaciar (nieve y hielo)', 'Laguna'];
  function rango(n) { const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i; return a; }
  function juntar(arr, idx) { const o = new Float32Array(idx.length); for (let k = 0; k < idx.length; k++) o[k] = arr[idx[k]]; return o; }
  function varActual() { return E.variables[S.variable]; }
  function litDefecto(v) {
    if (!v.literatura.length) return Math.round(UL.cuantilOrdenado(v.ordenados, 0.6) * 1000) / 1000;
    return v.literatura[Math.min(1, v.literatura.length - 1)].t;
  }

  /* =========================== Escena ============================ */
  /* Las últimas escenas generadas se guardan: al volver a un valor ya usado de un
     control (p. ej. 4 → 6 → 4 lagunas) la escena aparece sin recalcularse. */
  const memoEscenas = new Map();
  let contEscenas = 0;
  function escenaMemo() {
    const k = S.escena + '|' + JSON.stringify(Object.assign({}, S.sim, { L: 0 }));
    let e = memoEscenas.get(k);
    if (e) { memoEscenas.delete(k); memoEscenas.set(k, e); }
    else {
      e = UL.generarEscena(S.escena, S.sim);
      e._version = ++contEscenas;
      memoEscenas.set(k, e);
      while (memoEscenas.size > 6) memoEscenas.delete(memoEscenas.keys().next().value);
    }
    if (e.variables.SAVI && e.variables.SAVI.L !== S.sim.L) { UL.recalcularSAVI(e, S.sim.L); e._version = ++contEscenas; }
    return e;
  }
  function regenerar(inmediato) {
    claveRegen = JSON.stringify(S.sim);
    E = escenaMemo();
    versionEscena = E._version;
    cacheCompleta = {}; cacheHistEsc = {};
    if (!E.variables[S.variable]) S.variable = E.varDefecto;
    if (S.muestras.auto) generarMuestras(false);
    if (S.B) { S.B = null; actualizarB(); avisoMapa('La comparación B se quitó porque cambió la escena simulada.'); }
    S.bic = null;
    if (inmediato && !pendiente) ciclo(); else programar();
  }

  function cambiarEscena(id) {
    S.escena = id;
    S.sim = simDefecto(id);
    S.geoms.length = 0;
    S.variable = null;
    S.corteObj = null; S.compuesta = false; S.p.manual.t = null; S.p.calib.z0 = null;
    S.B = null; S.fijado = -1; S.capa = 'indice';
    S.muestras.cal = []; S.muestras.val = []; S.muestras.auto = false; S.muestras.semilla = 1; S.muestras.hecha = false;
    E = null;
    regenerarSinProgramar();
    construirEscenario();
    construirSim();
    construirParams();
    actualizarB();
    if (visor) visor.ajustar();
    programar();
  }
  function regenerarSinProgramar() {
    claveRegen = JSON.stringify(S.sim);
    E = escenaMemo();
    versionEscena = E._version; cacheCompleta = {}; cacheHistEsc = {}; S.bic = null;
    if (!S.variable || !E.variables[S.variable]) S.variable = E.varDefecto;
    if (S.muestras.auto) generarMuestras(false);
  }

  /* ============================ Muestras ============================ */
  function generarMuestras(manual) {
    const v = varActual();
    /* la primera vez en cada escenario se usa la semilla 1 (reproducible); después, otra muestra en cada clic */
    if (manual) { if (S.muestras.hecha) S.muestras.semilla++; S.muestras.hecha = true; }
    const rng = UL.crearRng(S.sim.semilla * 7 + S.muestras.semilla, 900);
    const d = S.muestras.diseno, nC = Math.max(0, S.muestras.nCal | 0), nV = Math.max(0, S.muestras.nVal | 0);
    let cal = [], val = [];
    if (d === 'aleatoria') {
      const sel = UL.muestrear(rango(N), nC + nV, rng);
      cal = sel.slice(0, nC); val = sel.slice(nC);
    } else {
      let pos = [], neg = [];
      let lejos = null;
      if (d === 'conveniencia') {
        lejos = new Uint8Array(N); const bordeV = v.borde;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let b = 0;
          for (let dy = -2; dy <= 2 && !b; dy++) for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && bordeV[yy * W + xx]) { b = 1; break; }
          }
          lejos[y * W + x] = b ? 0 : 1;
        }
      }
      for (let i = 0; i < N; i++) {
        if (lejos) {
          if (!lejos[i]) continue;
          if (!v.ref[i] && (v.confusoras || E.confusoras)[E.clases[i]]) continue; /* los confusores no se muestrean «donde se ve claro» */
        }
        (v.ref[i] ? pos : neg).push(i);
      }
      const p = UL.muestrear(pos, Math.ceil((nC + nV) / 2), rng);
      const q = UL.muestrear(neg, nC + nV - p.length, rng);
      const pc = Math.round(p.length * nC / Math.max(1, nC + nV)), qc = nC - pc;
      cal = p.slice(0, pc).concat(q.slice(0, qc));
      val = p.slice(pc).concat(q.slice(qc));
    }
    S.muestras.cal = cal; S.muestras.val = val; S.muestras.auto = true;
  }

  /* ============================ Cálculo ============================ */
  function ejecutar(metodo, vals, ctx) {
    const v = ctx.v, dir = v.dir, sem = S.sim.semilla;
    const etiquetas = function () {
      const idx = ctx.calIdx, I = new Float64Array(idx.length), Y = new Uint8Array(idx.length);
      for (let k = 0; k < idx.length; k++) { I[k] = v.valores[idx[k]]; Y[k] = v.ref[idx[k]]; }
      return { I: I, Y: Y };
    };
    switch (metodo) {
      case 'otsu': return M.otsu(vals, S.p.otsu.bins);
      case 'percentil': return M.percentil(vals, S.p.percentil.p);
      case 'kmeans': return M.kmeans(vals, S.p.kmeans.k, S.p.kmeans.nstart, UL.crearRng(sem, 600));
      case 'gmm': return M.gmm(vals, S.p.gmm.k, UL.crearRng(sem, 700), { nInit: 3, maxIter: 250 });
      case 'multiotsu': return M.multiOtsu(vals, S.p.multiotsu.k, 64);
      case 'youden':
      case 'f1': {
        if (ctx.calIdx.length < 10) return { error: (metodo === 'youden' ? 'Youden' : 'F1') + ' necesita al menos 10 muestras de calibración. Genéralas en «Población y muestras» o dibuja puntos o regiones con el rol Calibración.' };
        const e = etiquetas();
        return metodo === 'youden' ? M.youden(e.I, e.Y, dir) : M.fbeta(e.I, e.Y, dir, S.p.f1.beta);
      }
      case 'manual': {
        if (S.p.manual.t === null) S.p.manual.t = litDefecto(v);
        const r = { cortes: [S.p.manual.t], manual: true, tabla: null };
        if (ctx.calIdx.length >= 10) { const e = etiquetas(); const tab = M.tablaUmbrales(e.I, e.Y, dir); if (tab.P && tab.N) r.tabla = tab; }
        return r;
      }
      case 'logistica': {
        const pl = S.p.logistica;
        if (pl.tipo === 'multinomial') return multinomialA();
        if (ctx.calIdx.length < 10) return { error: 'La regresión logística necesita al menos 10 muestras de calibración. Genéralas en «Población y muestras» o dibuja puntos o regiones con el rol Calibración.' };
        const e = etiquetas();
        const g = M.logistica(e.I, e.Y);
        if (g.error) return g;
        const b0u = pl.corregir ? M.corregirIntercepto(g.b0, v.prevalencia, g.prevMuestra) : g.b0;
        const t = M.umbralLogistica(b0u, g.b1, pl.p);
        if (!isFinite(t) || Math.abs(g.b1) < 1e-9) return { error: 'La pendiente es nula: el índice no cambia la probabilidad de la clase en estas muestras.' };
        return { cortes: [t], ajuste: g, b0u: b0u, prevPob: v.prevalencia, pNivel: pl.p, corregido: pl.corregir, dirModelo: g.b1 > 0 ? 1 : -1, muestras: e };
      }
      case 'calib': {
        const z0 = S.p.calib.z0 === null ? v.zRef : S.p.calib.z0;
        let idx;
        if (S.p.calib.fuente === 'cal') {
          if (ctx.calIdx.length < 10) return { error: 'La fuente de pares es «muestras de calibración», pero hay menos de 10. Genera muestras o cambia a pares estratificados.' };
          idx = ctx.calIdx;
        } else idx = M.paresEstratificados(v.Z, ctx.pobIdx, S.p.calib.n, UL.crearRng(sem, 800));
        const Ip = new Float64Array(idx.length), Zp = new Float64Array(idx.length);
        for (let k = 0; k < idx.length; k++) { Ip[k] = v.valores[idx[k]]; Zp[k] = v.Z[idx[k]]; }
        const r = M.calibracionLineal(Ip, Zp, z0, UL.crearRng(sem, 801), 200);
        if (!r.error) r.pares = { I: Ip, Z: Zp, idx: idx };
        return r;
      }
    }
    return { error: 'Método desconocido' };
  }

  /** Logística multinomial en el escenario A: resto (0), glaciar (1) y laguna (2). */
  function multinomialA() {
    if (E.id !== 'A') return { error: 'La logística multinomial está disponible en el escenario A (resto, glaciar y laguna).' };
    const pl = S.p.logistica;
    const preds = pl.predictores === 'ambos' ? ['NDSI', 'NDWI'] : ['NDSI'];
    const cls = function (i) { return E.clases[i] === 1 ? 1 : E.clases[i] === 2 ? 2 : 0; };
    const grupos = [[], [], []];
    for (let i = 0; i < N; i++) grupos[cls(i)].push(i);
    if (grupos[2].length < 20) return { error: 'Hay muy pocas lagunas para la logística multinomial: sube su número o su tamaño en Simulación.' };
    const rng = UL.crearRng(S.sim.semilla * 7 + S.muestras.semilla, 990);
    const nC = pl.nClase, ent = [], pru = [];
    let escasa = false;
    for (const g of grupos) {
      const sel = UL.muestrear(g, 2 * nC, rng), h = Math.min(nC, Math.floor(sel.length / 2));
      if (h < nC) escasa = true;
      for (const i of sel.slice(0, h)) ent.push(i);
      for (const i of sel.slice(h, 2 * h)) pru.push(i);
    }
    const fila = function (i) { return preds.map(function (k) { return E.variables[k].valores[i]; }); };
    const mod = M.multinomial(ent.map(fila), ent.map(cls), 3);
    const objetivo = S.variable === 'NDWI' ? 2 : 1;
    const mapa = new Uint8Array(N), pObj = new Float32Array(N), ref3 = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const pr = mod.predecir(fila(i));
      let a = 0; if (pr[1] > pr[a]) a = 1; if (pr[2] > pr[a]) a = 2;
      mapa[i] = a; pObj[i] = pr[objetivo]; ref3[i] = cls(i);
    }
    const Mc = V.matrizMulti(mapa, ref3, 3, 3);
    const Mp = V.matrizMulti(Uint8Array.from(pru.map(function (i) { return mapa[i]; })), Uint8Array.from(pru.map(cls)), 3, 3);
    /* con un solo predictor, la regla equivale a cortes del NDSI */
    const cortes = [], secuencia = [];
    if (preds.length === 1) {
      const o0 = E.variables.NDSI.ordenados, a0 = o0[0], b0 = o0[o0.length - 1];
      let prev = -1;
      for (let k = 0; k <= 800; k++) {
        const x = a0 + (b0 - a0) * k / 800, pr = mod.predecir([x]);
        let c = 0; if (pr[1] > pr[c]) c = 1; if (pr[2] > pr[c]) c = 2;
        if (c !== prev) { if (prev >= 0) cortes.push(x - (b0 - a0) / 1600); secuencia.push(c); prev = c; }
      }
    }
    return { multi: true, cortes: cortes, secuencia: secuencia, modelo: mod, predictores: preds, mapa: mapa, pObj: pObj, objetivo: objetivo, Mc: Mc, Mp: Mp, nPru: pru.length, escasa: escasa, ent: ent, cls: cls, fila: fila };
  }

  /** Corte objetivo automático: el superior (o el inferior si la clase está en valores bajos);
      en el escenario D, con cobertura ≥ 40 %, el segundo corte (escasa | moderada). */
  function corteAuto(nc, dir) {
    if (E && E.ordinal && nc >= 2) return 1;
    return dir > 0 ? nc - 1 : 0;
  }

  /* identidad de vectores y huella de índices (para las memorias del cálculo) */
  let memoVals = { clave: null, vals: null };
  const memoRes = new Map(), idsArr = new WeakMap();
  let sigId = 1;
  function idArr(a) { let k = idsArr.get(a); if (!k) { k = sigId++; idsArr.set(a, k); } return k; }
  function huella(idx) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < idx.length; i++) h = Math.imul(h ^ idx[i], 16777619) >>> 0;
    return idx.length + ':' + h;
  }
  function claveMetodo() {
    return versionEscena + '|' + S.variable + '|' + S.metodo + '|' + JSON.stringify(S.p[S.metodo]);
  }

  function calcular() {
    const v = varActual(), I = v.valores, dir = v.dir;
    const o = { v: v, I: I, dir: dir, error: null, metodo: S.metodo };
    const pob = UL.rasterizar(S.geoms, 'poblacion');
    o.pobIdx = pob.idx; o.pobMask = pob.mask;
    o.nPob = pob.idx ? pob.idx.length : N;
    let calc = pob.idx;
    if (S.submuestra) {
      const marco = pob.idx ? pob.idx : rango(N);
      calc = Int32Array.from(UL.muestrear(marco, 2000, UL.crearRng(S.sim.semilla, 501)));
    }
    o.calcIdx = calc;
    /* los valores de la población y el resultado de los métodos no supervisados se
       recuerdan: volver a un K o a un número de lagunas ya visto es inmediato */
    const claveVals = idArr(I) + '|' + (calc ? huella(calc) : 'todo');
    if (memoVals.clave !== claveVals) memoVals = { clave: claveVals, vals: calc ? juntar(I, calc) : I };
    o.vals = memoVals.vals; o.claveVals = claveVals;
    /* muestras: generadas + dibujadas */
    const calG = UL.rasterizar(S.geoms, 'calibracion').idx, valG = UL.rasterizar(S.geoms, 'validacion').idx;
    const cs = new Set(S.muestras.cal), vs = new Set(S.muestras.val);
    if (calG) for (const i of calG) cs.add(i);
    if (valG) for (const i of valG) vs.add(i);
    let sol = 0;
    for (const i of vs) if (cs.has(i)) sol++;
    o.calIdx = Int32Array.from(cs); o.valIdx = Int32Array.from(vs); o.solape = sol;
    o.calDibujadas = calG ? calG.length : 0; o.valDibujadas = valG ? valG.length : 0;
    let pp = 0;
    if (pob.idx) { for (const i of pob.idx) pp += v.ref[i]; o.prevPob = pp / pob.idx.length; } else o.prevPob = v.prevalencia;

    if (o.vals.length < 20) o.error = 'La población de cálculo tiene menos de 20 píxeles. Amplía la geometría de población o bórrala para usar toda la escena.';
    let res = null;
    if (!o.error) {
      const claveRes = NO_SUP[S.metodo] ? claveMetodo() + '|' + claveVals : null;
      if (claveRes && memoRes.has(claveRes)) res = memoRes.get(claveRes);
      else {
        try { res = ejecutar(S.metodo, o.vals, o); } catch (e) { res = { error: 'Error al calcular: ' + e.message }; }
        if (claveRes && res && !res.error) { memoRes.set(claveRes, res); if (memoRes.size > 40) memoRes.delete(memoRes.keys().next().value); }
      }
      if (res && res.error) o.error = res.error;
    }
    o.res = res;
    o.valInfo = { n: o.valIdx.length };
    if (o.error) return o;

    let pred, j = null;
    o.excl = null; o.nExcl = 0;
    if (res.multi) {
      o.multi = res; o.k = 3; o.j = null; o.tObj = NaN; o.dirCls = 1;
      o.cortes = S.variable === 'NDSI' ? res.cortes.slice() : [];
      o.clases = res.mapa;
      pred = new Uint8Array(N);
      for (let i = 0; i < N; i++) pred[i] = res.mapa[i] === res.objetivo ? 1 : 0;
    } else {
    const cortes = res.cortes.slice().sort(function (a, b) { return a - b; });
    o.cortes = cortes; o.k = cortes.length + 1;
    o.dirCls = res.dirModelo || dir;
    j = S.corteObj;
    if (j === null || j >= cortes.length) j = corteAuto(cortes.length, o.dirCls);
    o.j = j; o.tObj = cortes[j];
    o.clases = V.clasificar(I, cortes);
    pred = V.binario(o.clases, j, o.dirCls);
    }
    if (E.id === 'A' && S.compuesta && S.variable === 'NDSI' && !res.multi) {
      const nir = E.extra.NIR;
      o.excl = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (pred[i] && nir[i] <= 0.11) { pred[i] = 0; o.excl[i] = 1; o.nExcl++; }
    }
    o.pred = pred;
    let a = 0, banda = 0, aPob = 0;
    for (let i = 0; i < N; i++) { a += pred[i]; if (Math.abs(I[i] - o.tObj) < 0.05) banda++; }
    if (pob.mask) for (let i = 0; i < N; i++) if (pob.mask[i]) aPob += pred[i];
    o.area = a * UL.PIX_KM2; o.banda = banda * UL.PIX_KM2; o.areaPob = aPob * UL.PIX_KM2;
    o.mCenso = V.matriz(pred, v.ref); o.censo = V.metricas(o.mCenso);
    o.mMuestra = o.valIdx.length ? V.matriz(pred, v.ref, o.valIdx) : null;
    o.muestra = o.mMuestra ? V.metricas(o.mMuestra) : null;
    o.mCal = o.calIdx.length ? V.matriz(pred, v.ref, o.calIdx) : null;
    o.aparente = o.mCal ? V.metricas(o.mCal) : null;
    if (S.B) {
      let dif = 0;
      for (let i = 0; i < N; i++) if (pred[i] !== S.B.pred[i]) dif++;
      o.B = { area: S.B.area, difPx: dif, censo: V.metricas(V.matriz(S.B.pred, v.ref)), muestra: o.valIdx.length ? V.metricas(V.matriz(S.B.pred, v.ref, o.valIdx)) : null };
    }
    /* mismo método con la escena completa (efecto de la población) */
    o.tCompleta = null;
    if (pob.idx && NO_SUP[S.metodo]) {
      const key = claveMetodo();
      if (!cacheCompleta[key]) { try { cacheCompleta[key] = ejecutar(S.metodo, I, Object.assign({}, o, { pobIdx: null })); } catch (e) { cacheCompleta[key] = { error: e.message }; } }
      const rc = cacheCompleta[key];
      if (rc && !rc.error) {
        const cc = rc.cortes.slice().sort(function (x, y) { return x - y; });
        o.tCompleta = cc[Math.min(j, cc.length - 1)];
        o.areaCompleta = V.areaUmbral(v.ordenados, o.dirCls, o.tCompleta);
      }
    }
    /* información de las muestras de calibración */
    if (o.calIdx.length) {
      const bordeV = v.borde, bEsc = v.bordeFrac * N; /* el borde se calcula aquí solo si hay muestras */
      let b = 0, p = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (const i of o.calIdx) { b += bordeV[i]; p += v.ref[i]; const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      o.calInfo = { n: o.calIdx.length, borde: b / o.calIdx.length, bordeEsc: bEsc / N, prev: p / o.calIdx.length, extension: ((x1 - x0 + 1) * (y1 - y0 + 1)) / N };
    }
    if (o.valIdx.length) { let p = 0; for (const i of o.valIdx) p += v.ref[i]; o.valInfo.prev = p / o.valIdx.length; }
    o.confusion = confusiones(o);
    return o;
  }

  /** Mensajes propios de cada escenario (confusores conocidos de la simulación). */
  function confusiones(o) {
    const out = [], v = o.v, cl = E.clases, pred = o.pred;
    if (E.id === 'A' && S.variable === 'NDSI' && !o.multi) {
      let lag = 0, sobre = 0, fuera = 0;
      for (let i = 0; i < N; i++) if (cl[i] === 2) { lag++; const s = o.dirCls > 0 ? o.clases[i] > o.j : o.clases[i] <= o.j; if (s) sobre++; if (s && !pred[i]) fuera++; }
      if (lag >= 10 && !S.compuesta && sobre / lag > 0.5) out.push({ n: 'aviso', t: 'Las lagunas pasan como nieve', x: ent(sobre) + ' de ' + ent(lag) + ' píxeles de laguna superan el umbral: el agua también da NDSI alto. Activa la regla compuesta NIR > 0,11 (en Método) y mira la capa Aciertos y errores.' });
      if (S.compuesta && o.nExcl > 0) out.push({ n: 'info', t: 'Regla compuesta activa', x: 'NIR > 0,11 excluyó ' + ent(o.nExcl) + ' píxeles que superaban el umbral (' + ent(fuera) + ' de laguna). Una segunda variable resuelve lo que un corte del NDSI no puede.' });
    }
    let fp = 0, fn = 0;
    const fpC = {}, fnC = {};
    for (let i = 0; i < N; i++) {
      if (pred[i] && !v.ref[i]) { fp++; fpC[cl[i]] = (fpC[cl[i]] || 0) + 1; }
      else if (!pred[i] && v.ref[i]) { fn++; fnC[cl[i]] = (fnC[cl[i]] || 0) + 1; }
    }
    if (E.id === 'A' && S.variable === 'NDWI' && fp >= 30 && (fpC[1] || 0) / fp > 0.4) out.push({ n: 'aviso', t: 'La nieve pasa como laguna', x: pct((fpC[1] || 0) / fp, 0) + ' de los ' + ent(fp) + ' falsos positivos está en el glaciar: la nieve refleja verde y NIR casi por igual y su NDWI queda apenas sobre 0. Sube el corte (0,15 en U3A) o restringe la población.' });
    if (E.id === 'C' && fp >= 30 && (fpC[3] || 0) / fp > 0.5) out.push({ n: 'aviso', t: 'Falsos positivos en la puna seca', x: pct((fpC[3] || 0) / fp, 0) + ' de los ' + ent(fp) + ' falsos positivos está en la puna: el índice sube por el secado estacional, no por el fuego. Un umbral estadístico mide cambio espectral, no severidad.' });
    if (E.id === 'B' && S.variable === 'NDVI') {
      if (fn >= 50 && (fnC[5] || 0) / fn > 0.4) out.push({ n: 'aviso', t: 'Omisiones en parcelas en barbecho', x: pct((fnC[5] || 0) / fn, 0) + ' de las ' + ent(fn) + ' omisiones son barbechos: son superficie agrícola, pero su NDVI es de suelo. Ningún corte del NDVI las recupera sin perder precisión.' });
      if (fp >= 30 && (fpC[2] || 0) / fp > 0.3) out.push({ n: 'info', t: 'Comisión en la vegetación ribereña', x: pct((fpC[2] || 0) / fp, 0) + ' de los falsos positivos son vegetación de ribera: verde, pero no agrícola.' });
    }
    if (E.id === 'B' && S.variable === 'MNDWI' && fp >= 20 && (fpC[2] || 0) / fp > 0.4) out.push({ n: 'info', t: 'Orillas húmedas como agua', x: pct((fpC[2] || 0) / fp, 0) + ' de los falsos positivos son orillas y vegetación ribereña junto al cauce: suelo húmedo con MNDWI alto.' });
    return out;
  }

  /* ============================ Ciclo ============================ */
  let pendiente = false;
  function programar() {
    const ahora = performance.now();
    if (ahora - S.tUltima > 700) S.anterior = S.actualMet;
    S.tUltima = ahora;
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(function () { pendiente = false; ciclo(); });
  }
  function ciclo() {
    R = calcular();
    if (S.anterior && S.anterior.clave !== S.escena + S.variable) S.anterior = null;
    S.actualMet = R.error ? null : Object.assign({ clave: S.escena + S.variable }, R.censo);
    visor.muestras = { cal: S.muestras.cal, val: S.muestras.val, ref: varActual().ref };
    actualizarCapas();
    renderMapa();
    renderHist();
    renderResumen();
    renderMensajes();
    renderEstadoPob();
    /* Mientras se mueve una barra (ciclos seguidos), el panel de la derecha
       (gráficos de Estadística, Método o Validación) se redibuja al detenerse:
       el mapa, el histograma y el resumen siguen al instante. */
    const ahora = performance.now(), seguido = ahora - ultimoCiclo < 260;
    ultimoCiclo = ahora;
    clearTimeout(tabDiferida);
    if (seguido) tabDiferida = setTimeout(function () { tabDiferida = 0; renderTab(); }, 220);
    else renderTab();
  }
  let ultimoCiclo = 0, tabDiferida = 0;

  /* ============================ Mapa ============================ */
  function actualizarCapas() {
    const dispo = { prob: !R.error && (S.metodo === 'gmm' || S.metodo === 'logistica'), diferencia: !!S.B };
    document.querySelectorAll('#segCapas button').forEach(function (b) {
      const k = b.dataset.v;
      b.disabled = dispo[k] === false;
      b.classList.toggle('activo', k === S.capa);
      b.setAttribute('aria-checked', k === S.capa ? 'true' : 'false');
    });
    if (dispo[S.capa] === false) { S.capa = 'clasificacion'; actualizarCapas(); }
  }

  function renderMapa() {
    const v = varActual(), I = v.valores, out = new Uint8ClampedArray(N * 4);
    let capa = S.capa;
    if (R.error && (capa === 'clasificacion' || capa === 'errores' || capa === 'prob' || capa === 'diferencia')) capa = 'indice';
    const rel = S.relieve && E.relieve ? E.relieve : null;
    const put = function (i, c, s) { const q = i * 4; out[q] = c[0] * s; out[q + 1] = c[1] * s; out[q + 2] = c[2] * s; out[q + 3] = 255; };
    const somb = function (i, fuerza) { return rel ? (1 - fuerza) + fuerza * (0.35 + 0.9 * rel[i]) : 1; };
    if (capa === 'indice') {
      const lut = UL.RAMPAS[v.rampa], a = v.rangoVis[0], b = v.rangoVis[1];
      for (let i = 0; i < N; i++) put(i, UL.colorLut(lut, (I[i] - a) / (b - a)), Math.min(1.12, somb(i, 0.55)));
    } else if (capa === 'clasificacion') {
      const pal = (R.multi ? COL3 : UL.paletaClases(R.k)).map(UL.hexARgb), ex = UL.hexARgb('#3d556b');
      for (let i = 0; i < N; i++) put(i, R.excl && R.excl[i] ? ex : pal[R.clases[i]], somb(i, 0.25));
    } else if (capa === 'referencia') {
      const col = {};
      for (const L of E.leyenda) col[L.id] = UL.hexARgb(L.color);
      for (let i = 0; i < N; i++) put(i, col[E.clases[i]], somb(i, 0.3));
    } else if (capa === 'errores') {
      const c = { vp: UL.hexARgb(UL.COLOR_ERR.vp), vn: UL.hexARgb(UL.COLOR_ERR.vn), fp: UL.hexARgb(UL.COLOR_ERR.fp), fn: UL.hexARgb(UL.COLOR_ERR.fn) };
      for (let i = 0; i < N; i++) { const p = R.pred[i], r = v.ref[i]; put(i, p && r ? c.vp : p ? c.fp : r ? c.fn : c.vn, somb(i, 0.2)); }
    } else if (capa === 'fraccion') {
      const lut = UL.RAMPAS.fraccion;
      for (let i = 0; i < N; i++) put(i, UL.colorLut(lut, v.Z[i]), 1);
    } else if (capa === 'prob' && S.metodo === 'logistica') {
      const lut = UL.RAMPAS.prob;
      if (R.multi) for (let i = 0; i < N; i++) put(i, UL.colorLut(lut, R.multi.pObj[i]), 1);
      else { const b0 = R.res.b0u, b1 = R.res.ajuste.b1; for (let i = 0; i < N; i++) put(i, UL.colorLut(lut, M.sigmoide(b0 + b1 * I[i])), 1); }
    } else if (capa === 'prob') {
      const lut = UL.RAMPAS.prob, comps = R.res.comps, tab = new Float32Array(256);
      const a = v.rangoVis[0] - 0.2, b = v.rangoVis[1] + 0.2;
      for (let k = 0; k < 256; k++) {
        const post = M.posteriorGmm(comps, a + (b - a) * k / 255);
        let s = 0;
        for (let j = 0; j < post.length; j++) if (R.dirCls > 0 ? j > R.j : j <= R.j) s += post[j];
        tab[k] = s;
      }
      for (let i = 0; i < N; i++) put(i, UL.colorLut(lut, tab[Math.round(UL.clamp01((I[i] - a) / (b - a)) * 255)]), 1);
    } else if (capa === 'diferencia') {
      const c = [UL.hexARgb('#2a3a47'), UL.hexARgb('#58c7ec'), UL.hexARgb('#f2a65a'), UL.hexARgb('#e8f3f8')];
      for (let i = 0; i < N; i++) put(i, c[(R.pred[i] ? 1 : 0) + (S.B.pred[i] ? 2 : 0)], somb(i, 0.2));
    }
    /* contorno de la población sobre cualquier capa: fuera se atenúa levemente */
    if (R.pobMask && visor.mostrarGeom) for (let i = 0; i < N; i++) if (!R.pobMask[i]) { const q = i * 4; out[q] *= 0.72; out[q + 1] *= 0.72; out[q + 2] *= 0.72; }
    visor.ponerImagen(out);
    renderLeyenda(capa);
    renderLectura();
  }

  function chip(color, texto, extra) { return '<span class="lchip"><i style="background:' + color + '"></i>' + texto + (extra ? ' <em>' + extra + '</em>' : '') + '</span>'; }
  function barraLut(lut, a, b, etiqueta, fmtFn) {
    const st = [];
    for (let k = 0; k <= 10; k++) st.push(UL.cssLut(lut, k / 10) + ' ' + (k * 10) + '%');
    return '<span class="lgrad"><span class="lgrad-t">' + etiqueta + '</span><span class="lgrad-v">' + fmtFn(a) + '</span><i style="background:linear-gradient(90deg,' + st.join(',') + ')"></i><span class="lgrad-v">' + fmtFn(b) + '</span></span>';
  }
  function renderLeyenda(capa) {
    const v = varActual(), el = $('leyendaMapa');
    let h = '';
    if (capa === 'indice') h = barraLut(UL.RAMPAS[v.rampa], v.rangoVis[0], v.rangoVis[1], v.nombre + ' simulado', function (x) { return f(x, 1); });
    else if (capa === 'clasificacion' && R.multi) {
      for (let k = 0; k < 3; k++) h += chip(COL3[k], NOM3[k], k === R.multi.objetivo ? 'objetivo' : '');
      h += '<span class="lnota">Clase de mayor probabilidad según ' + R.multi.predictores.join(' + ') + '</span>';
    } else if (capa === 'clasificacion') {
      const pal = UL.paletaClases(R.k), c = R.cortes;
      if (R.k === 2) {
        const objAlto = R.dirCls > 0;
        h = chip(pal[0], (objAlto ? 'Resto' : v.objetivo) + ' · ' + v.nombre + ' < ' + f(c[0], 3)) + chip(pal[1], (objAlto ? v.objetivo : 'Resto') + ' · ≥ ' + f(c[0], 3));
      } else {
        for (let k = 0; k < R.k; k++) {
          const lo = k === 0 ? '' : f(c[k - 1], 2), hi = k === R.k - 1 ? '' : f(c[k], 2);
          const obj = R.dirCls > 0 ? k > R.j : k <= R.j;
          h += chip(pal[k], 'Clase ' + (k + 1) + ' · ' + (lo && hi ? lo + ' a ' + hi : lo ? '≥ ' + lo : '< ' + hi), obj ? 'objetivo' : '');
        }
      }
      if (R.excl) h += chip('#3d556b', 'Excluido por NIR ≤ 0,11');
    } else if (capa === 'referencia') {
      for (const L of E.leyenda) h += chip(L.color, L.nombre);
      h += '<span class="lnota">Objetivo binario: ' + v.zNombre + ' ≥ ' + f(v.zRef, 2) + '</span>';
    } else if (capa === 'errores') {
      const m = R.mCenso;
      h = chip(UL.COLOR_ERR.vp, 'VP', ent(m.vp)) + chip(UL.COLOR_ERR.fp, 'FP · comisión', ent(m.fp)) + chip(UL.COLOR_ERR.fn, 'FN · omisión', ent(m.fn)) + chip(UL.COLOR_ERR.vn, 'VN', ent(m.vn));
    } else if (capa === 'fraccion') h = barraLut(UL.RAMPAS.fraccion, 0, 1, 'Z = ' + v.zNombre + ' (referencia continua)', function (x) { return f(x, 0); });
    else if (capa === 'prob') h = barraLut(UL.RAMPAS.prob, 0, 1, S.metodo === 'gmm' ? 'P(objetivo | ' + v.nombre + ') según la GMM' : R.multi ? 'P(' + NOM3[R.multi.objetivo].toLowerCase() + ' | ' + R.multi.predictores.join(', ') + ') · logística multinomial' : 'P(' + v.objetivo.toLowerCase() + ' | ' + v.nombre + ') · regresión logística' + (R.res.corregido ? ' (intercepto corregido)' : ''), function (x) { return f(x, 0); });
    else if (capa === 'diferencia') {
      let n = [0, 0, 0, 0];
      for (let i = 0; i < N; i++) n[(R.pred[i] ? 1 : 0) + (S.B.pred[i] ? 2 : 0)]++;
      h = chip('#e8f3f8', 'Objetivo en A y B', ent(n[3])) + chip('#58c7ec', 'Solo A', ent(n[1])) + chip('#f2a65a', 'Solo B', ent(n[2])) + chip('#2a3a47', 'Ninguno', ent(n[0]));
    }
    el.innerHTML = h;
  }

  let ultimaConsulta = -1;
  function renderLectura(i) {
    if (i === undefined) i = ultimaConsulta;
    ultimaConsulta = i;
    const el = $('lecturaPixel');
    const idx = i >= 0 ? i : S.fijado;
    if (idx < 0 || !E) { el.innerHTML = '<span class="tenue">Pasa el cursor sobre el mapa para consultar un píxel. Clic con Mover para fijar la consulta.</span>'; return; }
    const x = idx % W, y = (idx / W) | 0, v = varActual();
    const partes = ['<b>x ' + x + ' · y ' + y + '</b>', '<span class="tenue">E ' + ent(x * UL.PIX_M) + ' m · N ' + ent((H - y) * UL.PIX_M) + ' m</span>'];
    for (const k in E.variables) partes.push(E.variables[k].nombre + ' <b>' + f(E.variables[k].valores[idx], 3) + '</b>');
    if (E.extra.NIR) partes.push('NIR <b>' + f(E.extra.NIR[idx], 3) + '</b>');
    if (E.extra.bandas) partes.push('B · R · N <b>' + f(E.extra.bandas.B[idx], 3) + ' · ' + f(E.extra.bandas.R[idx], 3) + ' · ' + f(E.extra.bandas.N[idx], 3) + '</b>');
    if (E.altitud) partes.push(ent(E.altitud[idx]) + ' m s. n. m.');
    const L = E.leyenda.find(function (l) { return l.id === E.clases[idx]; });
    partes.push('Ref.: <b>' + (L ? L.nombre : '—') + '</b> (Z = ' + f(v.Z[idx], 2) + ')');
    if (!R.error) {
      const p = R.pred[idx], r = v.ref[idx];
      partes.push('Mapa: <b>' + (R.multi ? NOM3[R.clases[idx]] + ' · ' : R.k > 2 ? 'clase ' + (R.clases[idx] + 1) + ' · ' : '') + (p ? 'objetivo' : 'resto') + '</b> <span class="tag ' + (p && r ? 'vp' : p ? 'fp' : r ? 'fn' : 'vn') + '">' + (p && r ? 'VP' : p ? 'FP' : r ? 'FN' : 'VN') + '</span>');
      if (S.metodo === 'logistica') partes.push('P = ' + f(R.multi ? R.multi.pObj[idx] : M.sigmoide(R.res.b0u + R.res.ajuste.b1 * v.valores[idx]), 2));
      if (S.metodo === 'gmm') { const post = M.posteriorGmm(R.res.comps, v.valores[idx]); partes.push('P = ' + post.map(function (q) { return f(q, 2); }).join(' / ')); }
    }
    el.innerHTML = (i < 0 ? '<span class="tag fijo">fijado</span> ' : '') + partes.join(' <span class="sepv">·</span> ');
  }

  function avisoMapa(t) {
    const el = $('avisoMapa');
    el.textContent = t; el.hidden = false;
    clearTimeout(avisoMapa._t);
    avisoMapa._t = setTimeout(function () { el.hidden = true; }, 4200);
  }

  /* ============================ Histograma ============================ */
  function rangoHist(v) {
    const s = v.ordenados, lo = UL.cuantilOrdenado(s, 0.001), hi = UL.cuantilOrdenado(s, 0.999), pad = (hi - lo) * 0.05;
    return [Math.max(-1, lo - pad), Math.min(1.5, hi + pad)];
  }
  const BINS = [10, 15, 20, 30, 40, 50, 60, 80, 100, 120, 150, 200, 256, 320, 400, 512];
  function renderHist() {
    const tipo = S.hist.tipo;
    document.querySelectorAll('#segGraf button').forEach(function (b) { b.classList.toggle('activo', b.dataset.v === tipo); b.setAttribute('aria-checked', b.dataset.v === tipo ? 'true' : 'false'); });
    $('ctrlBins').hidden = tipo !== 'hist'; $('lblLog').hidden = tipo !== 'hist'; $('lblFondo').hidden = tipo === 'violin'; $('lblPorClase').hidden = tipo === 'violin';
    $('inBins').value = S.hist.bins;
    if (tipo !== 'hist') return renderDistribucion(tipo);
    const v = varActual(), r = rangoHist(v), nb = S.hist.bins;
    const hist = UL.histograma(R.vals, nb, r[0], r[1]);
    const kE = versionEscena + S.variable + '|' + nb;
    if (!cacheHistEsc[kE]) cacheHistEsc[kE] = UL.histograma(v.valores, nb, r[0], r[1]);
    const o = { hist: hist, log: S.hist.log, xLab: v.nombre, literatura: v.literatura, h: 196 };
    if (S.hist.fondo && (R.pobIdx || S.submuestra)) { o.fondo = cacheHistEsc[kE]; o.fondoEsc = R.vals.length / N; }
    if (S.hist.porClase) {
      const pos = new Float64Array(nb), neg = new Float64Array(nb), w = hist.ancho;
      const idx = R.calcIdx;
      const n = idx ? idx.length : N;
      for (let k = 0; k < n; k++) {
        const i = idx ? idx[k] : k, b = Math.floor((v.valores[i] - r[0]) / w);
        if (b < 0 || b >= nb) continue;
        if (v.ref[i]) pos[b]++; else neg[b]++;
      }
      o.porClase = { pos: pos, neg: neg };
    }
    if (!R.error) {
      o.cortes = R.cortes; o.corteObjetivo = R.j;
      if (R.multi) o.coloresIntervalo = R.cortes.length ? R.multi.secuencia.map(function (c) { return COL3[c]; }) : ['#8fa3b0'];
      if (S.metodo === 'gmm') o.comps = R.res.comps;
      if (S.metodo === 'kmeans') o.centros = R.res.centros;
    }
    if (S.B && S.B.variable === S.variable) o.cortesB = S.B.cortes;
    if (S.metodo === 'manual' && !R.error) o.arrastrar = function (t, fin) { S.p.manual.t = Math.round(t * 1000) / 1000; sincronizarManual(); programar(); };
    G.histograma($('grafHist'), o);
    const pobTxt = R.pobIdx ? 'geometrías de población · ' + ent(R.nPob) + ' px' : 'escena completa · ' + ent(N) + ' px';
    $('tituloHist').innerHTML = 'Distribución de ' + esc(v.nombre) + ' en la población de cálculo <span class="tenue">(' + pobTxt + (S.submuestra ? ' · muestra de ' + ent(R.vals.length) : '') + ')</span>';
    const pal = UL.paletaClases(R.error ? 2 : R.k);
    let ley = R.multi ? (R.cortes.length ? '<span class="hchip"><i style="background:' + COL3[0] + '"></i><i style="background:' + COL3[2] + '"></i><i style="background:' + COL3[1] + '"></i>barras coloreadas por la clase más probable</span>' : '<span class="hchip">Con ' + R.multi.predictores.join(' + ') + ' la frontera está en el plano de dos índices: no hay un corte único sobre ' + esc(v.nombre) + '</span>')
      : '<span class="hchip"><i style="background:' + pal[0] + '"></i><i style="background:' + pal[pal.length - 1] + '"></i>barras coloreadas por clase del umbral</span>';
    if (o.fondo) ley += '<span class="hchip"><i class="linea fondo"></i>escena completa (reescalada)</span>';
    if (o.porClase) ley += '<span class="hchip"><i class="linea refpos"></i>' + esc(v.objetivo) + ' (ref.)</span><span class="hchip"><i class="linea refneg"></i>resto (ref.)</span>';
    if (o.comps) ley += '<span class="hchip"><i class="linea suma"></i>mezcla ajustada y componentes</span>';
    if (o.centros) ley += '<span class="hchip"><i class="tri"></i>centros de k-means</span>';
    if (o.cortesB) ley += '<span class="hchip"><i class="linea b"></i>umbral de B</span>';
    ley += v.literatura.length ? '<span class="hchip"><i class="linea lit"></i>literatura: ' + v.literatura.map(function (L) { return f(L.t, 2) + ' (' + esc(L.ref) + ')'; }).join(' · ') + '</span>' : '<span class="hchip">sin corte de referencia para ' + esc(v.nombre) + ' en el material del curso</span>';
    if (S.metodo === 'manual') ley += '<span class="hchip fuerte">Arrastra sobre el histograma para mover el umbral</span>';
    $('leyHist').innerHTML = ley;
  }

  /** Densidad kernel o violín + caja con los mismos cortes y el mismo eje que el histograma. */
  function renderDistribucion(tipo) {
    const v = varActual(), r = rangoHist(v);
    const o = { xr: r, xLab: v.nombre, literatura: v.literatura, h: 196 };
    if (!R.error) {
      o.cortes = R.cortes; o.corteObjetivo = R.j;
      if (R.multi) o.coloresIntervalo = R.cortes.length ? R.multi.secuencia.map(function (c) { return COL3[c]; }) : ['#8fa3b0'];
    }
    if (S.B && S.B.variable === S.variable) o.cortesB = S.B.cortes;
    if (S.metodo === 'manual' && !R.error) o.arrastrar = function (t) { S.p.manual.t = Math.round(t * 1000) / 1000; sincronizarManual(); programar(); };
    const idx = R.calcIdx, n = idx ? idx.length : N;
    let ley = '';
    if (tipo === 'dens') {
      const d = UL.kde(R.vals, r[0], r[1], 256);
      o.x = d.x; o.y = d.y; o.extra = [];
      if (S.hist.fondo && (R.pobIdx || S.submuestra)) { const de = UL.kde(v.valores, r[0], r[1], 256); o.extra.push({ x: de.x, y: de.y, cls: 'g-fondo' }); }
      if (S.hist.porClase) {
        const pos = [], neg = [];
        for (let k = 0; k < n; k++) { const i = idx ? idx[k] : k; (v.ref[i] ? pos : neg).push(v.valores[i]); }
        for (const g of [{ a: pos, cls: 'g-refpos' }, { a: neg, cls: 'g-refneg' }]) {
          if (g.a.length < 5) continue;
          const dk = UL.kde(g.a, r[0], r[1], 256, d.h), w = g.a.length / n;
          o.extra.push({ x: dk.x, y: dk.y.map(function (q) { return q * w; }), cls: g.cls });
        }
      }
      G.densidad($('grafHist'), o);
      ley = '<span class="hchip">Densidad kernel gaussiana (ancho de banda de Silverman h = ' + f(d.h, 3) + '); área coloreada por clase del umbral</span>';
      if (o.extra.some(function (e) { return e.cls === 'g-fondo'; })) ley += '<span class="hchip"><i class="linea fondo"></i>escena completa</span>';
      if (S.hist.porClase) ley += '<span class="hchip"><i class="linea refpos"></i>' + esc(v.objetivo) + ' (ref.)</span><span class="hchip"><i class="linea refneg"></i>resto (ref.)</span><span class="hchip">cada clase ponderada por su proporción</span>';
    } else {
      const grupos = {};
      for (let k = 0; k < n; k++) { const i = idx ? idx[k] : k; (grupos[E.clases[i]] = grupos[E.clases[i]] || []).push(v.valores[i]); }
      const cuant = function (a) { const s2 = UL.ordenar(a), q = function (p) { return UL.cuantilOrdenado(s2, p); }; return { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) }; };
      const todas = Array.from(R.vals);
      o.filas = [{ nombre: 'Población de cálculo', color: '#8fa3b0', n: todas.length, kde: UL.kde(todas, r[0], r[1], 200), q: cuant(todas) }];
      for (const L of E.leyenda) { const a = grupos[L.id]; if (a && a.length >= 10) o.filas.push({ nombre: L.nombre, color: L.color, n: a.length, kde: UL.kde(a, r[0], r[1], 200), q: cuant(a) }); }
      G.violines($('grafHist'), o);
      ley = '<span class="hchip">Violín: densidad de ' + esc(v.nombre) + ' en cada clase de referencia (escalada a su propio máximo) · caja: p25–p75 · línea: mediana · bigotes: p5–p95</span>';
    }
    if (o.cortesB) ley += '<span class="hchip"><i class="linea b"></i>umbral de B</span>';
    ley += v.literatura.length ? '<span class="hchip"><i class="linea lit"></i>literatura: ' + v.literatura.map(function (L) { return f(L.t, 2) + ' (' + esc(L.ref) + ')'; }).join(' · ') + '</span>' : '';
    if (S.metodo === 'manual') ley += '<span class="hchip fuerte">Arrastra sobre el gráfico para mover el umbral</span>';
    $('leyHist').innerHTML = ley;
    const pobTxt = R.pobIdx ? 'geometrías de población · ' + ent(R.nPob) + ' px' : 'escena completa · ' + ent(N) + ' px';
    $('tituloHist').innerHTML = (tipo === 'dens' ? 'Densidad de ' : 'Violín y caja de ') + esc(v.nombre) + ' en la población de cálculo <span class="tenue">(' + pobTxt + ')</span>';
  }

  /* ============================ Panel analítico ============================ */
  function nombreMetodo(k) { for (const e in METODOS) for (const m of METODOS[e]) if (m[0] === k) return m[1]; return k; }

  function renderResumen() {
    const v = varActual(), el = $('resumenUmbral');
    if (R.error) { el.innerHTML = '<div class="ru-met">' + esc(UL.FICHAS[S.metodo].nombre) + '</div><div class="ru-error">' + esc(R.error) + '</div>'; return; }
    if (R.multi) {
      const mu = R.multi;
      el.innerHTML = '<div class="ru-met">Regresión logística multinomial <span class="tenue">· II · Supervisado</span></div>' +
        '<div class="ru-t"><span class="obj">' + mu.predictores.join(' + ') + '</span></div>' +
        '<div class="ru-regla">clase = argmax P(k | ' + mu.predictores.join(', ') + ') · exactitud 3 clases ' + f(mu.Mc.exactitud, 3) + ' → ' + esc(v.objetivo) + '</div>' +
        '<div class="ru-kpis"><div><span>Área clasificada</span><b>' + km(R.area) + '</b></div><div><span>Referencia</span><b>' + km(v.areaRef) + '</b></div><div><span>F1 · censo</span><b>' + f(R.censo.f1, 3) + '</b></div><div><span>IoU · censo</span><b>' + f(R.censo.iou, 3) + '</b></div></div>';
      return;
    }
    const reg = R.dirCls > 0 ? '≥' : '<';
    const tv = R.cortes.map(function (t, j) { return '<span class="' + (j === R.j ? 'obj' : '') + '">' + (R.cortes.length > 1 ? 't' + G.subindice(j + 1) + ' ' : 't ') + f(t, 3) + '</span>'; }).join('');
    const m = R.censo;
    el.innerHTML =
      '<div class="ru-met">' + esc(UL.FICHAS[S.metodo].nombre) + ' <span class="tenue">· ' + esc(UL.FICHAS[S.metodo].enfoque) + '</span></div>' +
      '<div class="ru-t">' + tv + '</div>' +
      '<div class="ru-regla">' + esc(v.nombre) + ' ' + reg + ' ' + f(R.tObj, 3) + (S.compuesta && E.id === 'A' && S.variable === 'NDSI' ? ' y NIR > 0,11' : '') + (S.metodo === 'logistica' ? ' ⇔ P ≥ ' + f(R.res.pNivel, 2) : '') + ' → ' + esc(v.objetivo) + '</div>' +
      '<div class="ru-kpis">' +
      '<div><span>Área clasificada</span><b>' + km(R.area) + '</b></div>' +
      '<div><span>Referencia</span><b>' + km(v.areaRef) + '</b></div>' +
      '<div><span>F1 · censo</span><b>' + f(m.f1, 3) + '</b></div>' +
      '<div><span>IoU · censo</span><b>' + f(m.iou, 3) + '</b></div>' +
      '</div>';
  }

  function renderMensajes() {
    const ctx = Object.assign({}, R, { v: varActual(), prevEsc: varActual().prevalencia, anterior: S.anterior, fuente: S.p.calib.fuente, B: R.B });
    const ms = UL.generarMensajes(ctx);
    const ico = { alerta: '!', aviso: '▲', info: 'i', ok: '✓' };
    $('mensajes').innerHTML = ms.map(function (q) {
      return '<div class="msg ' + q.n + '"><span class="msg-ico" aria-hidden="true">' + ico[q.n] + '</span><div><b>' + esc(q.t) + '</b><p>' + esc(q.x) + '</p></div></div>';
    }).join('');
  }

  function borrarPoblacion() {
    for (let k = S.geoms.length - 1; k >= 0; k--) if (S.geoms[k].rol === 'poblacion') S.geoms.splice(k, 1);
    visor.resaltado = null; visor.dibujar(); programar();
  }
  function renderEstadoPob() {
    const nPol = S.geoms.filter(function (g) { return g.rol === 'poblacion'; }).length;
    let h = nPol ? '<b>' + nPol + (nPol === 1 ? ' geometría' : ' geometrías') + '</b> · ' + ent(R.nPob) + ' px (' + pct(R.nPob / N) + ' de la escena)' : '<b>Escena completa</b> · ' + ent(N) + ' px';
    if (nPol) {
      const nomT = { rect: 'Rectángulo', poligono: 'Polígono', lazo: 'Selección libre' };
      let k = 0;
      h += '<ul class="lista-pob">' + S.geoms.filter(function (g) { return g.rol === 'poblacion'; }).map(function (g) {
        k++;
        const n = UL.rasterizar([g], 'poblacion').idx;
        return '<li data-id="' + g.id + '"><i class="dot pob"></i><span>' + (nomT[g.tipo] || 'Geometría') + ' ' + k + ' · ' + ent(n ? n.length : 0) + ' px</span><button type="button" class="lp-x" data-id="' + g.id + '" aria-label="Borrar ' + (nomT[g.tipo] || 'geometría') + ' ' + k + '" title="Borrar esta geometría">✕</button></li>';
      }).join('') + '</ul><button class="btn-txt peligro ancho" id="btnBorrarPob" type="button">Borrar toda la población</button><p class="nota tenue">También puedes borrar con la ✕ de cada geometría en el mapa o con Supr con el cursor encima.</p>';
    } else h += '<br><span class="tenue">Dibuja con el rol Población para restringir el cálculo.</span>';
    if (S.metodo === 'logistica' && S.p.logistica.tipo === 'multinomial') h += '<br><span class="tenue">La logística multinomial usa su propia muestra equilibrada por clase, no la población.</span>';
    else if (!NO_SUP[S.metodo] && S.metodo !== 'calib') h += '<br><span class="tenue">' + esc(nombreMetodo(S.metodo)) + ' usa las muestras de calibración, no la población.</span>';
    $('estadoPob').innerHTML = h;
    const b = $('btnBorrarPob');
    if (b) b.onclick = borrarPoblacion;
    $('btnBorrarPobMapa').hidden = !nPol;
    document.querySelectorAll('.lista-pob li').forEach(function (li) {
      li.onmouseenter = function () { visor.resaltado = li.dataset.id; visor.dibujar(); };
      li.onmouseleave = function () { visor.resaltado = null; visor.dibujar(); };
    });
    document.querySelectorAll('.lista-pob .lp-x').forEach(function (bt) {
      bt.onclick = function () { const g = S.geoms.find(function (q) { return q.id === bt.dataset.id; }); visor.resaltado = null; if (g) visor.borrarGeom(g); };
    });
    const v = varActual();
    const cuenta = function (idx) { let p = 0; for (const i of idx) p += v.ref[i]; return ent(idx.length) + ' (' + ent(p) + ' objetivo · ' + ent(idx.length - p) + ' resto)'; };
    let t = (!R.calIdx.length && !R.valIdx.length) ? '<span class="tenue">Sin muestras: pulsa «Generar muestras» o dibuja con los roles Calibración y Validación.</span>' : 'Calibración: ' + cuenta(R.calIdx) + '<br>Validación: ' + cuenta(R.valIdx);
    if (R.calDibujadas || R.valDibujadas) t += '<br><span class="tenue">Incluye ' + ent(R.calDibujadas) + ' px de calibración y ' + ent(R.valDibujadas) + ' px de validación dibujados.</span>';
    $('estadoMuestras').innerHTML = t;
  }

  function renderTab() {
    document.querySelectorAll('.tabs button').forEach(function (b) { const a = b.dataset.tab === S.tab; b.classList.toggle('activo', a); b.setAttribute('aria-selected', a ? 'true' : 'false'); });
    ['est', 'met', 'val'].forEach(function (t) { $('tab-' + t).hidden = t !== S.tab; });
    if (S.tab === 'est') renderEst();
    else if (S.tab === 'met') renderMet();
    else renderVal();
  }

  /* ---------- Estadística ---------- */
  function filaRes(n, a, b) { return '<tr><th>' + n + '</th><td>' + a + '</td>' + (b !== undefined ? '<td>' + b + '</td>' : '') + '</tr>'; }
  function renderEst() {
    const v = varActual(), el = $('tab-est');
    const rp = UL.resumen(R.vals);
    const dos = !!(R.pobIdx || S.submuestra);
    const re = dos ? UL.resumen(v.valores) : null;
    const col = function (fn) { return [fn(rp), dos ? fn(re) : undefined]; };
    let h = '<h3 class="sec">Estadística descriptiva</h3><div class="tabla-cont"><table class="tabla num"><thead><tr><th></th><th>Población</th>' + (dos ? '<th>Escena</th>' : '') + '</tr></thead><tbody>';
    const filas = [
      ['n (píxeles)', function (r) { return ent(r.n); }],
      ['Media', function (r) { return f(r.media, 3); }], ['Mediana', function (r) { return f(r.mediana, 3); }],
      ['Desviación estándar', function (r) { return f(r.de, 3); }], ['RIQ', function (r) { return f(r.riq, 3); }],
      ['MAD escalada', function (r) { return f(r.mad, 3); }], ['Asimetría', function (r) { return f(r.asimetria, 2); }],
      ['p5 · p95', function (r) { return f(r.p5, 3) + ' · ' + f(r.p95, 3); }], ['p25 · p75', function (r) { return f(r.p25, 3) + ' · ' + f(r.p75, 3); }],
      ['Mín · máx', function (r) { return f(r.min, 2) + ' · ' + f(r.max, 2); }]
    ];
    for (const q of filas) { const c = col(q[1]); h += filaRes(q[0], c[0], c[1]); }
    h += filaRes('Prevalencia de la referencia', pct(R.prevPob), dos ? pct(v.prevalencia) : undefined);
    if (!R.error) {
      h += filaRes('Clasificado como objetivo', R.pobIdx ? km(R.areaPob) + ' · ' + pct(R.areaPob / (R.nPob * UL.PIX_KM2)) : km(R.area) + ' · ' + pct(R.area / (N * UL.PIX_KM2)), dos ? km(R.area) + ' · ' + pct(R.area / (N * UL.PIX_KM2)) : undefined);
    }
    h += filaRes('Superficie (celda de 30 m = 0,0009 km²)', km(R.nPob * UL.PIX_KM2), dos ? km(N * UL.PIX_KM2) : undefined);
    h += '</tbody></table></div>';
    const avisoAsim = Math.abs(rp.asimetria) > 1 || Math.abs(rp.media - rp.mediana) > 0.25 * rp.de;
    h += '<p class="nota">' + (avisoAsim ? 'Asimetría ' + f(rp.asimetria, 2) + ': media y mediana se separan. Describe con mediana, RIQ y percentiles.' : 'Distribución poco asimétrica: media y mediana casi coinciden.') + '</p>';
    h += '<h3 class="sec">Distribución acumulada (ECDF)</h3><div id="gEcdf" class="graf-cont"></div>';
    h += '<h3 class="sec">' + esc(v.nombre) + ' por clase de referencia</h3><p class="nota tenue">Caja: p25–p75; bigotes: p5–p95; línea: mediana. Línea vertical: umbral objetivo.</p><div id="gCajas" class="graf-cont"></div>';
    el.innerHTML = h;
    /* ECDF */
    const s = rp.ordenados, xs = [], ys = [], r = rangoHist(v);
    const paso = Math.max(1, Math.floor(s.length / 300));
    for (let i = 0; i < s.length; i += paso) { xs.push(s[i]); ys.push((i + 1) / s.length); }
    xs.push(s[s.length - 1]); ys.push(1);
    const vl = [];
    let marc = [];
    if (!R.error && isFinite(R.tObj)) {
      const t = R.tObj, Ft = UL.contarMenorIgual(s, t) / s.length;
      vl.push({ x: t, label: 'F(t) = ' + f(Ft, 3) });
      marc.push({ x: t, y: Ft });
    }
    G.lineas($('gEcdf'), { x: r, y: [0, 1], h: 170, xLab: v.nombre, yLab: 'proporción ≤ x', series: [{ x: xs, y: ys, cls: 'g-linea principal' }], vlines: vl, marcas: marc });
    const cajas = UL.cajasPorClase(v.valores, E.clases, R.calcIdx, E.leyenda);
    G.cajas($('gCajas'), { cajas: cajas, x: r, cortes: R.error || !isFinite(R.tObj) ? [] : [R.tObj], xLab: v.nombre });
  }

  /* ---------- Método ---------- */
  function fichaHtml(k) {
    const F = UL.FICHAS[k];
    let h = '<div class="ficha"><div class="ficha-cab"><span class="ficha-enf">' + esc(F.enfoque) + '</span><h3>' + esc(F.nombre) + '</h3></div>';
    h += '<p>' + esc(F.linea) + '</p><div class="formula-tex">' + (F.tex ? F.tex.map(function (t) { return UL.tex(t, true); }).join('') : F.formula) + '</div></div>';
    return h;
  }
  function fichaDetalle(k) {
    const F = UL.FICHAS[k];
    let h = '<h3 class="sec">Parámetros, lectura y supuestos</h3><div class="ficha det">';
    h += '<dl class="params">' + F.params.map(function (p) { return '<dt>' + p[0] + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>';
    h += '<p class="lectura-f"><b>Cómo leerlo.</b> ' + esc(F.lectura) + '</p>';
    h += '<p class="lectura-f"><b>Supuestos y limitaciones</b></p><ul class="supuestos">' + F.supuestos.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    return h;
  }
  function kv(pares) { return '<dl class="kv">' + pares.map(function (p) { return '<div><dt>' + p[0] + '</dt><dd>' + p[1] + '</dd></div>'; }).join('') + '</dl>'; }

  function renderMet() {
    renderMetCuerpo();
    const el = $('tab-met'), d = document.createElement('div');
    d.innerHTML = fichaDetalle(S.metodo);
    el.appendChild(d);
  }
  function renderMetCuerpo() {
    const v = varActual(), el = $('tab-met'), res = R.res, r = rangoHist(v);
    let h = fichaHtml(S.metodo);
    if (R.error) { el.innerHTML = h + '<p class="nota alerta">' + esc(R.error) + '</p>'; return; }
    h += '<h3 class="sec">Fundamento en esta escena</h3>';
    const m = S.metodo;
    if (m === 'otsu') {
      h += '<div id="gM1" class="graf-cont"></div>' + kv([['t*', f(res.cortes[0], 3)], ['η', f(res.eta, 3)], ['ω₀ · ω₁', f(res.w0, 3) + ' · ' + f(res.w1, 3)], ['μ₀ · μ₁', f(res.mu0, 3) + ' · ' + f(res.mu1, 3)], ['Clases del histograma', res.hist.conteos.length], ['Píxeles', ent(res.hist.n)]]);
      el.innerHTML = h;
      G.lineas($('gM1'), { x: [res.hist.min, res.hist.max], y: [0, res.sB * 1.12], h: 180, xLab: 'corte t probado', yLab: 'σ²B(t)', yDec: 3, series: [{ x: res.curva.t, y: res.curva.s, cls: 'g-linea funcion' }], vlines: [{ x: res.cortes[0], label: 't* = ' + f(res.cortes[0], 3) }], marcas: [{ x: res.cortes[0], y: res.sB }] });
    } else if (m === 'percentil') {
      const s = res.ordenados, xs = [], ys = [], paso = Math.max(1, Math.floor(s.length / 300));
      for (let i = 0; i < s.length; i += paso) { xs.push(s[i]); ys.push((i + 1) / s.length); }
      h += '<div id="gM1" class="graf-cont"></div>' + kv([['p', f(res.p, 3)], ['t = Qp', f(res.cortes[0], 3)], ['Fracción fijada del lado objetivo', pct(v.dir > 0 ? 1 - res.p : res.p)], ['Área en la escena', km(R.area)]]);
      el.innerHTML = h;
      G.lineas($('gM1'), { x: r, y: [0, 1], h: 180, xLab: v.nombre, yLab: 'ECDF', series: [{ x: xs, y: ys, cls: 'g-linea principal' }], hlines: [{ y: res.p, label: 'p = ' + f(res.p, 3), cls: 'g-ref fuerte' }], vlines: [{ x: res.cortes[0], label: 't = ' + f(res.cortes[0], 3) }], marcas: [{ x: res.cortes[0], y: res.p }] });
    } else if (m === 'kmeans') {
      const tr = res.trayectoria, xs = tr.map(function (_, i) { return i; });
      h += '<p class="nota">Trayectoria de los centros en las iteraciones de Lloyd (arranque con menor suma de cuadrados).</p><div id="gM1" class="graf-cont"></div>';
      h += kv([['Centros', res.centros.map(function (c) { return f(c, 3); }).join(' · ')], ['Cortes', res.cortes.map(function (c) { return f(c, 3); }).join(' · ')], ['Iteraciones', res.iter], ['SSE por arranque', res.ssePorArranque.map(function (s) { return f(s, 2); }).join(' · ')]]);
      el.innerHTML = h;
      const pal = UL.paletaClases(S.p.kmeans.k), series = [];
      let mn = Infinity, mx = -Infinity;
      for (let j = 0; j < S.p.kmeans.k; j++) { const ys = tr.map(function (c) { return c[j]; }); for (const y of ys) { mn = Math.min(mn, y); mx = Math.max(mx, y); } series.push({ x: xs, y: ys, cls: 'g-linea grueso', color: pal[j] }); }
      const pad = (mx - mn) * 0.1 || 0.05;
      G.lineas($('gM1'), { x: [0, Math.max(1, xs.length - 1)], y: [mn - pad, mx + pad], h: 170, xLab: 'iteración', yLab: 'centro', xDec: 0, series: series });
    } else if (m === 'gmm') {
      h += '<p class="nota">Probabilidad a posteriori de cada componente según el valor del índice. Los cortes están donde dos componentes ponderadas se igualan (P = 0,5).</p><div id="gM1" class="graf-cont"></div>';
      h += '<div class="tabla-cont"><table class="tabla num"><thead><tr><th>Componente</th><th>π</th><th>μ</th><th>σ</th></tr></thead><tbody>' + res.comps.map(function (c, j) { return '<tr><th><i class="cuad" style="background:' + UL.paletaClases(res.comps.length)[j] + '"></i>' + (j + 1) + '</th><td>' + f(c.pi, 3) + '</td><td>' + f(c.mu, 3) + '</td><td>' + f(c.sd, 3) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      h += kv([['Cortes', res.cortes.map(function (c) { return f(c, 3); }).join(' · ')], ['log-verosimilitud', f(res.LL, 1)], ['BIC (mayor es mejor)', f(res.BIC, 1)], ['Píxeles en el ajuste', ent(res.n)]]);
      h += '<div class="fila-btn"><button class="btn" id="btnBic" type="button">Comparar BIC para K = 1 a 5</button></div><div id="bicRes"></div>';
      el.innerHTML = h;
      const xs = [], pal = UL.paletaClases(res.comps.length);
      for (let k = 0; k <= 200; k++) xs.push(r[0] + (r[1] - r[0]) * k / 200);
      const posts = xs.map(function (x) { return M.posteriorGmm(res.comps, x); });
      G.lineas($('gM1'), { x: r, y: [0, 1], h: 170, xLab: v.nombre, yLab: 'P(k | I)', series: res.comps.map(function (_, j) { return { x: xs, y: posts.map(function (p) { return p[j]; }), cls: 'g-linea grueso', color: pal[j] }; }), hlines: [{ y: 0.5, cls: 'g-ref' }], vlines: res.cortes.map(function (t, j) { return { x: t, label: 't' + G.subindice(j + 1) + ' = ' + f(t, 3), dy: j * 13 }; }) });
      $('btnBic').onclick = function () {
        const vals = R.vals, out = [];
        for (let K = 1; K <= 5; K++) { const g = M.gmm(vals, K, UL.crearRng(S.sim.semilla, 700), { nInit: 3, maxIter: 250 }); out.push([K, g.BIC]); }
        S.bic = out;
        mostrarBic();
      };
      mostrarBic();
    } else if (m === 'multiotsu') {
      h += (res.mapa ? '<p class="nota">σ²B para cada par de cortes (t₁, t₂); el punto marca el máximo. Más claro = más separación entre las tres clases.</p><div id="gM1" class="graf-cont cuadrado"></div>' : '<p class="nota">Con k > 3 la búsqueda exhaustiva recorre todas las combinaciones de cortes; el gráfico de pares solo se dibuja con k = 3.</p>');
      const cl = res.cortes, h2 = res.hist;
      h += kv([['Cortes', cl.map(function (c) { return f(c, 3); }).join(' · ')], ['η (separabilidad)', f(res.eta, 3)], ['Clases del histograma', h2.conteos.length]]);
      el.innerHTML = h;
      if (res.mapa) G.mapaCalor($('gM1'), { mapa: res.mapa, nb: h2.conteos.length, min: h2.min, max: h2.max, best: cl });
    } else if (m === 'logistica' && res.multi) {
      const mu = res, mod = mu.modelo, preds = mu.predictores;
      h += '<p class="nota">Un logit por clase frente a la de referencia (resto); cada píxel va a la clase más probable:</p><div class="formula-tex">' + UL.tex(UL.TEX_MULTINOMIAL, true) + '</div>';
      h += '<div id="gM1" class="graf-cont' + (preds.length === 2 ? ' cuadrado' : '') + '"></div>';
      h += '<div class="tabla-cont"><table class="tabla num"><thead><tr><th>Clase</th><th>β₀</th>' + preds.map(function (k) { return '<th>β · ' + k + '</th>'; }).join('') + '</tr></thead><tbody>' +
        mod.coef.map(function (c, k) { return '<tr><th><i class="cuad" style="background:' + COL3[k] + '"></i>' + NOM3[k] + (k === 0 ? ' (referencia)' : '') + '</th>' + c.map(function (b) { return '<td>' + f(b, 2) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      h += kv([['Predictores', preds.join(' + ')], ['Entrenamiento', ent(mu.ent.length) + ' px (' + ent(S.p.logistica.nClase) + ' por clase)'], ['Exactitud · prueba', f(mu.Mp.exactitud, 3)], ['Exactitud · censo', f(mu.Mc.exactitud, 3)], ['Lagunas bien clasificadas (censo)', pct(mu.Mc.M[2][2] / Math.max(1, mu.Mc.M[2][0] + mu.Mc.M[2][1] + mu.Mc.M[2][2]), 0)], ['Iteraciones de Newton', mod.iter + (mod.convergio ? '' : ' (sin converger)')]]);
      if (mu.escasa) h += '<p class="nota">Alguna clase tiene menos píxeles que los pedidos: se usó la mitad de los disponibles para entrenar y la otra mitad para probar.</p>';
      h += '<p class="nota">Las probabilidades reflejan la muestra equilibrada (igual número por clase), no la proporción de cada cobertura en el paisaje.</p>';
      el.innerHTML = h;
      const pts = mu.ent.filter(function (_, i) { return i % 2 === 0; }).map(function (i) { const x = mu.fila(i); return { x: x[0], y: preds.length === 2 ? x[1] : 0, c: mu.cls(i) }; });
      if (preds.length === 2) {
        const vx = E.variables.NDSI, vy = E.variables.NDWI;
        G.planoDecision($('gM1'), { xr: rangoHist(vx), yr: rangoHist(vy), clase: function (x, y) { const pr = mod.predecir([x, y]); let a = 0; if (pr[1] > pr[a]) a = 1; if (pr[2] > pr[a]) a = 2; return a; }, colores: COL3, puntos: pts, xLab: 'NDSI', yLab: 'NDWI' });
      } else {
        const rr = rangoHist(E.variables.NDSI), xs = [];
        for (let k = 0; k <= 200; k++) xs.push(rr[0] + (rr[1] - rr[0]) * k / 200);
        const pr = xs.map(function (x) { return mod.predecir([x]); });
        G.lineas($('gM1'), { x: rr, y: [0, 1], h: 180, xLab: 'NDSI', yLab: 'P(k | NDSI)', series: [0, 1, 2].map(function (k) { return { x: xs, y: pr.map(function (q) { return q[k]; }), cls: 'g-linea grueso', color: COL3[k] }; }), vlines: mu.cortes.map(function (t, j) { return { x: t, label: f(t, 2), dy: j * 13 }; }), leyenda: NOM3.map(function (n2, k) { return { cls: 'g-linea grueso', color: COL3[k], t: n2 }; }) });
      }
    } else if (m === 'logistica') {
      const g = res.ajuste, t = res.cortes[0], b0 = res.b0u, b1 = g.b1;
      const val = R.valIdx.length >= 20;
      h += '<div id="gM1" class="graf-cont"></div><h4>Curva de fiabilidad</h4><p class="nota tenue">Probabilidad predicha frente a la frecuencia observada por tramos, con ' + (val ? 'las muestras de validación' : 'las muestras de calibración (no hay validación suficiente)') + '. Sobre la diagonal, una probabilidad de 0,7 acierta el 70 % de las veces.</p><div id="gM2" class="graf-cont"></div>';
      h += kv([['β₀ · β₁', f(g.b0, 3) + ' · ' + f(g.b1, 2)], ['EE(β₀) · EE(β₁)', f(g.se0, 3) + ' · ' + f(g.se1, 2)], ['Razón de odds por +0,1 de índice', f(Math.exp(b1 * 0.1), 2)], ['Prevalencia: muestra · escena', pct(g.prevMuestra) + ' · ' + pct(res.prevPob)], ['β₀ usado', f(b0, 3) + (res.corregido ? ' (corregido)' : ' (de la muestra)')], ['Nivel p → t(p)', f(res.pNivel, 2) + ' → ' + f(t, 3)], ['Desvianza · nula', f(g.desvianza, 1) + ' · ' + f(g.desvianzaNula, 1)], ['R² de McFadden', f(g.r2McF, 3)], ['Iteraciones (IRLS)', g.iter + (g.convergio ? '' : ' (sin converger)')]]);
      el.innerHTML = h;
      const xs = [];
      for (let k = 0; k <= 200; k++) xs.push(r[0] + (r[1] - r[0]) * k / 200);
      const series = [{ x: xs, y: xs.map(function (x) { return M.sigmoide(b0 + b1 * x); }), cls: 'g-linea principal' }];
      const ley = [{ cls: 'g-linea principal', t: 'P(Y = 1 | I) usada' }];
      if (res.corregido) { series.push({ x: xs, y: xs.map(function (x) { return M.sigmoide(g.b0 + b1 * x); }), cls: 'g-linea media' }); ley.push({ cls: 'g-linea media', t: 'sin corregir (prevalencia de la muestra)' }); }
      const mi = res.muestras, rj = UL.crearRng(3, 17), pts = [];
      const paso = Math.max(1, Math.floor(mi.I.length / 500));
      for (let i = 0; i < mi.I.length; i += paso) pts.push({ x: mi.I[i], y: (mi.Y[i] ? 1.04 : -0.04) + (rj() - 0.5) * 0.05, cls: mi.Y[i] ? 'g-pto' : 'g-pto neg', r: 2 });
      G.lineas($('gM1'), { x: r, y: [-0.1, 1.1], h: 200, xLab: v.nombre, yLab: 'P(' + v.objetivo.toLowerCase() + ')', yTicks: [0, 0.25, 0.5, 0.75, 1], puntos: pts, series: series, hlines: [{ y: res.pNivel, label: 'p = ' + f(res.pNivel, 2), cls: 'g-ref fuerte' }], vlines: [{ x: t, label: 't = ' + f(t, 3), dy: 42 }], leyenda: ley });
      let pp = [], yy = [];
      const idx = val ? R.valIdx : R.calIdx;
      for (const i of idx) { pp.push(M.sigmoide(b0 + b1 * v.valores[i])); yy.push(v.ref[i]); }
      const fi = M.curvaFiabilidad(pp, yy, 10);
      G.lineas($('gM2'), { x: [0, 1], y: [0, 1], h: 180, xLab: 'probabilidad predicha', yLab: 'frecuencia observada', series: [{ x: [0, 1], y: [0, 1], cls: 'g-ref' }, { x: fi.pred, y: fi.obs, cls: 'g-linea funcion' }], marcas: fi.pred.map(function (q, k) { return { x: q, y: fi.obs[k], r: 3.5 }; }) });
      const prevV = yy.reduce(function (a2, b2) { return a2 + b2; }, 0) / Math.max(1, yy.length);
      $('gM2').insertAdjacentHTML('beforeend', '<p class="nota">Índice de Brier = media de (p̂ − y)² = ' + f(fi.brier, 3) + ' con ' + ent(pp.length) + ' muestras. Brier del ajuste (calibración): ' + f(g.brier, 3) + '.' +
        (prevV / v.prevalencia > 2 || prevV / v.prevalencia < 0.5 ? ' Estas muestras tienen ' + pct(prevV) + ' de clase objetivo y la escena ' + pct(v.prevalencia) + ': su frecuencia observada no es la del paisaje. Compara la curva con y sin corrección del intercepto.' : '') + '</p>');
    } else if (m === 'youden' || m === 'f1' || (m === 'manual' && res.tabla)) {
      const tab = m === 'manual' ? res.tabla : res.tabla;
      const t = R.tObj;
      let jt = 1;
      for (let q = 1; q < tab.t.length; q++) if ((v.dir > 0 ? tab.t[q] >= t : tab.t[q] <= t)) jt = q;
      const xsJ = [], ysJ = [], ysF = [], ysP = [], ysR = [];
      const b2 = m === 'f1' ? S.p.f1.beta * S.p.f1.beta : 1;
      for (let q = 1; q < tab.t.length; q++) {
        xsJ.push(tab.t[q]); ysJ.push(tab.tpr[q] - tab.fpr[q]);
        const P = tab.prec[q], Rr = tab.tpr[q];
        ysP.push(P); ysR.push(Rr); ysF.push(P + Rr > 0 && isFinite(P) ? (1 + b2) * P * Rr / (b2 * P + Rr) : 0);
      }
      h += '<div class="dos graficos"><div><h4>Curva ROC (muestras de calibración)</h4><div id="gM1" class="graf-cont"></div></div><div><h4>' + (m === 'f1' ? 'Precisión, sensibilidad y Fβ' : 'J(t) y F1(t)') + '</h4><div id="gM2" class="graf-cont"></div></div></div>';
      h += kv([['Muestras', ent(tab.n) + ' (' + ent(tab.P) + ' objetivo · ' + ent(tab.N) + ' resto)'], ['Prevalencia de la muestra', pct(tab.P / tab.n)], ['AUC', f(tab.auc, 3)], ['t', f(t, 3)], ['Sensibilidad · 1 − especificidad en t', f(tab.tpr[jt], 3) + ' · ' + f(tab.fpr[jt], 3)], ['J(t)', f(tab.tpr[jt] - tab.fpr[jt], 3)]]);
      if (m === 'youden' && res.empates > 1) h += '<p class="nota">' + res.empates + ' cortes empatan en el máximo de J: se usa el del centro de la meseta.</p>';
      el.innerHTML = h;
      G.lineas($('gM1'), { x: [0, 1], y: [0, 1], h: 190, xLab: 'FPR = 1 − especificidad', yLab: 'TPR', series: [{ x: [0, 1], y: [0, 1], cls: 'g-ref' }, { x: tab.fpr, y: tab.tpr, cls: 'g-linea principal' }], marcas: [{ x: tab.fpr[jt], y: tab.tpr[jt], label: 'AUC ' + f(tab.auc, 3) }] });
      const sx = rangoHist(v);
      if (m === 'f1') G.lineas($('gM2'), { x: sx, y: [0, 1], h: 190, xLab: v.nombre, series: [{ x: xsJ, y: ysP, cls: 'g-linea prec' }, { x: xsJ, y: ysR, cls: 'g-linea sens' }, { x: xsJ, y: ysF, cls: 'g-linea funcion' }], vlines: [{ x: t, label: 't = ' + f(t, 3) }], leyenda: [{ cls: 'g-linea prec', t: 'precisión' }, { cls: 'g-linea sens', t: 'sensibilidad' }, { cls: 'g-linea funcion', t: 'F' + (S.p.f1.beta === 1 ? '1' : 'β') }] });
      else G.lineas($('gM2'), { x: sx, y: [0, 1], h: 190, xLab: v.nombre, series: [{ x: xsJ, y: ysJ, cls: 'g-linea funcion' }, { x: xsJ, y: ysF, cls: 'g-linea sens' }], vlines: [{ x: t, label: 't = ' + f(t, 3) }], leyenda: [{ cls: 'g-linea funcion', t: 'J(t)' }, { cls: 'g-linea sens', t: 'F1(t)' }] });
    } else if (m === 'manual') {
      h += '<p class="nota">Sin muestras de calibración solo se muestra la curva área–umbral. Genera muestras para ver J(t) y F1(t) alrededor del corte manual.</p><div id="gM1" class="graf-cont"></div>';
      el.innerHTML = h;
      const ca = V.curvaArea(v.ordenados, v.dir, r[0], r[1], 160);
      G.lineas($('gM1'), { x: r, y: [0, Math.max.apply(null, ca.area) * 1.05], h: 180, xLab: v.nombre, yLab: 'km²', series: [{ x: ca.t, y: ca.area, cls: 'g-linea principal' }], hlines: [{ y: v.areaRef, label: 'referencia ' + km(v.areaRef), cls: 'g-ref fuerte' }], vlines: [{ x: R.tObj, label: 't = ' + f(R.tObj, 3) }] });
    } else if (m === 'calib') {
      const a = res.ajuste, P = res.pares;
      h += '<div id="gM1" class="graf-cont"></div><div id="gM2" class="graf-cont"></div>';
      h += kv([['Pares (I, Z)', ent(res.n) + (S.p.calib.fuente === 'cal' ? ' · muestras de calibración' : ' · estratificados por tramos de Z')], ['β₀ · β₁', f(a.b0, 3) + ' · ' + f(a.b1, 3) + ' (EE ' + f(a.seB1, 3) + ')'], ['R²', f(a.r2, 3)], ['z₀', f(res.z0, 2)], ['t = (z₀ − β₀)/β₁', f(res.cortes[0], 3)], ['IC 95 % bootstrap (B = ' + res.B + ')', f(res.ic[0], 3) + ' a ' + f(res.ic[1], 3)], ['Rango 2–98 % de I', f(res.rango[0], 2) + ' a ' + f(res.rango[1], 2)]]);
      h += '<h3 class="sec">Tres orígenes del umbral</h3><div id="tresOrigenes"></div><div id="gM3" class="graf-cont"></div>';
      el.innerHTML = h;
      const mp = M.mediaPorTramo(v.valores, v.Z, 40, r[0], r[1]);
      const pts = [];
      const paso = Math.max(1, Math.floor(P.I.length / 600));
      for (let i = 0; i < P.I.length; i += paso) pts.push({ x: P.I[i], y: P.Z[i], cls: 'g-pto', r: 2 });
      G.lineas($('gM1'), { x: r, y: [-0.15, 1.15], h: 200, xLab: v.nombre, yLab: 'Z (' + v.zNombre + ')', puntos: pts, series: [{ x: r, y: [a.b0 + a.b1 * r[0], a.b0 + a.b1 * r[1]], cls: 'g-linea funcion' }, { x: mp.x, y: mp.y, cls: 'g-linea media' }], hlines: [{ y: res.z0, label: 'z₀ = ' + f(res.z0, 2), cls: 'g-ref fuerte' }], vlines: [{ x: res.cortes[0], label: 't = ' + f(res.cortes[0], 3) }], bandas: isFinite(res.ic[0]) ? [{ x0: res.ic[0], x1: res.ic[1] }] : null, leyenda: [{ cls: 'g-linea funcion', t: 'recta MCO' }, { cls: 'g-linea media', t: 'media de Z por tramo (escena)' }] });
      const rp = [];
      for (let i = 0; i < P.I.length; i += paso) rp.push({ x: P.I[i], y: res.residuos[i], cls: 'g-pto', r: 2 });
      let mxr = 0.2;
      for (const q of rp) mxr = Math.max(mxr, Math.abs(q.y));
      G.lineas($('gM2'), { x: r, y: [-mxr * 1.1, mxr * 1.1], h: 140, xLab: v.nombre, yLab: 'residuo (Z − Z ajustada)', puntos: rp, hlines: [{ y: 0, cls: 'g-ref fuerte' }] });
      tresOrigenes();
    }
  }

  function mostrarBic() {
    const el = $('bicRes');
    if (!el || !S.bic) return;
    const mx = Math.max.apply(null, S.bic.map(function (q) { return q[1]; }));
    el.innerHTML = '<div class="tabla-cont"><table class="tabla num"><thead><tr><th>K</th>' + S.bic.map(function (q) { return '<th>' + q[0] + '</th>'; }).join('') + '</tr></thead><tbody><tr><th>BIC</th>' + S.bic.map(function (q) { return '<td' + (q[1] === mx ? ' class="mejor"' : '') + '>' + f(q[1], 0) + '</td>'; }).join('') + '</tr></tbody></table></div><p class="nota">El BIC suele pedir más componentes de las que hay coberturas: elegir K es una decisión temática.</p>';
  }

  /** Compara la frontera estadística, la supervisada y la física (enfoque III). */
  function tresOrigenes() {
    const v = varActual(), r = rangoHist(v);
    const filas = [];
    const otsu = M.otsu(R.vals, 256);
    filas.push({ k: 'E', n: 'Estadística (Otsu en la población)', t: otsu.cortes[0], dir: v.dir });
    if (R.calIdx.length >= 10) {
      const I = [], Y = [];
      for (const i of R.calIdx) { I.push(v.valores[i]); Y.push(v.ref[i]); }
      const y = M.youden(I, Y, v.dir);
      if (!y.error) filas.push({ k: 'S', n: 'Supervisada (Youden, muestras de calibración)', t: y.cortes[0], dir: v.dir });
    }
    filas.push({ k: 'F', n: 'Física (z₀ = ' + f(R.res.z0, 2) + ', calibración lineal)', t: R.res.cortes[0], dir: R.dirCls });
    let h = '<div class="tabla-cont"><table class="tabla num"><thead><tr><th>Origen</th><th>t</th><th>Área</th><th>F1 censo</th></tr></thead><tbody>';
    for (const q of filas) {
      const pr = V.binario(V.clasificar(v.valores, [q.t]), 0, q.dir);
      const mt = V.metricas(V.matriz(pr, v.ref));
      q.area = V.areaUmbral(v.ordenados, q.dir, q.t);
      h += '<tr><th><span class="letra">' + q.k + '</span>' + esc(q.n) + '</th><td>' + f(q.t, 3) + '</td><td>' + km(q.area) + '</td><td>' + f(mt.f1, 3) + '</td></tr>';
    }
    h += '<tr class="ref"><th>Referencia sintética</th><td>—</td><td>' + km(v.areaRef) + '</td><td>1</td></tr></tbody></table></div>';
    if (R.calIdx.length < 10) h += '<p class="nota">Falta la fila S (supervisada): pulsa «Generar muestras» o dibuja muestras de calibración.</p>';
    h += '<p class="nota">La frontera estadística separa grupos de valores; la supervisada coincide con etiquetas; la física corresponde a una magnitud medida (' + esc(v.zNombre) + ' = z₀). Las tres responden preguntas distintas.</p>';
    $('tresOrigenes').innerHTML = h;
    const ca = V.curvaArea(v.ordenados, v.dir, r[0], r[1], 160);
    const amax = Math.max.apply(null, ca.area) * 1.05;
    G.lineas($('gM3'), { x: r, y: [0, amax], h: 170, xLab: v.nombre, yLab: 'área objetivo (km²)', series: [{ x: ca.t, y: ca.area, cls: 'g-linea principal' }], hlines: [{ y: v.areaRef, label: 'referencia', cls: 'g-ref fuerte' }], marcas: filas.map(function (q) { return { x: q.t, y: V.areaUmbral(v.ordenados, v.dir, q.t), label: q.k, cls: 'g-marca' }; }) });
  }

  /* ---------- Validación ---------- */
  function matrizHtml(m, titulo) {
    if (!m) return '<div class="matriz-g vacia"><h4>' + titulo + '</h4><p class="nota">Sin muestras de validación: genera o dibuja muestras.</p></div>';
    const P = m.vp + m.fn, Nn = m.fp + m.vn, PP = m.vp + m.fp, PN = m.fn + m.vn, n = m.n;
    const r = function (a, b) { return b > 0 ? f(a / b, 3) : '—'; };
    const celda = function (cls, v2, et) { return '<td class="' + cls + '"><b>' + ent(v2) + '</b><small>' + et + ' · ' + (n ? pct(v2 / n, 1) : '—') + '</small></td>'; };
    return '<div class="matriz-g"><h4>' + titulo + '</h4><div class="tabla-cont"><table>' +
      '<thead><tr><th class="esq" rowspan="2">Mapa ↓<br>Referencia →</th><th colspan="2" class="eje">Referencia</th><th class="tot" rowspan="2">Total del mapa<br><span>precisión (usuario)</span></th></tr>' +
      '<tr><th>Objetivo</th><th>Resto</th></tr></thead><tbody>' +
      '<tr><th>Objetivo</th>' + celda('vp', m.vp, 'VP') + celda('fp', m.fp, 'FP · comisión') + '<td class="tot"><b>' + ent(PP) + '</b><small>' + r(m.vp, PP) + '</small></td></tr>' +
      '<tr><th>Resto</th>' + celda('fn', m.fn, 'FN · omisión') + celda('vn', m.vn, 'VN') + '<td class="tot"><b>' + ent(PN) + '</b><small>VPN ' + r(m.vn, PN) + '</small></td></tr>' +
      '<tr class="tot"><th>Total de la referencia<br><span>sensibilidad · especificidad</span></th><td><b>' + ent(P) + '</b><small>' + r(m.vp, P) + '</small></td><td><b>' + ent(Nn) + '</b><small>' + r(m.vn, Nn) + '</small></td><td><b>' + ent(n) + '</b><small>exactitud ' + r(m.vp + m.vn, n) + '</small></td></tr>' +
      '</tbody></table></div></div>';
  }
  function tablaMulti(mm, titulo) {
    let h = '<div><h4>' + titulo + '</h4><div class="tabla-cont"><table class="tabla num multi"><thead><tr><th>Ref. \\ mapa</th><th>Resto</th><th>Glaciar</th><th>Laguna</th><th>Acierto</th></tr></thead><tbody>';
    mm.M.forEach(function (fila, a) {
      const t = fila.reduce(function (x, y) { return x + y; }, 0);
      h += '<tr><th>' + ['Resto', 'Glaciar', 'Laguna'][a] + '</th>' + fila.map(function (c, b) { return '<td' + (a === b ? ' class="diag"' : '') + '>' + ent(c) + '</td>'; }).join('') + '<td>' + (t ? pct(fila[a] / t, 0) : '—') + '</td></tr>';
    });
    return h + '</tbody></table></div></div>';
  }
  function renderVal() {
    const v = varActual(), el = $('tab-val');
    if (R.error) { el.innerHTML = '<p class="nota alerta">' + esc(R.error) + '</p>'; return; }
    const mu = R.muestra, ce = R.censo, B = R.B;
    let h = '<h3 class="sec">Matriz de confusión</h3>' + matrizHtml(R.mMuestra, 'Muestras de validación · n = ' + ent(R.valIdx.length)) + matrizHtml(R.mCenso, 'Referencia completa (censo sintético) · n = ' + ent(N));
    const cel = function (r, k, d) { return r && r.valida !== undefined && isFinite(r[k]) ? f(r[k], d === undefined ? 3 : d) : '—'; };
    const filas = [['Exactitud global', 'exactitud'], ['Precisión (usuario)', 'precision'], ['Sensibilidad (productor)', 'sensibilidad'], ['Especificidad', 'especificidad'], ['F1', 'f1'], ['IoU', 'iou'], ['Exactitud balanceada', 'balanceada']];
    h += '<h3 class="sec">Métricas</h3><div class="tabla-cont"><table class="tabla num"><thead><tr><th></th><th>Muestra</th><th>Censo</th>' + (B ? '<th>B · muestra</th><th>B · censo</th>' : '') + '</tr></thead><tbody>';
    for (const q of filas) h += '<tr><th>' + q[0] + '</th><td>' + cel(mu, q[1]) + '</td><td>' + cel(ce, q[1]) + '</td>' + (B ? '<td>' + cel(B.muestra, q[1]) + '</td><td>' + cel(B.censo, q[1]) + '</td>' : '') + '</tr>';
    h += '<tr><th>Prevalencia</th><td>' + (mu ? pct(mu.prevalencia) : '—') + '</td><td>' + pct(ce.prevalencia) + '</td>' + (B ? '<td>' + (B.muestra ? pct(B.muestra.prevalencia) : '—') + '</td><td>' + pct(B.censo.prevalencia) + '</td>' : '') + '</tr>';
    h += '</tbody></table></div>';
    if (mu && mu.avisos.length) h += '<p class="nota alerta">Muestra de validación: ' + esc(mu.avisos.join('; ')) + '. Las métricas que dependen de esos casos no se informan.</p>';
    if (!mu) h += '<p class="nota">Sin muestras de validación: solo se muestra el censo. Genera o dibuja muestras de validación.</p>';
    if (R.aparente && R.aparente.valida && (S.metodo === 'youden' || S.metodo === 'f1')) h += '<p class="nota">Con las mismas muestras de calibración el F1 sería ' + f(R.aparente.f1, 3) + ' (desempeño aparente, optimista por construcción).</p>';
    const dA = R.area - v.areaRef;
    h += '<h3 class="sec">Superficie</h3>' + kv([['Clasificada como objetivo', km(R.area)], ['Referencia sintética', km(v.areaRef)], ['Diferencia', (dA >= 0 ? '+' : '') + f(dA, 2) + ' km² (' + (v.areaRef > 0 ? (dA >= 0 ? '+' : '') + f(100 * dA / v.areaRef, 1) + ' %' : '—') + ')'], ['Comisión (FP) · omisión (FN)', km(R.mCenso.fp * UL.PIX_KM2) + ' · ' + km(R.mCenso.fn * UL.PIX_KM2)], ['Banda |I − t| < 0,05', km(R.banda)]].concat(B ? [['Área de B', km(B.area)]] : []));
    /* multiclase */
    if (R.multi) {
      h += '<h3 class="sec">Matriz por clase · resto, glaciar y laguna</h3><p class="nota tenue">Filas: referencia; columnas: mapa. La muestra de prueba no se usó para ajustar el modelo.</p>';
      h += '<div class="dos graficos">' + tablaMulti(R.multi.Mp, 'Muestra de prueba · n = ' + ent(R.multi.nPru)) + tablaMulti(R.multi.Mc, 'Referencia completa (censo)') + '</div>';
      h += '<p class="nota">Exactitud en 3 clases: prueba ' + f(R.multi.Mp.exactitud, 3) + ' · censo ' + f(R.multi.Mc.exactitud, 3) + '. Las métricas binarias de arriba evalúan solo «' + esc(v.objetivo) + '» frente al resto.</p>';
    } else if (R.k > 2) {
      const ord = E.ordinal;
      const conteo = new Array(R.k).fill(0);
      for (let i = 0; i < N; i++) conteo[R.clases[i]]++;
      h += '<h3 class="sec">Superficie por clase del umbral</h3><div class="tabla-cont"><table class="tabla num"><thead><tr><th>Clase</th><th>Intervalo</th><th>km²</th></tr></thead><tbody>';
      const pal = UL.paletaClases(R.k);
      for (let k = 0; k < R.k; k++) h += '<tr><th><i class="cuad" style="background:' + pal[k] + '"></i>' + (k + 1) + '</th><td>' + (k === 0 ? '< ' + f(R.cortes[0], 2) : k === R.k - 1 ? '≥ ' + f(R.cortes[k - 1], 2) : f(R.cortes[k - 1], 2) + ' a ' + f(R.cortes[k], 2)) + '</td><td>' + f(conteo[k] * UL.PIX_KM2, 2) + '</td></tr>';
      h += '</tbody></table></div>';
      if (ord && R.k === ord.k) {
        const mm = V.matrizMulti(R.clases, ord.clases, R.k, ord.k);
        h += '<h3 class="sec">Matriz por clase (referencia ordinal de cobertura)</h3><div class="tabla-cont"><table class="tabla num multi"><thead><tr><th>Ref. \\ mapa</th>' + ord.nombres.map(function (_, k) { return '<th>' + (k + 1) + '</th>'; }).join('') + '<th>Acierto</th></tr></thead><tbody>';
        mm.M.forEach(function (fila, a) {
          const t = fila.reduce(function (x, y) { return x + y; }, 0);
          h += '<tr><th>' + ord.nombres[a] + '</th>' + fila.map(function (c, b) { return '<td' + (a === b ? ' class="diag"' : '') + '>' + ent(c) + '</td>'; }).join('') + '<td>' + (t ? pct(fila[a] / t, 0) : '—') + '</td></tr>';
        });
        h += '</tbody></table></div><p class="nota">Exactitud por clase (censo): ' + f(mm.exactitud, 3) + '. Las clases del umbral se comparan con las de cobertura en orden: la clase 1 con «Suelo», la 4 con «Densa».</p>';
      } else if (ord) h += '<p class="nota tenue">Con k = ' + ord.k + ' clases se muestra además la matriz frente a las clases ordinales de cobertura.</p>';
    }
    h += '<h3 class="sec">Curva ROC del índice</h3><p class="nota tenue">' + (R.valIdx.length >= 20 ? 'Con las muestras de validación.' : 'Con la referencia completa (no hay suficientes muestras de validación).') + ' El punto es el umbral actual.</p><div id="gV1" class="graf-cont"></div>';
    h += '<h3 class="sec">Área según el umbral</h3><div id="gV2" class="graf-cont"></div>';
    el.innerHTML = h;
    /* ROC */
    let I, Y;
    if (R.valIdx.length >= 20) { I = []; Y = []; for (const i of R.valIdx) { I.push(v.valores[i]); Y.push(v.ref[i]); } }
    else {
      const rng = UL.crearRng(S.sim.semilla, 950), sel = UL.muestrear(rango(N), 6000, rng);
      I = sel.map(function (i) { return v.valores[i]; }); Y = sel.map(function (i) { return v.ref[i]; });
    }
    const tab = M.tablaUmbrales(I, Y, v.dir);
    if (tab.P && tab.N) {
      const m = R.mMuestra && R.valIdx.length >= 20 ? R.mMuestra : R.mCenso;
      const tpr = m.vp / Math.max(1, m.vp + m.fn), fpr = m.fp / Math.max(1, m.fp + m.vn);
      G.lineas($('gV1'), { x: [0, 1], y: [0, 1], h: 180, xLab: 'FPR', yLab: 'TPR', series: [{ x: [0, 1], y: [0, 1], cls: 'g-ref' }, { x: tab.fpr, y: tab.tpr, cls: 'g-linea principal' }], marcas: [{ x: fpr, y: tpr, label: 'AUC ' + f(tab.auc, 3) }] });
    } else $('gV1').innerHTML = '<p class="nota">Faltan casos de una de las clases para dibujar la ROC.</p>';
    /* área–umbral */
    const r = rangoHist(v), ca = V.curvaArea(v.ordenados, R.dirCls, r[0], r[1], 160);
    const amax = Math.max(v.areaRef, Math.max.apply(null, ca.area)) * 1.05;
    const vl = isFinite(R.tObj) ? [{ x: R.tObj, label: 'A · ' + f(R.tObj, 3) }] : [];
    if (S.B && S.B.variable === S.variable) vl.push({ x: S.B.tObj, label: 'B · ' + f(S.B.tObj, 3), cls: 'g-umbralB', tcls: 'g-txB', dy: 13 });
    G.lineas($('gV2'), { x: r, y: [0, amax], h: 180, xLab: v.nombre, yLab: 'km² objetivo', series: [{ x: ca.t, y: ca.area, cls: 'g-linea principal' }], bandas: isFinite(R.tObj) ? [{ x0: R.tObj - 0.05, x1: R.tObj + 0.05 }] : null, hlines: [{ y: v.areaRef, label: 'referencia ' + km(v.areaRef), cls: 'g-ref fuerte' }], vlines: vl });
  }

  /* ============================ Controles ============================ */
  function deslizador(cont, o) {
    const d = document.createElement('div');
    d.className = 'desl';
    const id = o.id;
    const en = o.entrada;
    d.innerHTML = '<div class="desl-cab"><label for="' + id + '">' + o.etiqueta + '</label>' +
      (en ? '<span class="desl-num"><input type="number" id="' + id + 'Num" min="' + en.min + '" max="' + en.max + '" step="' + en.paso + '" aria-label="' + o.etiqueta + ' (valor escrito)">' + (en.unidad ? '<span>' + en.unidad + '</span>' : '') + '</span>' : '<output id="' + id + 'Out"></output>') +
      '</div><input type="range" id="' + id + '" min="' + o.min + '" max="' + o.max + '" step="' + o.paso + '">' + (o.ayuda ? '<p class="ayuda">' + o.ayuda + '</p>' : '');
    cont.appendChild(d);
    const inp = d.querySelector('input[type="range"]'), out = d.querySelector('output'), num = en ? d.querySelector('input[type="number"]') : null;
    inp.value = o.valor;
    const fmtv = o.fmt || function (x) { return f(x, 2); };
    const mostrar = function (x) { if (num) num.value = en.aTexto(x); else out.textContent = fmtv(x); };
    mostrar(o.valor);
    inp.addEventListener('input', function () { mostrar(+inp.value); o.cambio(+inp.value, false); });
    inp.addEventListener('change', function () { o.cambio(+inp.value, true); });
    if (num) num.addEventListener('change', function () {
      let x = en.deTexto(parseFloat(String(num.value).replace(',', '.')));
      if (!isFinite(x)) { mostrar(+inp.value); return; }
      x = UL.clamp(x, o.min, o.max);
      inp.value = x; mostrar(x); o.cambio(x, true);
    });
    return inp;
  }

  const ICONOS_ESC = {
    A: '<svg class="ico-esc" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 20 9.5 7l3.5 6 2.5-3.5L22 20z"/><path class="rell" d="M9.5 7 12 11.3l-1.5-.8-1.2 1.3-1.3-.9z"/></svg>',
    B: '<svg class="ico-esc" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8c3-2.5 6 2.5 9 0s6 2.5 9 0M3 13c3-2.5 6 2.5 9 0s6 2.5 9 0"/><path d="M4 19h4M10 19h4M16 19h4"/></svg>',
    C: '<svg class="ico-esc" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.6 2.3-4.8C9.6 10 10.5 11 11 11c.3-2.5.2-5.3 1-8z"/></svg>',
    D: '<svg class="ico-esc" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19C5 10 11 5 20 4c0 9-5 15-13 15z"/><path d="M5 19 13 11"/></svg>'
  };
  function construirEscenas() {
    const nav = $('pestanasEscena');
    nav.innerHTML = '';
    for (const id of ['A', 'B', 'C', 'D']) {
      const m = UL.ESCENARIOS[id], b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.v = id;
      b.innerHTML = ICONOS_ESC[id] + '<b>' + id + '</b><span>' + m.corto + '</span>';
      b.onclick = function () { if (S.escena !== id) cambiarEscena(id); };
      nav.appendChild(b);
    }
  }

  function construirEscenario() {
    const m = UL.ESCENARIOS[S.escena];
    document.querySelectorAll('#pestanasEscena button').forEach(function (b) { const a = b.dataset.v === S.escena; b.classList.toggle('activo', a); b.setAttribute('aria-selected', a ? 'true' : 'false'); });
    const vars = Object.keys(E.variables);
    $('detalleEsc').dataset.esc = S.escena;
    $('detalleEsc').open = false;
    $('resumenEsc').innerHTML = '<span class="re-nombre">' + esc(m.nombre) + '</span><span class="re-mas">contexto, objetivo y dificultad</span>';
    $('infoEscenario').innerHTML = '<h3>' + esc(m.nombre) + '</h3><p>' + esc(m.contexto) + '</p><dl class="mini-dl"><dt>Objetivo</dt><dd>' + esc(m.objetivo) + '</dd><dt>Dificultad</dt><dd>' + esc(m.dificultad) + '</dd><dt>Índices</dt><dd>' + vars.map(function (k) { return esc(E.variables[k].nombre); }).join(' · ') + ' (fórmula en el panel izquierdo)</dd></dl><p class="nota tenue">Escena, valores y referencia son datos simulados con semilla reproducible.</p>';
    $('listaExp').innerHTML = m.experimentos.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    $('detExperimentos').open = false;
    $('segVariable').innerHTML = vars.map(function (k) { return '<button type="button" role="radio" data-v="' + k + '">' + esc(E.variables[k].nombre) + '</button>'; }).join('');
    $('segVariable').style.setProperty('--n', vars.length);
    marcarSeg('segVariable', S.variable);
    document.querySelectorAll('#segVariable button').forEach(function (b) {
      b.onclick = function () {
        if (S.variable === b.dataset.v) return;
        S.variable = b.dataset.v; S.p.manual.t = null; S.p.calib.z0 = null; S.corteObj = null; S.bic = null;
        if (S.B) { S.B = null; actualizarB(); }
        if (S.muestras.auto) generarMuestras(false);
        marcarSeg('segVariable', S.variable); construirFormula(); construirParams(); programar();
      };
    });
    construirFormula();
  }

  /** Cuadro del índice: solo la fórmula (LaTeX) y el umbral bibliográfico; en SAVI, además L. */
  function construirFormula() {
    const v = varActual(), c = $('cajaFormula');
    c.innerHTML = '<div class="cf-formula">' + UL.tex(v.latex || v.nombre, true) + '</div>' +
      '<div class="cf-umbral"><span class="cf-etq">Umbral bibliográfico</span>' +
      (v.literatura.length ? v.literatura.map(function (L) { return '<span class="cf-u"><b>' + f(L.t, 2) + '</b> ' + esc(L.ref) + '</span>'; }).join('') : '<span class="cf-u tenue">sin umbral en el material del curso</span>') + '</div>';
    if (v.clave === 'SAVI') {
      deslizador(c, { id: 'slL', etiqueta: 'L (ajuste del suelo)', min: 0, max: 1, paso: 0.05, valor: S.sim.L, entrada: { min: 0, max: 1, paso: 0.05, aTexto: function (x) { return +x.toFixed(2); }, deTexto: function (n) { return n; } },
        cambio: function (x, fin) { S.sim.L = x; cambioL(fin); } });
    }
  }
  let tL = 0, lPend = null;
  function cambioL(fin) {
    const aplicar = function () {
      UL.recalcularSAVI(E, S.sim.L);
      E._version = ++contEscenas; versionEscena = E._version; cacheCompleta = {}; cacheHistEsc = {};
      if (S.p.manual.t !== null && S.metodo === 'manual') sincronizarManual();
      programar();
    };
    clearTimeout(lPend);
    const ahora = performance.now();
    if (fin || ahora - tL > 90) { tL = ahora; aplicar(); } else lPend = setTimeout(function () { tL = performance.now(); aplicar(); }, 100);
  }

  function marcarSeg(id, v) { document.querySelectorAll('#' + id + ' button').forEach(function (b) { b.classList.toggle('activo', b.dataset.v === v); }); }

  /* Un control de Simulación regenera la escena como mucho una vez por cuadro, deja
     al menos ~80 ms libres entre regeneraciones (la barra se sigue moviendo con
     fluidez mientras se arrastra) y nunca repite el cálculo con los mismos parámetros
     (al soltar la barra no se vuelve a calcular). */
  let regenPend = 0, claveRegen = '', finRegen = 0;
  function cambioSim(clave, valor) {
    S.sim[clave] = valor;
    if (regenPend) return;
    const espera = Math.max(0, 80 - (performance.now() - finRegen));
    regenPend = setTimeout(function () {
      requestAnimationFrame(function () {
        regenPend = 0;
        if (JSON.stringify(S.sim) === claveRegen) return;
        regenerar(true);
        finRegen = performance.now();
      });
    }, espera);
  }

  /** Escenario B: reparto de las parcelas entre cultivo verde, joven y barbecho. */
  function mezclaB() {
    const el = $('mezclaB');
    if (!el) return;
    const b = S.sim.barbecho, j = (1 - b) * S.sim.joven, v = 1 - b - j;
    el.innerHTML = 'Parcelas: <b>' + f(100 * v, 0) + ' %</b> cultivo verde · <b>' + f(100 * j, 0) + ' %</b> cultivo joven · <b>' + f(100 * b, 0) + ' %</b> barbecho';
  }
  function construirSim() {
    const m = UL.ESCENARIOS[S.escena], c = $('controlesSim');
    c.innerHTML = '';
    $('inSemilla').value = S.sim.semilla;
    deslizador(c, { id: 'slProp', etiqueta: m.prop.etiqueta, min: m.prop.min, max: m.prop.max, paso: m.prop.paso, valor: S.sim.prop, fmt: function (x) { return m.prop.pct ? f(100 * x, 0) + ' %' : f(x, 2); }, cambio: function (x, fin) { cambioSim('prop', x, fin); } });
    deslizador(c, { id: 'slEsp', etiqueta: m.esp.etiqueta, min: m.esp.min, max: m.esp.max, paso: m.esp.paso, valor: S.sim.esp, fmt: function (x) { return m.esp.entero ? f(x, 0) : f(x, 2); }, cambio: function (x, fin) { cambioSim('esp', x, fin); } });
    if (m.esp2) deslizador(c, { id: 'slEsp2', etiqueta: m.esp2.etiqueta, min: m.esp2.min, max: m.esp2.max, paso: m.esp2.paso, valor: S.sim.esp2, fmt: function (x) { return m.esp2.factor ? '× ' + f(x, 2) : f(x, 2); }, cambio: function (x, fin) { cambioSim('esp2', x, fin); }, ayuda: m.esp2.factor ? 'Escala el radio de todas las lagunas (de la mitad a 1,8 veces); el radio máximo queda en unos 330 m.' : '' });
    for (const x of m.extras || []) {
      deslizador(c, { id: 'slX_' + x.clave, etiqueta: x.etiqueta, min: x.min, max: x.max, paso: x.paso, valor: S.sim[x.clave],
        fmt: function (v) { return x.pct ? f(100 * v, 0) + ' %' : x.factor ? '× ' + f(v, 2) : f(v, 2); },
        cambio: function (v) { cambioSim(x.clave, v); if (x.clave === 'barbecho' || x.clave === 'joven') mezclaB(); }, ayuda: x.ayuda });
      if (x.clave === 'joven') { const pm = document.createElement('p'); pm.className = 'mezcla'; pm.id = 'mezclaB'; c.appendChild(pm); mezclaB(); }
    }
    deslizador(c, { id: 'slRuido', etiqueta: 'Ruido del sensor (σ)', min: 0, max: 0.12, paso: 0.005, valor: S.sim.ruido, fmt: function (x) { return f(x, 3); }, cambio: function (x, fin) { cambioSim('ruido', x, fin); } });
    deslizador(c, { id: 'slContraste', etiqueta: 'Contraste entre clases', min: 0.3, max: 1.3, paso: 0.05, valor: S.sim.contraste, fmt: function (x) { return '× ' + f(x, 2); }, cambio: function (x, fin) { cambioSim('contraste', x, fin); } });
    deslizador(c, { id: 'slHetero', etiqueta: 'Heterogeneidad espacial', min: 0, max: 1, paso: 0.05, valor: S.sim.hetero, fmt: function (x) { return f(x, 2); }, cambio: function (x, fin) { cambioSim('hetero', x, fin); } });
  }

  const DESC_MET = {
    otsu: 'Máxima varianza entre dos grupos', percentil: 'Fija la fracción sobre el corte', kmeans: 'Cortes entre centros de grupos',
    gmm: 'Mezcla de normales (EM)', multiotsu: 'k − 1 cortes de máxima separación', youden: 'Máximo de TPR − FPR',
    f1: 'Equilibrio precisión–sensibilidad', logistica: 'Probabilidad de la clase', manual: 'Corte fijo o de la literatura',
    calib: 'Índice donde la fracción Z = z₀'
  };
  function construirChips() {
    marcarSeg('segEnfoque', S.enfoque);
    document.querySelectorAll('#segEnfoque button').forEach(function (b) { b.setAttribute('aria-checked', b.dataset.v === S.enfoque ? 'true' : 'false'); });
    $('chipsMetodo').innerHTML = METODOS[S.enfoque].map(function (q) {
      const a = q[0] === S.metodo;
      return '<button type="button" role="radio" aria-checked="' + a + '" data-v="' + q[0] + '" class="mtile' + (a ? ' activo' : '') + '"><span class="mt-nom">' + q[1] + '</span><span class="mt-desc">' + DESC_MET[q[0]] + '</span></button>';
    }).join('');
    $('chipsMetodo').dataset.n = METODOS[S.enfoque].length;
    $('titParams').textContent = 'Parámetros · ' + UL.FICHAS[S.metodo].nombre;
    document.querySelectorAll('#chipsMetodo button').forEach(function (b) {
      b.onclick = function () { S.metodo = b.dataset.v; S.corteObj = null; construirChips(); construirParams(); programar(); };
    });
  }

  function sincronizarManual() {
    const sl = $('slManual');
    if (sl) { sl.value = S.p.manual.t; const nu = $('slManualNum'); if (nu) nu.value = +S.p.manual.t.toFixed(3); }
  }

  function construirParams() {
    const c = $('paramsMetodo'), p = S.p, v = varActual();
    c.innerHTML = '';
    const m = S.metodo;
    if (m === 'otsu') {
      const d = document.createElement('div');
      d.className = 'campo';
      d.innerHTML = '<span class="etq">Clases del histograma</span><div class="seg" id="segBins">' + [64, 128, 256, 512].map(function (b) { return '<button type="button" data-v="' + b + '">' + b + '</button>'; }).join('') + '</div>';
      c.appendChild(d);
      marcarSeg('segBins', String(p.otsu.bins));
      d.querySelectorAll('button').forEach(function (b) { b.onclick = function () { p.otsu.bins = +b.dataset.v; marcarSeg('segBins', b.dataset.v); programar(); }; });
    } else if (m === 'percentil') {
      deslizador(c, { id: 'slP', etiqueta: 'Percentil p', min: 0.01, max: 0.995, paso: 0.005, valor: p.percentil.p,
        entrada: { min: 1, max: 99.5, paso: 0.1, unidad: '%', aTexto: function (x) { return +(100 * x).toFixed(2); }, deTexto: function (n) { return n / 100; } },
        cambio: function (x) { p.percentil.p = x; programar(); },
        ayuda: 'Escribe el valor (por ejemplo 97,5) o usa la barra. ' + (v.dir > 0 ? 'Objetivo en valores altos: queda el (100 − p) % superior.' : 'Objetivo en valores bajos: queda el p % inferior.') });
    } else if (m === 'kmeans') {
      deslizador(c, { id: 'slK', etiqueta: 'Número de grupos k', min: 2, max: 5, paso: 1, valor: p.kmeans.k, fmt: function (x) { return f(x, 0); }, cambio: function (x, fin) { p.kmeans.k = x; S.corteObj = null; programar(); if (fin) construirParams(); } });
      deslizador(c, { id: 'slNs', etiqueta: 'Arranques', min: 1, max: 10, paso: 1, valor: p.kmeans.nstart, fmt: function (x) { return f(x, 0); }, cambio: function (x) { p.kmeans.nstart = x; programar(); } });
    } else if (m === 'gmm') {
      deslizador(c, { id: 'slKg', etiqueta: 'Componentes K', min: 2, max: 4, paso: 1, valor: p.gmm.k, fmt: function (x) { return f(x, 0); }, cambio: function (x, fin) { p.gmm.k = x; S.corteObj = null; programar(); if (fin) construirParams(); }, ayuda: 'EM sobre el histograma fino (512 clases) de toda la población, con 3 arranques.' });
    } else if (m === 'multiotsu') {
      deslizador(c, { id: 'slKm', etiqueta: 'Número de clases k', min: 3, max: 5, paso: 1, valor: p.multiotsu.k, fmt: function (x) { return f(x, 0); }, cambio: function (x, fin) { p.multiotsu.k = x; S.corteObj = null; if (fin) { programar(); construirParams(); } } });
    } else if (m === 'youden') {
      const d = document.createElement('p'); d.className = 'nota';
      d.textContent = 'Usa las muestras de calibración (generadas o dibujadas). Cambia el diseño de muestreo para ver cuánto se mueve el corte.';
      c.appendChild(d);
    } else if (m === 'logistica') {
      const pl = p.logistica, d = document.createElement('div');
      d.className = 'campo';
      d.innerHTML = '<span class="etq">Modelo</span><div class="seg" id="segLogTipo"><button type="button" data-v="binaria">Binaria</button><button type="button" data-v="multinomial"' + (S.escena !== 'A' ? ' disabled title="Disponible en el escenario A"' : '') + '>Multinomial</button></div>';
      c.appendChild(d);
      if (S.escena !== 'A' && pl.tipo === 'multinomial') pl.tipo = 'binaria';
      marcarSeg('segLogTipo', pl.tipo);
      d.querySelectorAll('button').forEach(function (b) { b.onclick = function () { if (b.disabled) return; pl.tipo = b.dataset.v; construirParams(); programar(); }; });
      if (pl.tipo === 'binaria') {
        deslizador(c, { id: 'slPlog', etiqueta: 'Nivel de probabilidad p', min: 0.05, max: 0.95, paso: 0.05, valor: pl.p,
          entrada: { min: 0.01, max: 0.99, paso: 0.01, aTexto: function (x) { return +x.toFixed(2); }, deTexto: function (n) { return n; } },
          cambio: function (x) { pl.p = x; programar(); }, ayuda: 'El umbral es el índice donde P(clase | I) = p: t(p) = [logit(p) − β₀] / β₁.' });
        const l = document.createElement('label'); l.className = 'check';
        l.innerHTML = '<input type="checkbox" id="chkCorregir"' + (pl.corregir ? ' checked' : '') + '> Corregir el intercepto con la prevalencia de la escena (π de la referencia sintética)';
        c.appendChild(l);
        l.querySelector('input').onchange = function (ev) { pl.corregir = ev.target.checked; programar(); };
        const n2 = document.createElement('p'); n2.className = 'nota tenue';
        n2.textContent = 'Usa las muestras de calibración. Con una muestra estratificada 50/50 el intercepto refleja la prevalencia de la muestra, no la del paisaje.';
        c.appendChild(n2);
      } else {
        const d2 = document.createElement('div'); d2.className = 'campo';
        d2.innerHTML = '<span class="etq">Predictores</span><div class="seg" id="segPred"><button type="button" data-v="NDSI">Solo NDSI</button><button type="button" data-v="ambos">NDSI + NDWI</button></div>';
        c.appendChild(d2);
        marcarSeg('segPred', pl.predictores);
        d2.querySelectorAll('button').forEach(function (b) { b.onclick = function () { pl.predictores = b.dataset.v; marcarSeg('segPred', b.dataset.v); programar(); }; });
        deslizador(c, { id: 'slNclase', etiqueta: 'Píxeles por clase (entrenamiento)', min: 30, max: 400, paso: 10, valor: pl.nClase, fmt: function (x) { return f(x, 0); }, cambio: function (x, fin) { pl.nClase = x; if (fin) programar(); }, ayuda: 'Muestra equilibrada propia (resto, glaciar, laguna) y otra igual, disjunta, para probar. «Generar muestras» cambia la semilla.' });
      }
    } else if (m === 'f1') {
      deslizador(c, { id: 'slBeta', etiqueta: 'β (peso de la sensibilidad)', min: 0.25, max: 3, paso: 0.05, valor: p.f1.beta, fmt: function (x) { return f(x, 2); }, cambio: function (x) { p.f1.beta = x; programar(); }, ayuda: 'β = 1: F1. β > 1 favorece no omitir; β < 1, no inventar objeto.' });
    } else if (m === 'manual') {
      if (p.manual.t === null) p.manual.t = litDefecto(v);
      deslizador(c, { id: 'slManual', etiqueta: 'Umbral t', min: v.rangoVis[0], max: v.rangoVis[1], paso: 0.005, valor: p.manual.t,
        entrada: { min: v.rangoVis[0], max: v.rangoVis[1], paso: 0.001, aTexto: function (x) { return +x.toFixed(3); }, deTexto: function (n) { return n; } },
        cambio: function (x) { p.manual.t = x; programar(); } });
      const d = document.createElement('div'); d.className = 'chips lit';
      d.innerHTML = '<span class="etq">Literatura</span>' + v.literatura.map(function (L, k) { return '<button type="button" data-k="' + k + '" title="' + esc(L.ref) + '">' + f(L.t, 2) + ' · ' + esc(L.ref) + '</button>'; }).join('');
      c.appendChild(d);
      d.querySelectorAll('button').forEach(function (b) { b.onclick = function () { p.manual.t = v.literatura[+b.dataset.k].t; sincronizarManual(); programar(); }; });
    } else if (m === 'calib') {
      if (p.calib.z0 === null) p.calib.z0 = v.zRef;
      deslizador(c, { id: 'slZ0', etiqueta: 'Criterio físico z₀ (' + v.zNombre + ')', min: 0.1, max: 0.9, paso: 0.05, valor: p.calib.z0,
        entrada: { min: 0.1, max: 0.9, paso: 0.01, aTexto: function (x) { return +x.toFixed(2); }, deTexto: function (n) { return n; } },
        cambio: function (x) { p.calib.z0 = x; programar(); } });
      const d = document.createElement('div'); d.className = 'campo';
      d.innerHTML = '<span class="etq">Pares (I, Z)</span><div class="seg" id="segFuente"><button type="button" data-v="auto">Estratificados por Z</button><button type="button" data-v="cal">Muestras de calibración</button></div>';
      c.appendChild(d);
      marcarSeg('segFuente', p.calib.fuente);
      d.querySelectorAll('button').forEach(function (b) { b.onclick = function () { p.calib.fuente = b.dataset.v; marcarSeg('segFuente', b.dataset.v); construirParams(); programar(); }; });
      if (p.calib.fuente === 'auto') deslizador(c, { id: 'slNp', etiqueta: 'Número de pares', min: 50, max: 1500, paso: 50, valor: p.calib.n, fmt: function (x) { return f(x, 0); }, cambio: function (x, fin) { p.calib.n = x; if (fin) programar(); }, ayuda: 'Cinco tramos de Z con el mismo número de pares, tomados de la población de cálculo.' });
    }
    /* corte objetivo para métodos con varios cortes */
    const kCortes = m === 'kmeans' ? p.kmeans.k - 1 : m === 'gmm' ? p.gmm.k - 1 : m === 'multiotsu' ? p.multiotsu.k - 1 : 1;
    if (kCortes > 1) {
      const d = document.createElement('div'); d.className = 'campo';
      d.innerHTML = '<span class="etq">Corte que separa «' + esc(v.objetivo) + '»</span><p class="ayuda">Auto: ' + (E.ordinal ? 't₂ (escasa | moderada)' : v.dir > 0 ? 'el corte superior' : 'el corte inferior') + '. El resto de clases se cuenta como «resto».</p><div class="seg" id="segCorte"><button type="button" data-v="auto">Auto</button>' + Array.from({ length: kCortes }, function (_, j) { return '<button type="button" data-v="' + j + '">t' + G.subindice(j + 1) + '</button>'; }).join('') + '</div>';
      c.appendChild(d);
      marcarSeg('segCorte', S.corteObj === null ? 'auto' : String(S.corteObj));
      d.querySelectorAll('button').forEach(function (b) { b.onclick = function () { S.corteObj = b.dataset.v === 'auto' ? null : +b.dataset.v; marcarSeg('segCorte', b.dataset.v); programar(); }; });
    }
    if (S.escena === 'A' && S.variable === 'NDSI' && !(m === 'logistica' && p.logistica.tipo === 'multinomial')) {
      const l = document.createElement('label'); l.className = 'check';
      l.innerHTML = '<input type="checkbox" id="chkCompuesta"' + (S.compuesta ? ' checked' : '') + '> Regla compuesta: además NIR > 0,11 (Hall et al., 1995)';
      c.appendChild(l);
      l.querySelector('input').onchange = function (ev) { S.compuesta = ev.target.checked; programar(); };
    }
  }

  function actualizarB() {
    $('btnQuitarB').disabled = !S.B;
    $('infoB').innerHTML = S.B ? '<span class="chip-b">B</span> ' + esc(S.B.desc) : 'Fija una configuración, cambia el método o la población y compara A con B en el mapa, el histograma y la validación.';
  }

  function fijarB() {
    if (!R || R.error) { avisoMapa('No hay una clasificación válida para fijar como B.'); return; }
    const v = varActual();
    const pobTxt = R.pobIdx ? 'población dibujada (' + ent(R.nPob) + ' px)' : 'escena completa';
    const reglaTxt = R.multi ? 'multinomial con ' + R.multi.predictores.join(' + ') : 't = ' + R.cortes.map(function (t) { return f(t, 3); }).join(' · ');
    S.B = { pred: R.pred.slice(), cortes: R.cortes.slice(), tObj: R.tObj, area: R.area, variable: S.variable, desc: UL.FICHAS[S.metodo].nombre + ' · ' + reglaTxt + ' · ' + pobTxt + ' · ' + km(R.area) + ' (' + v.nombre + ')' };
    actualizarB();
    S.capa = 'diferencia';
    programar();
  }

  /* ============================ Inicio ============================ */
  function iniciar() {
    try { const t = localStorage.getItem('lab-umbral-tema'); if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); } catch (e) { /* almacenamiento no disponible */ }
    actualizarBotonTema();
    S.escena = 'A'; S.variable = 'NDSI'; S.capa = 'indice';
    S.sim = simDefecto(S.escena);
    S.muestras.auto = false;
    regenerarSinProgramar();
    visor = new UL.Visor($('mapa'), {
      geometria: function () { programar(); },
      consulta: function (i) { renderLectura(i); },
      fijar: function (i) { S.fijado = S.fijado === i ? -1 : i; renderLectura(i); },
      aviso: avisoMapa
    });
    visor.geoms = S.geoms;
    construirEscenas();
    construirEscenario();
    construirSim();
    construirChips();
    construirParams();
    $('inNCal').value = S.muestras.nCal; $('inNVal').value = S.muestras.nVal; $('selDiseno').value = S.muestras.diseno;

    /* herramientas */
    function herramienta(h) {
      visor.herramienta = h; visor.cancelarBorrador();
      document.querySelectorAll('#rielHerr button').forEach(function (b) { b.classList.toggle('activo', b.dataset.h === h); b.setAttribute('aria-pressed', b.dataset.h === h ? 'true' : 'false'); });
      $('contMapa').dataset.herr = h;
      visor.dibujar();
    }
    document.querySelectorAll('#rielHerr button').forEach(function (b) { b.onclick = function () { herramienta(b.dataset.h); }; });
    herramienta('mover');
    function rol(r) { visor.rol = r; document.querySelectorAll('#segRol button').forEach(function (b) { b.classList.toggle('activo', b.dataset.v === r); b.setAttribute('aria-checked', b.dataset.v === r ? 'true' : 'false'); }); }
    document.querySelectorAll('#segRol button').forEach(function (b) { b.onclick = function () { rol(b.dataset.v); if (visor.herramienta === 'mover') herramienta(b.dataset.v === 'poblacion' ? 'rect' : 'punto'); }; });
    rol('poblacion');
    document.querySelectorAll('#segCapas button').forEach(function (b) { b.onclick = function () { if (b.disabled) return; S.capa = b.dataset.v; actualizarCapas(); renderMapa(); }; });
    $('btnZoomMas').onclick = function () { visor.zoom(1.4); };
    $('btnZoomMenos').onclick = function () { visor.zoom(1 / 1.4); };
    $('btnAjustar').onclick = function () { visor.ajustar(); };
    $('chkRelieve').onchange = function (ev) { S.relieve = ev.target.checked; renderMapa(); };
    $('chkGeom').onchange = function (ev) { visor.mostrarGeom = ev.target.checked; renderMapa(); };
    $('chkLog').onchange = function (ev) { S.hist.log = ev.target.checked; renderHist(); };
    $('chkPorClase').onchange = function (ev) { S.hist.porClase = ev.target.checked; renderHist(); };
    $('chkFondo').onchange = function (ev) { S.hist.fondo = ev.target.checked; renderHist(); };
    $('chkSubmuestra').onchange = function (ev) { S.submuestra = ev.target.checked; programar(); };
    document.querySelectorAll('#segGraf button').forEach(function (b) { b.onclick = function () { S.hist.tipo = b.dataset.v; renderHist(); }; });
    const ponerBins = function (n) { S.hist.bins = Math.round(UL.clamp(n, 5, 512)); renderHist(); };
    $('btnBinsMenos').onclick = function () { const m = BINS.filter(function (q) { return q < S.hist.bins; }); ponerBins(m.length ? m[m.length - 1] : 5); };
    $('btnBinsMas').onclick = function () { const m = BINS.filter(function (q) { return q > S.hist.bins; }); ponerBins(m.length ? m[0] : 512); };
    $('inBins').onchange = function (ev) { const n = parseInt(ev.target.value, 10); if (isFinite(n)) ponerBins(n); else ev.target.value = S.hist.bins; };
    $('btnBorrarPobMapa').onclick = borrarPoblacion;

    document.querySelectorAll('#segEnfoque button').forEach(function (b) {
      b.onclick = function () { S.enfoque = b.dataset.v; S.metodo = METODOS[S.enfoque][0][0]; S.corteObj = null; construirChips(); construirParams(); programar(); };
    });
    $('inSemilla').onchange = function (ev) { const s = Math.max(1, Math.min(99999, Math.round(+ev.target.value || 1))); ev.target.value = s; S.sim.semilla = s; regenerar(); };
    $('btnDado').onclick = function () { S.sim.semilla = 1 + Math.floor(Math.random() * 99999); $('inSemilla').value = S.sim.semilla; regenerar(); };
    $('btnReiniciar').onclick = function () { cambiarEscena(S.escena); avisoMapa('Escenario reiniciado con la semilla y los valores iniciales.'); };
    $('selDiseno').onchange = function (ev) { S.muestras.diseno = ev.target.value; };
    $('inNCal').onchange = function (ev) { S.muestras.nCal = Math.max(0, Math.min(5000, Math.round(+ev.target.value || 0))); ev.target.value = S.muestras.nCal; };
    $('inNVal').onchange = function (ev) { S.muestras.nVal = Math.max(0, Math.min(5000, Math.round(+ev.target.value || 0))); ev.target.value = S.muestras.nVal; };
    $('btnGenerar').onclick = function () { generarMuestras(true); programar(); };
    $('btnBorrarMuestras').onclick = function () {
      S.muestras.cal = []; S.muestras.val = []; S.muestras.auto = false;
      for (let k = S.geoms.length - 1; k >= 0; k--) if (S.geoms[k].rol !== 'poblacion') S.geoms.splice(k, 1);
      visor.dibujar(); programar();
    };
    $('btnFijarB').onclick = fijarB;
    $('btnQuitarB').onclick = function () { S.B = null; actualizarB(); if (S.capa === 'diferencia') S.capa = 'clasificacion'; programar(); };
    document.querySelectorAll('.tabs button').forEach(function (b) { b.onclick = function () { S.tab = b.dataset.tab; renderTab(); }; });
    $('btnTema').onclick = function () {
      const claro = document.documentElement.getAttribute('data-theme') !== 'light';
      if (claro) document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.setAttribute('data-theme', 'dark');
      try { localStorage.setItem('lab-umbral-tema', claro ? 'light' : 'dark'); } catch (e) { /* sin almacenamiento */ }
      actualizarBotonTema(); renderHist(); renderTab();
    };
    $('btnGuia').onclick = function () { $('guia').hidden = false; $('btnCerrarGuia').focus(); };
    $('btnCerrarGuia').onclick = function () { $('guia').hidden = true; };
    $('guia').addEventListener('click', function (ev) { if (ev.target === $('guia')) $('guia').hidden = true; });
    window.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { if (!$('guia').hidden) $('guia').hidden = true; $('detalleEsc').open = false; } });
    document.addEventListener('click', function (ev) { const d = $('detalleEsc'); if (d.open && !d.contains(ev.target)) d.open = false; });

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { visor.redimensionar(); if (R) { renderHist(); renderTab(); } }) : null;
    if (ro) { ro.observe($('contMapa')); ro.observe($('grafHist')); } else window.addEventListener('resize', function () { visor.redimensionar(); renderHist(); renderTab(); });
    visor.redimensionar();
    ciclo();
    UL.app = { S: S, estado: function () { return R; }, escena: function () { return E; }, visor: visor, programar: programar, cambiarEscena: cambiarEscena, ciclo: ciclo };
  }
  function actualizarBotonTema() {
    const claro = document.documentElement.getAttribute('data-theme') === 'light';
    $('btnTema').textContent = claro ? 'Tema oscuro' : 'Tema claro';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(globalThis.UL = globalThis.UL || {});
