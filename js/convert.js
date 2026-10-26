/* Pixel Perles — géométrie de l'image, réglages, conversion vers la palette */
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

  // Dessine l'image transformée ; (offX, offY) = coin du monde affiché en (0,0), scale = px par picot
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

  // ---------- Correspondance couleur → palette (CIEDE2000, avec cache) ----------
  function prepPalette(colors) {
    return colors.map((c) => {
      const rgb = U.hexToRgb(c.hex) || [0, 0, 0];
      return {
        rgb,
        lin: [U.S2L[rgb[0]], U.S2L[rgb[1]], U.S2L[rgb[2]]],
        lab: U.rgbToLab(rgb[0], rgb[1], rgb[2]),
      };
    });
  }

  function makeMatcher(pal, indices) {
    const cache = new Int16Array(1 << 18).fill(-1);
    return function (r, g, b) {
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let v = cache[key];
      if (v >= 0) return v;
      const lab = U.rgbToLab((r & 0xfc) + 2, (g & 0xfc) + 2, (b & 0xfc) + 2);
      let best = indices[0], bd = Infinity;
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        const de = U.deltaE2000(lab, pal[i].lab);
        if (de < bd) { bd = de; best = i; }
      }
      cache[key] = best;
      return best;
    };
  }

  function bboxOf(plates) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    plates.forEach((p) => {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * Convertit l'image en grilles de perles, une par plaque.
   * opts : { plates, image, src (canvas réglé), colors, mode: 'mean'|'dominant', maxColors, dither (0..1) }
   * Résultat : { grids: { [plateId]: Int16Array }, counts }
   * Valeur d'un picot : indice dans colors, ou -1 pour un picot vide.
   */
  async function convert(opts, onProgress) {
    const { plates, image, src, colors } = opts;
    if (!plates.length) throw new Error('Ajoutez au moins une plaque.');
    if (!colors.length) throw new Error('La palette choisie ne contient aucune couleur.');
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

    // Masque : seuls les picots couverts par une plaque comptent
    const onPlate = new Uint8Array(N);
    plates.forEach((p) => {
      for (let j = 0; j < p.h; j++) {
        const row = (p.y - bb.y + j) * bb.w + (p.x - bb.x);
        for (let i = 0; i < p.w; i++) onPlate[row + i] = 1;
      }
    });

    // 1) Couleur moyenne de chaque picot (en lumière linéaire, pondérée par l'opacité)
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
      if (onProgress && cy % 16 === 0) { onProgress(0.4 * (cy / bb.h)); await U.yieldUI(); }
    }

    const pal = prepPalette(colors);
    const all = pal.map((_, i) => i);

    const assignMean = (match) => {
      const out = new Int16Array(N).fill(-1);
      for (let ci = 0; ci < N; ci++) {
        if (empty[ci]) continue;
        out[ci] = match(U.linToSrgb(lin[ci * 3]) | 0, U.linToSrgb(lin[ci * 3 + 1]) | 0, U.linToSrgb(lin[ci * 3 + 2]) | 0);
      }
      return out;
    };

    // Couleur majoritaire : chaque pixel est rapproché de la palette, la plus fréquente l'emporte
    const assignDominant = async (match, indices) => {
      const out = new Int16Array(N).fill(-1);
      const votes = new Float32Array(pal.length);
      for (let cy = 0; cy < bb.h; cy++) {
        for (let cx = 0; cx < bb.w; cx++) {
          const ci = cy * bb.w + cx;
          if (empty[ci]) continue;
          for (let k = 0; k < indices.length; k++) votes[indices[k]] = 0;
          for (let ky = 0; ky < K; ky++) {
            let p = ((cy * K + ky) * W + cx * K) * 4;
            for (let kx = 0; kx < K; kx++, p += 4) {
              const a = data[p + 3];
              if (a < 128) continue;
              votes[match(data[p], data[p + 1], data[p + 2])] += 1;
            }
          }
          // départage : la couleur la plus proche de la moyenne
          const meanIdx = match(U.linToSrgb(lin[ci * 3]) | 0, U.linToSrgb(lin[ci * 3 + 1]) | 0, U.linToSrgb(lin[ci * 3 + 2]) | 0);
          let best = meanIdx, bv = votes[meanIdx];
          for (let k = 0; k < indices.length; k++) {
            const i = indices[k];
            if (votes[i] > bv) { bv = votes[i]; best = i; }
          }
          out[ci] = best;
        }
        if (onProgress && cy % 8 === 0) { onProgress(0.4 + 0.3 * (cy / bb.h)); await U.yieldUI(); }
      }
      return out;
    };

    // Tramage de Floyd–Steinberg sur la grille des picots
    const assignDither = (match, strength) => {
      const out = new Int16Array(N).fill(-1);
      const buf = new Float32Array(lin);
      for (let cy = 0; cy < bb.h; cy++) {
        for (let cx = 0; cx < bb.w; cx++) {
          const ci = cy * bb.w + cx;
          if (empty[ci]) continue;
          const r = U.clamp(buf[ci * 3], 0, 1), g = U.clamp(buf[ci * 3 + 1], 0, 1), b = U.clamp(buf[ci * 3 + 2], 0, 1);
          const idx = match(U.linToSrgb(r) | 0, U.linToSrgb(g) | 0, U.linToSrgb(b) | 0);
          out[ci] = idx;
          const er = (r - pal[idx].lin[0]) * strength, eg = (g - pal[idx].lin[1]) * strength, eb = (b - pal[idx].lin[2]) * strength;
          const spread = (dx, dy, f) => {
            const x = cx + dx, y = cy + dy;
            if (x < 0 || x >= bb.w || y >= bb.h) return;
            const j = y * bb.w + x;
            if (empty[j]) return;
            buf[j * 3] += er * f; buf[j * 3 + 1] += eg * f; buf[j * 3 + 2] += eb * f;
          };
          spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
        }
      }
      return out;
    };

    const mode = opts.mode === 'dominant' ? 'dominant' : 'mean';
    const dither = mode === 'mean' ? U.clamp(+opts.dither || 0, 0, 1) : 0;
    let indices = all;
    let match = makeMatcher(pal, indices);
    let result = mode === 'dominant' ? await assignDominant(match, indices) : assignMean(match);

    // 2) Limite du nombre de couleurs : on garde les plus utilisées et on recalcule
    const maxC = Math.max(0, opts.maxColors | 0);
    const countOf = (res) => {
      const c = new Int32Array(pal.length);
      for (let i = 0; i < N; i++) if (res[i] >= 0) c[res[i]]++;
      return c;
    };
    let counts = countOf(result);
    const used = counts.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    if (maxC > 0 && used > maxC) {
      indices = all.filter((i) => counts[i] > 0).sort((a, b) => counts[b] - counts[a]).slice(0, maxC);
      match = makeMatcher(pal, indices);
      result = mode === 'dominant' ? await assignDominant(match, indices) : assignMean(match);
    }
    if (dither > 0) result = assignDither(match, dither);
    if (onProgress) onProgress(0.95);

    // 3) Découpe par plaque
    const grids = {};
    plates.forEach((p) => {
      const g = new Int16Array(p.w * p.h);
      for (let j = 0; j < p.h; j++) {
        const row = (p.y - bb.y + j) * bb.w + (p.x - bb.x);
        for (let i = 0; i < p.w; i++) g[j * p.w + i] = result[row + i];
      }
      grids[p.id] = g;
    });
    counts = countOf(result);
    if (onProgress) onProgress(1);
    return { grids, counts };
  }

  PP.geo = { imgDims, drawImageTransformed, bboxOf };
  PP.convert = { convert, applyAdjust, isNeutral, prepPalette, makeMatcher };
})();
