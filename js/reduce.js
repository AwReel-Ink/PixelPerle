/* Pixel Perles — « Limiter le nombre de couleurs » : à partir du rendu choisi, les couleurs sont fusionnées
   une à une (celle dont la disparition se voit le moins part en premier), puis les aplats peuvent être lissés,
   un peu comme une compression JPG qui regroupe les zones proches. Seules des perles de la palette sont utilisées. */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const R = (A.reduce = {});

  // poids : une perle rare mais très différente (un œil, un contour) compte plus qu'un simple total de perles
  const W_N = 0.6, W_E = 1.4;

  /** Rassemble toutes les plaques dans une seule grille « monde », pour que le lissage voie à travers les plaques. */
  R.prepare = function (result, plates) {
    const bb = PP.geo.bboxOf(plates);
    const W = bb.w, H = bb.h;
    const raster = new Int16Array(W * H).fill(-2); // -2 : pas de plaque, -1 : picot vide
    plates.forEach((p) => {
      const g = result.grids[p.id];
      for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
        raster[(p.y - bb.y + j) * W + (p.x - bb.x + i)] = g && g.length === p.w * p.h ? g[j * p.w + i] : -1;
      }
    });
    const n = result.colors.length;
    const counts = new Int32Array(n);
    for (let k = 0; k < raster.length; k++) if (raster[k] >= 0) counts[raster[k]]++;
    const labs = result.colors.map((c) => { const rgb = U.hexToRgb(c.hex) || [0, 0, 0]; return U.rgbToLab(rgb[0], rgb[1], rgb[2]); });
    const de = new Float32Array(n * n);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) { const d = U.deltaE2000(labs[a], labs[b]); de[a * n + b] = d; de[b * n + a] = d; }
    const used = [];
    for (let i = 0; i < n; i++) if (counts[i] > 0) used.push(i);
    return { bb, W, H, raster, counts, n, de, used, plates, colors: result.colors };
  };

  /**
   * Fusion gloutonne : renvoie, pour chaque nombre de couleurs k (du nombre actuel jusqu'à 2), la table
   * « couleur d'origine → couleur gardée ». stock[i] = perles disponibles (−1 : assez).
   */
  R.sequence = function (base, stock) {
    const { n, de, counts, used } = base;
    const assign = new Int16Array(n).fill(-1);
    used.forEach((i) => { assign[i] = i; });
    const S = new Set(used);
    const out = new Map();
    out.set(S.size, Int16Array.from(assign));
    const w = new Float32Array(n);
    used.forEach((i) => { w[i] = Math.pow(counts[i], W_N); });
    const cost = (o, t) => w[o] * Math.pow(de[o * n + t], W_E);
    const load = new Int32Array(n);
    used.forEach((i) => { load[i] = counts[i]; });
    while (S.size > 2) {
      let best = null;
      S.forEach((c) => {
        let delta = 0;
        const moves = [];
        const extra = new Map();
        for (const o of used) {
          if (assign[o] !== c) continue;
          // couleur gardée la plus proche, en évitant celles dont le stock serait dépassé
          let t = -1, td = Infinity, tf = -1, tfd = Infinity;
          S.forEach((s) => {
            if (s === c) return;
            const d = de[o * n + s];
            if (d < tfd) { tfd = d; tf = s; }
            const cap = stock ? stock[s] : -1;
            if (cap >= 0 && load[s] + (extra.get(s) || 0) + counts[o] > cap) return;
            if (d < td) { td = d; t = s; }
          });
          if (t < 0) t = tf; // aucun stock suffisant : la plus proche quand même
          extra.set(t, (extra.get(t) || 0) + counts[o]);
          delta += cost(o, t) - cost(o, c);
          moves.push([o, t]);
        }
        if (!best || delta < best.delta) best = { c, delta, moves };
      });
      if (!best) break;
      best.moves.forEach(([o, t]) => { assign[o] = t; load[t] += counts[o]; });
      load[best.c] = 0;
      S.delete(best.c);
      out.set(S.size, Int16Array.from(assign));
    }
    return out;
  };

  /** Lissage des aplats : une perle presque seule de sa couleur prend la couleur proche qui l'entoure. */
  function smooth(base, ras, level) {
    if (!level) return ras;
    const { W, H, de, n } = base;
    const passes = level === 1 ? 1 : 2;
    const maxSame = level === 1 ? 1 : 3;
    const minOther = level === 1 ? 5 : 6;
    const maxDE = level === 1 ? 22 : 32;
    let cur = ras;
    const votes = new Int32Array(n);
    for (let pass = 0; pass < passes; pass++) {
      const snap = Int16Array.from(cur);
      let changed = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = snap[y * W + x];
        if (v < 0) continue;
        const seen = [];
        let same = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const m = snap[yy * W + xx];
          if (m < 0) continue;
          const wt = dx && dy ? 1 : 2;
          if (m === v) { same += wt; continue; }
          if (!votes[m]) seen.push(m);
          votes[m] += wt;
        }
        if (same <= maxSame && seen.length) {
          let bm = -1, bw = 0;
          seen.forEach((m) => { if (votes[m] > bw) { bw = votes[m]; bm = m; } });
          if (bw >= minOther && de[v * n + bm] <= maxDE) { cur[y * W + x] = bm; changed++; }
        }
        seen.forEach((m) => { votes[m] = 0; });
      }
      if (!changed) break;
    }
    return cur;
  }

  /** Produit le rendu réduit : grilles par plaque, quantités, perles modifiées et isolées. */
  R.render = function (base, assign, level) {
    const { raster, W, H, n, plates, bb } = base;
    let ras = new Int16Array(raster.length);
    for (let k = 0; k < raster.length; k++) { const v = raster[k]; ras[k] = v >= 0 ? assign[v] : v; }
    ras = smooth(base, ras, level);
    const counts = new Int32Array(n);
    let changed = 0, isolated = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, v = ras[k];
      if (v < 0) continue;
      counts[v]++;
      if (v !== raster[k]) changed++;
      let alone = true;
      for (let dy = -1; dy <= 1 && alone; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && ras[yy * W + xx] === v) { alone = false; break; }
      }
      if (alone) isolated++;
    }
    const grids = {};
    plates.forEach((p) => {
      const g = new Int16Array(p.w * p.h);
      for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) g[j * p.w + i] = ras[(p.y - bb.y + j) * W + (p.x - bb.x + i)];
      grids[p.id] = g;
    });
    let used = 0;
    counts.forEach((c) => { if (c > 0) used++; });
    return { grids, counts, used, changed, isolated, raster: ras };
  };

  /** Nombres de couleurs proposés : tous en dessous de 10, puis de 2 en 2 (ou plus) au-dessus. */
  R.targets = function (N) {
    const out = [];
    const step = N > 30 ? 3 : N > 14 ? 2 : 1;
    for (let k = N - 1; k >= 2; ) {
      out.push(k);
      k -= k > 10 ? step : 1;
    }
    return out;
  };

  /** Pénuries de stock éventuelles d'un rendu (couleurs dont on n'a pas assez). */
  R.shortage = function (counts, stock, colors) {
    if (!stock) return '';
    const out = [];
    counts.forEach((c, i) => { if (stock[i] >= 0 && c > stock[i]) out.push(colors[i].code + ' : ' + c + ' pour ' + stock[i]); });
    return out.join(', ');
  };

  /** Stock du rendu actuel, retrouvé par code dans la palette d'origine. */
  R.stockFor = function (result) {
    const pid = A.project && A.project.conv.paletteId;
    const pal = A.palettes.find((p) => p.id === pid) || A.palettes.find((p) => p.name === result.paletteName);
    if (!pal) return null;
    const byCode = new Map(pal.colors.map((c) => [c.code, c]));
    let any = false;
    const arr = result.colors.map((c) => {
      const pc = byCode.get(c.code);
      if (!pc || pc.stock == null || pc.stock === '') return -1;
      any = true;
      return Math.max(0, pc.stock | 0);
    });
    return any ? arr : null;
  };

  /** Applique un rendu réduit au projet (annulable avec Ctrl+Z / le bouton Annuler). */
  R.apply = function (item) {
    const r = A.project.result;
    const changes = [];
    A.project.plates.forEach((p) => {
      const g = r.grids[p.id];
      const ng = item.grids[p.id];
      if (!g || !ng) return;
      for (let i = 0; i < g.length; i++) if (g[i] !== ng[i]) { changes.push({ pid: p.id, idx: i, old: g[i], nv: ng[i] }); g[i] = ng[i]; }
      A.plateCache.delete(p.id);
    });
    if (!changes.length) return 0;
    A.stage.pushUndo(changes);
    return changes.length;
  };
})();
