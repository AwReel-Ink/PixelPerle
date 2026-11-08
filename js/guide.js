/* Pixel Perles v3 — Pose guidée.
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
    const list = A.plateModels().map((p) => ({ key: p.id, label: p.label, w: p.w, h: p.h, pitch: p.pitch }));
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
  G._hits = () => hits.slice();

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
  // ---------- Entrée dans l'étape, mode « sur l'écran » (bêta) ----------
  const isScreen = () => !!st && gs().view === 'screen';
  // l'étape Pose guidée s'ouvre toujours sur la pose « à côté », dans l'application
  G.enter = function () {
    const ok = A.hasResult();
    $('guideEmpty').hidden = ok;
    if (!ok) { G.leave(); return; }
    canvas = $('guideCanvas');
    ctx = canvas.getContext('2d');
    const g = gs();
    g.view = 'side';
    if (!g.mode || !['block', 'all'].includes(g.mode)) g.mode = 'block';
    const pid = g.plateId && A.plateById(g.plateId) ? g.plateId : P().plates[0].id;
    st = { plateId: pid, locked: false, panel: true, calib: false, placing: false, fine: true, highlight: null, zoom: { s: 1, x: 0, y: 0 }, legScroll: 0 };
    g.plateId = st.plateId;
    $('guideSlot').appendChild($('guidePanel'));
    $('guide').classList.remove('full');
    $('guidePanel').classList.remove('is-screen');
    $('guidePanel').hidden = false;
    $('gMini').hidden = true;
    $('guide').hidden = false;
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVis);
    requestWake();
    resize();
    refreshPanel();
  };
  G.leave = function () {
    $('guide').hidden = true;
    $('guide').classList.remove('full');
    document.documentElement.classList.remove('guide-open');
    if (!st) return;
    st = null;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVis);
    releaseWake();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    A.saveSettings();
    A.saveProject();
  };
  G.resize = () => resize();
  G.refresh = () => { if (st) refreshPanel(); };

  // pose sur l'écran : plein écran noir, plaque transparente posée sur la tablette
  G.openScreen = function () {
    if (!st) return;
    gs().view = 'screen';
    if (!['color', 'row', 'block', 'all'].includes(gs().mode)) gs().mode = 'color';
    $('guide').classList.add('full');
    $('guide').insertBefore($('guidePanel'), $('gZoom'));
    $('guidePanel').classList.add('is-screen');
    document.documentElement.classList.add('guide-open');
    $('toasts').innerHTML = '';
    st.calib = false; st.placing = false; st.highlight = null;
    showPanel(true);
    resize();
    refreshPanel();
    if (!cal().calibrated) startCalib();
  };
  G.closeScreen = function () {
    if (!st) return;
    gs().view = 'side';
    if (!['block', 'all'].includes(gs().mode)) gs().mode = 'block';
    st.calib = false; st.placing = false; st.locked = false; st.highlight = null;
    $('guide').classList.remove('full');
    $('guidePanel').classList.remove('is-screen');
    $('guideSlot').appendChild($('guidePanel'));
    $('guidePanel').hidden = false;
    $('gMini').hidden = true;
    document.documentElement.classList.remove('guide-open');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    A.saveSettings();
    A.saveProject();
    requestAnimationFrame(() => { resize(); refreshPanel(); });
  };
  // compatibilité : l'ancienne entrée ouvre l'étape
  G.open = function (plateId) { if (plateId) gs().plateId = plateId; A.setTab('guide'); };
  G.close = function () { if (isScreen()) G.closeScreen(); };

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
    if (!isScreen()) open = true;
    st.panel = open;
    $('guidePanel').hidden = !open;
    $('gMini').hidden = open;
    syncMini();
    draw();
  }

  // zone libre : l'écran moins le menu (ou la barre réduite), à gauche
  function freeArea() {
    if (!isScreen()) return { x: 0, y: 0, w: W, h: H };
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
    $('gZoom').hidden = true;
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
    const blockDone = new Set(mode === 'block' ? legendDone(p) : []);
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
          if (inB) { if ((st.highlight != null && v !== st.highlight) || blockDone.has(col.code)) alpha = hide ? 0 : 0.25; }
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
  // ---------- Légende : tri, couleurs terminées ----------
  const SORTS = { desc: 'quantité ↓', asc: 'quantité ↑', name: 'nom' };
  const sortMode = () => (SORTS[gs().legendSort] ? gs().legendSort : 'desc');
  function legendKey(p) {
    return gs().mode === 'block' ? blockSize() + ':' + (plateState(p.id).block | 0) : 'all';
  }
  function legendDone(p) {
    const ps = plateState(p.id);
    return (ps.legendDone && ps.legendDone[legendKey(p)]) || [];
  }
  function toggleLegendDone(p, code) {
    const ps = plateState(p.id);
    ps.legendDone = ps.legendDone || {};
    const k = legendKey(p);
    const list = ps.legendDone[k] || (ps.legendDone[k] = []);
    const i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1); else list.push(code);
    if (!list.length) delete ps.legendDone[k];
    A.saveProject();
  }
  // couleurs de la portion affichée (bloc ou plaque entière), triées, les terminées à la fin
  function portionColors(p) {
    const whole = gs().mode !== 'block';
    let list;
    if (whole) list = colorsOf(p);
    else {
      const br = blockRect(p, plateState(p.id).block);
      list = colorsOf(p, (i, j) => { const [di, dj] = toDisplay(i, j, p); return di >= br.x0 && di < br.x1 && dj >= br.y0 && dj < br.y1; });
    }
    const done = new Set(legendDone(p));
    const how = sortMode();
    list.forEach((x) => { x.done = done.has(x.c.code); });
    list.sort((a, b) => (a.done - b.done) || (how === 'name' ? U.naturalCompare(lbl(a.c), lbl(b.c)) : how === 'asc' ? a.n - b.n : b.n - a.n) || U.naturalCompare(lbl(a.c), lbl(b.c)));
    return list;
  }
  // toucher une couleur : la faire ressortir (ou l'éteindre)
  function legendTap(code, idx) {
    st.highlight = st.highlight === idx ? null : idx;
    refreshPanel();
  }
  // case à cocher : couleur finie. Si c'était la couleur en surbrillance, on passe à la suivante de la liste.
  function legendCheck(code, idx) {
    const p = plate();
    const before = portionColors(p);
    const k = before.findIndex((x) => x.c.code === code);
    const becomingDone = k >= 0 && !before[k].done;
    toggleLegendDone(p, code);
    if (becomingDone && st.highlight === idx) {
      const next = before.slice(k + 1).find((x) => !x.done) || before.find((x) => !x.done && x.c.code !== code);
      st.highlight = next ? next.idx : null;
    }
    refreshPanel();
  }
  function cycleSort() {
    const order = ['desc', 'asc', 'name'];
    gs().legendSort = order[(order.indexOf(sortMode()) + 1) % order.length];
    st.legScroll = 0;
    A.saveProject();
    refreshPanel();
  }
  function resetSideView() {
    st.zoom = { s: 1, x: 0, y: 0 };
    st.legScroll = 0;
  }

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
    const legendW = legendSide ? Math.min(250, fa.w * 0.32) : 0;
    const legendH = legendSide ? 0 : Math.min(fa.h * 0.36, 260);
    const lab = 26;
    const cell0 = Math.max(4, Math.min((fa.w - legendW - lab - pad * 3) / cols, (fa.h - legendH - lab - pad * 3) / rows));
    const gx = fa.x + pad + lab, gy = fa.y + pad + lab;
    const GA = { x: gx, y: gy, w: cols * cell0, h: rows * cell0 };
    st.gridArea = GA;
    // zoom : la grille garde sa place, son contenu s'agrandit et se déplace à l'intérieur
    const z = st.zoom || (st.zoom = { s: 1, x: 0, y: 0 });
    const cell = cell0 * z.s;
    z.x = U.clamp(z.x, GA.w - cols * cell, 0);
    z.y = U.clamp(z.y, GA.h - rows * cell, 0);
    const ox = gx + z.x, oy = gy + z.y;
    const legend = portionColors(p);
    const doneSet = new Set(legend.filter((x) => x.done).map((x) => x.idx));
    const hide = g.others === 'hide';

    // repères : lettres des colonnes, numéros des lignes (comme sur l'export)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lf = Math.max(9, Math.min(15, cell * 0.45));
    ctx.font = '700 ' + lf + 'px system-ui, sans-serif';
    ctx.fillStyle = '#1B1F24';
    const every = cell < 12 ? 5 : 1;
    ctx.save(); ctx.beginPath(); ctx.rect(gx, gy - lab, GA.w, lab); ctx.clip();
    for (let c = 0; c < cols; c++) if ((br.x0 + c) % every === 0 || every === 1) ctx.fillText(U.colLetters(br.x0 + c), ox + (c + 0.5) * cell, gy - lab / 2);
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(gx - lab, gy, lab, GA.h); ctx.clip();
    for (let rr = 0; rr < rows; rr++) if ((br.y0 + rr) % every === 0 || every === 1) ctx.fillText(String(br.y0 + rr + 1), gx - lab / 2, oy + (rr + 0.5) * cell);
    ctx.restore();

    // cases
    ctx.save(); ctx.beginPath(); ctx.rect(GA.x, GA.y, GA.w, GA.h); ctx.clip();
    const gap = Math.max(1, cell * 0.08);
    const showCodes = g.codes !== false && cell >= 18;
    const c0 = Math.max(0, Math.floor(-z.x / cell)), c1 = Math.min(cols, Math.ceil((GA.w - z.x) / cell));
    const r0 = Math.max(0, Math.floor(-z.y / cell)), r1 = Math.min(rows, Math.ceil((GA.h - z.y) / cell));
    for (let rr = r0; rr < r1; rr++) {
      for (let c = c0; c < c1; c++) {
        const [i, j] = fromDisplay(br.x0 + c, br.y0 + rr, p);
        const v = grid[j * p.w + i];
        const x = ox + c * cell + gap / 2, y = oy + rr * cell + gap / 2, sz = cell - gap;
        // perle d'une autre couleur que celle touchée, ou d'une couleur terminée : atténuée ou masquée
        const faded = v >= 0 && ((st.highlight != null && v !== st.highlight) || doneSet.has(v));
        if (v < 0 || !r.colors[v] || (faded && hide)) {
          ctx.fillStyle = v < 0 ? '#E4E5E7' : '#F1F2F3';
          PP.render.rr(ctx, x, y, sz, sz, sz * 0.15); ctx.fill();
          continue;
        }
        const col = r.colors[v];
        ctx.globalAlpha = faded ? 0.15 : 1;
        ctx.fillStyle = col.hex;
        PP.render.rr(ctx, x, y, sz, sz, sz * 0.15); ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = U.shade(col.hex, 0.72);
        ctx.stroke();
        if (showCodes) {
          const t = lbl(col);
          ctx.fillStyle = U.textOn(col.hex);
          ctx.font = '700 ' + Math.round(sz * (t.length <= 2 ? 0.42 : t.length === 3 ? 0.33 : 0.26)) + 'px system-ui, sans-serif';
          ctx.fillText(t, x + sz / 2, y + sz / 2 + 1);
        }
        ctx.globalAlpha = 1;
      }
    }
    // traits tous les 5 picots pour compter plus facilement
    ctx.strokeStyle = 'rgba(27,31,36,0.35)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= cols; c++) if ((br.x0 + c) % 5 === 0) { ctx.beginPath(); ctx.moveTo(ox + c * cell, oy); ctx.lineTo(ox + c * cell, oy + rows * cell); ctx.stroke(); }
    for (let rr = 0; rr <= rows; rr++) if ((br.y0 + rr) % 5 === 0) { ctx.beginPath(); ctx.moveTo(ox, oy + rr * cell); ctx.lineTo(ox + cols * cell, oy + rr * cell); ctx.stroke(); }
    ctx.restore();
    if (z.s > 1.01) {
      ctx.strokeStyle = 'rgba(27,31,36,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(GA.x - 0.5, GA.y - 0.5, GA.w + 1, GA.h + 1);
    }

    // colonne (ou bande) de légende : zoom, carte du motif, compteur et liste des couleurs
    const lx = legendSide ? gx + GA.w + pad * 1.5 : fa.x + pad;
    let ly = legendSide ? gy - lab : gy + GA.h + pad;
    const lw = legendSide ? fa.x + fa.w - lx - pad : fa.w - pad * 2;
    const zb = $('gZoom');
    zb.hidden = false;
    zb.style.left = lx + 'px';
    zb.style.top = ly + 'px';
    zb.style.width = Math.min(lw, 230) + 'px';
    $('gZoomVal').textContent = Math.round(z.s * 100) + ' %';
    $('gZoomFit').disabled = z.s <= 1.01;
    let hx = lx + Math.min(lw, 230) + 10; // à droite du zoom (bande du bas), la carte du motif
    if (legendSide) { ly += 50; hx = lx; }
    ctx.textAlign = 'left';
    let headY = ly;
    if (!whole) {
      const mmH = legendSide ? 80 : 44;
      const mm = Math.min((legendSide ? lw : lw - (hx - lx)) / d.w * 0.5, mmH / d.h);
      const mx = hx, my = legendSide ? ly : ly - 2;
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
      ctx.drawImage(mini, mx, my, d.w * mm, d.h * mm);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(mx, my, d.w * mm, d.h * mm);
      ctx.drawImage(mini, br.x0, br.y0, cols, rows, mx + br.x0 * mm, my + br.y0 * mm, cols * mm, rows * mm);
      ctx.imageSmoothingEnabled = true;
      ctx.strokeStyle = '#D3366F';
      ctx.lineWidth = 2;
      ctx.strokeRect(mx + br.x0 * mm, my + br.y0 * mm, cols * mm, rows * mm);
      ctx.fillStyle = '#1B1F24';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText(blockName(p, ps.block), mx + d.w * mm + 10, my + 10);
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillStyle = '#5B6470';
      ctx.fillText(U.colLetters(br.x0) + '–' + U.colLetters(br.x1 - 1) + ', ' + (br.y0 + 1) + '–' + br.y1, mx + d.w * mm + 10, my + 28);
      headY = legendSide ? ly + d.h * mm + 12 : ly + 50;
    } else {
      ctx.fillStyle = '#1B1F24';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.fillText(p.name + ' · ' + d.w + ' × ' + d.h, hx, ly + 12);
      headY = legendSide ? ly + 26 : ly + 50;
    }

    // compteur de couleurs et tri (touchable)
    const nDone = doneSet.size;
    ctx.fillStyle = '#1B1F24';
    ctx.font = '700 14px system-ui, sans-serif';
    const tail = nDone ? ' · ' + nDone + ' finie' + (nDone > 1 ? 's' : '') : '';
    let headTxt = 'Couleurs dans cette portion : ' + legend.length + tail;
    if (ctx.measureText(headTxt).width > lw) headTxt = 'Couleurs ici : ' + legend.length + tail;
    ctx.fillText(headTxt, lx, headY + 10);
    const chip = 'Tri : ' + SORTS[sortMode()];
    ctx.font = '600 13px system-ui, sans-serif';
    const cwid = ctx.measureText(chip).width + 18;
    const chipY = headY + 22;
    ctx.fillStyle = '#EEF0F3';
    PP.render.rr(ctx, lx, chipY, cwid, 26, 13); ctx.fill();
    ctx.fillStyle = '#1B1F24';
    ctx.fillText(chip, lx + 9, chipY + 13);
    hits.push({ type: 'sort', x: lx - 4, y: chipY - 6, w: cwid + 8, h: 38 });
    ctx.font = '500 12px system-ui, sans-serif';
    ctx.fillStyle = '#5B6470';
    const helpTxt = 'case : couleur finie · nom : la faire ressortir';
    if (lx + cwid + 12 + ctx.measureText(helpTxt).width < lx + lw) ctx.fillText(helpTxt, lx + cwid + 12, chipY + 13);

    // liste des couleurs, avec défilement quand elle est trop longue
    const rowH = 36;
    const colsL = legendSide ? 1 : Math.max(1, Math.floor(lw / 185));
    const cw = lw / colsL;
    const area = { x: lx - 4, y: chipY + 34, w: lw + 8, h: Math.max(rowH, fa.y + fa.h - pad - (chipY + 34)) };
    const contentH = Math.ceil(legend.length / colsL) * rowH;
    const maxScroll = Math.max(0, contentH - area.h);
    st.legScroll = U.clamp(st.legScroll || 0, 0, maxScroll);
    st.legArea = Object.assign({ maxScroll }, area);
    ctx.save(); ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
    legend.forEach((x, k) => {
      const cx = lx + (k % colsL) * cw, cy = area.y + Math.floor(k / colsL) * rowH - st.legScroll;
      if (cy + rowH < area.y || cy > area.y + area.h) return;
      const on = st.highlight === x.idx;
      const my = cy + rowH / 2;
      if (on) { ctx.fillStyle = '#F8E2EA'; PP.render.rr(ctx, cx - 4, cy + 1, cw - 4, rowH - 4, 6); ctx.fill(); }
      // case à cocher
      ctx.lineWidth = 2;
      ctx.strokeStyle = x.done ? '#C4285F' : '#8A929E';
      ctx.fillStyle = x.done ? '#C4285F' : '#FFFFFF';
      PP.render.rr(ctx, cx + 1, my - 11, 22, 22, 5); ctx.fill(); ctx.stroke();
      if (x.done) {
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(cx + 6, my); ctx.lineTo(cx + 10.5, my + 4.5); ctx.lineTo(cx + 18, my - 4.5); ctx.stroke();
      }
      ctx.globalAlpha = x.done ? 0.35 : 1;
      ctx.fillStyle = x.c.hex;
      ctx.beginPath(); ctx.arc(cx + 44, my - 1, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = U.shade(x.c.hex, 0.7); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#1B1F24';
      ctx.font = '700 14px system-ui, sans-serif';
      const t = lbl(x.c);
      ctx.fillText(t, cx + 60, my);
      let nm = t === x.c.code ? (x.c.name || '') : x.c.code;
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillStyle = '#5B6470';
      const nmW = cw - 112 - 58;
      if (nmW > 24) {
        if (ctx.measureText(nm).width > nmW) { while (nm.length > 1 && ctx.measureText(nm + '…').width > nmW) nm = nm.slice(0, -1); nm += '…'; }
        ctx.fillText(nm, cx + 112, my);
      }
      ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillStyle = '#1B1F24';
      ctx.textAlign = 'right';
      ctx.fillText('× ' + x.n, cx + cw - 12, my);
      ctx.textAlign = 'left';
      if (x.done) {
        ctx.strokeStyle = '#5B6470'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx + 58, my); ctx.lineTo(cx + cw - 16, my); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const vy = Math.max(cy, area.y), vh = Math.min(cy + rowH, area.y + area.h) - vy;
      if (vh > 8) hits.push({ type: 'legchk', x: cx - 4, y: vy, w: 34, h: vh, idx: x.idx, code: x.c.code });
      if (vh > 8) hits.push({ type: 'leg', x: cx + 30, y: vy, w: cw - 34, h: vh, idx: x.idx, code: x.c.code });
    });
    ctx.restore();
    if (maxScroll > 0) {
      // barre de défilement et fondu pour montrer qu'il y a une suite
      const th = Math.max(30, area.h * area.h / contentH);
      const ty = area.y + (area.h - th) * (st.legScroll / maxScroll);
      ctx.fillStyle = 'rgba(27,31,36,0.12)';
      PP.render.rr(ctx, area.x + area.w - 5, area.y, 5, area.h, 2.5); ctx.fill();
      ctx.fillStyle = 'rgba(27,31,36,0.45)';
      PP.render.rr(ctx, area.x + area.w - 5, ty, 5, th, 2.5); ctx.fill();
      const fade = (y0, up) => {
        const gr = ctx.createLinearGradient(0, y0, 0, y0 + (up ? 22 : -22));
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(area.x, up ? y0 : y0 - 22, area.w - 8, 22);
      };
      if (st.legScroll > 1) fade(area.y, true);
      if (st.legScroll < maxScroll - 1) {
        fade(area.y + area.h, false);
        ctx.fillStyle = '#5B6470';
        ctx.font = '600 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▼ glisser pour voir la suite', area.x + area.w / 2, area.y + area.h - 7);
        ctx.textAlign = 'left';
      }
    }
  }


  // ---------- Informations pratiques pour la pose ----------
  function infoChips(list, withDone) {
    return '<div class="gi-chips">' + list.map((x) =>
      '<span class="gi-chip' + (withDone && withDone.has(x.c.code) ? ' done' : '') + '" title="' + esc(x.c.name || x.c.code) + '"><i style="background:' + x.c.hex + '"></i><b>' + esc(lbl(x.c)) + '</b>' + (x.n != null ? '<span>× ' + x.n + '</span>' : '') + '</span>').join('') + '</div>';
  }
  function refreshInfo() {
    const box = $('gInfo');
    if (!box || !$('gInfoDD').open) return;
    const p = plate();
    if (!p) { box.innerHTML = ''; return; }
    const g = gs();
    const ps = plateState(p.id);
    const d = dims(p);
    const grid = gridOf(p);
    const all = colorsOf(p).sort((a, b) => b.n - a.n || U.naturalCompare(lbl(a.c), lbl(b.c)));
    const beads = all.reduce((s, x) => s + x.n, 0);
    const empty = p.w * p.h - beads;
    const pitch = p.pitch || 2.6;
    let html = '<p class="gi-line"><b>' + esc(p.name) + '</b> · ' + d.w + ' × ' + d.h + ' picots (≈ ' + A.ui.cm(d.w, pitch) + ' × ' + A.ui.cm(d.h, pitch) + ' cm) · <b>' + U.fmtInt(beads) + '</b> perles' + (empty ? ' · ' + U.fmtInt(empty) + ' picots vides' : '') + '</p>';
    // avancement : un bloc « posé » compte en entier ; sinon, les couleurs cochées dans sa légende comptent comme posées
    const remain = new Map();
    all.forEach((x) => remain.set(x.idx, x.n));
    let doneBeads = 0;
    const lDone = ps.legendDone || {};
    const countIn = (x0, y0, x1, y1, codes, whole) => {
      let n = 0, total = 0;
      for (let dj = y0; dj < y1; dj++) for (let di = x0; di < x1; di++) {
        const [i, j] = fromDisplay(di, dj, p);
        const v = grid[j * p.w + i];
        if (v < 0) continue;
        total++;
        if (whole || codes.has(r.colors[v].code)) { n++; remain.set(v, (remain.get(v) || 0) - 1); }
      }
      return { n, total };
    };
    const r = P().result;
    if (g.mode === 'block') {
      const b = blocks(p);
      let finished = 0;
      var finishedSet = new Set();
      for (let k = 0; k < b.n; k++) {
        const br = blockRect(p, k);
        const whole = ps.blocksDone.includes(k);
        const res = countIn(br.x0, br.y0, br.x1, br.y1, new Set(lDone[blockSize() + ':' + k] || []), whole);
        doneBeads += res.n;
        if (whole || (res.total && res.n === res.total) || !res.total) { finished++; finishedSet.add(k); }
      }
      html += '<p class="gi-line">Avancement : <b>' + finished + ' / ' + b.n + '</b> blocs terminés · ' + U.fmtInt(doneBeads) + ' perles posées, <b>' + U.fmtInt(beads - doneBeads) + '</b> restantes.</p>';
      html += '<p class="gi-sub">Un bloc compte comme terminé quand il est marqué « Bloc posé » ou que toutes ses couleurs sont cochées.</p>';
    } else {
      doneBeads = countIn(0, 0, d.w, d.h, new Set(lDone.all || []), false).n;
      html += '<p class="gi-line">Avancement : ' + U.fmtInt(doneBeads) + ' perles posées (couleurs cochées), <b>' + U.fmtInt(beads - doneBeads) + '</b> restantes.</p>';
    }
    if (g.mode === 'block') {
      const b = blocks(p);
      html += '<h4>' + all.length + ' couleur' + (all.length > 1 ? 's' : '') + ' sur la plaque</h4><p class="gi-sub">Quantité totale, puis ce qu’il reste à poser.</p>';
      html += '<table class="gi-table"><thead><tr><th>Couleur</th><th>Total</th><th>Reste</th></tr></thead><tbody>' + all.map((x) => '<tr><td><i style="background:' + x.c.hex + '"></i><b>' + esc(lbl(x.c)) + '</b> <span>' + esc(lbl(x.c) === x.c.code ? (x.c.name || '') : x.c.code) + '</span></td><td>' + x.n + '</td><td>' + (remain.get(x.idx) || 0) + '</td></tr>').join('') + '</tbody></table>';
      // couleurs par rangée de blocs : du début de la plaque jusqu'à la descente à la rangée suivante
      html += '<h4>Couleurs par rangée de blocs</h4><p class="gi-sub">Pour préparer les perles avant de poser chaque rangée.</p>';
      for (let by = 0; by < b.ny; by++) {
        const y0 = by * b.B, y1 = Math.min(d.h, y0 + b.B);
        const list = colorsOf(p, (i, j) => { const dj = toDisplay(i, j, p)[1]; return dj >= y0 && dj < y1; }).sort((a, c) => c.n - a.n || U.naturalCompare(lbl(a.c), lbl(c.c)));
        let doneRow = true;
        for (let bx = 0; bx < b.nx; bx++) if (!finishedSet.has(by * b.nx + bx)) doneRow = false;
        const cur = Math.floor((ps.block | 0) / b.nx) === by;
        html += '<div class="gi-band' + (cur ? ' cur' : '') + (doneRow ? ' done' : '') + '"><div class="gi-band-h"><b>Rangée ' + (by + 1) + '</b> · lignes ' + (y0 + 1) + ' à ' + y1 + ' · blocs ' + U.colLetters(0) + (by + 1) + ' à ' + U.colLetters(b.nx - 1) + (by + 1) + ' · <b>' + list.length + '</b> couleur' + (list.length > 1 ? 's' : '') + (doneRow ? ' · posée ✓' : cur ? ' · en cours' : '') + '</div>' + infoChips(list) + '</div>';
      }
    } else {
      html += '<h4>' + all.length + ' couleur' + (all.length > 1 ? 's' : '') + ' sur la plaque</h4>' + infoChips(all);
      html += '<h4>Couleurs ligne par ligne</h4>';
      for (let dj = 0; dj < d.h; dj++) {
        const list = colorsOf(p, (i, j) => toDisplay(i, j, p)[1] === dj).sort((a, c) => c.n - a.n);
        html += '<div class="gi-band"><div class="gi-band-h"><b>Ligne ' + (dj + 1) + '</b> · ' + list.length + ' couleur' + (list.length > 1 ? 's' : '') + '</div>' + infoChips(list) + '</div>';
      }
    }
    if (P().plates.length > 1) {
      const tot = new Map();
      P().plates.forEach((q) => colorsOf(q).forEach((x) => tot.set(x.idx, (tot.get(x.idx) || 0) + x.n)));
      const n = Array.from(tot.values()).reduce((a, b2) => a + b2, 0);
      html += '<h4>Tout le projet</h4><p class="gi-line">' + P().plates.length + ' plaques · ' + tot.size + ' couleurs · ' + U.fmtInt(n) + ' perles.</p>';
    }
    box.innerHTML = html;
  }
  function infoText() {
    const p = plate();
    const all = colorsOf(p).sort((a, b) => b.n - a.n);
    const lines = [P().name + ' — ' + p.name, all.length + ' couleurs :'].concat(all.map((x) => '- ' + lbl(x.c) + (x.c.name && lbl(x.c) === x.c.code ? ' (' + x.c.name + ')' : '') + ' × ' + x.n));
    if (gs().mode === 'block') {
      const b = blocks(p), d = dims(p);
      lines.push('', 'Couleurs par rangée de blocs :');
      for (let by = 0; by < b.ny; by++) {
        const y0 = by * b.B, y1 = Math.min(d.h, y0 + b.B);
        const list = colorsOf(p, (i, j) => { const dj = toDisplay(i, j, p)[1]; return dj >= y0 && dj < y1; }).sort((a, c) => c.n - a.n);
        lines.push('Rangée ' + (by + 1) + ' (lignes ' + (y0 + 1) + ' à ' + y1 + ') : ' + list.map((x) => lbl(x.c) + ' ×' + x.n).join(', '));
      }
    }
    return lines.join('\n');
  }

  // ---------- Panneau ----------
  function setSeg(el, v) {
    el.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  }

  function refreshPanel() {
    setTimeout(refreshInfo, 0);
    if (!st) return;
    const g = gs();
    const p = plate();
    const side = g.view === 'side';
    if (side && (g.mode === 'color' || g.mode === 'row')) g.mode = 'block';
    $('guidePlate').innerHTML = P().plates.map((x, k) => '<option value="' + x.id + '">' + esc(x.name) + ' · ' + x.w + '×' + x.h + (P().plates.length > 1 ? ' (' + (k + 1) + '/' + P().plates.length + ')' : '') + '</option>').join('');
    $('guidePlate').value = p.id;
    setSeg($('guideMode'), g.mode);
    $('gLegendBox').hidden = !(g.mode === 'block' || g.mode === 'all') || st.calib || st.placing;
    setSeg($('gOthers'), g.others || 'dim');
    $('gOthersHint').textContent = side
      ? 'S’applique quand une couleur est touchée dans la légende, et aux couleurs marquées finies.'
      : g.mode === 'block' ? 'S’applique aux perles hors du bloc, à celles d’une autre couleur que celle touchée et aux couleurs finies.' : 'S’applique aux perles qui ne sont pas à poser maintenant.';
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
    const list = portionColors(p);
    const nDone = list.filter((x) => x.done).length;
    $('gBlockCount').textContent = 'Couleurs dans cette portion : ' + list.length + (nDone ? ' · ' + nDone + ' finie' + (nDone > 1 ? 's' : '') : '');
    setSeg($('gSort'), sortMode());
    $('gBlockList').innerHTML = list.map((x) =>
      '<li data-idx="' + x.idx + '" data-code="' + esc(x.c.code) + '" class="' + (st.highlight === x.idx ? 'cur' : '') + (x.done ? ' done' : '') + '">' +
      '<button type="button" class="gp-chk" role="checkbox" aria-checked="' + x.done + '" aria-label="Couleur finie"><svg class="ic"><use href="#i-check"/></svg></button>' +
      '<span class="gp-dot" style="background:' + x.c.hex + '"></span><b>' + esc(lbl(x.c)) + '</b><span class="gp-nm">' + esc(lbl(x.c) === x.c.code ? (x.c.name || '') : 'n° ' + x.c.code) + '</span><span class="gp-n">× ' + x.n + '</span></li>').join('');
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
      resetSideView();
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
        resetSideView();
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
    if (A.tab !== 'guide') return;
    if (!isScreen() && (/^[1-6]$/.test(e.key) || e.ctrlKey || e.metaKey)) return; // raccourcis de l'application
    e.stopPropagation();
    if (e.key === 'Escape') { if (!isScreen()) return; e.preventDefault(); if (st.calib || st.placing) { st.calib = false; st.placing = false; refreshPanel(); } else G.closeScreen(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && (st.calib || st.placing)) { e.preventDefault(); nudge(...arrows[e.key]); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepItem(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepItem(-1); }
    else if (e.key === ' ' || e.key === 'Enter') { if (t && t.tagName === 'BUTTON') return; e.preventDefault(); toggleDone(); }
    else if (e.key === '+' || e.key === '=') sizeBy(1.001);
    else if (e.key === '-') sizeBy(1 / 1.001);
    else if (e.key.toLowerCase() === 'l' && isScreen()) setLock(!st.locked);
    else if (e.key.toLowerCase() === 'm' && isScreen()) showPanel(!st.panel);
  }


  // ---------- Gestes du mode « à côté » ----------
  // coordonnées dans le canvas (il n'occupe pas tout l'écran dans l'application)
  const ex = (e) => e.clientX - canvas.getBoundingClientRect().left;
  const ey = (e) => e.clientY - canvas.getBoundingClientRect().top;
  const inRect = (x, y, r) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  function zoomSide(f, px, py) {
    const GA = st.gridArea;
    if (!GA) return;
    const z = st.zoom;
    if (px == null) { px = GA.x + GA.w / 2; py = GA.y + GA.h / 2; }
    const ns = U.clamp(z.s * f, 1, 6);
    // le point sous le doigt reste en place
    const kx = (px - GA.x - z.x) / z.s, ky = (py - GA.y - z.y) / z.s;
    z.x = px - GA.x - kx * ns;
    z.y = py - GA.y - ky * ns;
    z.s = ns;
    if (ns <= 1.001) { z.x = 0; z.y = 0; }
    draw();
  }
  let lastGridTap = null;
  function sideDown(e) {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: ex(e), y: ey(e) });
    const z = st.zoom;
    if (pointers.size === 2 && !st.locked) {
      const [a, b] = Array.from(pointers.values());
      gest = { type: 'spinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: z.s, last: 1 };
      return;
    }
    if (pointers.size > 1) return;
    const la = st.legArea;
    const h = hits.find((r) => inRect(ex(e), ey(e), r));
    if (h && h.type === 'sort') { gest = { type: 'tap', hit: h, sx: ex(e), sy: ey(e) }; return; }
    if (inRect(ex(e), ey(e), la)) { gest = { type: 'leg', hit: h, sx: ex(e), sy: ey(e), s0: st.legScroll || 0, moved: false }; return; }
    if (st.locked) { gest = null; return; }
    gest = { type: z.s > 1.01 ? 'span' : 'swipe', sx: ex(e), sy: ey(e), x0: z.x, y0: z.y, moved: false, inGrid: inRect(ex(e), ey(e), st.gridArea) };
  }
  function sideMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: ex(e), y: ey(e) });
    if (gest.type === 'spinch' && pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const f = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / gest.d0;
      zoomSide(f / gest.last, (a.x + b.x) / 2, (a.y + b.y) / 2);
      gest.last = f;
      return;
    }
    const dx = ex(e) - gest.sx, dy = ey(e) - gest.sy;
    if (Math.abs(dx) + Math.abs(dy) > 8) gest.moved = true;
    if (gest.type === 'leg' && gest.moved) { st.legScroll = gest.s0 - dy; draw(); }
    else if (gest.type === 'span' && gest.moved) { st.zoom.x = gest.x0 + dx; st.zoom.y = gest.y0 + dy; draw(); }
  }
  function sideEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g0 = gest;
    if (pointers.size) { if (g0 && g0.type === 'spinch') gest = null; return; }
    gest = null;
    if (!g0 || e.type !== 'pointerup') return;
    const dx = ex(e) - g0.sx, dy = ey(e) - g0.sy;
    if (g0.type === 'tap' && Math.abs(dx) + Math.abs(dy) < 12) { if (g0.hit.type === 'sort') cycleSort(); return; }
    if (g0.type === 'leg') {
      if (!g0.moved && g0.hit && g0.hit.type === 'leg') legendTap(g0.hit.code, g0.hit.idx);
      if (!g0.moved && g0.hit && g0.hit.type === 'legchk') legendCheck(g0.hit.code, g0.hit.idx);
      return;
    }
    if (g0.type === 'swipe') {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { stepItem(dx < 0 ? 1 : -1); return; }
    }
    // deux touchers sur la grille : zoom ×2,5 à cet endroit, ou retour à la vue entière
    if (!g0.moved && g0.inGrid !== false && inRect(ex(e), ey(e), st.gridArea)) {
      const now = performance.now();
      if (lastGridTap && now - lastGridTap.t < 380 && Math.hypot(ex(e) - lastGridTap.x, ey(e) - lastGridTap.y) < 40) {
        lastGridTap = null;
        if (st.zoom.s > 1.01) { st.zoom = { s: 1, x: 0, y: 0 }; draw(); } else zoomSide(2.5, ex(e), ey(e));
      } else lastGridTap = { t: now, x: ex(e), y: ey(e) };
    }
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
      // « à côté » : la légende défile et se touche ; la grille se zoome, se déplace, ou change de bloc d'un glissé
      if (gs().view === 'side') { sideDown(e); return; }
      if (st.locked) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: ex(e), y: ey(e) });
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        gest = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, last: 1 };
      } else if (pointers.size === 1) {
        const c = cal();
        const pl = placement(plate(), model());
        gest = { type: 'pan', sx: ex(e), sy: ey(e), offX: c.offX, offY: c.offY, pi: pl.i, pj: pl.j };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!st || !gest) return;
      if (gs().view === 'side') { sideMove(e); return; }
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: ex(e), y: ey(e) });
      if (gest.type === 'pinch' && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const f = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / gest.d0;
        sizeBy(f / gest.last);
        gest.last = f;
      } else if (gest.type === 'pan') {
        const dx = ex(e) - gest.sx, dy = ey(e) - gest.sy;
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
      if (st && gs().view === 'side') { sideEnd(e); return; }
      pointers.delete(e.pointerId);
      if (!pointers.size) { if (gest) { A.saveSettings(); A.saveProject(); } gest = null; }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (st && gs().view === 'side') {
        e.preventDefault();
        const la = st.legArea;
        if (la && inRect(ex(e), ey(e), la)) { st.legScroll = (st.legScroll || 0) + e.deltaY; draw(); return; }
        if (st.gridArea && inRect(ex(e), ey(e), st.gridArea)) zoomSide(Math.exp(-e.deltaY * 0.002), ex(e), ey(e));
        return;
      }
      if (!st || st.locked) return;
      e.preventDefault();
      sizeBy(Math.exp(-e.deltaY * (e.shiftKey ? 0.002 : 0.0003)));
    }, { passive: false });

    const seg = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) fn(b.dataset.v); });
    $('guideClose').addEventListener('click', () => G.closeScreen());
    $('gScreenOpen').addEventListener('click', () => G.openScreen());
    $('gInfoDD').addEventListener('toggle', () => refreshInfo());
    $('gInfoCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(infoText()); A.toast('Liste copiée : collez-la dans vos notes.'); }
      catch (e) { A.toast('Copie refusée par le navigateur.', 'error'); }
    });
    $('gResetSide').addEventListener('click', async () => {
      if (!(await A.confirm('Effacer l’avancement de cette plaque (blocs posés, couleurs finies) ?', 'Recommencer', true))) return;
      const ps = plateState(plate().id); ps.blocksDone = []; ps.block = 0; ps.legendDone = {}; ps.done = []; ps.row = 0;
      resetSideView(); A.saveProject(); refreshPanel();
    });
    $('gCollapse').addEventListener('click', () => showPanel(false));
    $('gMiniMenu').addEventListener('click', () => showPanel(true));
    $('gMiniLock').addEventListener('click', () => setLock(!st.locked));
    $('gMiniPrev').addEventListener('click', () => stepItem(-1));
    $('gMiniNext').addEventListener('click', () => stepItem(1));
    $('gMiniDone').addEventListener('click', toggleDone);
    $('guidePlate').addEventListener('change', (e) => { st.plateId = e.target.value; gs().plateId = st.plateId; st.highlight = null; resetSideView(); refreshPanel(); });
    seg('guideMode', (v) => { gs().mode = v; st.highlight = null; resetSideView(); A.saveProject(); refreshPanel(); });
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
    $('gBlockSize').addEventListener('change', (e) => { resetSideView(); gs().blockSize = +e.target.value; plateState(plate().id).blocksDone = []; plateState(plate().id).block = 0; A.saveProject(); refreshPanel(); });
    $('gColorList').addEventListener('click', (e) => { const li = e.target.closest('li[data-code]'); if (li) { plateState(plate().id).color = li.dataset.code; refreshPanel(); } });
    $('gBlockList').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-idx]');
      if (!li) return;
      if (e.target.closest('.gp-chk')) legendCheck(li.dataset.code, +li.dataset.idx);
      else legendTap(li.dataset.code, +li.dataset.idx);
    });
    seg('gSort', (v) => { gs().legendSort = v; st.legScroll = 0; A.saveProject(); refreshPanel(); });
    $('gZoomIn').addEventListener('click', () => zoomSide(1.4));
    $('gZoomOut').addEventListener('click', () => zoomSide(1 / 1.4));
    $('gZoomFit').addEventListener('click', () => { st.zoom = { s: 1, x: 0, y: 0 }; draw(); });

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
(function () {
  const A = window.PP.A;
  A.panes.guide = { refresh: () => { document.getElementById('guideEmpty').hidden = A.hasResult(); A.guide.refresh(); } };
})();
