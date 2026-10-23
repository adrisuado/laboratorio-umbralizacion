/* =====================================================================
   graficos.js — gráficos SVG ligeros (sin librerías).
   Los colores salen de clases CSS que usan los tokens del tema.
   ===================================================================== */
(function (UL) {
  'use strict';
  const G = UL.graficos = {};
  const f = UL.fmt;

  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  G.escala = function (d0, d1, r0, r1) {
    const k = (r1 - r0) / ((d1 - d0) || 1);
    const s = function (v) { return r0 + (v - d0) * k; };
    s.inv = function (p) { return d0 + (p - r0) / k; };
    s.d = [d0, d1]; s.r = [r0, r1];
    return s;
  };

  G.ticks = function (min, max, n) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const paso0 = span / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(paso0)));
    const r = paso0 / mag;
    const paso = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / paso) * paso; v <= max + paso * 1e-6; v += paso) out.push(Math.abs(v) < paso * 1e-9 ? 0 : v);
    return out;
  };
  function decimales(ticks) {
    if (ticks.length < 2) return 2;
    /* los decimales justos para que ningún valor de la escala se redondee (0,25 no pasa a 0,3) */
    for (let d = 0; d < 3; d++) {
      const k = Math.pow(10, d);
      if (ticks.every(function (v) { return Math.abs(v * k - Math.round(v * k)) < 1e-6; })) return d;
    }
    return 3;
  }

  /** Marco con ejes, rejilla y etiquetas. Devuelve {svg partes, sx, sy}. */
  G.marco = function (o) {
    const w = o.w, h = o.h, m = Object.assign({ t: 10, r: 12, b: 30, l: 44 }, o.m || {});
    const sx = G.escala(o.x[0], o.x[1], m.l, w - m.r);
    const sy = G.escala(o.y[0], o.y[1], h - m.b, m.t);
    const p = [];
    const tx = o.xTicks || G.ticks(o.x[0], o.x[1], Math.max(3, Math.floor((w - m.l - m.r) / 70)));
    const ty = o.yTicks || G.ticks(o.y[0], o.y[1], Math.max(2, Math.floor((h - m.t - m.b) / 34)));
    const dx = o.xDec !== undefined ? o.xDec : decimales(tx), dy = o.yDec !== undefined ? o.yDec : decimales(ty);
    for (const v of ty) {
      const y = sy(v);
      p.push('<line class="g-ret" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + y + '" y2="' + y + '"/>');
      p.push('<text class="g-tx" x="' + (m.l - 6) + '" y="' + (y + 3.5) + '" text-anchor="end">' + (o.yFmt ? o.yFmt(v) : f(v, dy)) + '</text>');
    }
    for (const v of tx) {
      const x = sx(v);
      p.push('<line class="g-tick" x1="' + x + '" x2="' + x + '" y1="' + (h - m.b) + '" y2="' + (h - m.b + 4) + '"/>');
      p.push('<text class="g-tx" x="' + x + '" y="' + (h - m.b + 15) + '" text-anchor="middle">' + f(v, dx) + '</text>');
    }
    p.push('<line class="g-eje" x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + (h - m.b) + '" y2="' + (h - m.b) + '"/>');
    if (o.xLab) p.push('<text class="g-lab" x="' + (w - m.r) + '" y="' + (h - 3) + '" text-anchor="end">' + esc(o.xLab) + '</text>');
    if (o.yLab) p.push('<text class="g-lab" x="' + 4 + '" y="' + Math.max(10, m.t - 11) + '">' + esc(o.yLab) + '</text>');
    return { p: p, sx: sx, sy: sy, m: m, w: w, h: h };
  };

  function cerrar(el, F, extra) {
    el.innerHTML = '<svg class="graf" viewBox="0 0 ' + F.w + ' ' + F.h + '" width="' + F.w + '" height="' + F.h + '" role="img">' + F.p.join('') + (extra || '') + '</svg>';
    return el.firstChild;
  }
  function ruta(xs, ys, sx, sy) {
    let d = '', abierto = false;
    for (let i = 0; i < xs.length; i++) {
      if (!isFinite(xs[i]) || !isFinite(ys[i])) { abierto = false; continue; }
      d += (abierto ? 'L' : 'M') + sx(xs[i]).toFixed(1) + ',' + sy(ys[i]).toFixed(1);
      abierto = true;
    }
    return d;
  }
  G.ruta = ruta;

  /* ---------------------------------------------------------------
     Histograma con umbrales, clases coloreadas y capas opcionales
     --------------------------------------------------------------- */
  G.histograma = function (el, o) {
    const w = Math.max(260, el.clientWidth || 600), h = o.h || 190;
    const hist = o.hist, nb = hist.conteos.length;
    const tr = o.log ? function (c) { return Math.log10(1 + c); } : function (c) { return c; };
    let ymax = 0;
    for (let b = 0; b < nb; b++) ymax = Math.max(ymax, tr(hist.conteos[b]));
    if (o.fondo) for (let b = 0; b < nb; b++) ymax = Math.max(ymax, tr(o.fondo.conteos[b] * o.fondoEsc));
    ymax = ymax * 1.08 || 1;
    const yt = o.log ? [0, 1, 2, 3, 4].filter(function (v) { return v <= ymax; }) : null;
    const F = G.marco({ w: w, h: h, x: [hist.min, hist.max], y: [0, ymax], m: { t: 22, b: 28, l: 46, r: 12 }, xLab: o.xLab, yLab: o.log ? 'píxeles (log₁₀)' : 'píxeles', yTicks: yt, yFmt: o.log ? function (v) { return v === 0 ? '1' : '10' + ['', '', '²', '³', '⁴'][v]; } : function (v) { return v >= 1000 ? f(v / 1000, v % 1000 ? 1 : 0) + ' k' : f(v, 0); } });
    const sx = F.sx, sy = F.sy, cortes = (o.cortes || []).slice().sort(function (a, b) { return a - b; });
    const pal = o.coloresIntervalo || UL.paletaClases(cortes.length + 1);
    const y0 = sy(0);
    /* barras */
    for (let b = 0; b < nb; b++) {
      const c = hist.conteos[b];
      if (!c) continue;
      const xc = hist.centros[b];
      let k = 0;
      while (k < cortes.length && xc >= cortes[k]) k++;
      const x1 = sx(hist.bordes[b]), x2 = sx(hist.bordes[b + 1]), y = sy(tr(c));
      F.p.push('<rect x="' + x1.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + Math.max(0.6, x2 - x1 - 0.15).toFixed(2) + '" height="' + Math.max(0, y0 - y).toFixed(1) + '" fill="' + pal[k] + '" fill-opacity="0.88"/>');
    }
    /* escena completa (contorno, reescalada) */
    if (o.fondo) {
      const xs = [], ys = [];
      for (let b = 0; b < nb; b++) { xs.push(o.fondo.bordes[b], o.fondo.bordes[b + 1]); const v = tr(o.fondo.conteos[b] * o.fondoEsc); ys.push(v, v); }
      F.p.push('<path class="g-fondo" d="' + ruta(xs, ys, sx, sy) + '"/>');
    }
    /* por clase de referencia */
    if (o.porClase) {
      for (const s of [{ c: o.porClase.pos, cls: 'g-refpos' }, { c: o.porClase.neg, cls: 'g-refneg' }]) {
        const xs = [], ys = [];
        for (let b = 0; b < nb; b++) { xs.push(hist.bordes[b], hist.bordes[b + 1]); const v = tr(s.c[b]); ys.push(v, v); }
        F.p.push('<path class="' + s.cls + '" d="' + ruta(xs, ys, sx, sy) + '"/>');
      }
    }
    /* componentes de la GMM y centros de k-means */
    if (o.comps) {
      const n = hist.n, bw = hist.ancho;
      const xs = [];
      for (let k = 0; k <= 240; k++) xs.push(hist.min + (hist.max - hist.min) * k / 240);
      const tot = xs.map(function () { return 0; });
      o.comps.forEach(function (c, j) {
        const ys = xs.map(function (x, i) { const d = n * bw * UL.metodos.densidadComp(c, x); tot[i] += d; return tr(d); });
        F.p.push('<path class="g-comp" style="stroke:' + UL.paletaClases(o.comps.length)[j] + '" d="' + ruta(xs, ys, sx, sy) + '"/>');
      });
      F.p.push('<path class="g-suma" d="' + ruta(xs, tot.map(tr), sx, sy) + '"/>');
    }
    if (o.centros) {
      for (const c of o.centros) {
        const x = sx(c);
        F.p.push('<path class="g-centro" d="M' + (x - 5) + ',' + (y0 + 1) + 'L' + (x + 5) + ',' + (y0 + 1) + 'L' + x + ',' + (y0 - 8) + 'Z"/>');
      }
    }
    /* literatura */
    if (o.literatura) for (const L of o.literatura) {
      if (L.t < hist.min || L.t > hist.max) continue;
      const x = sx(L.t);
      F.p.push('<line class="g-lit" x1="' + x + '" x2="' + x + '" y1="' + (F.m.t - 4) + '" y2="' + y0 + '"/>');
    }
    /* configuración B (comparación) */
    if (o.cortesB) for (const t of o.cortesB) {
      if (t < hist.min || t > hist.max) continue;
      const x = sx(t);
      F.p.push('<line class="g-umbralB" x1="' + x + '" x2="' + x + '" y1="' + F.m.t + '" y2="' + y0 + '"/>');
      F.p.push('<text class="g-txB" x="' + (x + 3) + '" y="' + (F.m.t + 10) + '">B</text>');
    }
    /* umbrales */
    cortes.forEach(function (t, j) {
      if (t < hist.min || t > hist.max) return;
      const x = sx(t), obj = j === o.corteObjetivo;
      F.p.push('<line class="g-umbral' + (obj ? ' obj' : '') + '" x1="' + x + '" x2="' + x + '" y1="' + (F.m.t - 8) + '" y2="' + y0 + '"/>');
      const etiqueta = (cortes.length > 1 ? 't' + subindice(j + 1) : 't') + ' = ' + f(t, 3);
      const der = x < w - 90;
      F.p.push('<text class="g-tu' + (obj ? ' obj' : '') + '" x="' + (der ? x + 4 : x - 4) + '" y="' + (F.m.t - 10 + (j % 2) * 0) + '" text-anchor="' + (der ? 'start' : 'end') + '">' + etiqueta + '</text>');
    });
    const svg = cerrar(el, F);
    el._arr = o.arrastrar ? { sx: sx, hist: hist, cb: o.arrastrar, w: w } : null;
    if (o.arrastrar) { svg.classList.add('arrastrable'); habilitarArrastre(el); }
    return { sx: sx };
  };

  function subindice(n) { return String(n).split('').map(function (d) { return '₀₁₂₃₄₅₆₇₈₉'[+d]; }).join(''); }
  G.subindice = subindice;

  /* El arrastre se escucha en el contenedor: el SVG se redibuja en cada paso. */
  function habilitarArrastre(el) {
    if (el._arrInstalado) return;
    el._arrInstalado = true;
    let activo = false;
    function valor(ev) {
      const a = el._arr, svg = el.querySelector('svg');
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) * (a.w / r.width);
      return UL.clamp(a.sx.inv(px), a.hist.min, a.hist.max);
    }
    el.addEventListener('pointerdown', function (ev) { if (!el._arr) return; activo = true; el.setPointerCapture(ev.pointerId); el._arr.cb(valor(ev), false); });
    el.addEventListener('pointermove', function (ev) { if (activo && el._arr) el._arr.cb(valor(ev), false); });
    const soltar = function (ev) { if (activo && el._arr) { activo = false; el._arr.cb(valor(ev), true); } activo = false; };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', function () { activo = false; });
  }

  /* ---------------------------------------------------------------
     Gráfico de líneas genérico
     --------------------------------------------------------------- */
  G.lineas = function (el, o) {
    const w = Math.max(240, el.clientWidth || 380), h = o.h || 170;
    if (o.yLab) o.m = Object.assign({ t: 24 }, o.m || {});
    const F = G.marco({ w: w, h: h, x: o.x, y: o.y, m: o.m, xLab: o.xLab, yLab: o.yLab, xTicks: o.xTicks, yTicks: o.yTicks, xDec: o.xDec, yDec: o.yDec });
    const sx = F.sx, sy = F.sy;
    if (o.bandas) for (const b of o.bandas) {
      const x1 = sx(Math.max(o.x[0], b.x0)), x2 = sx(Math.min(o.x[1], b.x1));
      F.p.push('<rect class="' + (b.cls || 'g-banda') + '" x="' + Math.min(x1, x2) + '" y="' + F.m.t + '" width="' + Math.abs(x2 - x1) + '" height="' + (h - F.m.t - F.m.b) + '"/>');
    }
    if (o.areas) for (const a of o.areas) {
      const d = ruta(a.x, a.y, sx, sy);
      if (d) F.p.push('<path class="' + a.cls + '" d="' + d + 'L' + sx(a.x[a.x.length - 1]) + ',' + sy(o.y[0]) + 'L' + sx(a.x[0]) + ',' + sy(o.y[0]) + 'Z"/>');
    }
    if (o.hlines) for (const l of o.hlines) {
      if (l.y < o.y[0] || l.y > o.y[1]) continue;
      const y = sy(l.y);
      F.p.push('<line class="' + (l.cls || 'g-ref') + '" x1="' + F.m.l + '" x2="' + (w - F.m.r) + '" y1="' + y + '" y2="' + y + '"/>');
      if (l.label) F.p.push('<text class="g-tx" x="' + (w - F.m.r - 2) + '" y="' + (y - 4) + '" text-anchor="end">' + esc(l.label) + '</text>');
    }
    if (o.series) for (const s of o.series) {
      const d = ruta(s.x, s.y, sx, sy);
      if (d) F.p.push('<path class="' + (s.cls || 'g-linea') + '" d="' + d + '"' + (s.color ? ' style="stroke:' + s.color + '"' : '') + '/>');
    }
    if (o.puntos) {
      const pp = [];
      for (const q of o.puntos) {
        if (!isFinite(q.x) || !isFinite(q.y)) continue;
        pp.push('<circle class="' + (q.cls || 'g-pto') + '" cx="' + sx(q.x).toFixed(1) + '" cy="' + sy(q.y).toFixed(1) + '" r="' + (q.r || 2) + '"/>');
      }
      F.p.push(pp.join(''));
    }
    if (o.vlines) o.vlines.forEach(function (l, j) {
      if (!isFinite(l.x) || l.x < o.x[0] || l.x > o.x[1]) return;
      const x = sx(l.x);
      F.p.push('<line class="' + (l.cls || 'g-umbral obj') + '" x1="' + x + '" x2="' + x + '" y1="' + F.m.t + '" y2="' + (h - F.m.b) + '"/>');
      if (l.label) {
        const der = x < w - 100;
        F.p.push('<text class="' + (l.tcls || 'g-tu obj') + '" x="' + (der ? x + 4 : x - 4) + '" y="' + (F.m.t + 10 + (l.dy || 0)) + '" text-anchor="' + (der ? 'start' : 'end') + '">' + esc(l.label) + '</text>');
      }
    });
    if (o.marcas) for (const q of o.marcas) {
      if (!isFinite(q.x) || !isFinite(q.y)) continue;
      F.p.push('<circle class="' + (q.cls || 'g-marca') + '" cx="' + sx(q.x) + '" cy="' + sy(q.y) + '" r="' + (q.r || 4.5) + '"/>');
      if (q.label) F.p.push('<text class="g-tx fuerte" x="' + (sx(q.x) + 7) + '" y="' + (sy(q.y) - 6) + '">' + esc(q.label) + '</text>');
    }
    const svg = cerrar(el, F, o.extra ? o.extra(sx, sy, F) : '');
    if (o.leyenda) {
      const d = document.createElement('div');
      d.className = 'ley-graf';
      d.innerHTML = o.leyenda.map(function (L) {
        return '<span><svg class="graf" width="18" height="8" aria-hidden="true"><line class="' + L.cls + '" x1="1" x2="17" y1="4" y2="4"' + (L.color ? ' style="stroke:' + L.color + '"' : '') + '/></svg>' + esc(L.t) + '</span>';
      }).join('');
      el.appendChild(d);
    }
    return svg;
  };

  /* ---------------------------------------------------------------
     Cajas por clase de referencia (p5–p95, RIQ y mediana)
     --------------------------------------------------------------- */
  G.cajas = function (el, o) {
    const filas = o.cajas.filter(function (c) { return c.n >= 3; });
    const fila = 22, w = Math.max(260, el.clientWidth || 380), h = 30 + filas.length * fila + 8;
    const F = G.marco({ w: w, h: h, x: o.x, y: [0, filas.length], m: { t: 8, b: 26, l: 118, r: 12 }, yTicks: [], xLab: o.xLab });
    const sx = F.sx;
    filas.forEach(function (c, j) {
      const yc = F.m.t + j * fila + fila / 2;
      F.p.push('<text class="g-tx" x="' + (F.m.l - 8) + '" y="' + (yc + 3.5) + '" text-anchor="end">' + esc(c.nombre.length > 20 ? c.nombre.slice(0, 19) + '…' : c.nombre) + '</text>');
      F.p.push('<line class="g-bigote" x1="' + sx(c.p5) + '" x2="' + sx(c.p95) + '" y1="' + yc + '" y2="' + yc + '"/>');
      F.p.push('<rect x="' + sx(c.p25) + '" y="' + (yc - 6) + '" width="' + Math.max(1, sx(c.p75) - sx(c.p25)) + '" height="12" fill="' + c.color + '" class="g-caja"/>');
      F.p.push('<line class="g-mediana" x1="' + sx(c.p50) + '" x2="' + sx(c.p50) + '" y1="' + (yc - 7) + '" y2="' + (yc + 7) + '"/>');
    });
    for (const t of o.cortes || []) {
      if (t < o.x[0] || t > o.x[1]) continue;
      F.p.push('<line class="g-umbral obj" x1="' + sx(t) + '" x2="' + sx(t) + '" y1="' + F.m.t + '" y2="' + (h - F.m.b) + '"/>');
    }
    return cerrar(el, F);
  };

  /* ---------------------------------------------------------------
     Mapa de calor (σ²B de multi-Otsu con k = 3)
     --------------------------------------------------------------- */
  G.mapaCalor = function (el, o) {
    const nb = o.nb, w = Math.max(240, Math.min(el.clientWidth || 300, 330)), h = w - 10;
    const F = G.marco({ w: w, h: h, x: [o.min, o.max], y: [o.min, o.max], m: { t: 10, b: 32, l: 46, r: 10 }, xLab: 't₁', yLab: 't₂' });
    const cv = document.createElement('canvas');
    cv.width = nb; cv.height = nb;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(nb, nb);
    let mn = Infinity, mx = -Infinity;
    for (const v of o.mapa) if (isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; }
    for (let a = 0; a < nb; a++) for (let b = 0; b < nb; b++) {
      const v = o.mapa[a * nb + b], q = ((nb - 1 - b) * nb + a) * 4;
      if (!isFinite(v)) { img.data[q + 3] = 0; continue; }
      const c = UL.colorLut(UL.RAMPAS.prob, Math.pow((v - mn) / (mx - mn || 1), 2));
      img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const x0 = F.sx(o.min), x1 = F.sx(o.max), y1 = F.sy(o.max), y0 = F.sy(o.min);
    F.p.push('<image href="' + cv.toDataURL() + '" x="' + x0 + '" y="' + y1 + '" width="' + (x1 - x0) + '" height="' + (y0 - y1) + '" preserveAspectRatio="none" style="image-rendering:pixelated"/>');
    F.p.push('<circle class="g-marca" cx="' + F.sx(o.best[0]) + '" cy="' + F.sy(o.best[1]) + '" r="5"/>');
    return cerrar(el, F);
  };

  /* ---------------------------------------------------------------
     Plano de decisión de dos índices (logística multinomial)
     --------------------------------------------------------------- */
  G.planoDecision = function (el, o) {
    const w = Math.max(240, Math.min(el.clientWidth || 320, 360)), h = w - 6, nb = 120;
    const F = G.marco({ w: w, h: h, x: o.xr, y: o.yr, m: { t: 24, b: 32, l: 46, r: 10 }, xLab: o.xLab, yLab: o.yLab });
    const cv = document.createElement('canvas');
    cv.width = nb; cv.height = nb;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(nb, nb);
    const col = o.colores.map(UL.hexARgb);
    for (let a = 0; a < nb; a++) for (let b = 0; b < nb; b++) {
      const x = o.xr[0] + (o.xr[1] - o.xr[0]) * (a + 0.5) / nb, y = o.yr[1] - (o.yr[1] - o.yr[0]) * (b + 0.5) / nb;
      const c = col[o.clase(x, y)], q = (b * nb + a) * 4;
      img.data[q] = c[0]; img.data[q + 1] = c[1]; img.data[q + 2] = c[2]; img.data[q + 3] = 110;
    }
    ctx.putImageData(img, 0, 0);
    const x0 = F.sx(o.xr[0]), x1 = F.sx(o.xr[1]), y1 = F.sy(o.yr[1]), y0 = F.sy(o.yr[0]);
    F.p.push('<image href="' + cv.toDataURL() + '" x="' + x0 + '" y="' + y1 + '" width="' + (x1 - x0) + '" height="' + (y0 - y1) + '" preserveAspectRatio="none"/>');
    const pp = [];
    for (const q of o.puntos) {
      if (q.x < o.xr[0] || q.x > o.xr[1] || q.y < o.yr[0] || q.y > o.yr[1]) continue;
      pp.push('<circle cx="' + F.sx(q.x).toFixed(1) + '" cy="' + F.sy(q.y).toFixed(1) + '" r="2.4" fill="' + o.colores[q.c] + '" class="g-ptoc"/>');
    }
    F.p.push(pp.join(''));
    return cerrar(el, F);
  };

  /* Cortes, literatura y B sobre cualquier gráfico con eje x del índice */
  function dibujarCortes(F, o, sx, yTop, yBase, w) {
    const cortes = (o.cortes || []).slice().sort(function (a, b) { return a - b; });
    const xr = sx.d;
    if (o.literatura) for (const L of o.literatura) {
      if (L.t < xr[0] || L.t > xr[1]) continue;
      F.p.push('<line class="g-lit" x1="' + sx(L.t) + '" x2="' + sx(L.t) + '" y1="' + (yTop - 4) + '" y2="' + yBase + '"/>');
    }
    if (o.cortesB) for (const t of o.cortesB) {
      if (!(t >= xr[0] && t <= xr[1])) continue;
      F.p.push('<line class="g-umbralB" x1="' + sx(t) + '" x2="' + sx(t) + '" y1="' + yTop + '" y2="' + yBase + '"/><text class="g-txB" x="' + (sx(t) + 3) + '" y="' + (yTop + 10) + '">B</text>');
    }
    cortes.forEach(function (t, j) {
      if (!(t >= xr[0] && t <= xr[1])) return;
      const x = sx(t), obj = j === o.corteObjetivo, der = x < w - 90;
      F.p.push('<line class="g-umbral' + (obj ? ' obj' : '') + '" x1="' + x + '" x2="' + x + '" y1="' + (yTop - 8) + '" y2="' + yBase + '"/>');
      F.p.push('<text class="g-tu' + (obj ? ' obj' : '') + '" x="' + (der ? x + 4 : x - 4) + '" y="' + (yTop - 10) + '" text-anchor="' + (der ? 'start' : 'end') + '">' + (cortes.length > 1 ? 't' + subindice(j + 1) : 't') + ' = ' + f(t, 3) + '</text>');
    });
    return cortes;
  }
  function prepararArrastre(el, svg, sx, xr, w, cb) {
    el._arr = cb ? { sx: sx, hist: { min: xr[0], max: xr[1] }, cb: cb, w: w } : null;
    if (cb) { svg.classList.add('arrastrable'); habilitarArrastre(el); }
  }

  /** Densidad kernel con el área coloreada por clase del umbral. */
  G.densidad = function (el, o) {
    const w = Math.max(260, el.clientWidth || 600), h = o.h || 196;
    let ymax = 0;
    for (const v of o.y) ymax = Math.max(ymax, v);
    for (const s2 of o.extra || []) for (const v of s2.y) ymax = Math.max(ymax, v);
    ymax = ymax * 1.1 || 1;
    const F = G.marco({ w: w, h: h, x: o.xr, y: [0, ymax], m: { t: 22, b: 28, l: 46, r: 12 }, xLab: o.xLab, yLab: 'densidad' });
    const sx = F.sx, sy = F.sy, y0 = sy(0);
    const cortes = (o.cortes || []).slice().sort(function (a, b) { return a - b; });
    const pal = o.coloresIntervalo || UL.paletaClases(cortes.length + 1);
    const lim = [o.xr[0]].concat(cortes.filter(function (t) { return t > o.xr[0] && t < o.xr[1]; })).concat([o.xr[1]]);
    const interp = function (t) {
      for (let i = 1; i < o.x.length; i++) if (o.x[i] >= t) { const a = (t - o.x[i - 1]) / (o.x[i] - o.x[i - 1]); return o.y[i - 1] + a * (o.y[i] - o.y[i - 1]); }
      return o.y[o.y.length - 1];
    };
    for (let k = 0; k < lim.length - 1; k++) {
      const a = lim[k], b = lim[k + 1];
      let d = 'M' + sx(a).toFixed(1) + ',' + y0 + 'L' + sx(a).toFixed(1) + ',' + sy(interp(a)).toFixed(1);
      for (let i = 0; i < o.x.length; i++) if (o.x[i] > a && o.x[i] < b) d += 'L' + sx(o.x[i]).toFixed(1) + ',' + sy(o.y[i]).toFixed(1);
      d += 'L' + sx(b).toFixed(1) + ',' + sy(interp(b)).toFixed(1) + 'L' + sx(b).toFixed(1) + ',' + y0 + 'Z';
      let ci = 0;
      while (ci < cortes.length && (a + b) / 2 >= cortes[ci]) ci++;
      F.p.push('<path d="' + d + '" fill="' + pal[Math.min(ci, pal.length - 1)] + '" fill-opacity="0.6"/>');
    }
    for (const s2 of o.extra || []) F.p.push('<path class="' + s2.cls + '" d="' + ruta(s2.x, s2.y, sx, sy) + '"/>');
    F.p.push('<path class="g-linea densidad" d="' + ruta(o.x, o.y, sx, sy) + '"/>');
    dibujarCortes(F, o, sx, F.m.t, y0, w);
    const svg = cerrar(el, F);
    prepararArrastre(el, svg, sx, o.xr, w, o.arrastrar);
  };

  /** Violines (densidad espejada) con caja p25–p75, mediana y bigotes p5–p95, por clase. */
  G.violines = function (el, o) {
    const fila = 30, w = Math.max(260, el.clientWidth || 600), h = 24 + o.filas.length * fila + 30;
    const F = G.marco({ w: w, h: h, x: o.xr, y: [0, o.filas.length], m: { t: 24, b: 28, l: 150, r: 12 }, yTicks: [], xLab: o.xLab });
    const sx = F.sx;
    o.filas.forEach(function (r, j) {
      const yc = F.m.t + j * fila + fila / 2, amp = fila * 0.44;
      let ym = 0;
      for (const v of r.kde.y) ym = Math.max(ym, v);
      const xs = [], arriba = [], abajo = [];
      for (let i = 0; i < r.kde.x.length; i++) {
        if (r.kde.y[i] < ym * 0.004) continue;
        xs.push(sx(r.kde.x[i])); const d = (r.kde.y[i] / ym) * amp; arriba.push(yc - d); abajo.push(yc + d);
      }
      if (xs.length > 1) {
        let d = 'M' + xs[0].toFixed(1) + ',' + yc;
        for (let i = 0; i < xs.length; i++) d += 'L' + xs[i].toFixed(1) + ',' + arriba[i].toFixed(1);
        for (let i = xs.length - 1; i >= 0; i--) d += 'L' + xs[i].toFixed(1) + ',' + abajo[i].toFixed(1);
        F.p.push('<path d="' + d + 'Z" fill="' + r.color + '" fill-opacity="0.5" stroke="' + r.color + '" stroke-width="1.2"/>');
      }
      const q = r.q;
      F.p.push('<line class="g-bigote" x1="' + sx(q.p5) + '" x2="' + sx(q.p95) + '" y1="' + yc + '" y2="' + yc + '"/>');
      F.p.push('<rect class="g-cajav" x="' + sx(q.p25) + '" y="' + (yc - 4.5) + '" width="' + Math.max(1.5, sx(q.p75) - sx(q.p25)) + '" height="9"/>');
      F.p.push('<line class="g-medianav" x1="' + sx(q.p50) + '" x2="' + sx(q.p50) + '" y1="' + (yc - 6) + '" y2="' + (yc + 6) + '"/>');
      const nom = r.nombre.length > 24 ? r.nombre.slice(0, 23) + '…' : r.nombre;
      F.p.push('<text class="g-tx' + (j === 0 ? ' fuerte' : '') + '" x="' + (F.m.l - 8) + '" y="' + (yc - 1) + '" text-anchor="end">' + esc(nom) + '</text>');
      F.p.push('<text class="g-tx" x="' + (F.m.l - 8) + '" y="' + (yc + 10) + '" text-anchor="end">n = ' + UL.fmtEntero(r.n) + '</text>');
    });
    dibujarCortes(F, o, sx, F.m.t, h - F.m.b, w);
    const svg = cerrar(el, F);
    prepararArrastre(el, svg, sx, o.xr, w, o.arrastrar);
  };
})(globalThis.UL = globalThis.UL || {});
