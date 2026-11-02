/* Pixel Perles — Rendu Auto : applique d'un coup les règles qui donnent les plus beaux rendus en perles.
   1. reconnaître le type d'image (photo ou dessin) ;
   2. photo : contraste étiré et couleurs légèrement ravivées (les perles paraissent plus ternes qu'un écran) ;
   3. dessin : couleur dominante de chaque picot (bords nets) ; photo : couleur moyenne ;
   4. un jeu réduit de couleurs de la palette (10 à 18 selon la taille), la plus foncée toujours gardée ;
   5. tramage choisi par une note : ressemblance « vue de loin » moins une pénalité pour les perles isolées ;
   6. nettoyage des perles isolées, stock restant respecté. */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);

  const AU = (A.auto = {});
  // pénalité pour les perles isolées (« confettis ») : 0,4 unité d’écart de couleur par % de perles isolées.
  // Réglée pour que le tramage ne monte que tant qu’il améliore nettement la ressemblance vue de loin.
  const ISO_WEIGHT = 40;
  const cache = { key: null, res: null };

  // ---------- 1. Type d'image ----------
  function classify(src) {
    const c = U.imageToCanvas(src, 220);
    const W = c.width, H = c.height;
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let flat = 0, tot = 0, transp = 0;
    const hist = new Map();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        if (d[k + 3] < 128) { transp++; continue; }
        const key = ((d[k] >> 3) << 10) | ((d[k + 1] >> 3) << 5) | (d[k + 2] >> 3);
        hist.set(key, (hist.get(key) || 0) + 1);
        if (x < W - 1 && y < H - 1) {
          const r = k + 4, b = k + W * 4;
          const g = Math.max(Math.abs(d[k] - d[r]), Math.abs(d[k + 1] - d[r + 1]), Math.abs(d[k + 2] - d[r + 2]),
            Math.abs(d[k] - d[b]), Math.abs(d[k + 1] - d[b + 1]), Math.abs(d[k + 2] - d[b + 2]));
          tot++;
          if (g < 8) flat++;
        }
      }
    }
    const counts = Array.from(hist.values()).sort((a, b) => b - a);
    const opaque = counts.reduce((s, v) => s + v, 0);
    let acc = 0, n90 = 0;
    for (const v of counts) { acc += v; n90++; if (acc >= opaque * 0.9) break; }
    const flatRatio = tot ? flat / tot : 0;
    const drawing = transp / (W * H) > 0.15 || n90 <= 40 || (flatRatio > 0.6 && n90 <= 120);
    return { kind: drawing ? 'drawing' : 'photo', flatRatio, n90 };
  }
  AU.classify = classify;

  // ---------- 2. Préparation d'une photo ----------
  function enhance(src) {
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const id = ctx.getImageData(0, 0, out.width, out.height);
    const d = id.data;
    // percentiles 1 % et 99 % de la luminosité
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < d.length; i += 16) { if (d[i + 3] < 128) continue; hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++; n++; }
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.01) { hi = v; break; } }
    const stretch = hi - lo > 40 && (lo > 6 || hi < 249);
    const k = stretch ? 255 / (hi - lo) : 1;
    const sat = 1.15;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = stretch ? (v - lo) * k : v;
    for (let i = 0; i < d.length; i += 4) {
      let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      const gr = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gr + (r - gr) * sat; g = gr + (g - gr) * sat; b = gr + (b - gr) * sat;
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(id, 0, 0);
    return out;
  }

  // ---------- Stock restant de la palette, au format du moteur ----------
  A.stockArray = function (colors) {
    let any = false;
    const arr = colors.map((c) => {
      if (c.stock == null || c.stock === '') return -1;
      any = true;
      return Math.max(0, c.stock | 0);
    });
    return any ? arr : null;
  };

  AU.kindSetting = () => (A.project && A.project.conv.kind) || 'auto';
  AU.keyFor = function (pal) {
    return A.geoSig() + '|' + pal.id + ':' + pal.updated + ':' + pal.colors.length + '|' + AU.kindSetting();
  };

  function describe(item) {
    return (item.kind === 'drawing' ? 'dessin' : 'photo') + (item.mode === 'dominant' ? ' · couleur dominante' : item.dither ? ' · tramage ' + item.dither + ' %' : ' · sans tramage');
  }
  AU.describe = describe;

  /**
   * Calcule le meilleur rendu. Renvoie { grids, counts, used, isolated, mode, dither, kind, auto: true, label, stockInfo }.
   */
  AU.compute = async function (pal, onProgress) {
    const key = AU.keyFor(pal);
    if (cache.key === key && cache.res) return cache.res;
    const P = A.project;
    const colors = pal.colors.map((c) => ({ code: c.code, name: c.name, hex: c.hex }));
    const setting = AU.kindSetting();
    const kind = setting === 'auto' ? classify(A.imgAdj).kind : setting;
    const src = kind === 'photo' ? enhance(A.imgAdj) : A.imgAdj;
    if (onProgress) onProgress(0.1);
    const prep = await PP.convert.prepare({ plates: P.plates, image: P.image, src }, (f) => onProgress && onProgress(0.1 + f * 0.3));
    const filled = prep.empty.reduce((n, v) => n + (v ? 0 : 1), 0);
    const target = U.clamp(Math.round(6 + Math.sqrt(filled) / 5), 10, 18);
    const variants = kind === 'photo'
      ? [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((dd) => ({ key: 'auto:' + dd, mode: 'mean', dither: dd, maxColors: target, cleanup: true, protectDark: true, score: true }))
      : [{ key: 'auto:dom', mode: 'dominant', dither: 0, maxColors: 0, cleanup: true, protectDark: true, score: true },
        { key: 'auto:0', mode: 'mean', dither: 0, maxColors: 0, cleanup: true, protectDark: true, score: true }];
    const results = new Map();
    let done = 0;
    await PP.convert.runBatch(prep, colors, variants, 0, (k, r) => {
      if (!r.error) results.set(k, r);
      done++;
      if (onProgress) onProgress(0.4 + 0.6 * (done / variants.length));
    }, { stock: A.stockArray(pal.colors) });
    if (!results.size) throw new Error('Le calcul du rendu automatique a échoué.');
    const score = (r) => r.err + ISO_WEIGHT * (r.isolated / Math.max(1, r.filled));
    let best = null, bestV = null;
    variants.forEach((v) => {
      const r = results.get(v.key);
      if (!r) return;
      let s = score(r);
      if (kind === 'drawing' && v.mode === 'dominant') s *= 0.8; // un dessin garde ses bords nets
      r.score = s;
      if (!best || s < best.score) { best = r; bestV = v; }
    });
    // à qualité presque égale (3 %), on préfère le rendu le plus sobre : moins de tramage, donc moins de confettis
    if (kind === 'photo') {
      const tol = best.score * 1.03;
      const sober = variants.filter((v) => results.get(v.key) && results.get(v.key).score <= tol).sort((a, b) => a.dither - b.dither)[0];
      if (sober) { bestV = sober; best = results.get(sober.key); }
    }
    const item = {
      grids: best.grids, counts: best.counts, used: best.used, isolated: best.isolated, stockInfo: best.stockInfo,
      mode: bestV.mode, dither: bestV.dither, kind, auto: true,
      scores: variants.map((v) => [v.key, results.get(v.key) && +results.get(v.key).score.toFixed(2)]),
    };
    item.label = 'Meilleur rendu (' + describe(item) + ')';
    cache.key = key; cache.res = item;
    return item;
  };

  AU.invalidate = () => { cache.key = null; cache.res = null; };

  // Texte court sur les couleurs limitées par le stock restant
  A.stockNote = function (info, colors) {
    if (!info || !info.length) return '';
    return info.map((s) => colors[s.idx].code + ' ' + s.kept + '/' + s.wanted).join(', ');
  };

  // ---------- Bouton « Rendu Auto » ----------
  AU.run = async function () {
    if (A.busy || !A.project) return;
    const pal = A.checkConvertible();
    if (!pal) return;
    A.busy = true;
    const btn = $('autoBtn');
    btn.disabled = true;
    $('convertBtn').disabled = true;
    A.panels.setProgress('convProgress', 0);
    try {
      await U.nextFrame();
      const item = await AU.compute(pal, (f) => A.panels.setProgress('convProgress', f));
      A.busy = false;
      const ok = await A.applyVariant(item, pal.colors, pal.name);
      if (ok) {
        const note = A.stockNote(item.stockInfo, pal.colors);
        if (note) A.toast('Stock restant respecté : ' + note + ' (le reste a pris la couleur proche suivante).');
      }
    } catch (e) {
      console.error(e);
      A.toast(e.message || 'Le rendu automatique a échoué.', 'error');
    } finally {
      A.busy = false;
      btn.disabled = false;
      $('convertBtn').disabled = false;
      A.panels.setProgress('convProgress', null);
    }
  };
})();
