/* Pixel Perles — Pose guidée : la plaque transparente est posée sur l'écran, qui sert de modèle à l'échelle réelle.
   Fond noir, cadre blanc pour caler la plaque, couleur par couleur ou ligne par ligne, calibrage par appareil. */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;

  const G = (A.guide = {});
  const CARD_W = 85.6, CARD_H = 53.98; // carte bancaire ISO 7810 (mm)
  const DEFAULT_PX_MM = 96 / 25.4;
  let st = null;
  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let wakeLock = null;

  // ---------- Calibrage, mémorisé par écran ----------
  function deviceKey() {
    const a = Math.max(screen.width, screen.height), b = Math.min(screen.width, screen.height);
    return a + 'x' + b + '@' + (Math.round((window.devicePixelRatio || 1) * 100) / 100);
  }
  function cal() {
    const all = (A.settings.guideCal = A.settings.guideCal || {});
    const k = deviceKey();
    if (!all[k]) all[k] = { pxPerMm: DEFAULT_PX_MM, calibrated: false, pegs: {}, rim: 1.5 };
    return all[k];
  }
  const presetKey = (p) => (p.preset || 'custom') + ':' + p.w + 'x' + p.h + ':' + (p.pitch || 2.6);
  function pxPerPeg(p) {
    const c = cal();
    return c.pegs[presetKey(p)] || c.pxPerMm * (p.pitch || 2.6);
  }
  function setPxPerPeg(p, v) {
    cal().pegs[presetKey(p)] = U.clamp(v, 2, 200);
    A.saveSettings();
  }
  const pxPerMmEff = (p) => pxPerPeg(p) / (p.pitch || 2.6);
  G.isCalibrated = () => !!cal().calibrated;

  // ---------- État par projet ----------
  const P = () => A.project;
  const gs = () => P().guide;
  function plate() { return A.plateById(st.plateId) || P().plates[0]; }
  function plateState(id) {
    const g = gs();
    g.state = g.state || {};
    if (!g.state[id]) g.state[id] = { row: 0, color: null, done: [] };
    return g.state[id];
  }
  function gridOf(p) {
    const r = P().result;
    const g = r && r.grids[p.id];
    return g && g.length === p.w * p.h ? g : new Int16Array(p.w * p.h).fill(-1);
  }
  // Libellé affiché pour une perle : le nom (ex. « C15 ») quand il est court, sinon le code
  function lbl(c) {
    const mode = gs().label || 'auto';
    const nm = (c.name || '').trim();
    if (mode === 'code') return c.code;
    if (mode === 'name') return nm || c.code;
    // automatique : le nom seulement s'il ressemble à une référence de perle (court, avec un chiffre : C15, H07…)
    return nm && nm.length <= 6 && /\d/.test(nm) && !/\s/.test(nm) ? nm : c.code;
  }
  G.label = lbl;

  function colorsOf(p) {
    const r = P().result;
    const g = gridOf(p);
    const counts = new Map();
    for (let i = 0; i < g.length; i++) if (g[i] >= 0) counts.set(g[i], (counts.get(g[i]) || 0) + 1);
    return Array.from(counts.entries()).map(([idx, n]) => ({ idx, n, c: r.colors[idx] }))
      .sort((a, b) => U.naturalCompare(a.c.code, b.c.code));
  }

  // ---------- Ouverture / fermeture ----------
  G.open = function (plateId) {
    if (!A.hasResult()) { A.toast('Lancez d’abord la conversion.', 'error'); return; }
    canvas = $('guideCanvas');
    ctx = canvas.getContext('2d');
    const g = gs();
    st = { plateId: plateId || g.plateId || (A.sel && A.plateById(A.sel) ? A.sel : P().plates[0].id), off: { x: 0, y: 0 }, locked: false, panel: true, calib: null };
    g.plateId = st.plateId;
    $('guide').hidden = false;
    document.documentElement.classList.add('guide-open');
    $('toasts').innerHTML = '';
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVis);
    requestWake();
    resize();
    refreshPanel();
    if (!cal().calibrated) startCalib('card');
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

  // Zone libre : l'écran sans le panneau
  function freeArea() {
    const panel = $('guidePanel');
    if (!st.panel || panel.hidden) return { x: 0, y: 0, w: W, h: H };
    const pw = panel.getBoundingClientRect().width;
    const right = $('guide').classList.contains('side-right');
    return right ? { x: 0, y: 0, w: W - pw, h: H } : { x: pw, y: 0, w: W - pw, h: H };
  }

  // Position et dimensions de la grille à l'écran
  function layout(p) {
    const pp = pxPerPeg(p);
    const rot = gs().rot || 0;
    const dw = rot % 180 ? p.h : p.w, dh = rot % 180 ? p.w : p.h;
    const fa = freeArea();
    const gw = dw * pp, gh = dh * pp;
    const ox = fa.x + fa.w / 2 - gw / 2 + st.off.x;
    const oy = fa.y + fa.h / 2 - gh / 2 + st.off.y;
    return { pp, rot, dw, dh, gw, gh, ox, oy };
  }
  // (i, j) de la plaque → case affichée
  function toDisplay(i, j, p, rot) {
    if (rot === 90) return [p.h - 1 - j, i];
    if (rot === 180) return [p.w - 1 - i, p.h - 1 - j];
    if (rot === 270) return [j, p.w - 1 - i];
    return [i, j];
  }

  // ---------- Dessin ----------
  function draw() {
    if (!st || !ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const p = plate();
    if (!p) return;
    if (st.calib === 'card') { drawCard(); return; }
    const L = layout(p);
    const mm = pxPerMmEff(p);

    // Cadre blanc : la plaque doit le recouvrir en laissant dépasser un liseré blanc régulier
    const rim = cal().rim * mm;
    const fw = Math.max(5, 2.5 * mm);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = fw;
    ctx.strokeRect(L.ox - rim - fw / 2, L.oy - rim - fw / 2, L.gw + 2 * rim + fw, L.gh + 2 * rim + fw);

    if (st.calib === 'plate') { drawPlateCalib(p, L); return; }

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
    const rad = L.pp * 0.45;
    const codes = g.codes && L.pp >= 15;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontPx = (code) => Math.round(L.pp * (code.length <= 2 ? 0.42 : code.length === 3 ? 0.33 : 0.26));

    for (let j = 0; j < p.h; j++) {
      for (let i = 0; i < p.w; i++) {
        const v = grid[j * p.w + i];
        const [di, dj] = toDisplay(i, j, p, L.rot);
        const cx = L.ox + (di + 0.5) * L.pp, cy = L.oy + (dj + 0.5) * L.pp;
        if (v < 0 || !r.colors[v]) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#262626';
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, L.pp * 0.07), 0, Math.PI * 2); ctx.fill();
          continue;
        }
        const col = r.colors[v];
        let alpha = 1, ring = false;
        if (mode === 'color') {
          if (v === curIdx) ring = true;
          else if (done.has(col.code)) alpha = 0.32;
          else if (hide) alpha = 0;
          else alpha = 0.13;
        } else if (mode === 'row') {
          if (j === ps.row) ring = true;
          else if (j < ps.row) alpha = 0.32;
          else if (hide) alpha = 0;
          else alpha = 0.13;
        }
        if (alpha === 0) {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#262626';
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, L.pp * 0.07), 0, Math.PI * 2); ctx.fill();
          continue;
        }
        ctx.globalAlpha = alpha * bright;
        ctx.fillStyle = col.hex;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
        if (ring && mode !== 'all') {
          ctx.globalAlpha = bright;
          ctx.lineWidth = Math.max(1, L.pp * 0.07);
          ctx.strokeStyle = '#FFFFFF';
          ctx.stroke();
        }
        if (codes && alpha >= 0.99) {
          ctx.globalAlpha = bright;
          ctx.fillStyle = U.textOn(col.hex);
          const t = lbl(col);
          ctx.font = '700 ' + fontPx(t) + 'px system-ui, sans-serif';
          ctx.fillText(t, cx, cy + 1);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Ligne en cours : repère et numéro
    if (mode === 'row') {
      const a = toDisplay(0, ps.row, p, L.rot), b = toDisplay(p.w - 1, ps.row, p, L.rot);
      const x0 = L.ox + Math.min(a[0], b[0]) * L.pp, y0 = L.oy + Math.min(a[1], b[1]) * L.pp;
      const x1 = L.ox + (Math.max(a[0], b[0]) + 1) * L.pp, y1 = L.oy + (Math.max(a[1], b[1]) + 1) * L.pp;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      ctx.setLineDash([]);
      const label = String(ps.row + 1);
      ctx.font = '700 ' + Math.max(12, Math.min(22, L.pp * 0.9)) + 'px system-ui, sans-serif';
      ctx.fillStyle = '#FFFFFF';
      const horizontal = L.rot % 180 === 0;
      const lx = horizontal ? (L.rot === 0 ? L.ox - rim - fw - 16 : L.ox + L.gw + rim + fw + 16) : (x0 + x1) / 2;
      const ly = horizontal ? (y0 + y1) / 2 : (L.rot === 90 ? L.oy - rim - fw - 14 : L.oy + L.gh + rim + fw + 14);
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly);
    }
  }

  function drawCard() {
    const c = cal();
    const fa = freeArea();
    const w = CARD_W * c.pxPerMm, h = CARD_H * c.pxPerMm;
    const x = fa.x + fa.w / 2 - w / 2, y = fa.y + fa.h / 2 - h / 2;
    ctx.fillStyle = '#1b1b1b';
    PP.render.rr(ctx, x, y, w, h, 3.2 * c.pxPerMm);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Posez une carte bancaire ici', x + w / 2, y + h / 2 - 11);
    ctx.fillStyle = '#BBBBBB';
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText('ajustez jusqu’à ce que le cadre suive ses bords', x + w / 2, y + h / 2 + 12);
  }

  function drawPlateCalib(p, L) {
    // tous les picots en petits ronds, les 4 coins et le centre en repères
    ctx.fillStyle = '#5a5a5a';
    for (let dj = 0; dj < L.dh; dj++) {
      for (let di = 0; di < L.dw; di++) {
        ctx.beginPath();
        ctx.arc(L.ox + (di + 0.5) * L.pp, L.oy + (dj + 0.5) * L.pp, Math.max(1, L.pp * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const marks = [[0, 0], [L.dw - 1, 0], [0, L.dh - 1], [L.dw - 1, L.dh - 1], [Math.floor(L.dw / 2), Math.floor(L.dh / 2)]];
    marks.forEach(([di, dj], k) => {
      const cx = L.ox + (di + 0.5) * L.pp, cy = L.oy + (dj + 0.5) * L.pp;
      ctx.strokeStyle = k === 0 ? '#3CE07A' : '#FFD23C';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, L.pp * 0.42, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - L.pp, cy); ctx.lineTo(cx + L.pp, cy);
      ctx.moveTo(cx, cy - L.pp); ctx.lineTo(cx, cy + L.pp);
      ctx.stroke();
    });
  }

  // ---------- Panneau ----------
  function refreshPanel() {
    if (!st) return;
    const g = gs();
    const p = plate();
    const sel = $('guidePlate');
    sel.innerHTML = P().plates.map((x, k) => '<option value="' + x.id + '">' + esc(x.name) + ' · ' + x.w + '×' + x.h + (P().plates.length > 1 ? ' (' + (k + 1) + '/' + P().plates.length + ')' : '') + '</option>').join('');
    sel.value = p.id;
    setSeg($('guideMode'), g.mode);
    setSeg($('gOthers'), g.others);
    $('gCodes').checked = !!g.codes;
    setSeg($('gLabel'), g.label || 'auto');
    $('gBright').value = g.bright || 100;
    $('gBrightOut').textContent = (g.bright || 100) + ' %';
    $('gRim').value = cal().rim;
    const inCal = !!st.calib;
    $('gCalibBox').hidden = !inCal;
    $('gMainBox').hidden = inCal;
    $('guideColorBox').hidden = inCal || g.mode !== 'color';
    $('guideRowBox').hidden = inCal || g.mode !== 'row';
    $('gLock').classList.toggle('on', st.locked);
    $('gLock').querySelector('span').textContent = st.locked ? 'Déverrouiller l’écran' : 'Verrouiller l’écran';
    $('gLock').querySelector('use').setAttribute('href', st.locked ? '#i-lock' : '#i-unlock');
    $('gSide').querySelector('span').textContent = $('guide').classList.contains('side-right') ? 'Panneau à gauche' : 'Panneau à droite';
    $('guideLockBadge').hidden = !st.locked;
    refreshSize();
    if (inCal) refreshCalib();
    else if (g.mode === 'color') refreshColors();
    else if (g.mode === 'row') refreshRow();
    draw();
  }

  function refreshSize() {
    const p = plate();
    const pp = pxPerPeg(p);
    const mm = st.calib === 'card' ? cal().pxPerMm : pxPerMmEff(p);
    $('gSizeVal').textContent = st.calib === 'card'
      ? '1 mm = ' + mm.toFixed(2).replace('.', ',') + ' px'
      : '1 picot = ' + pp.toFixed(2).replace('.', ',') + ' px';
    $('gCalState').textContent = cal().calibrated
      ? 'Écran calibré · plaque de ' + ((p.w * pp) / mm / 10).toFixed(1).replace('.', ',') + ' cm de large à l’écran.'
      : 'Écran non calibré : la taille affichée est approximative.';
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
    const total = list.reduce((s, x) => s + x.n, 0);
    $('gProgress').textContent = U.fmtInt(nDone) + ' / ' + U.fmtInt(total) + ' perles posées';
    $('gColorList').innerHTML = list.map((x) =>
      '<li data-code="' + esc(x.c.code) + '" class="' + (x === cur ? 'cur ' : '') + (done.has(x.c.code) ? 'done' : '') + '">' +
      '<span class="gp-dot" style="background:' + x.c.hex + '"></span><b>' + esc(lbl(x.c)) + '</b><span class="gp-nm">' + esc(lbl(x.c) === x.c.code ? (x.c.name || '') : 'n° ' + x.c.code) + '</span><span class="gp-n">' + x.n + '</span>' +
      (done.has(x.c.code) ? '<span class="gp-ok">✓</span>' : '<span class="gp-ok"></span>') + '</li>').join('');
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
    const items = Array.from(counts.entries()).sort((a, b) => U.naturalCompare(r.colors[a[0]].code, r.colors[b[0]].code));
    // séquence de la ligne, de gauche à droite, regroupée : « 3 × J1, 2 × B0 … »
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

  function refreshCalib() {
    const card = st.calib === 'card';
    $('gCalTitle').textContent = card ? 'Étape 1 sur 2 — Carte bancaire' : 'Étape 2 sur 2 — La plaque elle-même';
    $('gCalText').innerHTML = card
      ? 'Posez une carte bancaire (ou toute carte au format carte d’identité) au centre de l’écran. Agrandissez ou réduisez le cadre blanc jusqu’à ce qu’il suive exactement les bords de la carte.'
      : 'Posez la plaque <b>' + esc(plate().name) + '</b> sur l’écran. Placez le picot du coin en haut à gauche sur le repère <b style="color:#3CE07A">vert</b> (faites glisser la grille si besoin), puis ajustez la taille jusqu’à ce que les autres picots tombent dans les repères <b style="color:#FFD23C">jaunes</b>. Ce réglage est mémorisé pour ce modèle de plaque sur cet écran.';
    $('gCalSkip').textContent = card ? 'Passer cette étape' : 'Annuler';
  }

  function setSeg(el, v) {
    el.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  }

  // ---------- Actions ----------
  function startCalib(step) {
    st.calib = step;
    st.off = { x: 0, y: 0 };
    st.locked = false;
    refreshPanel();
  }

  function sizeBy(f) {
    const p = plate();
    if (st.calib === 'card') {
      const c = cal();
      c.pxPerMm = U.clamp(c.pxPerMm * f, 1, 40);
      // sans calibrage de plaque, la grille suit la nouvelle échelle
      A.saveSettings();
    } else {
      setPxPerPeg(p, pxPerPeg(p) * f);
    }
    refreshSize();
    draw();
  }

  function stepColor(dir) {
    const p = plate();
    const ps = plateState(p.id);
    const list = colorsOf(p);
    if (!list.length) return;
    let k = list.findIndex((x) => x.c.code === ps.color);
    k = U.clamp((k < 0 ? 0 : k) + dir, 0, list.length - 1);
    ps.color = list[k].c.code;
    refreshPanel();
  }
  function toggleDone() {
    const p = plate();
    const ps = plateState(p.id);
    if (!ps.color) return;
    const i = ps.done.indexOf(ps.color);
    if (i >= 0) ps.done.splice(i, 1);
    else {
      ps.done.push(ps.color);
      // passe à la prochaine couleur non posée
      const list = colorsOf(p);
      const next = list.find((x) => !ps.done.includes(x.c.code));
      if (next) ps.color = next.c.code;
      else A.toast('Toutes les couleurs de ' + p.name + ' sont posées. Bravo !');
    }
    A.saveProject();
    refreshPanel();
  }
  function stepRow(dir) {
    const p = plate();
    const ps = plateState(p.id);
    ps.row = U.clamp(ps.row + dir, 0, p.h - 1);
    A.saveProject();
    refreshPanel();
  }

  function onKey(e) {
    if (!st) return;
    if (document.querySelector('.modal-backdrop')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'range' || t.tagName === 'SELECT')) {
      if (e.key === 'Escape') t.blur();
      return;
    }
    e.stopPropagation();
    const mode = gs().mode;
    if (e.key === 'Escape') { e.preventDefault(); if (st.calib) { st.calib = null; refreshPanel(); } else G.close(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (mode === 'color') stepColor(1); else if (mode === 'row') stepRow(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (mode === 'color') stepColor(-1); else if (mode === 'row') stepRow(-1);
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (t && t.tagName === 'BUTTON') return;
      e.preventDefault();
      if (mode === 'color') toggleDone(); else if (mode === 'row') stepRow(1);
    } else if (e.key === '+' || e.key === '=') sizeBy(1.004);
    else if (e.key === '-') sizeBy(1 / 1.004);
    else if (e.key.toLowerCase() === 'l') { st.locked = !st.locked; refreshPanel(); }
  }

  // ---------- Gestes sur l'écran (désactivés quand c'est verrouillé) ----------
  const pointers = new Map();
  let gest = null;
  function initEvents() {
    canvas = $('guideCanvas');
    ctx = canvas.getContext('2d');
    new ResizeObserver(() => resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => {
      if (!st || st.locked) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        gest = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, last: 1 };
      } else if (pointers.size === 1) {
        gest = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: st.off.x, oy: st.off.y };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!st || !gest || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gest.type === 'pinch' && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const f = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / gest.d0;
        sizeBy(f / gest.last);
        gest.last = f;
      } else if (gest.type === 'pan' && st.calib !== 'card') {
        st.off.x = gest.ox + (e.clientX - gest.sx);
        st.off.y = gest.oy + (e.clientY - gest.sy);
        draw();
      }
    });
    const end = (e) => { pointers.delete(e.pointerId); if (!pointers.size) gest = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (!st || st.locked) return;
      e.preventDefault();
      sizeBy(Math.exp(-e.deltaY * (e.shiftKey ? 0.002 : 0.0004)));
    }, { passive: false });

    $('guideClose').addEventListener('click', () => G.close());
    $('guidePlate').addEventListener('change', (e) => { st.plateId = e.target.value; gs().plateId = st.plateId; st.off = { x: 0, y: 0 }; refreshPanel(); });
    $('guideMode').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      gs().mode = b.dataset.v;
      A.saveProject();
      refreshPanel();
    });
    $('gOthers').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      gs().others = b.dataset.v;
      refreshPanel();
    });
    $('gCodes').addEventListener('change', (e) => { gs().codes = e.target.checked; draw(); });
    $('gLabel').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      gs().label = b.dataset.v;
      A.saveProject();
      refreshPanel();
    });
    $('gBright').addEventListener('input', (e) => { gs().bright = +e.target.value; $('gBrightOut').textContent = e.target.value + ' %'; draw(); });
    $('gRim').addEventListener('change', (e) => { cal().rim = U.clamp(+e.target.value || 0, 0, 15); e.target.value = cal().rim; A.saveSettings(); draw(); });
    $('gColorList').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-code]');
      if (!li) return;
      plateState(plate().id).color = li.dataset.code;
      refreshPanel();
    });
    $('gPrev').addEventListener('click', () => stepColor(-1));
    $('gNext').addEventListener('click', () => stepColor(1));
    $('gDone').addEventListener('click', toggleDone);
    $('gReset').addEventListener('click', () => { const ps = plateState(plate().id); ps.done = []; ps.row = 0; A.saveProject(); refreshPanel(); });
    $('gRowPrev').addEventListener('click', () => stepRow(-1));
    $('gRowNext').addEventListener('click', () => stepRow(1));
    $('gSizeMM').addEventListener('click', () => sizeBy(1 / 1.02));
    $('gSizeM').addEventListener('click', () => sizeBy(1 / 1.002));
    $('gSizeP').addEventListener('click', () => sizeBy(1.002));
    $('gSizePP').addEventListener('click', () => sizeBy(1.02));
    $('gCalib').addEventListener('click', () => startCalib('card'));
    $('gCalibPlate').addEventListener('click', () => startCalib('plate'));
    $('gCenter').addEventListener('click', () => { st.off = { x: 0, y: 0 }; draw(); });
    $('gRotate').addEventListener('click', () => { gs().rot = ((gs().rot || 0) + 90) % 360; st.off = { x: 0, y: 0 }; refreshPanel(); });
    $('gCalOk').addEventListener('click', () => {
      if (st.calib === 'card') {
        const c = cal();
        c.calibrated = true;
        // la carte donne l'échelle réelle : on repart de l'écart théorique de chaque modèle de plaque
        c.pegs = {};
        A.saveSettings();
        startCalib('plate');
      } else {
        cal().calibrated = true;
        A.saveSettings();
        st.calib = null;
        refreshPanel();
        A.toast('Calibrage enregistré pour cet écran.');
      }
    });
    $('gCalSkip').addEventListener('click', () => {
      if (st.calib === 'card') startCalib('plate');
      else { st.calib = null; refreshPanel(); }
    });
    $('gLock').addEventListener('click', () => { st.locked = !st.locked; refreshPanel(); });
    $('guideLockBadge').addEventListener('click', () => { st.locked = false; refreshPanel(); });
    $('gSide').addEventListener('click', () => {
      const right = !$('guide').classList.contains('side-right');
      $('guide').classList.toggle('side-right', right);
      document.documentElement.classList.toggle('guide-right', right);
      A.settings.guideSide = right ? 'right' : 'left';
      A.saveSettings();
      refreshPanel();
    });
    $('gFull').addEventListener('click', () => {
      const el = $('guide');
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      if (el.requestFullscreen) el.requestFullscreen().catch(() => A.toast('Le plein écran n’est pas disponible ici.'));
      else A.toast('Le plein écran n’est pas disponible sur cet appareil.');
    });
    $('guideHide').addEventListener('click', () => { st.panel = false; $('guidePanel').hidden = true; $('guideShow').hidden = false; draw(); });
    $('guideShow').addEventListener('click', () => { st.panel = true; $('guidePanel').hidden = false; $('guideShow').hidden = true; draw(); });
    if (A.settings && A.settings.guideSide === 'right') $('guide').classList.add('side-right');
  }
  G.applySide = function () {
    const right = A.settings.guideSide === 'right';
    $('guide').classList.toggle('side-right', right);
    document.documentElement.classList.toggle('guide-right', right);
  };

  initEvents();
})();
