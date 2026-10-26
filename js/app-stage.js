/* Pixel Perles — table de travail : affichage (canvas), zoom, gestes souris / tactile */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const canvas = document.getElementById('canvas');
  const stageEl = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const S = (A.stage = {});

  let W = 0, H = 0, dpr = 1;
  let theme = {};
  const wsView = { x: -10, y: -10, s: 8 };
  const phView = { x: 0, y: 0, s: 1 };
  let pending = false;
  let gesture = null;
  const pointers = new Map();
  let spaceDown = false;
  let hover = null; // position monde survolée

  const isPhoto = () => A.tab === 'palette';
  const view = () => (isPhoto() ? phView : wsView);
  const mobile = () => document.documentElement.classList.contains('ui-mobile');

  // ---------- Thème ----------
  const probe = document.createElement('canvas').getContext('2d');
  function cssToRgb(c) {
    probe.fillStyle = '#000';
    probe.fillStyle = c;
    const v = probe.fillStyle;
    if (v[0] === '#') return U.hexToRgb(v);
    const m = /rgba?\(([^)]+)\)/.exec(v);
    if (!m) return [128, 128, 128];
    return m[1].split(',').slice(0, 3).map((n) => parseFloat(n));
  }
  S.readTheme = function () {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    theme = {
      bg: g('--canvas-bg'), board: g('--canvas-board'), grid: g('--canvas-grid'), major: g('--canvas-grid-major'),
      plateFill: g('--plate-fill'), peg: g('--plate-peg'), edge: g('--plate-edge'), accent: g('--accent'),
      ink: g('--ink'), ink2: g('--ink-2'), surface: g('--surface'), empty: g('--empty-cell'), go: g('--go'),
    };
    theme.emptyRgb = cssToRgb(theme.empty);
    A.plateCache.clear();
    A.redraw();
  };

  // ---------- Taille, rafraîchissement ----------
  S.resize = function () {
    const r = stageEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const oldW = W, oldH = H;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (oldW && oldH) {
      // garde le centre de la vue
      [wsView, phView].forEach((v) => { v.x += (oldW - W) / 2 / v.s; v.y += (oldH - H) / 2 / v.s; });
    }
    A.redraw();
  };
  A.redraw = function () {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; draw(); });
  };
  new ResizeObserver(() => S.resize()).observe(stageEl);

  // ---------- Vue ----------
  const toWorld = (sx, sy, v) => { v = v || view(); return { x: v.x + sx / v.s, y: v.y + sy / v.s }; };
  S.toWorld = toWorld;
  const LIMITS = { ws: [0.6, 90], photo: [0.02, 40] };

  function zoomAt(sx, sy, f) {
    const v = view();
    const lim = isPhoto() ? LIMITS.photo : LIMITS.ws;
    const w = toWorld(sx, sy, v);
    v.s = U.clamp(v.s * f, lim[0], lim[1]);
    v.x = w.x - sx / v.s;
    v.y = w.y - sy / v.s;
    updateZoomLabel();
    A.redraw();
  }
  S.zoomBy = (f) => zoomAt(W / 2, H / 2, f);

  function updateZoomLabel() {
    const el = document.getElementById('zoomLabel');
    if (!el) return;
    const v = view();
    el.textContent = isPhoto() ? Math.round(v.s * 100) + ' %' : Math.round((v.s / 10) * 100) + ' %';
  }

  function fitRect(v, r, pad, lim) {
    if (!W || !H || !r || !r.w || !r.h) return;
    const s = U.clamp(Math.min((W - 2 * pad) / r.w, (H - 2 * pad) / r.h), lim[0], lim[1]);
    v.s = s;
    v.x = r.x + r.w / 2 - W / 2 / s;
    v.y = r.y + r.h / 2 - H / 2 / s;
  }

  S.fitView = function () {
    if (!W) S.resize();
    if (isPhoto()) {
      const im = A.photo.display;
      if (im) fitRect(phView, { x: 0, y: 0, w: im.width, h: im.height }, 16, LIMITS.photo);
    } else if (A.project) {
      const rects = A.project.plates.slice();
      if (A.project.image && (A.tab === 'image' || !rects.length)) {
        const d = PP.geo.imgDims(A.project.image);
        rects.push({ x: A.project.image.x, y: A.project.image.y, w: d.w, h: d.h });
      }
      if (rects.length) {
        const bb = PP.geo.bboxOf(rects);
        fitRect(wsView, bb, mobile() ? 28 : 56, LIMITS.ws);
      }
    }
    updateZoomLabel();
    A.redraw();
  };
  S.onTabChange = function () { updateZoomLabel(); updateCursor(); A.redraw(); };

  // ---------- Dessin ----------
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg || '#ccc';
    ctx.fillRect(0, 0, W, H);
    if (!A.project) return;
    if (isPhoto()) drawPhoto(); else drawWorkspace();
  }

  function drawWorkspace() {
    const v = wsView;
    const P = A.project;
    const b = gesture && gesture.bounds ? gesture.bounds : A.workBounds();
    const bx = (b.x - v.x) * v.s, by = (b.y - v.y) * v.s, bw = b.w * v.s, bh = b.h * v.s;
    ctx.fillStyle = theme.board;
    ctx.fillRect(bx, by, bw, bh);

    // Grille magnétique
    if (v.s >= 5) {
      const x0 = Math.max(b.x, Math.floor(v.x)), x1 = Math.min(b.x + b.w, Math.ceil(v.x + W / v.s));
      const y0 = Math.max(b.y, Math.floor(v.y)), y1 = Math.min(b.y + b.h, Math.ceil(v.y + H / v.s));
      const minor = new Path2D(), major = new Path2D();
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round((x - v.x) * v.s) + 0.5;
        (x % 10 === 0 ? major : minor).moveTo(sx, Math.max(by, 0)); (x % 10 === 0 ? major : minor).lineTo(sx, Math.min(by + bh, H));
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round((y - v.y) * v.s) + 0.5;
        (y % 10 === 0 ? major : minor).moveTo(Math.max(bx, 0), sy); (y % 10 === 0 ? major : minor).lineTo(Math.min(bx + bw, W), sy);
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = theme.grid; ctx.stroke(minor);
      ctx.strokeStyle = theme.major; ctx.stroke(major);
    }

    const showResult = A.hasResult() && (A.tab === 'edit' || A.tab === 'export');
    const hasImg = !!(P.image && A.imgAdj);
    const imgBelow = hasImg && !showResult;
    const imgOver = hasImg && showResult && P.disp.overlay;

    if (imgBelow) {
      ctx.save();
      const op = (P.disp.opacity || 85) / 100;
      ctx.globalAlpha = A.tab === 'image' ? op : Math.min(op, 0.7);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      PP.geo.drawImageTransformed(ctx, A.imgAdj, P.image, v.x, v.y, v.s);
      ctx.restore();
    }

    P.plates.forEach((p) => drawPlate(p, showResult, imgBelow));

    if (imgOver) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      PP.geo.drawImageTransformed(ctx, A.imgAdj, P.image, v.x, v.y, v.s);
      ctx.restore();
    }

    // Étiquettes des plaques
    P.plates.forEach((p) => drawPlateLabel(p));

    // Image : cadre et poignées
    if (A.tab === 'image' && P.image) {
      const d = PP.geo.imgDims(P.image);
      const sx = (P.image.x - v.x) * v.s, sy = (P.image.y - v.y) * v.s, sw = d.w * v.s, sh = d.h * v.s;
      ctx.save();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
      const hs = handleSize();
      [[sx, sy], [sx + sw, sy], [sx, sy + sh], [sx + sw, sy + sh]].forEach(([hx, hy]) => {
        ctx.fillStyle = theme.surface;
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
      });
      ctx.restore();
    }

    // Survol en retouche
    if (A.tab === 'edit' && showResult && hover && A.edit.tool !== 'hand' && !mobile()) {
      const size = A.edit.tool === 'brush' || A.edit.tool === 'erase' ? A.edit.size : 1;
      const off = Math.floor((size - 1) / 2);
      const cx = Math.floor(hover.x) - off, cy = Math.floor(hover.y) - off;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect((cx - v.x) * v.s + 0.5, (cy - v.y) * v.s + 0.5, size * v.s - 1, size * v.s - 1);
    }
  }

  function handleSize() { return mobile() ? 18 : 11; }

  function drawPlate(p, showResult, imgVisible) {
    const v = wsView;
    const sx = (p.x - v.x) * v.s, sy = (p.y - v.y) * v.s, sw = p.w * v.s, sh = p.h * v.s;
    if (sx > W || sy > H || sx + sw < 0 || sy + sh < 0) return;
    const grid = showResult ? A.project.result.grids[p.id] : null;
    if (grid) {
      drawGrid(p, grid, sx, sy);
    } else {
      if (!imgVisible) { ctx.fillStyle = theme.plateFill; ctx.fillRect(sx, sy, sw, sh); }
      else if (A.tab === 'plates') { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(sx, sy, sw, sh); }
      if (v.s >= 3.5) {
        const i0 = Math.max(0, Math.floor(v.x - p.x)), i1 = Math.min(p.w, Math.ceil(v.x + W / v.s - p.x));
        const j0 = Math.max(0, Math.floor(v.y - p.y)), j1 = Math.min(p.h, Math.ceil(v.y + H / v.s - p.y));
        const r = Math.max(0.7, v.s * 0.13);
        ctx.fillStyle = imgVisible ? 'rgba(255,255,255,0.75)' : theme.peg;
        const path = new Path2D();
        for (let j = j0; j < j1; j++) {
          const cy = sy + (j + 0.5) * v.s;
          for (let i = i0; i < i1; i++) {
            const cx = sx + (i + 0.5) * v.s;
            if (v.s < 8) path.rect(cx - r, cy - r, 2 * r, 2 * r);
            else { path.moveTo(cx + r, cy); path.arc(cx, cy, r, 0, Math.PI * 2); }
          }
        }
        if (imgVisible) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.5; ctx.fill(path); ctx.restore(); }
        else ctx.fill(path);
      }
    }
    const selected = A.sel === p.id;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeStyle = selected ? theme.accent : theme.edge;
    ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(sw) - 1, Math.round(sh) - 1);
  }

  function drawPlateLabel(p) {
    const v = wsView;
    const sx = (p.x - v.x) * v.s, sy = (p.y - v.y) * v.s, sw = p.w * v.s;
    if (sw < 34 || sy < -30 || sy > H || sx > W || sx + sw < 0) return;
    const txt = sw > 120 ? p.name + '  ' + p.w + '×' + p.h : p.name;
    ctx.font = '700 12px ' + getComputedStyle(document.body).fontFamily;
    const tw = ctx.measureText(txt).width;
    const lx = sx + 4, ly = sy + 4;
    ctx.fillStyle = A.sel === p.id ? theme.accent : 'rgba(20,24,30,0.72)';
    PP.render.rr(ctx, lx, ly, tw + 12, 20, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, lx + 6, ly + 10.5);
  }

  function plateCacheCanvas(p, grid, colors) {
    let c = A.plateCache.get(p.id);
    if (c && c.width === p.w && c.height === p.h) return c;
    c = document.createElement('canvas');
    c.width = p.w; c.height = p.h;
    const cx = c.getContext('2d');
    const id = cx.createImageData(p.w, p.h);
    const rgb = colors.map((k) => U.hexToRgb(k.hex) || [0, 0, 0]);
    const e = theme.emptyRgb || [220, 220, 220];
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      const col = v >= 0 && rgb[v] ? rgb[v] : e;
      id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2]; id.data[i * 4 + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    A.plateCache.set(p.id, c);
    return c;
  }

  function drawGrid(p, grid, sx, sy) {
    const v = wsView;
    const colors = A.project.result.colors;
    if (v.s < 7) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(plateCacheCanvas(p, grid, colors), sx, sy, p.w * v.s, p.h * v.s);
      ctx.imageSmoothingEnabled = true;
      return;
    }
    const beads = A.project.disp.beads;
    const codes = A.project.disp.codes && v.s >= 24;
    const gap = Math.max(1, v.s * 0.08);
    const c = v.s - gap;
    const i0 = Math.max(0, Math.floor(v.x - p.x)), i1 = Math.min(p.w, Math.ceil(v.x + W / v.s - p.x));
    const j0 = Math.max(0, Math.floor(v.y - p.y)), j1 = Math.min(p.h, Math.ceil(v.y + H / v.s - p.y));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const val = grid[j * p.w + i];
        const x = sx + i * v.s + gap / 2, y = sy + j * v.s + gap / 2;
        if (val < 0 || !colors[val]) {
          ctx.fillStyle = theme.empty;
          ctx.fillRect(x + c * 0.12, y + c * 0.12, c * 0.76, c * 0.76);
          continue;
        }
        const hex = colors[val].hex;
        ctx.fillStyle = hex;
        if (beads) {
          ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c / 2, 0, Math.PI * 2); ctx.fill();
          if (!codes) {
            ctx.fillStyle = U.shade(hex, 0.62);
            ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.17, 0, Math.PI * 2); ctx.fill();
          }
        } else {
          ctx.fillRect(x, y, c, c);
        }
        if (codes) {
          const code = colors[val].code;
          ctx.fillStyle = U.textOn(hex);
          ctx.font = '700 ' + Math.round(c * (code.length <= 2 ? 0.4 : code.length === 3 ? 0.32 : 0.25)) + 'px ' + 'system-ui, sans-serif';
          ctx.fillText(code, x + c / 2, y + c / 2 + 1);
        }
      }
    }
  }

  function drawPhoto() {
    const v = phView;
    const im = A.photo.display;
    if (!im) return;
    ctx.imageSmoothingEnabled = v.s < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, -v.x * v.s, -v.y * v.s, im.width * v.s, im.height * v.s);
    ctx.imageSmoothingEnabled = true;
    const rect = (r, color, dash) => {
      if (!r) return;
      const x = (r.x - v.x) * v.s, y = (r.y - v.y) * v.s, w = r.w * v.s, h = r.h * v.s;
      ctx.save();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeRect(x, y, w, h);
      ctx.lineWidth = 1.5; ctx.strokeStyle = color; if (dash) ctx.setLineDash(dash); ctx.strokeRect(x, y, w, h);
      ctx.restore();
    };
    const pal = A.currentPalette();
    if (pal && pal.wb && pal.wb.rect) {
      const r = pal.wb.rect;
      rect({ x: r[0], y: r[1], w: r[2], h: r[3] }, '#FFFFFF', [5, 4]);
    }
    if (A.photo.lastRect) rect(A.photo.lastRect, theme.accent || '#f06');
    if (A.photo.selRect) rect(A.photo.selRect, A.photoTool === 'white' ? '#FFFFFF' : '#FFFF66', [4, 3]);
  }

  // ---------- Gestes ----------
  function localXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function imageHandleAt(sx, sy) {
    const im = A.project.image;
    if (!im || A.tab !== 'image') return null;
    const v = wsView;
    const d = PP.geo.imgDims(im);
    const x0 = (im.x - v.x) * v.s, y0 = (im.y - v.y) * v.s, x1 = x0 + d.w * v.s, y1 = y0 + d.h * v.s;
    const t = handleSize() * (mobile() ? 1.4 : 1);
    const corners = { nw: [x0, y0], ne: [x1, y0], sw: [x0, y1], se: [x1, y1] };
    for (const k in corners) {
      if (Math.abs(sx - corners[k][0]) <= t && Math.abs(sy - corners[k][1]) <= t) return k;
    }
    return null;
  }
  function imageHit(wx, wy) {
    const im = A.project.image;
    if (!im) return false;
    const d = PP.geo.imgDims(im);
    return wx >= im.x && wx <= im.x + d.w && wy >= im.y && wy <= im.y + d.h;
  }
  function plateAt(wx, wy) {
    for (let k = A.project.plates.length - 1; k >= 0; k--) {
      const p = A.project.plates[k];
      if (wx >= p.x && wx < p.x + p.w && wy >= p.y && wy < p.y + p.h) return p;
    }
    return null;
  }

  function wantsPan(e) {
    if (e.button === 1 || e.button === 2) return true;
    if (spaceDown || A.hand) return true;
    if (isPhoto()) return A.photoTool === 'hand' || !A.photo.display;
    if (A.tab === 'edit' && A.edit.tool === 'hand') return true;
    return false;
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (!A.project) return;
    canvas.setPointerCapture(e.pointerId);
    const pt = localXY(e);
    pointers.set(e.pointerId, pt);
    if (pointers.size === 2) {
      endGesture(true);
      const [a, b] = Array.from(pointers.values());
      const v = view();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: v.s, world: toWorld(mid.x, mid.y, v) };
      return;
    }
    if (pointers.size > 2) return;
    startGesture(e, pt);
  });

  function startGesture(e, pt) {
    const v = view();
    const w = toWorld(pt.x, pt.y, v);
    if (wantsPan(e)) {
      gesture = { type: 'pan', sx: pt.x, sy: pt.y, vx: v.x, vy: v.y };
      updateCursor();
      return;
    }
    if (isPhoto()) {
      const px = { x: U.clamp(w.x, 0, A.photo.display.width), y: U.clamp(w.y, 0, A.photo.display.height) };
      gesture = { type: 'rect', start: px, sx: pt.x, sy: pt.y };
      A.photo.selRect = { x: px.x, y: px.y, w: 0, h: 0 };
      A.redraw();
      return;
    }
    const P = A.project;
    if (A.tab === 'plates') {
      const p = plateAt(w.x, w.y);
      if (p) {
        // la plaque saisie passe au premier plan pour la sélection
        A.sel = p.id;
        gesture = { type: 'plate', id: p.id, start: w, orig: { x: p.x, y: p.y }, bounds: A.workBounds(), moved: false };
        A.panels.refreshPlates();
      } else {
        gesture = { type: 'pan', sx: pt.x, sy: pt.y, vx: v.x, vy: v.y, click: true };
      }
      A.redraw();
      return;
    }
    if (A.tab === 'image' && P.image) {
      const h = imageHandleAt(pt.x, pt.y);
      if (h) {
        const im = P.image;
        const d = PP.geo.imgDims(im);
        const anchor = { x: h.includes('w') ? im.x + d.w : im.x, y: h.includes('n') ? im.y + d.h : im.y };
        gesture = { type: 'imgResize', corner: h, anchor, ar: d.h / d.w };
        return;
      }
      if (imageHit(w.x, w.y)) {
        gesture = { type: 'imgMove', start: w, orig: { x: P.image.x, y: P.image.y }, bounds: A.workBounds(), moved: false };
        updateCursor('grabbing');
        return;
      }
    }
    if (A.tab === 'edit' && A.hasResult()) {
      const cell = A.cellAt(w.x, w.y);
      if (cell) {
        A.sel = cell.plate.id;
        if (A.edit.tool === 'pick') { pickAt(cell); return; }
        if (A.edit.tool === 'fill') { floodFill(cell); return; }
        gesture = { type: 'paint', changes: new Map(), last: { x: Math.floor(w.x), y: Math.floor(w.y) } };
        paintAt(Math.floor(w.x), Math.floor(w.y));
        A.redraw();
        return;
      }
    }
    if (A.tab === 'export' && A.hasResult()) {
      const p = plateAt(w.x, w.y);
      if (p) { A.sel = p.id; A.panels.refreshExport(); A.redraw(); }
    }
    gesture = { type: 'pan', sx: pt.x, sy: pt.y, vx: v.x, vy: v.y, click: true };
    updateCursor();
  }

  canvas.addEventListener('pointermove', (e) => {
    if (!A.project) return;
    const pt = localXY(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
    if (gesture && gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const v = view();
      const lim = isPhoto() ? LIMITS.photo : LIMITS.ws;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      v.s = U.clamp(gesture.s0 * (d / gesture.d0), lim[0], lim[1]);
      v.x = gesture.world.x - mid.x / v.s;
      v.y = gesture.world.y - mid.y / v.s;
      updateZoomLabel();
      A.redraw();
      return;
    }
    if (!gesture) { onHover(pt); return; }
    moveGesture(pt);
  });

  function moveGesture(pt) {
    const v = view();
    const w = toWorld(pt.x, pt.y, v);
    const g = gesture;
    if (g.type === 'pan') {
      if (Math.abs(pt.x - g.sx) + Math.abs(pt.y - g.sy) > 3) g.click = false;
      v.x = g.vx - (pt.x - g.sx) / v.s;
      v.y = g.vy - (pt.y - g.sy) / v.s;
      A.redraw();
    } else if (g.type === 'plate') {
      movePlate(g, w);
    } else if (g.type === 'imgMove') {
      const im = A.project.image;
      const d = PP.geo.imgDims(im);
      const b = g.bounds;
      const nx = g.orig.x + Math.round(w.x - g.start.x);
      const ny = g.orig.y + Math.round(w.y - g.start.y);
      im.x = U.clamp(nx, b.x, Math.max(b.x, Math.floor(b.x + b.w - d.w)));
      im.y = U.clamp(ny, b.y, Math.max(b.y, Math.floor(b.y + b.h - d.h)));
      g.moved = g.moved || nx !== g.orig.x || ny !== g.orig.y;
      A.panels.refreshImageInfo();
      A.redraw();
    } else if (g.type === 'imgResize') {
      const im = A.project.image;
      const dx = Math.abs(w.x - g.anchor.x), dy = Math.abs(w.y - g.anchor.y);
      let nw = Math.max(dx, dy / g.ar);
      nw = Math.max(2, Math.round(nw));
      const nh = nw * g.ar;
      im.w = nw;
      im.x = Math.round(g.corner.includes('w') ? g.anchor.x - nw : g.anchor.x);
      im.y = Math.round(g.corner.includes('n') ? g.anchor.y - nh : g.anchor.y);
      g.moved = true;
      A.panels.refreshImageInfo();
      A.redraw();
    } else if (g.type === 'paint') {
      const cx = Math.floor(w.x), cy = Math.floor(w.y);
      // tracé continu entre deux positions (Bresenham)
      let x0 = g.last.x, y0 = g.last.y;
      const dx = Math.abs(cx - x0), dy = -Math.abs(cy - y0);
      const sxs = x0 < cx ? 1 : -1, sys = y0 < cy ? 1 : -1;
      let err = dx + dy;
      let guard = 0;
      while (guard++ < 10000) {
        paintAt(x0, y0);
        if (x0 === cx && y0 === cy) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sxs; }
        if (e2 <= dx) { err += dx; y0 += sys; }
      }
      g.last = { x: cx, y: cy };
      hover = w;
      updateCoords(w);
      A.redraw();
    } else if (g.type === 'rect') {
      const im = A.photo.display;
      const px = { x: U.clamp(w.x, 0, im.width), y: U.clamp(w.y, 0, im.height) };
      A.photo.selRect = {
        x: Math.min(g.start.x, px.x), y: Math.min(g.start.y, px.y),
        w: Math.abs(px.x - g.start.x), h: Math.abs(px.y - g.start.y),
      };
      g.moved = g.moved || Math.abs(pt.x - g.sx) + Math.abs(pt.y - g.sy) > 4;
      A.redraw();
    }
  }

  // Déplacement d'une plaque : grille d'un picot, aimantation, jamais de chevauchement
  function movePlate(g, w) {
    const p = A.plateById(g.id);
    if (!p) return;
    const b = g.bounds;
    let nx = g.orig.x + Math.round(w.x - g.start.x);
    let ny = g.orig.y + Math.round(w.y - g.start.y);
    const clampX = (x) => U.clamp(x, b.x, b.x + b.w - p.w);
    const clampY = (y) => U.clamp(y, b.y, b.y + b.h - p.h);
    nx = clampX(nx); ny = clampY(ny);
    if (A.settings.snap) {
      const t = Math.max(1, Math.round(10 / wsView.s));
      let bdx = null, bdy = null;
      A.project.plates.forEach((o) => {
        if (o.id === p.id) return;
        const n = 2 * t + 1;
        const yNear = ny < o.y + o.h + n && ny + p.h > o.y - n;
        const xNear = nx < o.x + o.w + n && nx + p.w > o.x - n;
        if (yNear) [o.x + o.w - nx, o.x - (nx + p.w), o.x - nx, o.x + o.w - (nx + p.w)].forEach((d) => {
          if (Math.abs(d) <= t && (bdx === null || Math.abs(d) < Math.abs(bdx))) bdx = d;
        });
        if (xNear) [o.y + o.h - ny, o.y - (ny + p.h), o.y - ny, o.y + o.h - (ny + p.h)].forEach((d) => {
          if (Math.abs(d) <= t && (bdy === null || Math.abs(d) < Math.abs(bdy))) bdy = d;
        });
      });
      if (bdx !== null) nx = clampX(nx + bdx);
      if (bdy !== null) ny = clampY(ny + bdy);
    }
    const free = (x, y) => !A.collides({ x, y, w: p.w, h: p.h }, p.id);
    if (free(nx, ny)) { p.x = nx; p.y = ny; }
    else if (free(nx, p.y)) { p.x = nx; }
    else if (free(p.x, ny)) { p.y = ny; }
    if (p.x !== g.orig.x || p.y !== g.orig.y) g.moved = true;
    A.redraw();
  }
  S.nudgePlate = function (id, dx, dy) {
    const p = A.plateById(id);
    if (!p) return;
    const b = A.workBounds();
    const nx = U.clamp(p.x + dx, b.x, b.x + b.w - p.w), ny = U.clamp(p.y + dy, b.y, b.y + b.h - p.h);
    if (!A.collides({ x: nx, y: ny, w: p.w, h: p.h }, p.id)) { p.x = nx; p.y = ny; A.touch(); }
    else A.toast('Les plaques ne peuvent pas se chevaucher.');
  };
  S.nudgeImage = function (dx, dy) {
    const im = A.project.image;
    if (!im) return;
    const b = A.workBounds();
    const d = PP.geo.imgDims(im);
    im.x = U.clamp(im.x + dx, b.x, Math.floor(b.x + b.w - d.w));
    im.y = U.clamp(im.y + dy, b.y, Math.floor(b.y + b.h - d.h));
    A.touch();
    A.panels.refreshImageInfo();
  };

  function endGesture(cancelled) {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.type === 'plate') {
      if (g.moved) { A.touch(); A.panels.refreshPlates(); }
    } else if (g.type === 'imgMove' || g.type === 'imgResize') {
      if (g.moved) { A.touch(); A.panels.refreshImageInfo(); }
    } else if (g.type === 'paint') {
      commitStroke(g);
    } else if (g.type === 'pan' && g.click && !cancelled) {
      if (A.tab === 'plates' && A.sel) { A.sel = null; A.panels.refreshPlates(); }
    } else if (g.type === 'rect') {
      const r = A.photo.selRect;
      A.photo.selRect = null;
      if (!cancelled && r) A.panels.onPhotoRect(g.moved && r.w >= 2 && r.h >= 2 ? r : null, g.start);
    }
    updateCursor();
    A.redraw();
  }

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === 'pinch') {
      if (pointers.size < 2) gesture = null;
      return;
    }
    if (pointers.size === 0) endGesture(e.type === 'pointercancel');
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    if (!gesture) { hover = null; updateCoords(null); if (A.tab === 'edit') A.redraw(); }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const pt = localXY(e);
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const k = e.ctrlKey ? 0.01 : 0.0018;
    zoomAt(pt.x, pt.y, Math.exp(-dy * k));
  }, { passive: false });

  function onHover(pt) {
    const w = toWorld(pt.x, pt.y);
    hover = w;
    updateCoords(w);
    updateCursor(null, pt, w);
    if (A.tab === 'edit') A.redraw();
  }

  function updateCoords(w) {
    const el = document.getElementById('coords');
    if (!el) return;
    if (!w || isPhoto() || !A.project) { el.textContent = ''; return; }
    const c = A.cellAt(w.x, w.y);
    if (!c) { el.textContent = ''; return; }
    let txt = c.plate.name + ' · ' + U.colLetters(c.i) + (c.j + 1);
    const r = A.project.result;
    if (r && (A.tab === 'edit' || A.tab === 'export')) {
      const g = r.grids[c.plate.id];
      const val = g ? g[c.idx] : -1;
      txt += val >= 0 && r.colors[val] ? ' · ' + r.colors[val].code + (r.colors[val].name ? ' ' + r.colors[val].name : '') : ' · vide';
    }
    el.textContent = txt;
  }

  function setCursor(cls) {
    canvas.className = cls || '';
  }
  function updateCursor(force, pt, w) {
    if (force) return setCursor(force);
    if (gesture && gesture.type === 'pan') return setCursor('grabbing');
    if (spaceDown || A.hand) return setCursor('grab');
    if (!A.project) return setCursor('');
    if (isPhoto()) return setCursor(A.photoTool === 'hand' ? 'grab' : 'cross');
    if (A.tab === 'edit') return setCursor(A.edit.tool === 'hand' ? 'grab' : 'cross');
    if (A.tab === 'image' && pt && A.project.image) {
      const h = imageHandleAt(pt.x, pt.y);
      if (h) return setCursor(h === 'nw' || h === 'se' ? 'nwse' : 'nesw');
      if (w && imageHit(w.x, w.y)) return setCursor('move');
      return setCursor('grab');
    }
    if (A.tab === 'plates' && w) return setCursor(plateAt(w.x, w.y) ? 'move' : 'grab');
    setCursor('');
  }
  S.setSpace = function (v) { spaceDown = v; updateCursor(); };
  S.updateCursor = () => updateCursor();

  // ---------- Retouche ----------
  function gridFor(plate) {
    const r = A.project.result;
    let g = r.grids[plate.id];
    if (!g || g.length !== plate.w * plate.h) {
      g = new Int16Array(plate.w * plate.h).fill(-1);
      r.grids[plate.id] = g;
    }
    return g;
  }

  function paintAt(cx, cy) {
    const g = gesture;
    if (!g || g.type !== 'paint') return;
    const size = A.edit.size;
    const off = Math.floor((size - 1) / 2);
    const nv = A.edit.tool === 'erase' ? -1 : A.edit.color;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const c = A.cellAt(cx - off + dx + 0.5, cy - off + dy + 0.5);
        if (!c) continue;
        const grid = gridFor(c.plate);
        const old = grid[c.idx];
        if (old === nv) continue;
        const key = c.plate.id + ':' + c.idx;
        if (!g.changes.has(key)) g.changes.set(key, { pid: c.plate.id, idx: c.idx, old, nv });
        else g.changes.get(key).nv = nv;
        grid[c.idx] = nv;
        A.plateCache.delete(c.plate.id);
      }
    }
  }

  function commitStroke(g) {
    if (!g.changes.size) return;
    S.pushUndo(Array.from(g.changes.values()));
  }

  S.pushUndo = function (changes) {
    if (!changes.length) return;
    A.edit.undo.push(changes);
    if (A.edit.undo.length > 150) A.edit.undo.shift();
    A.edit.redo = [];
    A.project.result.edited = true;
    A.touch();
    A.panels.refreshEdit();
  };

  S.undo = function (redo) {
    const from = redo ? A.edit.redo : A.edit.undo;
    const to = redo ? A.edit.undo : A.edit.redo;
    const ch = from.pop();
    if (!ch) return;
    ch.forEach((c) => {
      const g = A.project.result.grids[c.pid];
      if (g) g[c.idx] = redo ? c.nv : c.old;
      A.plateCache.delete(c.pid);
    });
    to.push(ch);
    A.touch();
    A.panels.refreshEdit();
  };

  function pickAt(cell) {
    const g = A.project.result.grids[cell.plate.id];
    const v = g ? g[cell.idx] : -1;
    if (v >= 0) {
      A.edit.color = v;
      A.edit.tool = 'brush';
      A.panels.refreshEdit();
    } else {
      A.toast('Ce picot est vide.');
    }
  }

  function floodFill(cell) {
    const p = cell.plate;
    const grid = gridFor(p);
    const target = grid[cell.idx];
    const nv = A.edit.color;
    if (target === nv) return;
    const changes = [];
    const stack = [cell.idx];
    const seen = new Uint8Array(grid.length);
    while (stack.length) {
      const k = stack.pop();
      if (seen[k] || grid[k] !== target) continue;
      seen[k] = 1;
      changes.push({ pid: p.id, idx: k, old: target, nv });
      grid[k] = nv;
      const i = k % p.w, j = (k / p.w) | 0;
      if (i > 0) stack.push(k - 1);
      if (i < p.w - 1) stack.push(k + 1);
      if (j > 0) stack.push(k - p.w);
      if (j < p.h - 1) stack.push(k + p.w);
    }
    A.plateCache.delete(p.id);
    S.pushUndo(changes);
  }

  S.centerOnPlate = function (id) {
    const p = A.plateById(id);
    if (!p || isPhoto()) return;
    const v = wsView;
    v.x = p.x + p.w / 2 - W / 2 / v.s;
    v.y = p.y + p.h / 2 - H / 2 / v.s;
    A.redraw();
  };

  S.size = () => ({ W, H });
})();
