/* Pixel Perles — géométrie de l'image, réglages, conversion vers la palette.
   La conversion se fait en deux temps :
   1. prepare() échantillonne l'image une seule fois (couleur moyenne de chaque picot) ;
   2. chaque rendu (tramage 0 %, 10 %… ou « Dominante ») est calculé à partir de cette préparation,
      en parallèle dans des Web Workers, avec repli sur le fil principal si les workers sont indisponibles. */
(function () {
  'use strict';
  const PP = (window.PP = window.PP || {});
  const U = PP.util;

  // ---------- Géométrie de l'image posée sur la grille (unités = picots) ----------
  function imgDims(img) {
    const rotated = img.rot % 180 !== 0;
    const ar = rotated ? img.nw / img.nh : img.nh / img.nw;
    return { w: img.w, h: img.w * ar };
  }

  function drawImageTransformed(ctx, src, img, offX, offY, scale) {
    const d = imgDims(img);
    const rotated = img.rot % 180 !== 0;
    ctx.save();
    ctx.translate((img.x + d.w / 2 - offX) * scale, (img.y + d.h / 2 - offY) * scale);
    ctx.scale(img.flipH ? -1 : 1, img.flipV ? -1 : 1);
    ctx.rotate((img.rot * Math.PI) / 180);
    const dw = (rotated ? d.h : d.w) * scale;
    const dh = (rotated ? d.w : d.h) * scale;
    ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // ---------- Réglages luminosité / contraste / saturation ----------
  function isNeutral(a) {
    return !a || (!a.brightness && !a.contrast && !a.saturation);
  }
  function applyAdjust(src, a) {
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    if (isNeutral(a)) return out;
    const id = ctx.getImageData(0, 0, out.width, out.height);
    const d = id.data;
    const br = (a.brightness || 0) * 1.28;
    const ct = (a.contrast || 0) * 1.28;
    const cf = (259 * (ct + 255)) / (255 * (259 - ct));
    const sat = 1 + (a.saturation || 0) / 100;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = cf * (i + br - 128) + 128;
    for (let i = 0; i < d.length; i += 4) {
      let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      if (sat !== 1) {
        const gr = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gr + (r - gr) * sat; g = gr + (g - gr) * sat; b = gr + (b - gr) * sat;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(id, 0, 0);
    return out;
  }

  function bboxOf(rects) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach((p) => {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // =====================================================================
  // Cœur du calcul : autonome (aucune dépendance), exécuté tel quel dans les workers.
  // =====================================================================
  function coreFactory() {
    const S2L = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    function linToSrgb(v) {
      v = clamp(v, 0, 1);
      return (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
    }
    function linToLab(r, g, b) {
      let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
      let y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
      let z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
      const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      x = f(x); y = f(y); z = f(z);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    }
    const RAD = Math.PI / 180;
    const P7 = Math.pow(25, 7);
    function de2000(l1, l2, kL) {
      const L1 = l1[0], a1 = l1[1], b1 = l1[2], L2 = l2[0], a2 = l2[1], b2 = l2[2];
      const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
      const Cb7 = Math.pow((C1 + C2) / 2, 7);
      const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + P7)));
      const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
      const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
      let h1p = Math.atan2(b1, a1p) / RAD; if (h1p < 0) h1p += 360;
      let h2p = Math.atan2(b2, a2p) / RAD; if (h2p < 0) h2p += 360;
      const dLp = L2 - L1, dCp = C2p - C1p;
      let dhp = 0;
      if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
      const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
      const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
      let hbp = h1p + h2p;
      if (C1p * C2p !== 0) {
        if (Math.abs(h1p - h2p) > 180) hbp = h2p + h1p < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
        else hbp = hbp / 2;
      }
      const T = 1 - 0.17 * Math.cos((hbp - 30) * RAD) + 0.24 * Math.cos(2 * hbp * RAD) +
        0.32 * Math.cos((3 * hbp + 6) * RAD) - 0.2 * Math.cos((4 * hbp - 63) * RAD);
      const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
      const Cbp7 = Math.pow(Cbp, 7);
      const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + P7));
      const Lb = (Lbp - 50) * (Lbp - 50);
      const Sl = 1 + (0.015 * Lb) / Math.sqrt(20 + Lb), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
      const Rt = -Math.sin(2 * dTh * RAD) * Rc;
      const tl = dLp / (Sl * (kL || 1)), tc = dCp / Sc, th = dHp / Sh;
      return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
    }
    function makeMatcher(pal, indices) {
      const cache = new Int16Array(1 << 18).fill(-1);
      return function (r, g, b) {
        const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
        const v = cache[key];
        if (v >= 0) return v;
        const lab = linToLab(S2L[(r & 0xfc) + 2], S2L[(g & 0xfc) + 2], S2L[(b & 0xfc) + 2]);
        let best = indices[0], bd = Infinity;
        for (let k = 0; k < indices.length; k++) {
          const i = indices[k];
          const d = de2000(lab, pal[i].lab);
          if (d < bd) { bd = d; best = i; }
        }
        cache[key] = best;
        return best;
      };
    }

    /**
     * job : { w, h, lin (Float32Array w*h*3), empty (Uint8Array w*h), pal: [{lab, lin}],
     *         mode: 'mean'|'dominant', maxColors, dither (0..1), K, W, data (RGBA, seulement pour 'dominant') }
     * → { grid: Int16Array (−1 = picot vide), counts: Int32Array, isolated, used }
     */
    function run(job) {
      const { w, h, lin, empty, pal } = job;
      const N = w * h;
      const nP = pal.length;
      const srgb = (ci) => [linToSrgb(lin[ci * 3]) | 0, linToSrgb(lin[ci * 3 + 1]) | 0, linToSrgb(lin[ci * 3 + 2]) | 0];

      const assignMean = (match) => {
        const out = new Int16Array(N).fill(-1);
        for (let ci = 0; ci < N; ci++) {
          if (empty[ci]) continue;
          const c = srgb(ci);
          out[ci] = match(c[0], c[1], c[2]);
        }
        return out;
      };
      const assignDominant = (match, indices) => {
        const { K, W, data } = job;
        const out = new Int16Array(N).fill(-1);
        const votes = new Float32Array(nP);
        for (let cy = 0; cy < h; cy++) {
          for (let cx = 0; cx < w; cx++) {
            const ci = cy * w + cx;
            if (empty[ci]) continue;
            for (let k = 0; k < indices.length; k++) votes[indices[k]] = 0;
            for (let ky = 0; ky < K; ky++) {
              let p = ((cy * K + ky) * W + cx * K) * 4;
              for (let kx = 0; kx < K; kx++, p += 4) {
                if (data[p + 3] < 128) continue;
                votes[match(data[p], data[p + 1], data[p + 2])] += 1;
              }
            }
            const c = srgb(ci);
            let best = match(c[0], c[1], c[2]), bv = votes[best];
            for (let k = 0; k < indices.length; k++) {
              const i = indices[k];
              if (votes[i] > bv) { bv = votes[i]; best = i; }
            }
            out[ci] = best;
          }
        }
        return out;
      };
      // Tramage de Floyd–Steinberg sur la grille des picots
      const assignDither = (match, strength) => {
        const out = new Int16Array(N).fill(-1);
        const buf = new Float32Array(lin);
        for (let cy = 0; cy < h; cy++) {
          for (let cx = 0; cx < w; cx++) {
            const ci = cy * w + cx;
            if (empty[ci]) continue;
            const r = clamp(buf[ci * 3], 0, 1), g = clamp(buf[ci * 3 + 1], 0, 1), b = clamp(buf[ci * 3 + 2], 0, 1);
            const idx = match(linToSrgb(r) | 0, linToSrgb(g) | 0, linToSrgb(b) | 0);
            out[ci] = idx;
            const pl = pal[idx].lin;
            const er = (r - pl[0]) * strength, eg = (g - pl[1]) * strength, eb = (b - pl[2]) * strength;
            const spread = (dx, dy, f) => {
              const x = cx + dx, y = cy + dy;
              if (x < 0 || x >= w || y >= h) return;
              const j = y * w + x;
              if (empty[j]) return;
              buf[j * 3] += er * f; buf[j * 3 + 1] += eg * f; buf[j * 3 + 2] += eb * f;
            };
            spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
          }
        }
        return out;
      };
      const countOf = (res) => {
        const c = new Int32Array(nP);
        for (let i = 0; i < N; i++) if (res[i] >= 0) c[res[i]]++;
        return c;
      };

      const mode = job.mode === 'dominant' ? 'dominant' : 'mean';
      const dither = mode === 'mean' ? clamp(+job.dither || 0, 0, 1) : 0;
      // Stock restant : −1 = assez, 0 = épuisée, N = il en reste N
      const stock = job.stock || null;
      const capOf = (i) => (stock && stock[i] >= 0 ? stock[i] : Infinity);
      const labCache = new Float32Array(N * 3).fill(NaN);
      const cellLab = (k) => {
        if (labCache[k * 3] !== labCache[k * 3]) {
          const L = linToLab(lin[k * 3], lin[k * 3 + 1], lin[k * 3 + 2]);
          labCache[k * 3] = L[0]; labCache[k * 3 + 1] = L[1]; labCache[k * 3 + 2] = L[2];
        }
        return [labCache[k * 3], labCache[k * 3 + 1], labCache[k * 3 + 2]];
      };

      // les couleurs épuisées ne sont jamais proposées
      let indices = pal.map((_, i) => i).filter((i) => capOf(i) > 0);
      if (!indices.length) indices = pal.map((_, i) => i);
      let match = makeMatcher(pal, indices);
      let grid = mode === 'dominant' ? assignDominant(match, indices) : assignMean(match);
      let counts = countOf(grid);
      const darkestOf = (list) => {
        let d = -1;
        list.forEach((i) => { if (counts[i] > 0 && (d < 0 || pal[i].lab[0] < pal[d].lab[0])) d = i; });
        return d;
      };
      const maxC = Math.max(0, job.maxColors | 0);
      const used0 = counts.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
      if (maxC > 0 && used0 > maxC) {
        const keep = indices.filter((i) => counts[i] > 0).sort((a, b) => counts[b] - counts[a]).slice(0, maxC);
        if (job.protectDark) {
          // la couleur la plus foncée employée reste disponible : yeux, contours, ombres portées
          const dark = darkestOf(indices);
          if (dark >= 0 && !keep.includes(dark)) keep[keep.length - 1] = dark;
        }
        indices = keep;
        match = makeMatcher(pal, indices);
        grid = mode === 'dominant' ? assignDominant(match, indices) : assignMean(match);
      }
      if (dither > 0) grid = assignDither(match, dither);
      counts = countOf(grid);

      // Nettoyage : une perle isolée prend la couleur majoritaire autour d'elle,
      // sauf si elle tranche nettement (reflet dans un œil, détail fin) ou si c'est la couleur la plus foncée
      if (job.cleanup) {
        const dark = darkestOf(pal.map((_, i) => i));
        const snap = Int16Array.from(grid);
        const votes = new Float32Array(nP);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const k = y * w + x, v = snap[k];
            if (v < 0 || v === dark) continue;
            let same = false, any = false;
            const touched = [];
            for (let dy = -1; dy <= 1 && !same; dy++) {
              const yy = y + dy;
              if (yy < 0 || yy >= h) continue;
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const xx = x + dx;
                if (xx < 0 || xx >= w) continue;
                const n = snap[yy * w + xx];
                if (n < 0) continue;
                any = true;
                if (n === v) { same = true; break; }
                if (!votes[n]) touched.push(n);
                votes[n] += dx && dy ? 1 : 2;
              }
            }
            let best = -1, bv = 0;
            touched.forEach((n) => { if (votes[n] > bv) { bv = votes[n]; best = n; } votes[n] = 0; });
            if (same || !any || best < 0) continue;
            if (de2000(pal[v].lab, pal[best].lab) < 14) grid[k] = best;
          }
        }
        counts = countOf(grid);
      }

      // Stock restant : seulement si l'image demande plus de perles qu'il n'en reste.
      // Les perles disponibles vont aux picots où un remplacement abîmerait le plus l'image ;
      // les autres reçoivent la couleur proche suivante dont il reste assez.
      let stockInfo = null;
      if (stock) {
        const over = [];
        for (let i = 0; i < nP; i++) if (counts[i] > capOf(i)) over.push(i);
        over.sort((a, b) => (counts[b] - capOf(b)) - (counts[a] - capOf(a)));
        const left = (i) => capOf(i) - counts[i];
        const bestAlt = (k, not) => {
          const L = cellLab(k);
          let best = -1, bd = Infinity;
          for (let i = 0; i < nP; i++) {
            if (i === not || left(i) <= 0) continue;
            const d = de2000(L, pal[i].lab);
            if (d < bd) { bd = d; best = i; }
          }
          return { i: best, d: bd };
        };
        over.forEach((c) => {
          const cells = [];
          for (let k = 0; k < N; k++) if (grid[k] === c) cells.push(k);
          const wanted = cells.length;
          const cap = capOf(c);
          const scored = cells.map((k) => {
            const alt = bestAlt(k, c);
            return { k, regret: (alt.i < 0 ? 1e9 : alt.d) - de2000(cellLab(k), pal[c].lab) };
          }).sort((a, b) => b.regret - a.regret);
          let moved = 0, short = 0;
          for (let n = cap; n < scored.length; n++) {
            const k = scored[n].k;
            const alt = bestAlt(k, c);
            if (alt.i < 0) { short++; continue; }
            grid[k] = alt.i; counts[alt.i]++; counts[c]--; moved++;
          }
          (stockInfo = stockInfo || []).push({ idx: c, wanted, kept: wanted - moved, short });
        });
      }

      // Perles isolées : aucune des 8 voisines n'a la même couleur
      let isolated = 0, filled = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = grid[y * w + x];
          if (v < 0) continue;
          filled++;
          let same = false, any = false;
          for (let dy = -1; dy <= 1 && !same; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              const n = grid[yy * w + xx];
              if (n < 0) continue;
              any = true;
              if (n === v) { same = true; break; }
            }
          }
          if (any && !same) isolated++;
        }
      }

      // Ressemblance « vue de loin » : l'image et le rendu sont floutés comme par l'œil à distance, puis comparés
      let err = 0;
      if (job.score) {
        const blur = (src) => {
          let a = new Float32Array(src), b = new Float32Array(N * 3);
          const wgt = new Float32Array(N);
          for (let k = 0; k < N; k++) wgt[k] = empty[k] ? 0 : 1;
          for (let pass = 0; pass < 2; pass++) {
            for (let horiz = 0; horiz < 2; horiz++) {
              for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                  const k = y * w + x;
                  if (empty[k]) continue;
                  let r = 0, g = 0, bb = 0, s = 0;
                  for (let t = -1; t <= 1; t++) {
                    const xx = horiz ? x + t : x, yy = horiz ? y : y + t;
                    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
                    const j = yy * w + xx;
                    if (!wgt[j]) continue;
                    r += a[j * 3]; g += a[j * 3 + 1]; bb += a[j * 3 + 2]; s++;
                  }
                  b[k * 3] = r / s; b[k * 3 + 1] = g / s; b[k * 3 + 2] = bb / s;
                }
              }
              const t = a; a = b; b = t;
            }
          }
          return a;
        };
        const res = new Float32Array(N * 3);
        for (let k = 0; k < N; k++) {
          const v = grid[k];
          if (v < 0) continue;
          res[k * 3] = pal[v].lin[0]; res[k * 3 + 1] = pal[v].lin[1]; res[k * 3 + 2] = pal[v].lin[2];
        }
        const bo = blur(lin), br = blur(res);
        let n = 0;
        for (let k = 0; k < N; k++) {
          if (empty[k]) continue;
          const A1 = linToLab(bo[k * 3], bo[k * 3 + 1], bo[k * 3 + 2]), B1 = linToLab(br[k * 3], br[k * 3 + 1], br[k * 3 + 2]);
          err += Math.hypot(A1[0] - B1[0], A1[1] - B1[1], A1[2] - B1[2]);
          n++;
        }
        err = n ? err / n : 0;
      }
      const used = counts.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
      return { grid, counts, isolated, used, err, filled, stockInfo };
    }

    return { run, linToLab, de2000, linToSrgb, S2L };
  }

  const core = coreFactory();

  // ---------- Préparation : échantillonnage unique de l'image ----------
  async function prepare(opts, onProgress) {
    const { plates, image, src } = opts;
    if (!plates.length) throw new Error('Ajoutez au moins une plaque.');
    const bb = bboxOf(plates);
    const K = U.clamp(Math.floor(2048 / Math.max(bb.w, bb.h)), 1, 8);
    const W = bb.w * K, H = bb.h * K;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (image && src) drawImageTransformed(ctx, src, image, bb.x, bb.y, K);
    const data = ctx.getImageData(0, 0, W, H).data;
    const N = bb.w * bb.h;
    const onPlate = new Uint8Array(N);
    plates.forEach((p) => {
      for (let j = 0; j < p.h; j++) {
        const row = (p.y - bb.y + j) * bb.w + (p.x - bb.x);
        for (let i = 0; i < p.w; i++) onPlate[row + i] = 1;
      }
    });
    const lin = new Float32Array(N * 3);
    const empty = new Uint8Array(N);
    const KK = K * K;
    for (let cy = 0; cy < bb.h; cy++) {
      for (let cx = 0; cx < bb.w; cx++) {
        const ci = cy * bb.w + cx;
        if (!onPlate[ci]) { empty[ci] = 1; continue; }
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let ky = 0; ky < K; ky++) {
          let p = ((cy * K + ky) * W + cx * K) * 4;
          for (let kx = 0; kx < K; kx++, p += 4) {
            const a = data[p + 3];
            if (!a) continue;
            const af = a / 255;
            sr += U.S2L[data[p]] * af; sg += U.S2L[data[p + 1]] * af; sb += U.S2L[data[p + 2]] * af; sa += af;
          }
        }
        if (sa / KK < 0.5) { empty[ci] = 1; continue; }
        lin[ci * 3] = sr / sa; lin[ci * 3 + 1] = sg / sa; lin[ci * 3 + 2] = sb / sa;
      }
      if (onProgress && cy % 16 === 0) { onProgress(cy / bb.h); await U.yieldUI(); }
    }
    return { bb, K, W, H, N, lin, empty, data, plates: plates.map((p) => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h })) };
  }

  function prepPalette(colors) {
    return colors.map((c) => {
      const rgb = U.hexToRgb(c.hex) || [0, 0, 0];
      const lin = [U.S2L[rgb[0]], U.S2L[rgb[1]], U.S2L[rgb[2]]];
      return { lin, lab: core.linToLab(lin[0], lin[1], lin[2]) };
    });
  }

  function makeJob(prep0, pal, v, maxColors, extra) {
    const prep = v.prep || prep0;
    const job = {
      w: prep.bb.w, h: prep.bb.h, lin: prep.lin, empty: prep.empty, pal, mode: v.mode, dither: (v.dither || 0) / 100,
      maxColors: v.maxColors != null ? v.maxColors : maxColors,
      cleanup: !!v.cleanup, protectDark: !!v.protectDark, score: !!v.score,
      stock: extra && extra.stock ? extra.stock : null,
    };
    if (v.mode === 'dominant') { job.K = prep.K; job.W = prep.W; job.data = prep.data; }
    return job;
  }

  // Découpe le résultat (boîte englobante) en une grille par plaque
  function split(prep, grid) {
    const grids = {};
    const bb = prep.bb;
    prep.plates.forEach((p) => {
      const g = new Int16Array(p.w * p.h);
      for (let j = 0; j < p.h; j++) {
        const row = (p.y - bb.y + j) * bb.w + (p.x - bb.x);
        for (let i = 0; i < p.w; i++) g[j * p.w + i] = grid[row + i];
      }
      grids[p.id] = g;
    });
    return grids;
  }

  // ---------- Pool de workers ----------
  let workers = null;
  let workerFailed = false;
  const WORKER_SRC = 'const core = (' + coreFactory.toString() + ')();\n' +
    'self.onmessage = function (e) { const m = e.data; try { const r = core.run(m.job); self.postMessage({ id: m.id, r: r }, [r.grid.buffer, r.counts.buffer]); }' +
    ' catch (err) { self.postMessage({ id: m.id, error: String((err && err.message) || err) }); } };';

  function poolSize() {
    const hc = navigator.hardwareConcurrency || 4;
    return Math.max(2, Math.min(6, hc - 1));
  }

  function createWorkers(n) {
    if (workerFailed || typeof Worker === 'undefined') return null;
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      const list = [];
      for (let i = 0; i < n; i++) list.push(new Worker(url));
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return list;
    } catch (e) {
      workerFailed = true;
      return null;
    }
  }

  let batchId = 0;
  let cancelResolve = null;
  /**
   * Calcule plusieurs rendus. variants : [{ key, mode, dither }]
   * onResult(key, result) est appelé dès qu'un rendu est prêt. Résout quand tout est fini.
   * Un nouvel appel annule le précédent.
   */
  function runBatch(prep, colors, variants, maxColors, onResult, extra) {
    const my = ++batchId;
    if (cancelResolve) { const r = cancelResolve; cancelResolve = null; r(); }
    const pal = prepPalette(colors);
    const queue = variants.slice();
    // le rendu « Dominante » est le plus long : on le lance en premier
    queue.sort((a, b) => (b.mode === 'dominant') - (a.mode === 'dominant'));
    if (workers) { workers.forEach((w) => w.terminate()); workers = null; }
    const n = Math.min(poolSize(), queue.length);
    workers = createWorkers(n);
    const deliver = (v, r) => {
      if (my !== batchId) return;
      r.grids = split(prep, r.grid);
      onResult(v.key, r);
    };

    if (!workers) {
      // Repli : calcul séquentiel sur le fil principal, en rendant la main à l'interface
      return (async () => {
        for (const v of queue) {
          if (my !== batchId) return;
          await U.yieldUI();
          let r;
          try { r = core.run(makeJob(prep, pal, v, maxColors, extra)); }
          catch (e) { r = { error: e.message }; }
          deliver(v, r);
        }
      })();
    }

    return new Promise((resolve) => {
      cancelResolve = resolve;
      let pending = queue.length;
      let jobSeq = 0;
      const inflight = new Map();
      const next = (w) => {
        const v = queue.shift();
        if (!v) return;
        const id = ++jobSeq;
        inflight.set(id, v);
        w.postMessage({ id, job: makeJob(prep, pal, v, maxColors, extra) });
      };
      const pool = workers;
      pool.forEach((w) => {
        w.onmessage = (e) => {
          const v = inflight.get(e.data.id);
          inflight.delete(e.data.id);
          if (v) deliver(v, e.data.error ? { error: e.data.error } : e.data.r);
          if (--pending <= 0) { if (workers === pool) { pool.forEach((x) => x.terminate()); workers = null; } resolve(); return; }
          next(w);
        };
        w.onerror = (ev) => {
          ev.preventDefault();
          // un worker en panne : on bascule ce qui reste sur le fil principal
          workerFailed = true;
          const rest = Array.from(inflight.values()).concat(queue.splice(0));
          inflight.clear();
          pool.forEach((x) => x.terminate());
          if (workers === pool) workers = null;
          (async () => {
            for (const v of rest) {
              if (my !== batchId) break;
              await U.yieldUI();
              deliver(v, core.run(makeJob(prep, pal, v, maxColors, extra)));
            }
            resolve();
          })();
        };
        next(w);
      });
    });
  }

  function cancelBatch() {
    batchId++;
    if (cancelResolve) { const r = cancelResolve; cancelResolve = null; r(); }
    if (workers) { workers.forEach((w) => w.terminate()); workers = null; }
  }

  PP.geo = { imgDims, drawImageTransformed, bboxOf };
  PP.convert = {
    applyAdjust, isNeutral, prepare, runBatch, cancelBatch, split, prepPalette, core,
    get usesWorkers() { return !workerFailed && typeof Worker !== 'undefined'; },
    poolSize,
  };
})();
