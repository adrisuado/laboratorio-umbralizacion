/* =====================================================================
   visor.js — visor raster con zoom, desplazamiento, consulta de píxel
   y herramientas de geometría (rectángulo, polígono, lazo, punto,
   edición y borrado). Las geometrías se guardan en coordenadas de
   píxel de la escena (x hacia la derecha, y hacia abajo).
   ===================================================================== */
(function (UL) {
  'use strict';
  const W = UL.W, H = UL.H;

  /* ---------- Geometría ---------- */
  function dentro(px, py, pts) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  UL.puntoEnPoligono = dentro;

  function areaPol(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return Math.abs(a / 2);
  }
  UL.areaPoligono = areaPol;

  /** Simplificación Ramer–Douglas–Peucker. */
  function rdp(pts, tol) {
    if (pts.length < 3) return pts;
    let dmax = 0, idx = 0;
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol) return rdp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(rdp(pts.slice(idx), tol));
    return [a, b];
  }

  /** Simplificación de un contorno cerrado: se parte en el vértice más lejano al inicio. */
  function simplificarCerrado(pts, tol) {
    if (pts.length < 4) return pts;
    let m = 0, dm = -1;
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > dm) { dm = d; m = i; } }
    const a = rdp(pts.slice(0, m + 1), tol), b = rdp(pts.slice(m).concat([pts[0]]), tol);
    return a.slice(0, -1).concat(b.slice(0, -1));
  }

  /** Índices de píxel cubiertos por las geometrías de un rol (unión). */
  UL.rasterizar = function (geoms, rol) {
    const mask = new Uint8Array(UL.N);
    let alguna = false;
    for (const g of geoms) {
      if (g.rol !== rol) continue;
      alguna = true;
      if (g.tipo === 'punto') {
        const x = Math.floor(g.pts[0][0]), y = Math.floor(g.pts[0][1]);
        if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1;
        continue;
      }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const p of g.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(H - 1, Math.ceil(y1)); y++) {
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
          if (dentro(x + 0.5, y + 0.5, g.pts)) mask[y * W + x] = 1;
        }
      }
    }
    if (!alguna) return { mask: null, idx: null };
    let n = 0;
    for (let i = 0; i < UL.N; i++) n += mask[i];
    const idx = new Int32Array(n);
    for (let i = 0, k = 0; i < UL.N; i++) if (mask[i]) idx[k++] = i;
    return { mask: mask, idx: idx };
  };

  /* ---------- Visor ---------- */
  function Visor(canvas, cb) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.off.width = W; this.off.height = H;
    this.offCtx = this.off.getContext('2d');
    this.img = this.offCtx.createImageData(W, H);
    this.cb = cb || {};
    this.k = 2; this.tx = 0; this.ty = 0;
    this.herramienta = 'mover';
    this.rol = 'poblacion';
    this.geoms = [];
    this.muestras = { cal: [], val: [], ref: null };
    this.borrador = null;
    this.hover = null;
    this.arrastre = null;
    this.mostrarGeom = true;
    this.sello = 'DATOS SIMULADOS';
    this._pend = false;
    this._sigId = 1;
    this.instalar();
  }

  Visor.prototype.nuevoId = function () { return 'g' + (this._sigId++); };

  Visor.prototype.redimensionar = function () {
    const r = this.cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(200, Math.floor(r.width)), h = Math.max(160, Math.floor(r.height));
    const primera = !this.cw;
    const cambio = this.cw !== w || this.ch !== h;
    this.cw = w; this.ch = h; this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    if (primera || (cambio && this.ajustado)) this.ajustar();
    this.dibujar();
  };

  Visor.prototype.ajustar = function () {
    /* márgenes para no tapar la escena con el riel (izq.), los roles (arriba) y el zoom (der.) */
    const mi = this.cw > 560 ? 58 : 8, md = this.cw > 560 ? 48 : 8, ms = this.cw > 560 ? 46 : 8, mb = 8;
    this.k = Math.min((this.cw - mi - md) / W, (this.ch - ms - mb) / H);
    this.tx = mi + (this.cw - mi - md - W * this.k) / 2;
    this.ty = ms + (this.ch - ms - mb - H * this.k) / 2;
    this.ajustado = true;
    this.dibujar();
  };
  Visor.prototype.zoom = function (factor, cx, cy) {
    if (cx === undefined) { cx = this.cw / 2; cy = this.ch / 2; }
    const kmin = Math.min(this.cw / W, this.ch / H) * 0.5, kmax = 48;
    const k2 = UL.clamp(this.k * factor, kmin, kmax);
    const f = k2 / this.k;
    this.tx = cx - (cx - this.tx) * f;
    this.ty = cy - (cy - this.ty) * f;
    this.k = k2;
    this.ajustado = false;
    this.dibujar();
  };

  Visor.prototype.aPixel = function (sx, sy) { return [(sx - this.tx) / this.k, (sy - this.ty) / this.k]; };
  Visor.prototype.aPantalla = function (px, py) { return [this.tx + px * this.k, this.ty + py * this.k]; };

  Visor.prototype.ponerImagen = function (rgba) { this.img.data.set(rgba); this.offCtx.putImageData(this.img, 0, 0); this.dibujar(); };

  Visor.prototype.dibujar = function () {
    if (this._pend) return;
    this._pend = true;
    const self = this;
    (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : setTimeout)(function () { self._pend = false; self._dibujar(); });
  };

  Visor.prototype._dibujar = function () {
    const c = this.ctx, dpr = this.dpr || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.cw, this.ch);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.off, this.tx, this.ty, W * this.k, H * this.k);
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1;
    c.strokeRect(this.tx - 0.5, this.ty - 0.5, W * this.k + 1, H * this.k + 1);
    if (this.mostrarGeom) { this.dibujarMuestras(c); this.dibujarGeoms(c); }
    this.dibujarBorrador(c);
    if (this.hover && this.hover.dentro) {
      const p = this.aPantalla(Math.floor(this.hover.px), Math.floor(this.hover.py));
      c.strokeStyle = '#ffffff'; c.lineWidth = 1.5;
      c.strokeRect(p[0], p[1], Math.max(3, this.k), Math.max(3, this.k));
      c.strokeStyle = '#000000'; c.lineWidth = 0.75;
      c.strokeRect(p[0] - 1.5, p[1] - 1.5, Math.max(3, this.k) + 3, Math.max(3, this.k) + 3);
    }
    this.dibujarCartografia(c);
  };

  function rgba(hex, a) { const v = UL.hexARgb(hex); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }

  Visor.prototype.trazar = function (c, pts, cerrar) {
    c.beginPath();
    pts.forEach(function (p, i) { const q = this.aPantalla(p[0], p[1]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }, this);
    if (cerrar) c.closePath();
  };

  Visor.prototype.dibujarGeoms = function (c) {
    const ref = this.muestras.ref;
    this._insignias = [];
    for (const g of this.geoms) {
      const col = UL.COLOR_ROL[g.rol];
      const sel = (this.hover && this.hover.geom === g) || g.id === this.resaltado;
      if (g.tipo === 'punto') {
        const x = Math.floor(g.pts[0][0]), y = Math.floor(g.pts[0][1]);
        const q = this.aPantalla(x, y), s = Math.max(7, this.k);
        const pos = ref && ref[y * W + x];
        c.fillStyle = pos ? col : 'rgba(10,23,36,0.85)';
        c.strokeStyle = sel ? '#ffffff' : col; c.lineWidth = sel ? 2.5 : 2;
        const ox = q[0] + this.k / 2 - s / 2, oy = q[1] + this.k / 2 - s / 2;
        c.fillRect(ox, oy, s, s); c.strokeRect(ox, oy, s, s);
        continue;
      }
      this.trazar(c, g.pts, true);
      c.fillStyle = rgba(col, g.rol === 'poblacion' ? 0.1 : 0.16);
      c.fill();
      c.setLineDash(g.rol === 'poblacion' ? [7, 4] : g.rol === 'validacion' ? [2, 3] : []);
      c.lineWidth = 3.5; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.stroke();
      c.lineWidth = sel ? 2.5 : 1.8; c.strokeStyle = sel ? '#ffffff' : col; c.stroke();
      c.setLineDash([]);
      /* insignia ✕ para borrar la geometría con un clic (cualquier herramienta) */
      let mx = -Infinity, my = Infinity;
      for (const p of g.pts) { if (p[0] > mx) mx = p[0]; if (p[1] < my) my = p[1]; }
      const q = this.aPantalla(mx, my), bx = UL.clamp(q[0], 12, this.cw - 12), by = UL.clamp(q[1], 12, this.ch - 12);
      const encima = this._insigniaHover === g;
      c.beginPath(); c.arc(bx, by, encima ? 10 : 8.5, 0, 6.2832);
      c.fillStyle = encima ? '#f2777a' : col; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,0.6)'; c.stroke();
      c.strokeStyle = '#0a1724'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(bx - 3.5, by - 3.5); c.lineTo(bx + 3.5, by + 3.5); c.moveTo(bx + 3.5, by - 3.5); c.lineTo(bx - 3.5, by + 3.5); c.stroke();
      this._insignias.push({ g: g, x: bx, y: by });
      if (this.herramienta === 'editar') {
        for (const p of g.pts) {
          if (g.tipo === 'lazo' && g.pts.length > 40) break;
          const q = this.aPantalla(p[0], p[1]);
          c.fillStyle = '#ffffff'; c.strokeStyle = col; c.lineWidth = 1.5;
          c.beginPath(); c.arc(q[0], q[1], 4, 0, 6.2832); c.fill(); c.stroke();
        }
      }
    }
  };

  Visor.prototype.dibujarMuestras = function (c) {
    const ref = this.muestras.ref;
    if (!ref) return;
    const s = Math.max(2.4, Math.min(this.k * 0.8, 8));
    for (const rol of ['cal', 'val']) {
      const col = UL.COLOR_ROL[rol === 'cal' ? 'calibracion' : 'validacion'];
      for (const i of this.muestras[rol]) {
        const x = i % W, y = (i / W) | 0, q = this.aPantalla(x + 0.5, y + 0.5);
        if (q[0] < -10 || q[1] < -10 || q[0] > this.cw + 10 || q[1] > this.ch + 10) continue;
        c.beginPath();
        if (rol === 'cal') c.arc(q[0], q[1], s / 2 + 0.6, 0, 6.2832);
        else { c.moveTo(q[0], q[1] - s / 2 - 1); c.lineTo(q[0] + s / 2 + 1, q[1]); c.lineTo(q[0], q[1] + s / 2 + 1); c.lineTo(q[0] - s / 2 - 1, q[1]); c.closePath(); }
        c.fillStyle = ref[i] ? col : 'rgba(10,23,36,0.9)';
        c.fill();
        c.lineWidth = 1.3; c.strokeStyle = col; c.stroke();
      }
    }
  };

  Visor.prototype.dibujarBorrador = function (c) {
    const b = this.borrador;
    if (!b) return;
    const col = UL.COLOR_ROL[b.rol];
    const pts = b.pts.slice();
    if (b.tipo === 'poligono' && b.cursor) pts.push(b.cursor);
    if (pts.length < 2) {
      if (pts.length === 1) { const q = this.aPantalla(pts[0][0], pts[0][1]); c.fillStyle = col; c.beginPath(); c.arc(q[0], q[1], 3.5, 0, 6.2832); c.fill(); }
      return;
    }
    this.trazar(c, pts, b.tipo !== 'poligono');
    c.fillStyle = rgba(col, 0.12); c.fill();
    c.setLineDash([5, 4]); c.lineWidth = 2; c.strokeStyle = col; c.stroke(); c.setLineDash([]);
    if (b.tipo === 'poligono') for (const p of b.pts) {
      const q = this.aPantalla(p[0], p[1]);
      c.fillStyle = col; c.beginPath(); c.arc(q[0], q[1], 3.5, 0, 6.2832); c.fill();
    }
  };

  Visor.prototype.dibujarCartografia = function (c) {
    /* barra de escala */
    const mPorPx = UL.PIX_M / this.k;
    const opciones = [60, 100, 200, 300, 500, 1000, 2000, 3000, 5000];
    let L = opciones[0];
    for (const o of opciones) if (o / mPorPx <= 150) L = o;
    const lw = L / mPorPx, x0 = 14, y0 = this.ch - 18;
    c.fillStyle = 'rgba(7,18,28,0.72)';
    c.fillRect(x0 - 8, y0 - 22, lw + 64, 32);
    c.fillStyle = '#f5f7fa'; c.fillRect(x0, y0, lw / 2, 5);
    c.strokeStyle = '#f5f7fa'; c.lineWidth = 1; c.strokeRect(x0 + 0.5, y0 + 0.5, lw, 5);
    c.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
    c.textBaseline = 'alphabetic';
    c.fillText('0', x0 - 3, y0 - 5);
    c.fillText(L >= 1000 ? (L / 1000) + ' km' : L + ' m', x0 + lw - 8, y0 - 5);
    /* norte */
    const nx = this.cw - 28, ny = 30;
    c.fillStyle = 'rgba(7,18,28,0.72)'; c.beginPath(); c.arc(nx, ny - 4, 17, 0, 6.2832); c.fill();
    c.fillStyle = '#f5f7fa'; c.beginPath(); c.moveTo(nx, ny - 16); c.lineTo(nx + 6, ny + 2); c.lineTo(nx, ny - 2); c.lineTo(nx - 6, ny + 2); c.closePath(); c.fill();
    c.font = '700 10px "Barlow Semi Condensed", system-ui, sans-serif';
    c.fillText('N', nx - 3.5, ny + 12 - 1);
    /* sello de datos simulados */
    c.font = '700 11px "Barlow Semi Condensed", system-ui, sans-serif';
    const t = this.sello, tw = c.measureText(t).width;
    c.fillStyle = 'rgba(7,18,28,0.72)'; c.fillRect(this.cw - tw - 26, this.ch - 30, tw + 18, 20);
    c.fillStyle = '#efbe77'; c.fillText(t, this.cw - tw - 17, this.ch - 16);
  };

  /* ---------- Interacción ---------- */
  Visor.prototype.instalar = function () {
    const self = this, cv = this.cv;
    function pos(ev) { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    cv.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      const p = pos(ev);
      self.zoom(Math.pow(1.0018, -ev.deltaY), p[0], p[1]);
    }, { passive: false });
    cv.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

    cv.addEventListener('pointerdown', function (ev) {
      const p = pos(ev), px = self.aPixel(p[0], p[1]);
      const ins = self.insigniaEn(p);
      if (ins && !self.borrador) { self.borrarGeom(ins.g); return; }
      cv.setPointerCapture(ev.pointerId);
      const pan = self.herramienta === 'mover' || ev.button === 1 || ev.button === 2 || ev.shiftKey;
      if (pan) { self.arrastre = { tipo: 'pan', x: p[0], y: p[1], tx: self.tx, ty: self.ty, movido: false }; return; }
      const h = self.herramienta;
      if (h === 'rect') self.borrador = { tipo: 'rect', rol: self.rol, ini: px, pts: [px, px, px, px] };
      else if (h === 'lazo') self.borrador = { tipo: 'lazo', rol: self.rol, pts: [px] };
      else if (h === 'poligono') {
        if (!self.borrador) self.borrador = { tipo: 'poligono', rol: self.rol, pts: [] };
        const b = self.borrador;
        if (b.pts.length >= 3) {
          const q0 = self.aPantalla(b.pts[0][0], b.pts[0][1]);
          if (Math.hypot(q0[0] - p[0], q0[1] - p[1]) < 9) { self.cerrarPoligono(); return; }
        }
        b.pts.push(px);
      } else if (h === 'punto') {
        if (self.rol === 'poblacion') { self.aviso('Los puntos son muestras: elige el rol Calibración o Validación.'); return; }
        if (px[0] < 0 || px[1] < 0 || px[0] >= W || px[1] >= H) return;
        self.geoms.push({ id: self.nuevoId(), rol: self.rol, tipo: 'punto', pts: [[Math.floor(px[0]) + 0.5, Math.floor(px[1]) + 0.5]] });
        self.emitir(true);
      } else if (h === 'editar') {
        const hit = self.tocar(p);
        if (hit) self.arrastre = { tipo: 'editar', hit: hit, ini: px, orig: hit.geom.pts.map(function (q) { return q.slice(); }) };
      } else if (h === 'borrar') {
        const hit = self.tocar(p);
        if (hit) { self.geoms.splice(self.geoms.indexOf(hit.geom), 1); self.hover = null; self.emitir(true); }
      }
      self.dibujar();
    });

    cv.addEventListener('pointermove', function (ev) {
      const p = pos(ev), px = self.aPixel(p[0], p[1]);
      const a = self.arrastre, b = self.borrador;
      if (a && a.tipo === 'pan') {
        self.tx = a.tx + p[0] - a.x; self.ty = a.ty + p[1] - a.y;
        if (Math.abs(p[0] - a.x) + Math.abs(p[1] - a.y) > 3) a.movido = true;
        self.ajustado = false; self.dibujar(); return;
      }
      if (a && a.tipo === 'editar') {
        const g = a.hit.geom, dx = px[0] - a.ini[0], dy = px[1] - a.ini[1];
        if (a.hit.v >= 0) {
          if (g.tipo === 'rect') {
            const op = a.orig[(a.hit.v + 2) % 4], q = [px[0], px[1]];
            g.pts = [[op[0], op[1]], [q[0], op[1]], [q[0], q[1]], [op[0], q[1]]];
            a.hit.v = 2; a.orig = g.pts.map(function (z) { return z.slice(); }); a.ini = px;
          } else g.pts[a.hit.v] = [px[0], px[1]];
        } else if (g.tipo === 'punto') {
          g.pts = [[Math.floor(UL.clamp(px[0], 0, W - 1)) + 0.5, Math.floor(UL.clamp(px[1], 0, H - 1)) + 0.5]];
        } else g.pts = a.orig.map(function (q) { return [q[0] + dx, q[1] + dy]; });
        self.emitir(false); self.dibujar(); return;
      }
      if (b && ev.buttons && b.tipo === 'rect') {
        const i = b.ini;
        b.pts = [[i[0], i[1]], [px[0], i[1]], [px[0], px[1]], [i[0], px[1]]];
        self.dibujar();
      } else if (b && ev.buttons && b.tipo === 'lazo') {
        const u = b.pts[b.pts.length - 1];
        if (Math.hypot(u[0] - px[0], u[1] - px[1]) * self.k > 3) { b.pts.push(px); self.dibujar(); }
      } else if (b && b.tipo === 'poligono') { b.cursor = px; self.dibujar(); }
      /* consulta y resaltado */
      const dentroE = px[0] >= 0 && px[1] >= 0 && px[0] < W && px[1] < H;
      self.hover = { px: px[0], py: px[1], dentro: dentroE, geom: null };
      const ins = self.borrador ? null : self.insigniaEn(p);
      self._insigniaHover = ins ? ins.g : null;
      cv.style.cursor = ins ? 'pointer' : '';
      if (ins) self.hover.geom = ins.g;
      else if (self.herramienta === 'editar' || self.herramienta === 'borrar' || self.herramienta === 'mover') { const hit = self.tocar(p); self.hover.geom = hit ? hit.geom : null; }
      if (self.cb.consulta) self.cb.consulta(dentroE ? Math.floor(px[1]) * W + Math.floor(px[0]) : -1);
      self.dibujar();
    });

    cv.addEventListener('pointerup', function (ev) {
      const a = self.arrastre, b = self.borrador;
      self.arrastre = null;
      if (a && a.tipo === 'editar') { self.emitir(true); return; }
      if (a && a.tipo === 'pan') { if (!a.movido && self.cb.fijar && self.hover && self.hover.dentro) self.cb.fijar(Math.floor(self.hover.py) * W + Math.floor(self.hover.px)); return; }
      if (b && b.tipo === 'rect') {
        const pts = b.pts.map(function (q) { return [UL.clamp(q[0], 0, W), UL.clamp(q[1], 0, H)]; });
        if (areaPol(pts) >= 2) self.geoms.push({ id: self.nuevoId(), rol: b.rol, tipo: 'rect', pts: pts });
        self.borrador = null; self.emitir(true);
      } else if (b && b.tipo === 'lazo') {
        const pts = simplificarCerrado(b.pts, 0.45);
        if (pts.length >= 3 && areaPol(pts) >= 3) self.geoms.push({ id: self.nuevoId(), rol: b.rol, tipo: 'lazo', pts: pts });
        else self.aviso('El lazo es muy pequeño: dibuja una forma cerrada más amplia.');
        self.borrador = null; self.emitir(true);
      }
      self.dibujar();
    });
    cv.addEventListener('dblclick', function () { if (self.borrador && self.borrador.tipo === 'poligono') self.cerrarPoligono(); });
    cv.addEventListener('pointerleave', function () { self.hover = null; if (self.cb.consulta) self.cb.consulta(-1); self.dibujar(); });
    window.addEventListener('keydown', function (ev) {
      if (ev.target && /input|select|textarea/i.test(ev.target.tagName)) return;
      const b = self.borrador;
      if (ev.key === 'Escape' && b) { self.borrador = null; self.dibujar(); }
      if (ev.key === 'Enter' && b && b.tipo === 'poligono') self.cerrarPoligono();
      if (ev.key === 'Backspace' && b && b.tipo === 'poligono') { b.pts.pop(); ev.preventDefault(); self.dibujar(); }
      if ((ev.key === 'Delete' || ev.key === 'Supr') && !b && self.hover && self.hover.geom) { self.borrarGeom(self.hover.geom); ev.preventDefault(); }
    });
  };

  Visor.prototype.cerrarPoligono = function () {
    const b = this.borrador;
    if (!b) return;
    /* el doble clic agrega un vértice repetido: se elimina */
    const pts = [];
    for (const p of b.pts) { const u = pts[pts.length - 1]; if (!u || Math.hypot(u[0] - p[0], u[1] - p[1]) * this.k > 2) pts.push(p); }
    if (pts.length >= 3 && areaPol(pts) >= 1) this.geoms.push({ id: this.nuevoId(), rol: b.rol, tipo: 'poligono', pts: pts });
    else this.aviso('Un polígono necesita al menos tres vértices.');
    this.borrador = null;
    this.emitir(true);
    this.dibujar();
  };
  Visor.prototype.cancelarBorrador = function () { this.borrador = null; this.dibujar(); };

  /** Busca un vértice o una geometría bajo el cursor (la más reciente primero). */
  Visor.prototype.tocar = function (p) {
    const px = this.aPixel(p[0], p[1]);
    for (let gi = this.geoms.length - 1; gi >= 0; gi--) {
      const g = this.geoms[gi];
      if (g.tipo !== 'punto' && !(g.tipo === 'lazo' && g.pts.length > 40)) {
        for (let v = 0; v < g.pts.length; v++) {
          const q = this.aPantalla(g.pts[v][0], g.pts[v][1]);
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 8) return { geom: g, v: v };
        }
      }
    }
    for (let gi = this.geoms.length - 1; gi >= 0; gi--) {
      const g = this.geoms[gi];
      if (g.tipo === 'punto') {
        const q = this.aPantalla(g.pts[0][0], g.pts[0][1]);
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.max(8, this.k)) return { geom: g, v: -1 };
      } else if (dentro(px[0], px[1], g.pts)) return { geom: g, v: -1 };
    }
    return null;
  };

  Visor.prototype.insigniaEn = function (p) {
    for (let k = (this._insignias || []).length - 1; k >= 0; k--) {
      const b = this._insignias[k];
      if (Math.hypot(b.x - p[0], b.y - p[1]) <= 11) return b;
    }
    return null;
  };
  Visor.prototype.borrarGeom = function (g) {
    const i = this.geoms.indexOf(g);
    if (i < 0) return;
    this.geoms.splice(i, 1);
    this.hover = null; this._insigniaHover = null; this.cv.style.cursor = '';
    this.emitir(true); this.dibujar();
  };

  Visor.prototype.emitir = function (fin) { if (this.cb.geometria) this.cb.geometria(fin); };
  Visor.prototype.aviso = function (t) { if (this.cb.aviso) this.cb.aviso(t); };

  UL.Visor = Visor;
})(globalThis.UL = globalThis.UL || {});
