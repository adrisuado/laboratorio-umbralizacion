/* =====================================================================
   escenas.js — generador de escenas raster SINTÉTICAS.
   Cada escena se construye a partir de fracciones de cobertura por
   píxel (mezclas en los bordes), valores de extremo por clase que
   varían en el espacio, ruido y una referencia temática que sale de la
   misma geometría, nunca del umbral. Ningún valor es una observación
   satelital: son simulaciones con semilla reproducible.
   ===================================================================== */
(function (UL) {
  'use strict';
  const W = UL.W, H = UL.H, N = UL.N;
  const c01 = UL.clamp01;

  /* ------------------------------------------------------------------
     Descripción de los escenarios (lo que ve el estudiante)
     ------------------------------------------------------------------ */
  UL.ESCENARIOS = {
    A: {
      id: 'A', corto: 'Nieve y hielo', nombre: 'Nieve y hielo en alta montaña',
      contexto: 'Circo glaciar simulado entre 4300 y 5600 m, inspirado en un área de conservación andina. Hay glaciares con zona de ablación más oscura, roca con sombras, pajonal y lagunas glaciares (una de ellas al pie del hielo).',
      objetivo: 'NDSI: nieve y hielo (fracción de nieve ≥ 0,5). NDWI: lagunas glaciares (fracción de agua ≥ 0,5).',
      dificultad: 'El agua también da NDSI alto: las lagunas pasan como nieve. En el NDWI la nieve queda apenas sobre 0 y las lagunas son menos del 1 % de la escena.',
      prop: { etiqueta: 'Superficie de nieve', min: 0.03, max: 0.35, paso: 0.01, defecto: 0.12, pct: true },
      esp: { etiqueta: 'Número de lagunas', min: 0, max: 9, paso: 1, defecto: 4, entero: true },
      esp2: { etiqueta: 'Tamaño de las lagunas', min: 0.5, max: 1.8, paso: 0.05, defecto: 1, factor: true },
      defectos: { ruido: 0.03, contraste: 1, hetero: 0.5 },
      experimentos: [
        'NDSI + Otsu: compara la clasificación con la capa Referencia. ¿Qué pasa con las lagunas? Activa la regla compuesta NIR > 0,11.',
        'NDWI + corte de McFeeters (0): ¿cuánta nieve entra como agua? Prueba 0,15 (decisión local de U3A).',
        'NDWI + Otsu en toda la escena y luego en una población que solo incluya glaciar y lagunas. Agranda las lagunas y repite.',
        'Logística multinomial con solo NDSI y después con NDSI + NDWI: compara cuántas lagunas se clasifican bien.'
      ]
    },
    B: {
      id: 'B', corto: 'Valle y río', nombre: 'Valle agrícola y río',
      contexto: 'Valle costero simulado: un río estrecho con orillas húmedas y vegetación ribereña, parcelas en distintos estados (cultivo verde, joven y barbecho) y desierto con dos tipos de suelo.',
      objetivo: 'MNDWI: agua (fracción de agua ≥ 0,5). NDVI: superficie agrícola, incluido el barbecho.',
      dificultad: 'El agua ocupa cerca del 2 % de la escena y no forma un pico: el histograma completo separa dos suelos. En el NDVI, el barbecho es agrícola pero tiene valores de suelo.',
      prop: { etiqueta: 'Ancho del valle agrícola', min: 0.2, max: 0.8, paso: 0.02, defecto: 0.5, pct: true },
      esp: { etiqueta: 'Semiancho del río (px)', min: 0.8, max: 6, paso: 0.1, defecto: 1.8 },
      extras: [
        { clave: 'barbecho', etiqueta: 'Parcelas en barbecho', min: 0, max: 0.8, paso: 0.01, defecto: 0.32, pct: true },
        { clave: 'joven', etiqueta: 'Cultivo joven (de lo sembrado)', min: 0, max: 1, paso: 0.01, defecto: 0.25 / 0.68, pct: true },
        { clave: 'ribera', etiqueta: 'Orilla y vegetación ribereña', min: 0, max: 2, paso: 0.05, defecto: 1, factor: true }
      ],
      defectos: { ruido: 0.025, contraste: 1, hetero: 0.6 },
      experimentos: [
        'MNDWI + Otsu sobre toda la escena: ¿cuánta “agua” marca? Dibuja un polígono de población alrededor del río y compara.',
        'MNDWI + GMM con K = 2: la componente pequeña y ancha encuentra la minoría sin cambiar la población.',
        'NDVI + Youden y F1 con muestras aleatorias y estratificadas: ¿cuál cambia con la prevalencia?',
        'NDVI + Otsu: sube las parcelas en barbecho y mira cómo crecen las omisiones en la capa Aciertos y errores. Repite con más cultivo joven.',
        'MNDWI + Otsu en una población alrededor del río: lleva la orilla y la vegetación ribereña a 0 y compara los falsos positivos.'
      ]
    },
    C: {
      id: 'C', corto: 'Incendio', nombre: 'Zona seca e incendio forestal',
      contexto: 'Ladera simulada con bosque y matorral en la parte baja y puna en la alta. Entre la fecha previa y la posterior hubo un incendio y, además, la puna se secó por la estación.',
      objetivo: 'Superficie quemada (fracción quemada ≥ 0,5). En NBR posterior la clase está en los valores BAJOS.',
      dificultad: 'Dos procesos suben el dNBR: el fuego y el secado estacional. Un umbral estadístico mide cambio espectral, no severidad.',
      prop: { etiqueta: 'Extensión del incendio', min: 0.02, max: 0.3, paso: 0.01, defecto: 0.045, pct: true },
      esp: { etiqueta: 'Secado de la puna (Δ NBR)', min: 0, max: 0.32, paso: 0.01, defecto: 0.17 },
      defectos: { ruido: 0.035, contraste: 1, hetero: 0.5 },
      experimentos: [
        'dNBR + Otsu: mira la capa Aciertos y errores. ¿Dónde están los falsos positivos?',
        'Baja el secado de la puna a 0 y vuelve a subirlo: ¿cuánto se mueve el umbral de Otsu y el de Key y Benson (0,27)?',
        'Calibración biofísica con z₀ = 0,5: compara el umbral físico con Otsu y Youden en la tabla de enfoques.'
      ]
    },
    D: {
      id: 'D', corto: 'Vegetación', nombre: 'Cobertura vegetal heterogénea',
      contexto: 'Mosaico simulado de matorral y pastos con densidades distintas, suelo expuesto, senderos y matas pequeñas. La cobertura vegetal (FVC) varía de forma continua y casi todos los píxeles son mezclas. Se simulan las bandas azul, roja e infrarroja para calcular NDVI, SAVI y EVI.',
      objetivo: 'Cuatro clases ordinales de cobertura (suelo, escasa, moderada, densa) y, en binario, cobertura ≥ 40 %.',
      dificultad: 'El NDVI se satura en dosel denso y cambia con el brillo del suelo. SAVI amortigua el suelo con L y EVI conserva más sensibilidad en coberturas altas, pero ninguno coincide exactamente con los cortes de cobertura.',
      prop: { etiqueta: 'Cobertura vegetal media', min: 0.12, max: 0.7, paso: 0.01, defecto: 0.38, pct: true },
      esp: { etiqueta: 'Brillo del suelo', min: 0, max: 1, paso: 0.05, defecto: 0.4 },
      esp2: { etiqueta: 'Saturación del dosel', min: 0, max: 1, paso: 0.05, defecto: 0.6 },
      defectos: { ruido: 0.025, contraste: 1, hetero: 0.6 },
      experimentos: [
        'Sube el brillo del suelo y compara el umbral de Otsu en NDVI y en SAVI con L = 0,5 y L = 1.',
        'Multi-Otsu con 4 clases en NDVI, SAVI y EVI: ¿cuál acierta más en la matriz por clase?',
        'Calibración lineal con NDVI y con EVI: ¿cuál tiene residuos más rectos al subir la saturación del dosel?',
        'Percentiles: cambia la cobertura media y observa que el área sobre el p75 no cambia.'
      ]
    }
  };

  /* ------------------------------------------------------------------
     Utilidades de construcción
     ------------------------------------------------------------------ */
  function minMax01(a) {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < a.length; i++) { if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; }
    const r = mx - mn || 1;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) / r;
    return a;
  }
  function contraste(mu, centro, c) { return centro + (mu - centro) * c; }
  /* índice del mayor (el primero si empatan), sin crear arreglos por píxel */
  function argmax4(a, b, c, d) {
    let k = 0, m = a;
    if (b > m) { k = 1; m = b; } if (c > m) { k = 2; m = c; } if (d > m) { k = 3; }
    return k;
  }
  function argmax6(a, b, c, d, e, g) {
    let k = 0, m = a;
    if (b > m) { k = 1; m = b; } if (c > m) { k = 2; m = c; } if (d > m) { k = 3; m = d; } if (e > m) { k = 4; m = e; } if (g > m) { k = 5; }
    return k;
  }

  /* ==================================================================
     Escenario A — Nieve y hielo (NDSI)
     ================================================================== */
  function escenaA(s) {
    const sd = s.semilla, rng = UL.crearRng(sd, 11), rn = UL.flujoNormal(sd, 12);
    const picos = [];
    for (let k = 0; k < 3; k++) picos.push({ x: W * (0.15 + 0.7 * rng()), y: H * (0.1 + 0.32 * rng()), s: 26 + 22 * rng(), a: 1.0 + 0.8 * rng() });
    /* el relieve solo depende de la semilla: se calcula una vez y se reutiliza
       al mover los demás controles (lagunas, nieve, ruido...) */
    const rel = UL.memo('A-relieve|' + sd, function () {
      const base = UL.campo(sd, 1, 110, 5, 0.5);
      const cres = UL.campo(sd, 2, 64, 4, 0.5);
      const dem = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let v = 0.5 * base[i] - 0.55 * Math.abs(cres[i]) + 1.5 * (1 - y / H);
        for (const p of picos) { const d2 = (x - p.x) ** 2 + (y - p.y) ** 2; v += p.a * Math.exp(-d2 / (2 * p.s * p.s)); }
        dem[i] = v;
      }
      minMax01(dem);
      return { dem: dem, grad: UL.gradiente(dem), ilum: UL.sombreado(dem, 70), ord: UL.ordenar(dem) };
    });
    const dem = rel.dem, grad = rel.grad, ilum = rel.ilum;
    const ondula = UL.campo(sd, 3, 6, 2, 0.5);
    const cota = UL.cuantilOrdenado(rel.ord, 1 - s.prop);

    const fs = new Float32Array(N), prof = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let d = (dem[i] - cota) / Math.max(grad[i], 2e-4) + 0.6 * ondula[i];
      d = UL.clamp(d, -60, 60);
      fs[i] = c01(0.5 + d / 1.1);
      prof[i] = Math.max(0, d);
    }

    /* Lagunas: bajo la cota de nieve, separadas entre sí; una pegada al glaciar */
    const fw = new Float32Array(N), clar = new Float32Array(N); /* claridad del agua: 0 turbia, 1 clara y profunda */
    const bordeL = UL.campo(sd, 4, 5, 2, 0.5);
    const nL = Math.round(s.esp), lagunas = [];
    const tam = UL.clamp(s.esp2 === undefined ? 1 : s.esp2, 0.5, 1.8); /* factor de tamaño acotado */
    let intentos = 0;
    while (lagunas.length < nL && intentos < 4000) {
      intentos++;
      const x = 6 + rng() * (W - 12), y = 6 + rng() * (H - 12), i = (y | 0) * W + (x | 0);
      const proglaciar = lagunas.length === 0 && intentos < 1500;
      const lo = cota - (proglaciar ? 0.035 : 0.12), hi = cota - (proglaciar ? 0.004 : 0.02);
      if (dem[i] < lo || dem[i] > hi || fs[i] > 0) continue;
      if (lagunas.some(function (l) { return Math.hypot(l.x - x, l.y - y) < 16 * Math.max(1, tam); })) continue;
      const rx = (2.6 + 3.6 * rng()) * tam;
      lagunas.push({ x: x, y: y, rx: rx, ry: rx * (0.5 + 0.4 * rng()), a: rng() * Math.PI, t: rng() });
    }
    for (const L of lagunas) {
      const R = Math.max(L.rx, L.ry) + 3, ca = Math.cos(L.a), sa = Math.sin(L.a);
      for (let y = Math.max(0, Math.floor(L.y - R)); y <= Math.min(H - 1, Math.ceil(L.y + R)); y++) {
        for (let x = Math.max(0, Math.floor(L.x - R)); x <= Math.min(W - 1, Math.ceil(L.x + R)); x++) {
          const i = y * W + x, dx = x + 0.5 - L.x, dy = y + 0.5 - L.y;
          const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
          const de = Math.sqrt((u / L.rx) ** 2 + (v / L.ry) ** 2);
          const borde = (1 - de) * (L.rx + L.ry) / 2 + 0.7 * bordeL[i];
          const f = c01(0.5 + borde / 0.9);
          if (f > fw[i]) { fw[i] = f; clar[i] = UL.clamp01(0.7 * L.t + 0.3 * (1 - de)); }
        }
      }
    }
    for (let i = 0; i < N; i++) fs[i] = fs[i] * (1 - fw[i]);

    /* Pajonal en cotas bajas, roca en el resto */
    const vq = UL.cuantilOrdenado(rel.ord, 0.42), veg = UL.campo(sd, 5, 20, 3, 0.5);
    const fv = new Float32Array(N), fr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const f0 = c01(0.5 + (vq - dem[i]) * 40 + 0.5 * veg[i]);
      fv[i] = f0 * (1 - fs[i] - fw[i]);
      fr[i] = Math.max(0, 1 - fs[i] - fw[i] - fv[i]);
    }

    const h1 = UL.campo(sd, 6, 50, 3, 0.5), h2 = UL.campo(sd, 7, 24, 3, 0.5), tex = UL.campo(sd, 8, 4, 2, 0.5);
    const c = s.contraste, het = s.hetero, ctr = -0.5;
    const I = new Float32Array(N), nir = new Float32Array(N), verde = new Float32Array(N), ndwi = new Float32Array(N), clases = new Uint8Array(N);
    const rn2 = UL.flujoNormal(sd, 13), ctrW = -0.3;
    for (let i = 0; i < N; i++) {
      const mS = contraste(0.84 - 0.3 * Math.exp(-prof[i] / 3.5) + 0.035 * het * h1[i], ctr, c);
      const mW = contraste(0.3 + 0.55 * clar[i] + 0.05 * het * h2[i], ctr, c);
      const mR = contraste(-0.4 + 0.12 * het * h1[i] + 0.3 * Math.max(0, 0.42 - ilum[i]), ctr, c);
      const mV = contraste(-0.63 + 0.06 * het * h2[i], ctr, c);
      let v = fs[i] * mS + fw[i] * mW + fr[i] * mR + fv[i] * mV + 0.02 * tex[i] + s.ruido * rn.normal();
      I[i] = UL.clamp(v, -1, 1);
      const ilf = 0.5 + 0.5 * ilum[i];
      nir[i] = Math.max(0, fs[i] * (0.62 + 0.04 * h1[i]) * ilf + fw[i] * 0.04 + fr[i] * 0.22 * ilf + fv[i] * 0.28 * ilf + 0.008 * rn.normal());
      /* banda verde: nieve brillante; el agua turbia refleja más verde y más NIR que la clara */
      const gS = (0.68 - 0.2 * Math.exp(-prof[i] / 3.5) + 0.03 * h1[i]) * ilf;
      const nS = (0.64 - 0.2 * Math.exp(-prof[i] / 3.5) + 0.04 * h1[i]) * ilf;
      verde[i] = Math.max(0.005, fs[i] * gS + fw[i] * (0.11 - 0.05 * clar[i]) + fr[i] * (0.13 + 0.02 * het * h1[i]) * ilf + fv[i] * 0.08 * ilf + 0.012 + 0.006 * rn2.normal());
      const nirW = Math.max(0.005, fs[i] * nS + fw[i] * (0.05 - 0.04 * clar[i]) + fr[i] * 0.22 * ilf + fv[i] * 0.28 * ilf + 0.004 + 0.006 * rn2.normal());
      const w0 = (verde[i] - nirW) / (verde[i] + nirW);
      ndwi[i] = UL.clamp(ctrW + (w0 - ctrW) * c + 0.4 * s.ruido * rn2.normal(), -1, 1);
      clases[i] = 1 + argmax4(fs[i], fw[i], fr[i], fv[i]);
    }
    return {
      id: 'A', clases: clases, relieve: ilum,
      altitud: dem.map(function (v) { return 4300 + 1300 * v; }),
      leyenda: [
        { id: 1, nombre: 'Nieve y hielo', color: '#eef7fc' },
        { id: 2, nombre: 'Laguna', color: '#2f78c4' },
        { id: 3, nombre: 'Roca y morrena', color: '#8b8178' },
        { id: 4, nombre: 'Pajonal', color: '#9aa65a' }
      ],
      confusoras: { 2: 'laguna' },
      extra: { NIR: nir, verde: verde },
      variables: {
        NDSI: {
          clave: 'NDSI', nombre: 'NDSI', valores: I, dir: 1, rangoVis: [-0.8, 1], rampa: 'ndsi',
          objetivo: 'Nieve y hielo', Z: fs, zRef: 0.5, zNombre: 'fracción de nieve',
          formula: 'NDSI = (G − S1) / (G + S1)', bandas: 'OLI: B3, B6 · MSI: B3, B11', autor: 'Hall et al. (1995)',
          nota: 'Misma fórmula que el MNDWI: el agua también da valores altos.',
          confusoras: { 2: 'laguna' },
          literatura: [{ t: 0.4, ref: 'Hall et al. (1995)' }]
        },
        NDWI: {
          clave: 'NDWI', nombre: 'NDWI', valores: ndwi, dir: 1, rangoVis: [-0.7, 0.8], rampa: 'mndwi',
          objetivo: 'Lagunas glaciares', Z: fw, zRef: 0.5, zNombre: 'fracción de agua',
          formula: 'NDWI = (G − N) / (G + N)', bandas: 'OLI: B3, B5 · MSI: B3, B8', autor: 'McFeeters (1996)',
          nota: 'El agua absorbe el NIR. La nieve refleja verde y NIR casi por igual y queda cerca de 0. No confundir con el NDWI de Gao (N − S1).',
          confusoras: { 1: 'nieve' },
          literatura: [{ t: 0, ref: 'McFeeters (1996)' }, { t: 0.15, ref: 'decisión local U3A' }]
        }
      },
      varDefecto: 'NDSI'
    };
  }

  /* ==================================================================
     Escenario B — Valle agrícola y río (NDVI y MNDWI)
     ================================================================== */
  function escenaB(s) {
    const sd = s.semilla, rng = UL.crearRng(sd, 21), rn = UL.flujoNormal(sd, 22);
    const nA = UL.campo(sd, 21, 50, 3, 0.5), nB = UL.campo(sd, 22, 30, 3, 0.5);
    const fase = rng() * Math.PI * 2;
    const cx = new Float32Array(H), rw = new Float32Array(H), vw = new Float32Array(H), rr = new Float32Array(H), pend = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      cx[y] = W * 0.5 + 24 * Math.sin(2 * Math.PI * (y / H) * 0.9 + fase) + 10 * nA[y * W + 64];
      rw[y] = s.esp * (1 + 0.22 * nB[y * W + 32]);
      vw[y] = s.prop * W * 0.5 * (1 + 0.1 * nB[y * W + 200]);
      rr[y] = Math.max(1.2, 3.2 + 1.4 * nA[y * W + 180]);
    }
    for (let y = 0; y < H; y++) pend[y] = (cx[Math.min(H - 1, y + 1)] - cx[Math.max(0, y - 1)]) / 2;

    /* Pozas cerca del río */
    const pozas = [];
    for (let k = 0; k < 3; k++) {
      const y = 10 + rng() * (H - 20), lado = rng() < 0.5 ? -1 : 1;
      const d = rw[y | 0] + 7 + rng() * Math.max(4, vw[y | 0] * 0.4);
      pozas.push({ x: cx[y | 0] + lado * d, y: y, r: 1.3 + rng() * 1.2 });
    }

    const tPar = 0.25 + 0.3 * rng(), ct = Math.cos(tPar), st = Math.sin(tPar);
    const pw = 11 + 4 * rng(), ph = 7 + 3 * rng();
    const suelo = UL.campo(sd, 23, 60, 3, 0.5), h2 = UL.campo(sd, 24, 18, 3, 0.5), tex = UL.campo(sd, 25, 4, 2, 0.5);
    const relieve0 = UL.campo(sd, 26, 40, 4, 0.5);
    const het = s.hetero, c = s.contraste;
    const pBar = s.barbecho === undefined ? 0.32 : s.barbecho, pJov = s.joven === undefined ? 0.25 / 0.68 : s.joven;
    const kRib = s.ribera === undefined ? 1 : s.ribera;

    const ndvi = new Float32Array(N), mndwi = new Float32Array(N), Zag = new Float32Array(N), Zw = new Float32Array(N);
    const clases = new Uint8Array(N), elev = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const den = Math.sqrt(1 + pend[y] * pend[y]);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const dist = Math.abs(x + 0.5 - cx[y]) / den;
        let fw = c01(0.5 + (rw[y] - dist) / 1.0);
        for (const p of pozas) {
          const dx = x + 0.5 - p.x, dy = y + 0.5 - p.y, lim = p.r + 0.5;
          if (dx * dx + dy * dy < lim * lim) fw = Math.max(fw, c01(0.5 + (p.r - Math.hypot(dx, dy)) / 0.9)); /* lejos de la poza su aporte es 0 */
        }
        const fwet = kRib > 0 ? Math.max(0, c01(0.5 + (rw[y] + 1.6 * kRib - dist) / 1.0) - fw) : 0;
        const frib = kRib > 0 ? Math.max(0, c01(0.5 + (rw[y] + rr[y] * kRib - dist) / 1.2) - fw - fwet) : 0;
        const fval = c01(0.5 + (vw[y] - dist) / 2.0);
        const fagR = Math.max(0, fval - fw - fwet - frib);
        const fdes = Math.max(0, 1 - fw - fwet - frib - fagR);

        /* parcelas en una grilla girada */
        const ux = x - W / 2, uy = y - H / 2;
        const u = ux * ct + uy * st, v = -ux * st + uy * ct;
        const fila = Math.floor(v / ph);
        const u2 = u + ((UL.hash32(sd, fila * 7919) % 1000) / 1000) * pw;
        const col = Math.floor(u2 / pw);
        const hP = UL.hash32(sd + 17, fila * 10007 + col * 31 + 5);
        const rP = (hP % 10000) / 10000, oP = ((hP >>> 14) % 1000) / 1000 - 0.5, oM = ((hP >>> 4) % 1000) / 1000 - 0.5;
        /* estado de la parcela: barbecho si rP ≥ 1 − pBar; de lo sembrado, joven en la fracción pJov */
        const estado = rP >= 1 - pBar ? 2 : rP / Math.max(1e-9, 1 - pBar) >= 1 - pJov ? 1 : 0; // verde, joven, barbecho
        const fu = u2 / pw - col, fvv = v / ph - fila;
        const camino = Math.max(c01(0.5 + (0.06 * pw - Math.min(fu, 1 - fu) * pw) / 0.8), c01(0.5 + (0.06 * ph - Math.min(fvv, 1 - fvv) * ph) / 0.8));
        const fcam = fagR * camino, fcul = fagR * (1 - camino);

        const tS = c01(0.5 + 1.2 * suelo[i]);
        const dS = 0.3 + 0.7 * het;
        /* firmas por cobertura (escalares: sin objetos ni arreglos por píxel) */
        const ndRib = 0.6 + 0.05 * het * h2[i], ndDes = 0.1 - 0.03 * tS * dS;
        const ndCul = estado === 0 ? 0.72 + 0.1 * oP : estado === 1 ? 0.38 + 0.12 * oP : 0.15 + 0.04 * oP;
        const mwAgua = 0.2 + 0.06 * het * h2[i], mwDes = -0.25 - 0.09 * (tS - 0.5) * dS;
        const mwCul = estado === 0 ? -0.44 + 0.06 * oM : estado === 1 ? -0.37 + 0.06 * oM : -0.27 + 0.05 * oM;
        const cN = 0.12, cM = -0.3;
        let vN = fw * contraste(-0.06, cN, c) + fwet * contraste(0.18, cN, c) + frib * contraste(ndRib, cN, c) + fcul * contraste(ndCul, cN, c) + fcam * contraste(0.11, cN, c) + fdes * contraste(ndDes, cN, c);
        let vM = fw * contraste(mwAgua, cM, c) + fwet * contraste(-0.06, cM, c) + frib * contraste(-0.3, cM, c) + fcul * contraste(mwCul, cM, c) + fcam * contraste(-0.26, cM, c) + fdes * contraste(mwDes, cM, c);
        vN += 0.012 * tex[i] + s.ruido * rn.normal();
        vM += 0.012 * tex[i] + s.ruido * rn.normal();
        ndvi[i] = UL.clamp(vN, -1, 1);
        mndwi[i] = UL.clamp(vM, -1, 1);
        Zag[i] = fcul;
        Zw[i] = fw;
        clases[i] = 1 + argmax6(fw, fwet + frib, estado === 0 ? fcul : 0, estado === 1 ? fcul : 0, estado === 2 ? fcul : 0, fdes + fcam);
        elev[i] = 0.25 * c01((dist - vw[y]) / 40) + 0.12 * c01((dist - vw[y]) / 10) * (relieve0[i] * 0.5 + 0.5) + 0.01 * relieve0[i];
      }
    }
    return {
      id: 'B', clases: clases, relieve: UL.memo('B-somb|' + sd + '|' + s.prop, function () { return UL.sombreado(elev, 60); }),
      altitud: elev.map(function (v) { return 320 + 900 * v; }),
      leyenda: [
        { id: 1, nombre: 'Agua (río y pozas)', color: '#2f78c4' },
        { id: 2, nombre: 'Orilla y vegetación ribereña', color: '#3f8a5a' },
        { id: 3, nombre: 'Cultivo verde', color: '#6fbf3f' },
        { id: 4, nombre: 'Cultivo joven', color: '#c4d66b' },
        { id: 5, nombre: 'Barbecho (agrícola)', color: '#b98b5a' },
        { id: 6, nombre: 'Desierto y caminos', color: '#e2cfa6' }
      ],
      confusoras: { 2: 'ribera', 5: 'barbecho' },
      extra: {},
      variables: {
        MNDWI: {
          clave: 'MNDWI', nombre: 'MNDWI', valores: mndwi, dir: 1, rangoVis: [-0.7, 0.6], rampa: 'mndwi',
          objetivo: 'Agua', Z: Zw, zRef: 0.5, zNombre: 'fracción de agua',
          formula: 'MNDWI = (G − S1) / (G + S1)', bandas: 'OLI: B3, B6 · MSI: B3, B11', autor: 'Xu (2006)',
          nota: 'Sustituye el NIR por el SWIR de 1,6 µm. El suelo húmedo de las orillas también sube.',
          literatura: [{ t: 0, ref: 'Xu (2006)' }]
        },
        NDVI: {
          clave: 'NDVI', nombre: 'NDVI', valores: ndvi, dir: 1, rangoVis: [-0.2, 0.9], rampa: 'ndvi',
          objetivo: 'Superficie agrícola', Z: Zag, zRef: 0.5, zNombre: 'fracción agrícola',
          formula: 'NDVI = (N − R) / (N + R)', bandas: 'OLI: B5, B4 · MSI: B8, B4', autor: 'Rouse et al. (1974)',
          nota: 'El barbecho es uso agrícola con NDVI de suelo; la ribera es verde pero no agrícola.',
          literatura: [{ t: 0.2, ref: 'tabla fija de U3A' }]
        }
      },
      varDefecto: 'MNDWI'
    };
  }

  /* ==================================================================
     Escenario C — Zona seca e incendio (NBR, dNBR)
     ================================================================== */
  function escenaC(s) {
    const sd = s.semilla, rng = UL.crearRng(sd, 31), rn = UL.flujoNormal(sd, 32);
    const rel = UL.memo('C-relieve|' + sd, function () {
      const base = UL.campo(sd, 31, 90, 5, 0.5), cres = UL.campo(sd, 36, 50, 3, 0.5);
      const dem = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        dem[i] = 0.6 * base[i] - 0.35 * Math.abs(cres[i]) + 1.6 * (x / W) + 0.4 * (1 - y / H);
      }
      minMax01(dem);
      return { dem: dem, ilum: UL.sombreado(dem, 55), grad: UL.gradiente(dem), qP: UL.cuantil(dem, 0.55) };
    });
    const dem = rel.dem, ilum = rel.ilum, grad = rel.grad;
    const qP = rel.qP, nP = UL.campo(sd, 37, 12, 3, 0.5);
    const fp = new Float32Array(N);
    for (let i = 0; i < N; i++) fp[i] = c01(0.5 + (dem[i] - qP) / Math.max(grad[i], 3e-4) / 2.5 + 0.45 * nP[i]);

    /* Ignición en la ladera boscosa, propagación hacia arriba */
    let ix = W * 0.4, iy = H * 0.5;
    for (let k = 0; k < 3000; k++) {
      const x = 20 + rng() * (W - 40), y = 20 + rng() * (H - 40), i = (y | 0) * W + (x | 0);
      if (dem[i] > qP - 0.16 && dem[i] < qP - 0.03) { ix = x; iy = y; break; }
    }
    const ii = (iy | 0) * W + (ix | 0);
    let gx = dem[ii + 1] - dem[ii - 1], gy = dem[ii + W] - dem[ii - W];
    const gn = Math.hypot(gx, gy) || 1; gx /= gn; gy /= gn;
    const R = Math.sqrt(s.prop * N / Math.PI) * 0.92;
    const focos = [{ x: ix + gx * 0.3 * R, y: iy + gy * 0.3 * R, R: R }];
    focos.push({ x: ix + gx * 1.75 * R + gy * 0.4 * R, y: iy + gy * 1.75 * R - gx * 0.4 * R, R: 0.28 * R });
    const bn = UL.campo(sd, 33, 14, 3, 0.5), isl = UL.campo(sd, 34, 5, 2, 0.5), sv = UL.campo(sd, 35, 10, 3, 0.5);
    const fb = new Float32Array(N), sev = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let mejor = 0, borde = -1e9, Rf = R, rel = -1e9;
      for (const f of focos) {
        const dx = x + 0.5 - f.x, dy = y + 0.5 - f.y;
        const al = dx * gx + dy * gy, ac = -dx * gy + dy * gx;
        const d = Math.sqrt((al / 1.35) ** 2 + (ac / 0.8) ** 2);
        const e = f.R * (1 + 0.28 * bn[i]) - d;
        const v = c01(0.5 + e / 1.2);
        if (e / f.R > rel) { rel = e / f.R; mejor = v; borde = e; Rf = f.R; }
      }
      if (isl[i] > 1.45) mejor *= 0.12;
      fb[i] = mejor;
      sev[i] = c01(0.32 + 0.55 * c01(borde / Rf) + 0.22 * sv[i]);
    }

    const h1 = UL.campo(sd, 38, 45, 3, 0.5), h2 = UL.campo(sd, 39, 20, 3, 0.5), tex = UL.campo(sd, 40, 4, 2, 0.5);
    const het = s.hetero, c = s.contraste, seca = s.esp, ctr = 0.05;
    const dnbr = new Float32Array(N), post = new Float32Array(N), clases = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const pre = fp[i] * (0.2 + 0.05 * het * h2[i]) + (1 - fp[i]) * (0.5 + 0.07 * het * h1[i]) + 0.04 * (ilum[i] - 0.6);
      const alto = c01((dem[i] - qP) / 0.25);
      const dBg = fp[i] * (seca * (0.62 + 0.38 * alto) + 0.04 * het * h1[i]) + (1 - fp[i]) * (0.02 + 0.03 * het * h2[i]);
      const dB = 0.1 + 0.62 * sev[i] + fp[i] * seca * 0.5;
      let d = fb[i] * contraste(dB, ctr, c) + (1 - fb[i]) * contraste(dBg, ctr, c) + 0.015 * tex[i] + s.ruido * rn.normal();
      d = UL.clamp(d, -1, 1.5);
      dnbr[i] = d;
      post[i] = UL.clamp(pre - d + 0.5 * s.ruido * rn.normal(), -1, 1);
      clases[i] = fb[i] >= 0.5 ? 1 : fp[i] >= 0.5 ? 3 : 2;
    }
    return {
      id: 'C', clases: clases, relieve: ilum,
      altitud: dem.map(function (v) { return 2400 + 2000 * v; }),
      leyenda: [
        { id: 1, nombre: 'Quemado', color: '#c3361f' },
        { id: 2, nombre: 'Bosque y matorral', color: '#2f7a46' },
        { id: 3, nombre: 'Puna (secado estacional)', color: '#d9bd6a' }
      ],
      confusoras: { 3: 'puna' },
      extra: { severidad: sev },
      variables: {
        dNBR: {
          clave: 'dNBR', nombre: 'dNBR', valores: dnbr, dir: 1, rangoVis: [-0.3, 0.9], rampa: 'dnbr',
          objetivo: 'Superficie quemada', Z: fb, zRef: 0.5, zNombre: 'fracción quemada',
          formula: 'NBR = (N − S2) / (N + S2) · dNBR = NBR antes − NBR después', bandas: 'OLI: B5, B7 · MSI: B8, B12', autor: 'Key y Benson (2006)',
          nota: 'Mide cambio de reflectancia, no daño ecológico: el secado estacional también lo sube.',
          literatura: [{ t: 0.1, ref: 'Key y Benson: baja' }, { t: 0.27, ref: 'Key y Benson: moderada-baja' }, { t: 0.44, ref: 'Key y Benson: moderada-alta' }]
        },
        NBRpost: {
          clave: 'NBRpost', nombre: 'NBR posterior', valores: post, dir: -1, rangoVis: [-0.5, 0.8], rampa: 'nbr',
          objetivo: 'Superficie quemada (valores bajos)', Z: fb, zRef: 0.5, zNombre: 'fracción quemada',
          formula: 'NBR = (N − S2) / (N + S2), fecha posterior', bandas: 'OLI: B5, B7 · MSI: B8, B12', autor: 'Key y Benson (2006)',
          nota: 'La clase está en los valores bajos: se clasifica con I ≤ t.',
          literatura: [{ t: 0, ref: 'superficie carbonizada: NBR < 0' }]
        }
      },
      varDefecto: 'dNBR'
    };
  }

  /* ==================================================================
     Escenario D — Cobertura vegetal heterogénea (NDVI multiclase)
     ================================================================== */
  UL.CORTES_FVC = [0.15, 0.4, 0.65];
  function escenaD(s) {
    const sd = s.semilla, rng = UL.crearRng(sd, 41), rn = UL.flujoNormal(sd, 42);
    const base = UL.campo(sd, 41, 48, 5, 0.55), matas = UL.campo(sd, 42, 7, 2, 0.5);
    const sueloC = UL.campo(sd, 43, 30, 3, 0.5), h1 = UL.campo(sd, 44, 40, 3, 0.5), tex = UL.campo(sd, 45, 3, 1, 0.5);
    const het = s.hetero;
    const z = new Float32Array(N);
    for (let i = 0; i < N; i++) z[i] = base[i] + (0.3 + 0.9 * het) * 0.6 * matas[i];
    /* senderos sinuosos */
    const sendero = new Float32Array(N);
    for (let k = 0; k < 2; k++) {
      const y0 = H * (0.2 + 0.6 * rng()), a = 8 + 10 * rng(), f = 1 + 2 * rng(), ph = rng() * 6.28, ang = (rng() - 0.5) * 0.6;
      for (let x = 0; x < W; x++) {
        const yc = y0 + a * Math.sin(2 * Math.PI * f * x / W + ph) + ang * (x - W / 2);
        for (let y = Math.max(0, Math.floor(yc - 3)); y <= Math.min(H - 1, Math.ceil(yc + 3)); y++) {
          const i = y * W + x;
          sendero[i] = Math.max(sendero[i], c01(0.5 + (0.9 - Math.abs(y + 0.5 - yc)) / 0.8));
        }
      }
    }
    /* desplazamiento para que la FVC media sea la pedida */
    function fvc(i, sh) { return (1 / (1 + Math.exp(-1.8 * (z[i] + sh)))) * (1 - sendero[i]); }
    /* (solo depende de la semilla y de la cobertura media: se recuerda) */
    const sh = UL.memo('D-sh|' + sd + '|' + s.prop, function () {
      let lo = -6, hi = 6;
      for (let it = 0; it < 40; it++) {
        const m = (lo + hi) / 2;
        let acc = 0;
        for (let i = 0; i < N; i += 3) acc += fvc(i, m);
        if (acc / Math.ceil(N / 3) < s.prop) lo = m; else hi = m;
      }
      return (lo + hi) / 2;
    });
    /* Modelo de dosel semiempírico: ρ = ρ_suelo·(1 − FVC)^(2k) + ρ_dosel·[1 − (1 − FVC)^(2k)].
       El rojo (k alto) se satura antes que el NIR (k bajo): de ahí la saturación del NDVI. */
    const brillo = s.esp, sat = s.esp2 === undefined ? 0.6 : s.esp2, c = s.contraste;
    const kR = 0.45 + 0.75 * sat, kN = 0.3, sig = s.ruido * 0.15;
    const Rb = new Float32Array(N), Nb = new Float32Array(N), Bb = new Float32Array(N);
    const ndvi = new Float32Array(N), evi = new Float32Array(N), F = new Float32Array(N), ord = new Uint8Array(N), clases = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const f = fvc(i, sh);
      F[i] = f;
      const sR = 0.07 + 0.14 * brillo + 0.035 * het * sueloC[i];
      const sN = 1.15 * sR + 0.02, sB = 0.55 * sR + 0.01;
      const vR = sR + (0.03 - sR) * c, vN = sN + (0.42 + 0.03 * h1[i] - sN) * c, vB = sB + (0.02 - sB) * c;
      const q = 1 - Math.min(f, 0.995), eR = Math.pow(q, 2 * kR), eN = Math.pow(q, 2 * kN);
      const r = Math.max(0.003, sR * eR + vR * (1 - eR) + sig * rn.normal());
      const n = Math.max(0.003, sN * eN + vN * (1 - eN) + 0.004 * tex[i] + sig * rn.normal());
      const b = Math.max(0.002, sB * eR + vB * (1 - eR) + sig * rn.normal());
      Rb[i] = r; Nb[i] = n; Bb[i] = b;
      ndvi[i] = UL.clamp((n - r) / (n + r), -1, 1);
      evi[i] = UL.clamp(2.5 * (n - r) / (n + 6 * r - 7.5 * b + 1), -1, 1.5);
      const o = f < UL.CORTES_FVC[0] ? 0 : f < UL.CORTES_FVC[1] ? 1 : f < UL.CORTES_FVC[2] ? 2 : 3;
      ord[i] = o;
      clases[i] = o + 1;
    }
    const L = s.L === undefined ? 0.5 : s.L;
    const comun = { dir: 1, rampa: 'ndvi', objetivo: 'Cobertura vegetal ≥ 40 %', Z: F, zRef: 0.4, zNombre: 'cobertura vegetal (FVC)' };
    return {
      id: 'D', clases: clases, relieve: null, altitud: null,
      leyenda: [
        { id: 1, nombre: 'Suelo expuesto (FVC < 15 %)', color: '#c9a978' },
        { id: 2, nombre: 'Vegetación escasa (15–40 %)', color: '#d8d48a' },
        { id: 3, nombre: 'Vegetación moderada (40–65 %)', color: '#86b85a' },
        { id: 4, nombre: 'Vegetación densa (≥ 65 %)', color: '#2f7a3a' }
      ],
      confusoras: {},
      ordinal: { clases: ord, k: 4, nombres: ['Suelo', 'Escasa', 'Moderada', 'Densa'] },
      extra: { bandas: { R: Rb, N: Nb, B: Bb } },
      variables: {
        NDVI: Object.assign({}, comun, {
          clave: 'NDVI', nombre: 'NDVI', valores: ndvi, rangoVis: [-0.1, 0.95],
          formula: 'NDVI = (N − R) / (N + R)', bandas: 'OLI: B5, B4 · MSI: B8, B4', autor: 'Rouse et al. (1974)',
          nota: 'Se satura en dosel denso y cambia con el brillo del suelo.',
          literatura: [{ t: 0.2, ref: 'U3A: 0,2' }, { t: 0.4, ref: 'U3A: 0,4' }, { t: 0.6, ref: 'U3A: 0,6' }]
        }),
        SAVI: Object.assign({}, comun, {
          clave: 'SAVI', nombre: 'SAVI', valores: UL.calcularSAVI({ R: Rb, N: Nb }, L), rangoVis: [-0.1, 0.9], L: L,
          formula: 'SAVI = (1 + L)(N − R) / (N + R + L)', bandas: 'OLI: B5, B4 · MSI: B8, B4', autor: 'Huete (1988)',
          nota: 'L amortigua el suelo: ≈ 0–0,25 en dosel denso, 0,5 de referencia, 0,5–1 en cobertura escasa. Con L = 0 es el NDVI.',
          literatura: []
        }),
        EVI: Object.assign({}, comun, {
          clave: 'EVI', nombre: 'EVI', valores: evi, rangoVis: [-0.1, 0.9],
          formula: 'EVI = 2,5 (N − R) / (N + 6R − 7,5B + 1)', bandas: 'OLI: B5, B4, B2 · MSI: B8, B4, B2', autor: 'Huete et al. (2002)',
          nota: 'Coeficientes estándar G = 2,5; C1 = 6; C2 = 7,5; L = 1. Más sensible en dosel denso; no está acotado a [−1, 1].',
          literatura: []
        })
      },
      varDefecto: 'NDVI'
    };
  }

  /** SAVI a partir de las bandas roja y NIR con el factor L. */
  UL.calcularSAVI = function (b, L) {
    const out = new Float32Array(b.R.length);
    for (let i = 0; i < out.length; i++) out[i] = UL.clamp((1 + L) * (b.N[i] - b.R[i]) / (b.N[i] + b.R[i] + L), -1, 1);
    return out;
  };

  /** Recalcula el SAVI de una escena D con otro L (sin regenerar la escena). */
  UL.recalcularSAVI = function (e, L) {
    const v = e.variables.SAVI;
    if (!v) return;
    v.valores = UL.calcularSAVI(e.extra.bandas, L);
    v.L = L;
    v.ordenados = UL.ordenar(v.valores);
  };

  const GEN = { A: escenaA, B: escenaB, C: escenaC, D: escenaD };

  /** Fórmula de cada índice en LaTeX (notación de U3A: B, G, R, N, S1, S2). */
  UL.LATEX = {
    NDSI: '\\mathrm{NDSI}=\\dfrac{G-S_1}{G+S_1}',
    NDWI: '\\mathrm{NDWI}=\\dfrac{G-N}{G+N}',
    MNDWI: '\\mathrm{MNDWI}=\\dfrac{G-S_1}{G+S_1}',
    NDVI: '\\mathrm{NDVI}=\\dfrac{N-R}{N+R}',
    dNBR: '\\begin{gathered}\\mathrm{dNBR}=\\mathrm{NBR}_{\\text{antes}}-\\mathrm{NBR}_{\\text{después}}\\\\[4pt]\\mathrm{NBR}=\\dfrac{N-S_2}{N+S_2}\\end{gathered}',
    NBRpost: '\\mathrm{NBR}_{\\text{después}}=\\dfrac{N-S_2}{N+S_2}',
    SAVI: '\\mathrm{SAVI}=\\dfrac{(1+L)\\,(N-R)}{N+R+L}',
    EVI: '\\mathrm{EVI}=\\dfrac{2{,}5\\,(N-R)}{N+6R-7{,}5B+1}'
  };

  /** Genera la escena; s = {semilla, prop, ruido, contraste, hetero, esp}. */
  UL.generarEscena = function (id, s) {
    const e = GEN[id](s);
    e.meta = UL.ESCENARIOS[id];
    e.params = Object.assign({}, s);
    /* vectores ordenados por variable (curvas área–umbral, percentiles) */
    for (const k in e.variables) {
      const v = e.variables[k];
      v.latex = UL.LATEX[k] || '';
      v.ordenados = UL.ordenar(v.valores);
      const refBin = new Uint8Array(N);
      let pos = 0;
      for (let i = 0; i < N; i++) { refBin[i] = v.Z[i] >= v.zRef ? 1 : 0; pos += refBin[i]; }
      v.ref = refBin;
      v.prevalencia = pos / N;
      v.areaRef = pos * UL.PIX_KM2;
      /* píxeles mixtos o de borde: útiles para juzgar muestras (se calculan solo si se piden) */
      let bordeMemo = null;
      Object.defineProperty(v, 'borde', { configurable: true, enumerable: true, get: function () {
        if (bordeMemo) return bordeMemo;
        const borde = new Uint8Array(N);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x, r = refBin[i];
          let b = v.Z[i] > 0.02 && v.Z[i] < 0.98 ? 1 : 0;
          if (!b) {
            for (let dy = -1; dy <= 1 && !b; dy++) for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
              if (refBin[yy * W + xx] !== r) { b = 1; break; }
            }
          }
          borde[i] = b;
        }
        let nb = 0;
        for (let i = 0; i < N; i++) nb += borde[i];
        v.bordeFrac = nb / N;
        return (bordeMemo = borde);
      } });
    }
    return e;
  };
})(globalThis.UL = globalThis.UL || {});
