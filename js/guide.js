/* Pixel Perles — Pose guidée.
   « Sur l'écran » : la plaque transparente est posée sur la tablette, ancrée dans un coin éclairé ; l'écran montre
   les perles à taille réelle sous les picots. Calage en une étape (deux cercles sous deux picots), mémorisé par écran
   et par modèle de plaque ; le motif se place librement sur les picots de la plaque.
   « À côté » : la tablette est posée à côté de la plaque et montre le modèle bloc par bloc, avec repères et légende. */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;

  const G = (A.guide = {});
  let st = null;
  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let wakeLock = null;
  let hits = []; // zones touchables dessinées (légende du mode « à côté »)

  const COL = { green: '#3CE07A', yellow: '#FFD23C', blue: '#6FB8FF' };

  // ---------- Écran et calage ----------
  function deviceKey() {
    const a = Math.max(screen.width, screen.height), b = Math.min(screen.width, screen.height);
    return a + 'x' + b + '@' + (Math.round((window.devicePixelRatio || 1) * 100) / 100);
  }
  // estimation avant calage : pixels CSS par millimètre (iPad : 132 px CSS par pouce)
  function guessPxPerMm() {
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const minSide = Math.min(screen.width, screen.height);
    if (!coarse) return 96 / 25.4;
    return (minSide >= 600 ? 132 : 163) / 25.4;
  }
  function models() {
    const list = A.PRESETS.filter((p) => p.id !== 'custom').map((p) => ({ key: p.id, label: p.label, w: p.w, h: p.h, pitch: p.pitch }));
    const pl = plate();
    if (pl && !list.some((m) => m.w === pl.w && m.h === pl.h)) {
      list.push({ key: 'custom:' + pl.w + 'x' + pl.h, label: 'Plaque ' + pl.w + ' × ' + pl.h + ' (comme le motif)', w: pl.w, h: pl.h, pitch: pl.pitch || 2.6 });
    }
    return list;
  }
  function model() {
    const list = models();
    return list.find((m) => m.key === gs().model) || list.find((m) => m.key === (plate() && plate().preset)) || list[0];
  }
  function cal(m) {
    m = m || model();
    const all = (A.settings.guideCal2 = A.settings.guideCal2 || {});
    const k = deviceKey() + '|' + m.key;
    if (!all[k]) {
      const pp = guessPxPerMm() * m.pitch;
      all[k] = { pp, corner: 'tr', offX: pp * 0.5 + 3 * guessPxPerMm(), offY: pp * 0.5 + 3 * guessPxPerMm(), light: true, calibrated: false };
    }
    return all[k];
  }
  G.isCalibrated = () => { try { return !!cal().calibrated; } catch (e) { return false; } };
  G.applySide = () => {};

  // ---------- Projet ----------
  const P = () => A.project;
  const gs = () => P().guide;
  function plate() { return st ? (A.plateById(st.plateId) || P().plates[0]) : P().plates[0]; }
  function plateState(id) {
    const g = gs();
    g.state = g.state || {};
    if (!g.state[id]) g.state[id] = { row: 0, color: null, done: [], block: 0, blocksDone: [] };
    const s = g.state[id];
    if (!s.blocksDone) s.blocksDone = [];
    if (s.block == null) s.block = 0;
    return s;
  }
  function gridOf(p) {
    const r = P().result;
    const g = r && r.grids[p.id];
    return g && g.length === p.w * p.h ? g : new Int16Array(p.w * p.h).fill(-1);
  }
  function lbl(c) {
    const mode = gs().label || 'auto';
    const nm = (c.name || '').trim();
    if (mode === 'code') return c.code;
    if (mode === 'name') return nm || c.code;
    return nm && nm.length <= 6 && /\d/.test(nm) && !/\s/.test(nm) ? nm : c.code;
  }
  G.label = lbl;
  function colorsOf(p, filter) {
    const r = P().result;
    const g = gridOf(p);
    const counts = new Map();
    for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
      if (filter && !filter(i, j)) continue;
      const v = g[j * p.w + i];
      if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([idx, n]) => ({ idx, n, c: r.colors[idx] }))
      .sort((a, b) => U.naturalCompare(lbl(a.c), lbl(b.c)));
  }

  // ---------- Motif tourné, blocs ----------
  const rot = () => gs().rot || 0;
  function dims(p) { return rot() % 180 ? { w: p.h, h: p.w } : { w: p.w, h: p.h }; }
  // case affichée (di, dj) → case du motif (i, j)
  function fromDisplay(di, dj, p) {
    const r = rot();
    if (r === 90) return [dj, p.h - 1 - di];
    if (r === 180) return [p.w - 1 - di, p.h - 1 - dj];
    if (r === 270) return [p.w - 1 - dj, di];
    return [di, dj];
  }
  function toDisplay(i, j, p) {
    const r = rot();
    if (r === 90) return [p.h - 1 - j, i];
    if (r === 180) return [p.w - 1 - i, p.h - 1 - j];
    if (r === 270) return [j, p.w - 1 - i];
    return [i, j];
  }
  const blockSize = () => gs().blockSize || 10;
  function blocks(p) {
    const B = blockSize();
    const d = dims(p);
    const nx = Math.ceil(d.w / B), ny = Math.ceil(d.h / B);
    return { B, nx, ny, n: nx * ny };
  }
  function blockRect(p, k) {
    const b = blocks(p);
    const bx = k % b.nx, by = Math.floor(k / b.nx);
    const d = dims(p);
    const x0 = bx * b.B, y0 = by * b.B;
    return { x0, y0, x1: Math.min(d.w, x0 + b.B), y1: Math.min(d.h, y0 + b.B), bx, by };
  }
  function blockName(p, k) {
    const r = blockRect(p, k);
    return 'Bloc ' + U.colLetters(r.bx) + (r.by + 1);
  }

  // ---------- Ouverture ----------
  G.open = function (plateId) {
    if (!A.hasResult()) { A.toast('Lancez d’abord la conversion.', 'error'); return; }
    canvas = $('guideCanvas');
    ctx = canvas.getContext('2d');
    const g = gs();
    if (!g.view) g.view = 'screen';
    if (!g.mode || !['color', 'row', 'block', 'all'].includes(g.mode)) g.mode = 'color';
    st = { plateId: plateId || g.plateId || P().plates[0].id, locked: false, panel: true, calib: false, placing: false, fine: true, highlight: null };
    g.plateId = st.plateId;
    $('guide').hidden = false;
    document.documentElement.classList.add('guide-open');
    $('toasts').innerHTML = '';
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVis);
    requestWake();
    showPanel(true);
    resize();
    refreshPanel();
    if (g.view === 'screen' && !cal().calibrated) startCalib();
  };

  G.close = function () {
    if (!st) return;
    st = null;
    $('guide').hidden = true;
    document.documentElement.classList.remove('guide-open');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVis);
    releaseWake();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    A.saveSettings();
    A.touch();
    if (A.panels) A.panels.refreshGuidePane();
  };

  async function requestWake() {
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }
  function onVis() { if (st && document.visibilityState === 'visible') requestWake(); }

  function resize() {
    if (!st) return;
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    draw();
  }

  function showPanel(open) {
    st.panel = open;
    $('guidePanel').hidden = !open;
    $('gMini').hidden = open;
    syncMini();
    draw();
  }

  // zone libre : l'écran moins le menu (ou la barre réduite), à gauche
  function freeArea() {
    const el = st.panel ? $('guidePanel') : $('gMini');
    const w = el.hidden ? 0 : el.getBoundingClientRect().right;
    return { x: w, y: 0, w: Math.max(50, W - w), h: H };
  }

  // ---------- Géométrie « sur l'écran » ----------
  function layout() {
    const m = model();
    const c = cal(m);
    const pp = c.pp;
    const left = c.corner[1] === 'l', top = c.corner[0] === 't';
    const ax = left ? c.offX : W - c.offX, ay = top ? c.offY : H - c.offY;
    // centre du picot (a, b) de la plaque, a = colonne depuis la gauche, b = rangée depuis le haut
    const peg = (a, b) => [left ? ax + a * pp : ax - (m.w - 1 - a) * pp, top ? ay + b * pp : ay - (m.h - 1 - b) * pp];
    const cornerPeg = [left ? 0 : m.w - 1, top ? 0 : m.h - 1];
    const rowEnd = [left ? m.w - 1 : 0, cornerPeg[1]];
    const colEnd = [cornerPeg[0], top ? m.h - 1 : 0];
    return { m, c, pp, peg, cornerPeg, rowEnd, colEnd, left, top };
  }
  function placement(p, m) {
    const ps = plateState(p.id);
    const d = dims(p);
    if (!ps.place || ps.place.model !== m.key || ps.place.rot !== rot()) {
      ps.place = { model: m.key, rot: rot(), i: Math.floor((m.w - d.w) / 2), j: Math.floor((m.h - d.h) / 2) };
    }
    return ps.place;
  }

  // ---------- Dessin ----------
  function draw() {
    if (!st || !ctx) return;
    hits = [];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (gs().view === 'side') { drawSide(); return; }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const p = plate();
    if (!p) return;
    const L = layout();
    const pxmm = L.pp / L.m.pitch;

    // coin éclairé : un L blanc le long des deux bords
    if (L.c.light !== false) {
      const room = Math.min(L.c.offX, L.c.offY) - L.pp * 0.55;
      const t = Math.max(3, Math.min(4 * pxmm, room)), len = Math.min(W, H) * 0.28;
      ctx.fillStyle = '#FFFFFF';
      const x = L.left ? 0 : W - len, y = L.top ? 0 : H - t;
      ctx.fillRect(x, y, len, t);
      ctx.fillRect(L.left ? 0 : W - t, L.top ? 0 : H - len, t, len);
    }

    // picots de la plaque : petits points
    const dotR = Math.max(1, L.pp * 0.08);
    ctx.fillStyle = '#3a3a3a';
    for (let b = 0; b < L.m.h; b++) for (let a = 0; a < L.m.w; a++) {
      const [x, y] = L.peg(a, b);
      ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2); ctx.fill();
    }

    if (st.calib) { drawCalibMarks(L); return; }

    const pl = placement(p, L.m);
    const d = dims(p);
    const g = gs();
    const ps = plateState(p.id);
    const r = P().result;
    const grid = gridOf(p);
    const mode = g.mode;
    const colors = colorsOf(p);
    if (mode === 'color' && (ps.color === null || !colors.some((x) => x.c.code === ps.color))) ps.color = colors[0] ? colors[0].c.code : null;
    const curIdx = mode === 'color' ? (colors.find((x) => x.c.code === ps.color) || {}).idx : -2;
    const done = new Set(ps.done);
    const bright = (g.bright || 100) / 100;
    const hide = g.others === 'hide';
    const rad = L.pp * 0.46;
    const showCodes = g.codes && L.pp >= 15;
    const br = mode === 'block' ? blockRect(p, ps.block) : null;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let dj = 0; dj < d.h; dj++) {
      for (let di = 0; di < d.w; di++) {
        const [i, j] = fromDisplay(di, dj, p);
        const v = grid[j * p.w + i];
        if (v < 0 || !r.colors[v]) continue;
        const col = r.colors[v];
        let alpha = 1, ring = false;
        if (mode === 'color') {
          if (v === curIdx) ring = true;
          else if (done.has(col.code)) alpha = 0.3;
          else alpha = hide ? 0 : 0.12;
        } else if (mode === 'row') {
          if (j === ps.row) ring = true;
          else if (j < ps.row) alpha = 0.3;
          else alpha = hide ? 0 : 0.12;
        } else if (mode === 'block') {
          const inB = di >= br.x0 && di < br.x1 && dj >= br.y0 && dj < br.y1;
          if (inB) { if (st.highlight != null && v !== st.highlight) alpha = 0.25; }
          else alpha = hide ? 0 : 0.1;
        }
        if (alpha === 0) continue;
        const [x, y] = L.peg(pl.i + di, pl.j + dj);
        ctx.globalAlpha = alpha * bright;
        ctx.fillStyle = col.hex;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
        if (ring) {
          ctx.globalAlpha = bright;
          ctx.lineWidth = Math.max(1, L.pp * 0.07);
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();
        }
        if (showCodes && alpha >= 0.99) {
          const t = lbl(col);
          ctx.globalAlpha = bright;
          ctx.fillStyle = U.textOn(col.hex);
          ctx.font = '700 ' + Math.round(L.pp * (t.length <= 2 ? 0.42 : t.length === 3 ? 0.33 : 0.26)) + 'px system-ui, sans-serif';
          ctx.fillText(t, x, y + 1);
        }
      }
    }
    ctx.globalAlpha = 1;

    // repères : bloc en cours, ligne en cours, contour du motif pendant le placement
    const cellRect = (x0, y0, x1, y1) => {
      const a = L.peg(pl.i + x0, pl.j + y0), b = L.peg(pl.i + x1 - 1, pl.j + y1 - 1);
      return [Math.min(a[0], b[0]) - L.pp / 2, Math.min(a[1], b[1]) - L.pp / 2, Math.abs(b[0] - a[0]) + L.pp, Math.abs(b[1] - a[1]) + L.pp];
    };
    ctx.lineWidth = 1.5;
    if (mode === 'block' && br) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.strokeRect(...cellRect(br.x0, br.y0, br.x1, br.y1));
    }
    if (mode === 'row') {
      const [ra, rb] = toDisplay(0, ps.row, p), [rc, rd] = toDisplay(p.w - 1, ps.row, p);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeRect(...cellRect(Math.min(ra, rc), Math.min(rb, rd), Math.max(ra, rc) + 1, Math.max(rb, rd) + 1));
      ctx.setLineDash([]);
    }
    if (st.placing) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = COL.yellow;
      ctx.lineWidth = 2;
      ctx.strokeRect(...cellRect(0, 0, d.w, d.h));
      ctx.setLineDash([]);
    }
    // cercles de contrôle aux coins de la plaque tant que ce n'est pas verrouillé
    if (!st.locked) {
      [[0, 0], [L.m.w - 1, 0], [0, L.m.h - 1], [L.m.w - 1, L.m.h - 1]].forEach(([a, b]) => {
        const [x, y] = L.peg(a, b);
        ctx.strokeStyle = a === L.cornerPeg[0] && b === L.cornerPeg[1] ? COL.green : 'rgba(255,210,60,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, L.pp * 0.5, 0, Math.PI * 2); ctx.stroke();
      });
    }
  }

  function drawCalibMarks(L) {
    const mark = (a, b, color, label) => {
      const [x, y] = L.peg(a, b);
      const r = Math.max(8, L.pp * 0.55);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 1.8, y); ctx.lineTo(x - r * 0.4, y); ctx.moveTo(x + r * 0.4, y); ctx.lineTo(x + r * 1.8, y);
      ctx.moveTo(x, y - r * 1.8); ctx.lineTo(x, y - r * 0.4); ctx.moveTo(x, y + r * 0.4); ctx.lineTo(x, y + r * 1.8);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, L.pp * 0.1), 0, Math.PI * 2); ctx.fill();
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const [cx, cy] = L.peg((L.m.w - 1) / 2, (L.m.h - 1) / 2);
      const sx = Math.sign(cx - x) || 1, sy = Math.sign(cy - y) || 1;
      ctx.textAlign = sx > 0 ? 'left' : 'right';
      ctx.fillText(label, x + sx * r * 1.4, y + sy * r * 2.4);
    };
    mark(...L.cornerPeg, COL.green, '1 · coin');
    mark(...L.rowEnd, COL.yellow, '2 · fin de rangée');
    mark(...L.colEnd, COL.blue, '3 · vérification');
  }

  // ---------- « À côté » : un bloc en grand, repères et légende ----------
  function drawSide() {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    const p = plate();
    if (!p) return;
    const g = gs();
    const ps = plateState(p.id);
    const r = P().result;
    const grid = gridOf(p);
    const d = dims(p);
    const fa = freeArea();
    const whole = g.mode !== 'block';
    const br = whole ? { x0: 0, y0: 0, x1: d.w, y1: d.h } : blockRect(p, ps.block);
    const cols = br.x1 - br.x0, rows = br.y1 - br.y0;
    const legendSide = fa.w > fa.h * 1.05;
    const pad = 14;
    const legendW = legendSide ? Math.min(240, fa.w * 0.3) : 0;
    const legendH = legendSide ? 0 : Math.min(fa.h * 0.32, 220);
    const lab = 26;
    const cell = Math.max(4, Math.min((fa.w - legendW - lab - pad * 3) / cols, (fa.h - legendH - lab - pad * 3) / rows));
    const gx = fa.x + pad + lab, gy = fa.y + pad + lab;
    const inBlock = (di, dj) => di >= br.x0 && di < br.x1 && dj >= br.y0 && dj < br.y1;
    const legend = colorsOf(p, (i, j) => { const [di, dj] = toDisplay(i, j, p); return inBlock(di, dj); });

    // repères : lettres des colonnes, numéros des lignes (comme sur l'export)
    ctx.fillStyle = '#1B1F24';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lf = Math.max(9, Math.min(15, cell * 0.45));
    ctx.font = '700 ' + lf + 'px system-ui, sans-serif';
    const every = cell < 12 ? 5 : 1;
    for (let c = 0; c < cols; c++) if ((br.x0 + c) % every === 0 || every === 1) ctx.fillText(U.colLetters(br.x0 + c), gx + (c + 0.5) * cell, gy - lab / 2);
    for (let rr = 0; rr < rows; rr++) if ((br.y0 + rr) % every === 0 || every === 1) ctx.fillText(String(br.y0 + rr + 1), gx - lab / 2, gy + (rr + 0.5) * cell);

    // cases
    const gap = Math.max(1, cell * 0.08);
    const showCodes = cell >= 18;
    for (let rr = 0; rr < rows; rr++) {
      for (let c = 0; c < cols; c++) {
        const [i, j] = fromDisplay(br.x0 + c, br.y0 + rr, p);
        const v = grid[j * p.w + i];
        const x = gx + c * cell + gap / 2, y = gy + rr * cell + gap / 2, s = cell - gap;
        if (v < 0 || !r.colors[v]) {
          ctx.fillStyle = '#E4E5E7';
          PP.render.rr(ctx, x, y, s, s, s * 0.15); ctx.fill();
          continue;
        }
        const col = r.colors[v];
        ctx.globalAlpha = st.highlight != null && v !== st.highlight ? 0.15 : 1;
        ctx.fillStyle = col.hex;
        PP.render.rr(ctx, x, y, s, s, s * 0.15); ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = U.shade(col.hex, 0.72);
        ctx.stroke();
        if (showCodes) {
          const t = lbl(col);
          ctx.fillStyle = U.textOn(col.hex);
          ctx.font = '700 ' + Math.round(s * (t.length <= 2 ? 0.42 : t.length === 3 ? 0.33 : 0.26)) + 'px system-ui, sans-serif';
          ctx.fillText(t, x + s / 2, y + s / 2 + 1);
        }
        ctx.globalAlpha = 1;
      }
    }
    // traits tous les 5 picots pour compter plus facilement
    ctx.strokeStyle = 'rgba(27,31,36,0.35)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) if ((br.x0 + c) % 5 === 0) { ctx.beginPath(); ctx.moveTo(gx + c * cell, gy); ctx.lineTo(gx + c * cell, gy + rows * cell); ctx.stroke(); }
    for (let rr = 0; rr <= rows; rr++) if ((br.y0 + rr) % 5 === 0) { ctx.beginPath(); ctx.moveTo(gx, gy + rr * cell); ctx.lineTo(gx + cols * cell, gy + rr * cell); ctx.stroke(); }

    // légende : carte du motif avec le bloc, puis les couleurs du bloc avec leur quantité
    const lx = legendSide ? gx + cols * cell + pad * 1.5 : fa.x + pad;
    let ly = legendSide ? gy - lab : gy + rows * cell + pad;
    const lw = legendSide ? fa.x + fa.w - lx - pad : fa.w - pad * 2;
    ctx.textAlign = 'left';
    if (!whole) {
      const mm = Math.min(lw / d.w, 90 / d.h);
      const mini = document.createElement('canvas');
      mini.width = d.w; mini.height = d.h;
      const mctx = mini.getContext('2d');
      const img = mctx.createImageData(d.w, d.h);
      const rgb = r.colors.map((c) => U.hexToRgb(c.hex) || [0, 0, 0]);
      for (let dj = 0; dj < d.h; dj++) for (let di = 0; di < d.w; di++) {
        const [i, j] = fromDisplay(di, dj, p);
        const v = grid[j * p.w + i];
        const c = v >= 0 && rgb[v] ? rgb[v] : [228, 229, 231];
        const k = (dj * d.w + di) * 4;
        img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
      }
      mctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mini, lx, ly, d.w * mm, d.h * mm);
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(lx, ly, d.w * mm, d.h * mm);
      ctx.drawImage(mini, br.x0, br.y0, br.x1 - br.x0, br.y1 - br.y0, lx + br.x0 * mm, ly + br.y0 * mm, (br.x1 - br.x0) * mm, (br.y1 - br.y0) * mm);
      ctx.strokeStyle = '#D3366F';
      ctx.lineWidth = 2;
      ctx.strokeRect(lx + br.x0 * mm, ly + br.y0 * mm, (br.x1 - br.x0) * mm, (br.y1 - br.y0) * mm);
      ctx.fillStyle = '#1B1F24';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText(blockName(p, ps.block) + ' · ' + U.colLetters(br.x0) + '–' + U.colLetters(br.x1 - 1) + ', ' + (br.y0 + 1) + '–' + br.y1, lx + d.w * mm + 10, ly + 10);
      ly += d.h * mm + 14;
    } else {
      ctx.fillStyle = '#1B1F24';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText(p.name + ' · ' + d.w + ' × ' + d.h, lx, ly + 10);
      ly += 26;
    }
    const rowH = 28;
    const colsL = legendSide ? 1 : Math.max(1, Math.floor(lw / 170));
    const cw = lw / colsL;
    legend.forEach((x, k) => {
      const cx = lx + (k % colsL) * cw, cy = ly + Math.floor(k / colsL) * rowH;
      if (cy + rowH > fa.y + fa.h) return;
      const on = st.highlight === x.idx;
      if (on) { ctx.fillStyle = '#F8E2EA'; PP.render.rr(ctx, cx - 4, cy, cw - 4, rowH - 3, 6); ctx.fill(); }
      ctx.fillStyle = x.c.hex;
      ctx.beginPath(); ctx.arc(cx + 10, cy + rowH / 2 - 1, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = U.shade(x.c.hex, 0.7); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#1B1F24';
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(lbl(x.c), cx + 26, cy + rowH / 2);
      const nm = lbl(x.c) === x.c.code ? (x.c.name || '') : x.c.code;
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillStyle = '#5B6470';
      ctx.fillText(nm.slice(0, 16), cx + 80, cy + rowH / 2);
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillStyle = '#1B1F24';
      ctx.textAlign = 'right';
      ctx.fillText('× ' + x.n, cx + cw - 10, cy + rowH / 2);
      ctx.textAlign = 'left';
      hits.push({ x: cx - 4, y: cy, w: cw - 4, h: rowH, idx: x.idx });
    });
  }

  // ---------- Panneau ----------
  function setSeg(el, v) {
    el.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  }

  function refreshPanel() {
    if (!st) return;
    const g = gs();
    const p = plate();
    const side = g.view === 'side';
    if (side && (g.mode === 'color' || g.mode === 'row')) g.mode = 'block';
    $('guidePlate').innerHTML = P().plates.map((x, k) => '<option value="' + x.id + '">' + esc(x.name) + ' · ' + x.w + '×' + x.h + (P().plates.length > 1 ? ' (' + (k + 1) + '/' + P().plates.length + ')' : '') + '</option>').join('');
    $('guidePlate').value = p.id;
    setSeg($('gView'), g.view);
    setSeg($('guideMode'), g.mode);
    $('guideMode').querySelector('[data-v=color]').hidden = side;
    $('guideMode').querySelector('[data-v=row]').hidden = side;
    setSeg($('gOthers'), g.others || 'dim');
    setSeg($('gLabel'), g.label || 'auto');
    $('gCodes').checked = !!g.codes;
    $('gBright').value = g.bright || 100;
    $('gBrightOut').textContent = (g.bright || 100) + ' %';
    $('gBlockSize').value = String(blockSize());

    const m = model();
    $('gModel').innerHTML = models().map((x) => '<option value="' + x.key + '">' + esc(x.label) + '</option>').join('');
    $('gModel').value = m.key;
    const c = cal(m);
    setSeg($('gCorner'), c.corner);
    $('gCornerLight').checked = c.light !== false;
    $('gCalState').textContent = c.calibrated
      ? 'Écran calé pour cette plaque : 1 picot = ' + c.pp.toFixed(2).replace('.', ',') + ' px.'
      : 'Écran pas encore calé pour cette plaque : appuyez sur « Caler l’écran ».';

    const special = st.calib || st.placing;
    $('gCalibBox').hidden = !st.calib;
    $('gPlaceBox').hidden = !st.placing;
    $('gMainBox').hidden = special;
    // pendant le calage, on garde le choix de la plaque posée et du coin juste sous les explications
    $('gPlateSec').hidden = side || st.placing;
    $('gMoveSec').hidden = side;
    $('gMoveTitle').textContent = st.placing ? 'Déplacer le motif' : 'Ajuster la grille';
    $('gStep').textContent = st.placing ? '1 picot' : st.fine ? 'fin' : 'rapide';
    $('gStep').disabled = st.placing;
    document.querySelectorAll('#gMoveSec .btn').forEach((b) => { b.disabled = st.locked && !special; });
    $('gSizeVal').textContent = c.pp.toFixed(2).replace('.', ',') + ' px';
    if (st.placing) {
      const pl = placement(p, m), d = dims(p);
      $('gPlaceInfo').textContent = 'Motif ' + d.w + ' × ' + d.h + ' sur une plaque ' + m.w + ' × ' + m.h + ' · départ au picot ' + U.colLetters(pl.i) + (pl.j + 1) + '.';
    }
    $('guideColorBox').hidden = special || g.mode !== 'color';
    $('guideRowBox').hidden = special || g.mode !== 'row';
    $('guideBlockBox').hidden = special || g.mode !== 'block';
    $('gLock').classList.toggle('on', st.locked);
    $('gLock').querySelector('span').textContent = st.locked ? 'Tactile verrouillé · toucher pour déverrouiller' : 'Verrouiller le tactile';
    $('gLock').querySelector('use').setAttribute('href', st.locked ? '#i-lock' : '#i-unlock');
    if (!special) {
      if (g.mode === 'color') refreshColors();
      else if (g.mode === 'row') refreshRow();
      else if (g.mode === 'block') refreshBlock();
    }
    syncMini();
    draw();
  }

  function syncMini() {
    if (!st) return;
    const g = gs();
    $('gMiniLock').classList.toggle('on', st.locked);
    $('gMiniLock').querySelector('use').setAttribute('href', st.locked ? '#i-lock' : '#i-unlock');
    $('gMiniLock').title = st.locked ? 'Déverrouiller le tactile' : 'Verrouiller le tactile';
    const sw = $('gMiniSw');
    const p = plate();
    const ps = plateState(p.id);
    sw.style.background = '';
    sw.style.color = '';
    sw.textContent = '';
    if (g.mode === 'color' && ps.color) {
      const x = colorsOf(p).find((y) => y.c.code === ps.color);
      if (x) { sw.style.background = x.c.hex; sw.style.color = U.textOn(x.c.hex); sw.textContent = lbl(x.c); }
    } else if (g.mode === 'row') sw.textContent = 'L' + (ps.row + 1);
    else if (g.mode === 'block') sw.textContent = blockName(p, ps.block).replace('Bloc ', '');
    $('gMiniDone').hidden = !(g.mode === 'color' || g.mode === 'block');
  }

  function refreshColors() {
    const p = plate();
    const ps = plateState(p.id);
    const list = colorsOf(p);
    const cur = list.find((x) => x.c.code === ps.color) || list[0];
    if (!cur) { $('gColorList').innerHTML = ''; return; }
    ps.color = cur.c.code;
    const done = new Set(ps.done);
    $('gColorSwatch').style.background = cur.c.hex;
    $('gColorSwatch').style.color = U.textOn(cur.c.hex);
    $('gColorSwatch').textContent = lbl(cur.c);
    $('gColorName').textContent = lbl(cur.c) === cur.c.code ? (cur.c.name || cur.c.code) : lbl(cur.c) + ' (n° ' + cur.c.code + ')';
    $('gColorCount').textContent = U.fmtInt(cur.n) + ' perle' + (cur.n > 1 ? 's' : '') + ' · couleur ' + (list.indexOf(cur) + 1) + ' sur ' + list.length;
    $('gDone').querySelector('span').textContent = done.has(cur.c.code) ? 'Posée ✓ (annuler)' : 'Marquer posée';
    $('gDone').classList.toggle('on', done.has(cur.c.code));
    const nDone = list.filter((x) => done.has(x.c.code)).reduce((s, x) => s + x.n, 0);
    $('gProgress').textContent = U.fmtInt(nDone) + ' / ' + U.fmtInt(list.reduce((s, x) => s + x.n, 0)) + ' perles posées';
    $('gColorList').innerHTML = list.map((x) =>
      '<li data-code="' + esc(x.c.code) + '" class="' + (x === cur ? 'cur ' : '') + (done.has(x.c.code) ? 'done' : '') + '">' +
      '<span class="gp-dot" style="background:' + x.c.hex + '"></span><b>' + esc(lbl(x.c)) + '</b><span class="gp-nm">' + esc(lbl(x.c) === x.c.code ? (x.c.name || '') : 'n° ' + x.c.code) + '</span><span class="gp-n">' + x.n + '</span>' +
      '<span class="gp-ok">' + (done.has(x.c.code) ? '✓' : '') + '</span></li>').join('');
  }

  function refreshRow() {
    const p = plate();
    const ps = plateState(p.id);
    ps.row = U.clamp(ps.row | 0, 0, p.h - 1);
    $('gRowNum').textContent = ps.row + 1;
    $('gRowTotal').textContent = p.h;
    const r = P().result;
    const g = gridOf(p);
    const counts = new Map();
    for (let i = 0; i < p.w; i++) { const v = g[ps.row * p.w + i]; if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1); }
    const items = Array.from(counts.entries()).sort((a, b) => U.naturalCompare(lbl(r.colors[a[0]]), lbl(r.colors[b[0]])));
    const seq = [];
    for (let i = 0; i < p.w; i++) {
      const v = g[ps.row * p.w + i];
      const last = seq[seq.length - 1];
      if (last && last.v === v) last.n++; else seq.push({ v, n: 1 });
    }
    $('gRowColors').innerHTML = items.map(([v, n]) => '<span class="gp-chip" style="background:' + r.colors[v].hex + ';color:' + U.textOn(r.colors[v].hex) + '">' + n + ' × ' + esc(lbl(r.colors[v])) + '</span>').join('') +
      '<p class="gp-seq"><span>De gauche à droite :</span> ' + seq.map((s) => s.v < 0 ? s.n + ' vide' + (s.n > 1 ? 's' : '') : s.n + ' × ' + esc(lbl(r.colors[s.v]))).join(' · ') + '</p>';
    $('gRowPrev').disabled = ps.row <= 0;
    $('gRowNext').querySelector('span').textContent = ps.row >= p.h - 1 ? 'Dernière ligne' : 'Ligne suivante';
    $('gRowNext').disabled = ps.row >= p.h - 1;
  }

  function refreshBlock() {
    const p = plate();
    const ps = plateState(p.id);
    const b = blocks(p);
    ps.block = U.clamp(ps.block | 0, 0, b.n - 1);
    const br = blockRect(p, ps.block);
    const done = ps.blocksDone.includes(ps.block);
    $('gBlockName').textContent = blockName(p, ps.block) + (done ? ' ✓' : '');
    $('gBlockInfo').textContent = 'Colonnes ' + U.colLetters(br.x0) + ' à ' + U.colLetters(br.x1 - 1) + ', lignes ' + (br.y0 + 1) + ' à ' + br.y1 + ' · bloc ' + (ps.block + 1) + ' sur ' + b.n;
    $('gBlockDone').querySelector('span').textContent = done ? 'Posé ✓ (annuler)' : 'Bloc posé';
    $('gBlockDone').classList.toggle('on', done);
    $('gBlockProgress').textContent = ps.blocksDone.length + ' / ' + b.n + ' blocs posés';
    const inB = (i, j) => { const [di, dj] = toDisplay(i, j, p); return di >= br.x0 && di < br.x1 && dj >= br.y0 && dj < br.y1; };
    const list = colorsOf(p, inB);
    $('gBlockList').innerHTML = list.map((x) =>
      '<li data-idx="' + x.idx + '" class="' + (st.highlight === x.idx ? 'cur' : '') + '">' +
      '<span class="gp-dot" style="background:' + x.c.hex + '"></span><b>' + esc(lbl(x.c)) + '</b><span class="gp-nm">' + esc(lbl(x.c) === x.c.code ? (x.c.name || '') : 'n° ' + x.c.code) + '</span><span class="gp-n">× ' + x.n + '</span><span class="gp-ok"></span></li>').join('');
  }

  // ---------- Actions ----------
  function startCalib() {
    st.calib = true; st.placing = false; st.locked = false; st.fine = true;
    showPanel(true);
    refreshPanel();
  }
  function startPlacing() {
    st.placing = true; st.calib = false; st.locked = false;
    showPanel(true);
    refreshPanel();
  }

  function nudge(dx, dy) {
    if (st.locked && !st.calib && !st.placing) return;
    const p = plate(), m = model();
    if (st.placing) {
      const pl = placement(p, m), d = dims(p);
      // le motif peut dépasser d'au plus sa propre taille, pour rester visible
      pl.i = U.clamp(pl.i + dx, -d.w + 1, m.w - 1);
      pl.j = U.clamp(pl.j + dy, -d.h + 1, m.h - 1);
      A.saveProject();
      refreshPanel();
      return;
    }
    const c = cal(m);
    const step = st.fine ? 1 : 10;
    // les flèches déplacent la grille dans le sens indiqué, quel que soit le coin choisi
    c.offX += (c.corner[1] === 'l' ? dx : -dx) * step;
    c.offY += (c.corner[0] === 't' ? dy : -dy) * step;
    A.saveSettings();
    draw();
  }
  function sizeBy(f) {
    if (st.locked && !st.calib && !st.placing) return;
    const c = cal();
    c.pp = U.clamp(c.pp * f, 2, 200);
    A.saveSettings();
    $('gSizeVal').textContent = c.pp.toFixed(2).replace('.', ',') + ' px';
    draw();
  }

  function stepItem(dir) {
    const p = plate();
    const ps = plateState(p.id);
    const mode = gs().mode;
    if (mode === 'color') {
      const list = colorsOf(p);
      if (!list.length) return;
      let k = list.findIndex((x) => x.c.code === ps.color);
      ps.color = list[U.clamp((k < 0 ? 0 : k) + dir, 0, list.length - 1)].c.code;
    } else if (mode === 'row') {
      ps.row = U.clamp(ps.row + dir, 0, p.h - 1);
    } else if (mode === 'block') {
      ps.block = U.clamp(ps.block + dir, 0, blocks(p).n - 1);
      st.highlight = null;
    } else return;
    A.saveProject();
    refreshPanel();
  }
  function toggleDone() {
    const p = plate();
    const ps = plateState(p.id);
    const mode = gs().mode;
    if (mode === 'color') {
      if (!ps.color) return;
      const i = ps.done.indexOf(ps.color);
      if (i >= 0) ps.done.splice(i, 1);
      else {
        ps.done.push(ps.color);
        const next = colorsOf(p).find((x) => !ps.done.includes(x.c.code));
        if (next) ps.color = next.c.code;
        else A.toast('Toutes les couleurs de ' + p.name + ' sont posées. Bravo !');
      }
    } else if (mode === 'block') {
      const i = ps.blocksDone.indexOf(ps.block);
      if (i >= 0) ps.blocksDone.splice(i, 1);
      else {
        ps.blocksDone.push(ps.block);
        const n = blocks(p).n;
        let k = ps.block;
        for (let t = 1; t <= n; t++) { const c = (ps.block + t) % n; if (!ps.blocksDone.includes(c)) { k = c; break; } }
        if (k === ps.block) A.toast('Tous les blocs de ' + p.name + ' sont posés. Bravo !');
        ps.block = k;
        st.highlight = null;
      }
    } else if (mode === 'row') { stepItem(1); return; }
    A.saveProject();
    refreshPanel();
  }
  function setLock(v) {
    st.locked = v;
    if (v) { st.calib = false; st.placing = false; }
    refreshPanel();
  }

  function onKey(e) {
    if (!st || document.querySelector('.modal-backdrop')) return;
    const t = e.target;
    if (t && ((t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range') || t.tagName === 'SELECT')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); if (st.calib || st.placing) { st.calib = false; st.placing = false; refreshPanel(); } else G.close(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && (st.calib || st.placing)) { e.preventDefault(); nudge(...arrows[e.key]); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepItem(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepItem(-1); }
    else if (e.key === ' ' || e.key === 'Enter') { if (t && t.tagName === 'BUTTON') return; e.preventDefault(); toggleDone(); }
    else if (e.key === '+' || e.key === '=') sizeBy(1.001);
    else if (e.key === '-') sizeBy(1 / 1.001);
    else if (e.key.toLowerCase() === 'l') setLock(!st.locked);
    else if (e.key.toLowerCase() === 'm') showPanel(!st.panel);
  }

  // ---------- Gestes sur l'écran ----------
  const pointers = new Map();
  let gest = null;
  function initEvents() {
    canvas = $('guideCanvas');
    ctx = canvas.getContext('2d');
    new ResizeObserver(() => resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => {
      if (!st) return;
      // « à côté » : toucher une couleur de la légende la fait ressortir ; glisser change de bloc
      if (gs().view === 'side') {
        const h = hits.find((z) => e.clientX >= z.x && e.clientX <= z.x + z.w && e.clientY >= z.y && e.clientY <= z.y + z.h);
        if (h) { st.highlight = st.highlight === h.idx ? null : h.idx; refreshPanel(); return; }
        gest = { type: 'swipe', sx: e.clientX, sy: e.clientY };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (st.locked) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        gest = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, last: 1 };
      } else if (pointers.size === 1) {
        const c = cal();
        const pl = placement(plate(), model());
        gest = { type: 'pan', sx: e.clientX, sy: e.clientY, offX: c.offX, offY: c.offY, pi: pl.i, pj: pl.j };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!st || !gest) return;
      if (gest.type === 'swipe') return;
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gest.type === 'pinch' && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const f = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / gest.d0;
        sizeBy(f / gest.last);
        gest.last = f;
      } else if (gest.type === 'pan') {
        const dx = e.clientX - gest.sx, dy = e.clientY - gest.sy;
        const c = cal();
        if (st.placing) {
          // glisser le motif : il avance d'un picot à la fois
          const pl = placement(plate(), model());
          pl.i = gest.pi + Math.round(dx / c.pp);
          pl.j = gest.pj + Math.round(dy / c.pp);
          refreshPanel();
        } else {
          c.offX = gest.offX + (c.corner[1] === 'l' ? dx : -dx);
          c.offY = gest.offY + (c.corner[0] === 't' ? dy : -dy);
          draw();
        }
      }
    });
    const end = (e) => {
      if (gest && gest.type === 'swipe') {
        const dx = e.clientX - gest.sx;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - gest.sy)) stepItem(dx < 0 ? 1 : -1);
        gest = null;
        return;
      }
      pointers.delete(e.pointerId);
      if (!pointers.size) { if (gest) { A.saveSettings(); A.saveProject(); } gest = null; }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (!st || st.locked || gs().view === 'side') return;
      e.preventDefault();
      sizeBy(Math.exp(-e.deltaY * (e.shiftKey ? 0.002 : 0.0003)));
    }, { passive: false });

    const seg = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) fn(b.dataset.v); });
    $('guideClose').addEventListener('click', () => G.close());
    $('gCollapse').addEventListener('click', () => showPanel(false));
    $('gMiniMenu').addEventListener('click', () => showPanel(true));
    $('gMiniLock').addEventListener('click', () => setLock(!st.locked));
    $('gMiniPrev').addEventListener('click', () => stepItem(-1));
    $('gMiniNext').addEventListener('click', () => stepItem(1));
    $('gMiniDone').addEventListener('click', toggleDone);
    $('guidePlate').addEventListener('change', (e) => { st.plateId = e.target.value; gs().plateId = st.plateId; st.highlight = null; refreshPanel(); });
    seg('gView', (v) => { gs().view = v; st.calib = false; st.placing = false; st.highlight = null; A.saveProject(); refreshPanel(); if (v === 'screen' && !cal().calibrated) startCalib(); });
    seg('guideMode', (v) => { gs().mode = v; st.highlight = null; A.saveProject(); refreshPanel(); });
    seg('gOthers', (v) => { gs().others = v; refreshPanel(); });
    seg('gLabel', (v) => { gs().label = v; A.saveProject(); refreshPanel(); });
    seg('gCorner', (v) => {
      const c = cal();
      c.corner = v;
      A.saveSettings();
      refreshPanel();
    });
    $('gCornerLight').addEventListener('change', (e) => { cal().light = e.target.checked; A.saveSettings(); draw(); });
    $('gModel').addEventListener('change', (e) => { gs().model = e.target.value; A.saveProject(); refreshPanel(); if (!cal().calibrated) startCalib(); });
    $('gCodes').addEventListener('change', (e) => { gs().codes = e.target.checked; draw(); });
    $('gBright').addEventListener('input', (e) => { gs().bright = +e.target.value; $('gBrightOut').textContent = e.target.value + ' %'; draw(); });
    $('gBlockSize').addEventListener('change', (e) => { gs().blockSize = +e.target.value; plateState(plate().id).blocksDone = []; plateState(plate().id).block = 0; A.saveProject(); refreshPanel(); });
    $('gColorList').addEventListener('click', (e) => { const li = e.target.closest('li[data-code]'); if (li) { plateState(plate().id).color = li.dataset.code; refreshPanel(); } });
    $('gBlockList').addEventListener('click', (e) => { const li = e.target.closest('li[data-idx]'); if (li) { st.highlight = st.highlight === +li.dataset.idx ? null : +li.dataset.idx; refreshPanel(); } });
    $('gPrev').addEventListener('click', () => stepItem(-1));
    $('gNext').addEventListener('click', () => stepItem(1));
    $('gDone').addEventListener('click', toggleDone);
    $('gReset').addEventListener('click', () => { const ps = plateState(plate().id); ps.done = []; ps.row = 0; ps.blocksDone = []; ps.block = 0; A.saveProject(); refreshPanel(); });
    $('gRowPrev').addEventListener('click', () => stepItem(-1));
    $('gRowNext').addEventListener('click', () => stepItem(1));
    $('gBlockPrev').addEventListener('click', () => stepItem(-1));
    $('gBlockNext').addEventListener('click', () => stepItem(1));
    $('gBlockDone').addEventListener('click', toggleDone);
    $('gUp').addEventListener('click', () => nudge(0, -1));
    $('gDown').addEventListener('click', () => nudge(0, 1));
    $('gLeftB').addEventListener('click', () => nudge(-1, 0));
    $('gRightB').addEventListener('click', () => nudge(1, 0));
    $('gStep').addEventListener('click', () => { st.fine = !st.fine; refreshPanel(); });
    $('gSizeMM').addEventListener('click', () => sizeBy(1 / 1.01));
    $('gSizeM').addEventListener('click', () => sizeBy(1 / 1.001));
    $('gSizeP').addEventListener('click', () => sizeBy(1.001));
    $('gSizePP').addEventListener('click', () => sizeBy(1.01));
    $('gCalib').addEventListener('click', startCalib);
    $('gPlace').addEventListener('click', startPlacing);
    $('gRotate').addEventListener('click', () => { gs().rot = (rot() + 90) % 360; A.saveProject(); refreshPanel(); });
    $('gCalOk').addEventListener('click', () => {
      cal().calibrated = true;
      A.saveSettings();
      const p = plate(), m = model(), d = dims(p);
      // motif plus petit (ou plus grand) que la plaque : on propose tout de suite de le placer
      if (d.w !== m.w || d.h !== m.h) { A.toast('Écran calé. Placez maintenant le motif sur les picots voulus.'); startPlacing(); }
      else { st.calib = false; A.toast('Écran calé pour cette plaque.'); refreshPanel(); }
    });
    $('gCalCancel').addEventListener('click', () => { st.calib = false; refreshPanel(); });
    $('gPlaceCenter').addEventListener('click', () => {
      const p = plate(), m = model(), pl = placement(p, m), d = dims(p);
      pl.i = Math.floor((m.w - d.w) / 2); pl.j = Math.floor((m.h - d.h) / 2);
      A.saveProject(); refreshPanel();
    });
    $('gPlaceOk').addEventListener('click', () => { st.placing = false; A.toast('Motif placé. Verrouillez le tactile pour ne plus rien déplacer.'); refreshPanel(); });
    $('gLock').addEventListener('click', () => setLock(!st.locked));
    $('gFull').addEventListener('click', () => {
      const el = $('guide');
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (el.requestFullscreen) el.requestFullscreen().catch(() => A.toast('Le plein écran n’est pas disponible ici.'));
      else A.toast('Le plein écran n’est pas disponible sur cet appareil (sur iPad : ajoutez l’application à l’écran d’accueil).');
    });
  }

  initEvents();
})();
