/* =====================================================================
   Laboratorio de umbralización · U3B
   nucleo.js — espacio de nombres, azar reproducible, ruido espacial,
   utilidades numéricas, formato en español y rampas de color.
   Todos los módulos cuelgan de globalThis.UL para funcionar con
   <script> clásicos (abre con doble clic, sin servidor) y en Node.
   ===================================================================== */
(function (UL) {
  'use strict';

  /* Malla de la escena sintética: 256 × 192 celdas de 30 m (tipo Landsat) */
  UL.W = 256;
  UL.H = 192;
  UL.N = UL.W * UL.H;
  UL.PIX_M = 30;
  UL.PIX_KM2 = (UL.PIX_M * UL.PIX_M) / 1e6; // 0,0009 km²

  /* ---------- Azar reproducible ---------- */
  function hash32(a, b) {
    let h = (a | 0) ^ Math.imul(((b | 0) + 0x632be5ab) | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  UL.hash32 = hash32;

  /** Generador mulberry32 con semilla y "sal" (flujo independiente). */
  UL.crearRng = function (semilla, sal) {
    let a = hash32(semilla, sal || 0);
    const r = function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let guardado = null;
    r.normal = function () {
      if (guardado !== null) { const g = guardado; guardado = null; return g; }
      let u = 0;
      while (u <= 1e-12) u = r();
      const v = r();
      const m = Math.sqrt(-2 * Math.log(u));
      guardado = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    };
    r.entero = function (n) { return Math.floor(r() * n); };
    return r;
  };

  /** Baraja (Fisher–Yates) una copia y devuelve los primeros n elementos. */
  UL.muestrear = function (arr, n, rng) {
    const a = Array.from(arr);
    const m = Math.min(n, a.length);
    for (let i = 0; i < m; i++) {
      const j = i + Math.floor(rng() * (a.length - i));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, m);
  };

  /* ---------- Ruido espacial (value noise fractal) ---------- */
  UL.estandarizar = function (a) {
    let s = 0, s2 = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; s2 += a[i] * a[i]; }
    const m = s / a.length;
    const sd = Math.sqrt(Math.max(s2 / a.length - m * m, 1e-12));
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - m) / sd;
    return a;
  };

  /**
   * Campo aleatorio suave con autocorrelación espacial.
   * escala: tamaño (px) de la octava más gruesa. Devuelve media 0 y DE 1.
   */
  function campoCrudo(semilla, sal, escala, octavas, persistencia) {
    const W = UL.W, H = UL.H, out = new Float32Array(W * H);
    let amp = 1, esc = escala;
    for (let o = 0; o < octavas && esc >= 1.5; o++) {
      const r = UL.crearRng(semilla, sal * 101 + o * 13 + 7);
      const gw = Math.ceil(W / esc) + 3, gh = Math.ceil(H / esc) + 3;
      const g = new Float32Array(gw * gh);
      for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
      const ox = r() * esc, oy = r() * esc;
      for (let y = 0; y < H; y++) {
        const fy = (y + oy) / esc, y0 = Math.floor(fy), ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < W; x++) {
          const fx = (x + ox) / esc, x0 = Math.floor(fx), tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const i00 = g[y0 * gw + x0], i10 = g[y0 * gw + x0 + 1];
          const i01 = g[(y0 + 1) * gw + x0], i11 = g[(y0 + 1) * gw + x0 + 1];
          const a = i00 + (i10 - i00) * sx, b = i01 + (i11 - i01) * sx;
          out[y * W + x] += amp * (a + (b - a) * sy);
        }
      }
      amp *= persistencia;
      esc /= 2;
    }
    return UL.estandarizar(out);
  }

  /* ---------- Memoria de cálculos deterministas (LRU) ----------
     Los campos de ruido y las secuencias aleatorias dependen solo de la semilla:
     al mover un control (p. ej. el número de lagunas) se reutilizan en vez de
     recalcularse, y el tiempo de respuesta no crece con el uso. */
  const MEMO = new Map(), MEMO_MAX = 96;
  UL.memo = function (clave, fn) {
    if (MEMO.has(clave)) { const v = MEMO.get(clave); MEMO.delete(clave); MEMO.set(clave, v); return v; }
    const v = fn();
    MEMO.set(clave, v);
    while (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
    return v;
  };
  UL.limpiarMemo = function () { MEMO.clear(); };

  /** Campo aleatorio suave (copia de la versión memorizada: quien lo usa puede modificarlo). */
  UL.campo = function (semilla, sal, escala, octavas, persistencia) {
    const k = 'campo|' + semilla + '|' + sal + '|' + escala + '|' + octavas + '|' + persistencia;
    return UL.memo(k, function () { return campoCrudo(semilla, sal, escala, octavas, persistencia); }).slice();
  };

  /** Flujo de normales N(0, 1) idéntico a crearRng(semilla, sal).normal(), pero guardado
      para reutilizarlo entre regeneraciones de la escena con la misma semilla. */
  UL.flujoNormal = function (semilla, sal) {
    const st = UL.memo('normal|' + semilla + '|' + sal, function () { return { rng: UL.crearRng(semilla, sal), a: new Float64Array(0), n: 0 }; });
    let j = 0;
    return {
      normal: function () {
        if (j >= st.n) {
          if (st.n >= st.a.length) { const b = new Float64Array(Math.max(4096, st.a.length * 2)); b.set(st.a); st.a = b; }
          st.a[st.n++] = st.rng.normal();
        }
        return st.a[j++];
      }
    };
  };


  /** Magnitud del gradiente (unidades por píxel), diferencias centradas. */
  UL.gradiente = function (a) {
    const W = UL.W, H = UL.H, g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const ya = Math.max(0, y - 1), yb = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) {
        const xa = Math.max(0, x - 1), xb = Math.min(W - 1, x + 1);
        const gx = (a[y * W + xb] - a[y * W + xa]) / (xb - xa);
        const gy = (a[yb * W + x] - a[ya * W + x]) / (yb - ya);
        g[y * W + x] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return g;
  };

  /** Sombreado de relieve (luz del noroeste, 0 = sombra, 1 = iluminado). */
  UL.sombreado = function (dem, zf) {
    const W = UL.W, H = UL.H, s = new Float32Array(W * H);
    const L = [-1, -1, 1.25];
    const ln = Math.hypot(L[0], L[1], L[2]);
    for (let y = 0; y < H; y++) {
      const ya = Math.max(0, y - 1), yb = Math.min(H - 1, y + 1);
      for (let x = 0; x < W; x++) {
        const xa = Math.max(0, x - 1), xb = Math.min(W - 1, x + 1);
        const dx = (dem[y * W + xb] - dem[y * W + xa]) / (xb - xa) * zf;
        const dy = (dem[yb * W + x] - dem[ya * W + x]) / (yb - ya) * zf;
        const nx = -dx, ny = -dy, nz = 1, nn = Math.hypot(nx, ny, nz);
        const d = (nx * L[0] + ny * L[1] + nz * L[2]) / (nn * ln);
        s[y * W + x] = Math.max(0, Math.min(1, d));
      }
    }
    return s;
  };

  /* ---------- Utilidades numéricas ---------- */
  UL.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  UL.clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };

  /* Copia ordenada; se recuerda por objeto (con una suma de control por si el
     vector cambió) para no reordenar en cada redibujado. Tratar como de solo lectura. */
  const ORDENADOS = new WeakMap();
  /** Ordenación por base (radix, 3 pasadas de 11 bits) de un Float32Array, en su sitio.
      Da el mismo orden que TypedArray.prototype.sort (−0 antes que +0, NaN al final). */
  let radixB = new Uint32Array(0);
  const radixC = new Uint32Array(2048);
  function ordenarRadix(f) {
    const n = f.length;
    if (n < 512) { f.sort(); return f; }
    let a = new Uint32Array(f.buffer, f.byteOffset, n);
    for (let i = 0; i < n; i++) { const x = a[i]; a[i] = (x & 0x80000000) ? ~x >>> 0 : (x | 0x80000000) >>> 0; }
    if (radixB.length < n) radixB = new Uint32Array(n);
    let b = radixB.subarray(0, n);
    const orig = a;
    for (let sh = 0; sh <= 22; sh += 11) {
      const m = sh === 22 ? 1023 : 2047;
      radixC.fill(0);
      for (let i = 0; i < n; i++) radixC[(a[i] >>> sh) & m]++;
      let acc = 0;
      for (let k = 0; k <= m; k++) { const t = radixC[k]; radixC[k] = acc; acc += t; }
      for (let i = 0; i < n; i++) { const x = a[i]; b[radixC[(x >>> sh) & m]++] = x; }
      const t = a; a = b; b = t;
    }
    /* tras 3 pasadas el resultado está en el búfer auxiliar: se copia al original */
    if (a !== orig) orig.set(a);
    for (let i = 0; i < n; i++) { const x = orig[i]; orig[i] = (x & 0x80000000) ? (x & 0x7fffffff) >>> 0 : ~x >>> 0; }
    return f;
  }
  function control(arr) {
    let a = 0, b = 0;
    for (let i = 0; i < arr.length; i++) { const v = +arr[i]; a += v; b += v * ((i & 1023) + 1); }
    return a + '|' + b;
  }
  UL.ordenarEnSitio = function (f) { return ordenarRadix(f); };
  UL.ordenar = function (arr) {
    const objeto = arr !== null && typeof arr === 'object';
    let c = null;
    if (objeto && arr.length > 256) {
      const g = ORDENADOS.get(arr);
      c = control(arr);
      if (g && g.n === arr.length && g.c === c) return g.s;
    }
    const s = ordenarRadix(Float32Array.from(arr));
    if (c !== null) ORDENADOS.set(arr, { n: arr.length, c: c, s: s });
    return s;
  };

  /** Cuantil tipo 7 (el de R por defecto) sobre un vector ordenado. */
  UL.cuantilOrdenado = function (s, p) {
    const n = s.length;
    if (!n) return NaN;
    const h = (n - 1) * p, lo = Math.floor(h), hi = Math.min(n - 1, lo + 1);
    return s[lo] + (h - lo) * (s[hi] - s[lo]);
  };
  UL.cuantil = function (arr, p) { return UL.cuantilOrdenado(UL.ordenar(arr), p); };

  /** Número de elementos de un vector ordenado ≥ t (búsqueda binaria). */
  UL.contarMayorIgual = function (s, t) {
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < t) lo = m + 1; else hi = m; }
    return s.length - lo;
  };
  UL.contarMenorIgual = function (s, t) {
    let lo = 0, hi = s.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  };

  /* ---------- Formato numérico en español (coma decimal) ---------- */
  const MENOS = '−', ESP = ' ';
  UL.fmt = function (x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    if (d === undefined) d = 3;
    const neg = x < 0 && Math.abs(x) >= 0.5 * Math.pow(10, -d);
    let s = Math.abs(x).toFixed(d);
    let [ent, dec] = s.split('.');
    ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ESP);
    return (neg ? MENOS : '') + ent + (dec ? ',' + dec : '');
  };
  UL.fmtEntero = function (x) { return UL.fmt(Math.round(x), 0); };
  UL.fmtPct = function (x, d) { return isFinite(x) ? UL.fmt(100 * x, d === undefined ? 1 : d) + ' %' : '—'; };
  UL.fmtKm2 = function (x) { return isFinite(x) ? UL.fmt(x, x < 10 ? 2 : 1) + ' km²' : '—'; };

  /* ---------- Color ---------- */
  UL.hexARgb = function (h) {
    const v = parseInt(h.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  UL.rgbAHex = function (c) {
    return '#' + c.map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join('');
  };
  /** Rampa de color → tabla de 256 colores (Uint8Array RGB). */
  UL.rampa = function (paradas) {
    const lut = new Uint8Array(256 * 3);
    const p = paradas.map(function (s) { return [s[0], UL.hexARgb(s[1])]; });
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let k = 0;
      while (k < p.length - 2 && t > p[k + 1][0]) k++;
      const a = p[k], b = p[k + 1];
      const f = UL.clamp01((t - a[0]) / Math.max(1e-9, b[0] - a[0]));
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[1][c] + (b[1][c] - a[1][c]) * f);
    }
    return lut;
  };
  UL.colorLut = function (lut, t) {
    const i = Math.round(UL.clamp01(t) * 255) * 3;
    return [lut[i], lut[i + 1], lut[i + 2]];
  };
  UL.cssLut = function (lut, t) { return UL.rgbAHex(UL.colorLut(lut, t)); };

  UL.RAMPAS = {
    ndsi: UL.rampa([[0, '#2a2420'], [0.3, '#5f5246'], [0.5, '#958d82'], [0.66, '#bcd2de'], [0.82, '#e3eff6'], [1, '#ffffff']]),
    ndvi: UL.rampa([[0, '#4b3018'], [0.22, '#a9824d'], [0.38, '#e2d29b'], [0.55, '#a8cc6b'], [0.75, '#4f9a3e'], [1, '#164f24']]),
    mndwi: UL.rampa([[0, '#5c4a33'], [0.3, '#a8916b'], [0.5, '#e6dcc4'], [0.62, '#a9d3e8'], [0.8, '#3f8cc4'], [1, '#0d2f63']]),
    dnbr: UL.rampa([[0, '#145c3a'], [0.22, '#7fbf67'], [0.36, '#eeeaa6'], [0.52, '#f4a34e'], [0.72, '#c9311f'], [1, '#3f0606']]),
    nbr: UL.rampa([[0, '#3f0606'], [0.25, '#b8452a'], [0.45, '#e9c98a'], [0.65, '#8fc070'], [1, '#0f4a2a']]),
    fraccion: UL.rampa([[0, '#13202b'], [0.5, '#5f8f6e'], [1, '#f1f7d2']]),
    prob: UL.rampa([[0, '#2a1e4a'], [0.35, '#3b5f9a'], [0.65, '#3fb39a'], [1, '#f2e35c']])
  };

  /** Paleta de clases del umbral: baja (ámbar) → alta (cian), como en la U3B. */
  UL.paletaClases = function (k) {
    const P = {
      1: ['#d9b57b'],
      2: ['#d9b57b', '#58c7ec'],
      3: ['#d9b57b', '#a4c896', '#4b9fdb'],
      4: ['#d9b57b', '#b6c78d', '#68bdb3', '#3f86d3'],
      5: ['#d9b57b', '#c2c58a', '#8cc4a6', '#52acc9', '#3a75cc']
    };
    return P[Math.max(1, Math.min(5, k))];
  };

  /* Colores de la evaluación espacial */
  UL.COLOR_ERR = { vp: '#e8f3f8', vn: '#2a3a47', fp: '#f2777a', fn: '#a98bff' };
  UL.COLOR_ROL = { poblacion: '#f2c46d', calibracion: '#5fe0a8', validacion: '#f09ac6' };

  /* ---------- Fórmulas: LaTeX → MathML con Temml (incluido en js/vendor) ---------- */
  UL.tex = function (latex, bloque) {
    try {
      if (typeof temml !== 'undefined') return temml.renderToString(latex, { displayMode: bloque !== false, throwOnError: false });
    } catch (e) { /* se muestra el texto LaTeX */ }
    return '<code class="tex-crudo">' + String(latex).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code>';
  };
})(globalThis.UL = globalThis.UL || {});
