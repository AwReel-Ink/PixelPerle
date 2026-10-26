/* Pixel Perles — mise en page des exports : une image par plaque (grille A/1 + légende) et vue d'ensemble */
(function () {
  'use strict';
  const PP = (window.PP = window.PP || {});
  const U = PP.util;

  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const INK = '#1B1F24';
  const INK_SOFT = '#5B6470';
  const EMPTY = '#E4E5E7';
  const EMPTY_DOT = '#C8CACE';

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function usage(grid, n) {
    const counts = new Int32Array(n);
    let empty = 0;
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (v >= 0 && v < n) counts[v]++; else empty++;
    }
    return { counts, empty };
  }

  function codeFont(c, code) {
    const len = String(code).length;
    const f = len <= 2 ? 0.44 : len === 3 ? 0.34 : len === 4 ? 0.27 : 0.22;
    return Math.max(6, Math.round(c * f));
  }

  // Dessine un picot (case colorée, perle ronde ou picot vide)
  function drawCell(ctx, x, y, c, v, palette, o) {
    if (v < 0 || !palette[v]) {
      ctx.fillStyle = EMPTY;
      rr(ctx, x, y, c, c, c * 0.14);
      ctx.fill();
      ctx.fillStyle = EMPTY_DOT;
      ctx.beginPath();
      ctx.arc(x + c / 2, y + c / 2, c * 0.11, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const col = palette[v];
    const hex = col.hex;
    ctx.fillStyle = hex;
    if (o.style === 'bead') {
      ctx.beginPath();
      ctx.arc(x + c / 2, y + c / 2, c / 2, 0, Math.PI * 2);
    } else {
      rr(ctx, x, y, c, c, c * 0.14);
    }
    ctx.fill();
    ctx.lineWidth = Math.max(1, c * 0.035);
    ctx.strokeStyle = U.shade(hex, 0.72);
    ctx.stroke();
    if (o.codes && c >= 14) {
      ctx.fillStyle = U.textOn(hex);
      ctx.font = '700 ' + codeFont(c, col.code) + 'px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(col.code, x + c / 2, y + c / 2 + c * 0.03);
    } else if (o.style === 'bead') {
      ctx.fillStyle = U.shade(hex, 0.7);
      ctx.beginPath();
      ctx.arc(x + c / 2, y + c / 2, c * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Texte lisible sur fond blanc comme sur fond transparent (contour clair si transparent)
  function text(ctx, str, x, y, size, o, weight, color, align) {
    ctx.font = (weight || 600) + ' ' + Math.round(size) + 'px ' + FONT;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    if (o.bg === 'transparent') {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, size * 0.22);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color || INK;
    ctx.fillText(str, x, y);
  }

  function fitText(ctx, str, maxW, size, weight) {
    ctx.font = (weight || 600) + ' ' + Math.round(size) + 'px ' + FONT;
    if (ctx.measureText(str).width <= maxW) return str;
    let s = str;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  const measureCtx = document.createElement('canvas').getContext('2d');

  // ---------- Légende (partagée par les deux exports) ----------
  function legendModel(counts, empty, palette, U0, availH) {
    const entries = [];
    for (let i = 0; i < counts.length; i++) if (counts[i] > 0) entries.push(i);
    entries.sort((a, b) => U.naturalCompare(palette[a].code, palette[b].code));
    const R = Math.round(U0 * 1.3);
    const HH = Math.round(U0 * 2.6);
    const CW = Math.round(U0 * 11);
    const footer = empty > 0 ? R : 0;
    const rowsPerCol = Math.max(4, Math.floor((availH - HH - footer) / R));
    const cols = Math.max(1, Math.ceil(entries.length / rowsPerCol));
    const total = entries.reduce((s, i) => s + counts[i], 0);
    const rows = Math.min(entries.length, rowsPerCol);
    return { entries, R, HH, CW, cols, rowsPerCol, total, empty, width: cols * CW, height: HH + rows * R + footer };
  }

  function drawLegend(ctx, lm, x, y, counts, palette, U0, o) {
    text(ctx, 'Légende', x, y + U0 * 0.6, U0 * 0.9, o, 700);
    text(ctx, lm.entries.length + (lm.entries.length > 1 ? ' couleurs · ' : ' couleur · ') + U.fmtInt(lm.total) + ' perles',
      x, y + U0 * 1.6, U0 * 0.52, o, 500, INK_SOFT);
    lm.entries.forEach((idx, k) => {
      const col = Math.floor(k / lm.rowsPerCol);
      const row = k % lm.rowsPerCol;
      const rx = x + col * lm.CW;
      const ry = y + lm.HH + row * lm.R;
      const sw = Math.round(lm.R * 0.82);
      drawCell(ctx, rx, ry + (lm.R - sw) / 2, sw, idx, palette, { style: 'square', codes: true });
      const c = palette[idx];
      const tx = rx + sw + U0 * 0.45;
      const countStr = '× ' + U.fmtInt(counts[idx]);
      const cntW = (measureCtx.font = '700 ' + Math.round(U0 * 0.6) + 'px ' + FONT, measureCtx.measureText(countStr).width);
      const nameMax = lm.CW - (tx - rx) - cntW - U0 * 1.2;
      const label = fitText(measureCtx, c.code + (c.name ? '  ' + c.name : ''), nameMax, U0 * 0.6, 600);
      text(ctx, label, tx, ry + lm.R / 2, U0 * 0.6, o, 600);
      text(ctx, countStr, rx + lm.CW - U0 * 0.8, ry + lm.R / 2, U0 * 0.6, o, 700, INK, 'right');
    });
    if (lm.empty > 0) {
      const lastRow = Math.min(lm.entries.length, lm.rowsPerCol);
      const ry = y + lm.HH + lastRow * lm.R;
      const sw = Math.round(lm.R * 0.82);
      drawCell(ctx, x, ry + (lm.R - sw) / 2, sw, -1, palette, o);
      text(ctx, 'Picot vide  × ' + U.fmtInt(lm.empty), x + sw + U0 * 0.45, ry + lm.R / 2, U0 * 0.6, o, 500, INK_SOFT);
    }
  }

  /**
   * Image d'une plaque. o : { minSide, bg, style, codes, guides, labels4 }, meta : { project, date, index, total }
   */
  function plateLayout(plate, grid, palette, o, meta) {
    const w = plate.w, h = plate.h;
    const minSide = Math.max(600, o.minSide || 4320);
    const guides = o.guides !== false;
    const labels4 = o.labels4 !== false;
    const p = Math.ceil(minSide / Math.min(w, h));
    const g = Math.max(1, Math.round(p * 0.1));
    const c = p - g;
    const extra = guides ? Math.max(2, Math.round(p * 0.22)) : 0;
    const colX = (i) => i * p + Math.floor(i / 10) * extra;
    const gridW = colX(w - 1) + c;
    const gridH = colX(h - 1) + c;
    const L = Math.round(p * 1.15);
    const U0 = Math.max(48, Math.round(minSide / 48));
    const M = U0;
    const T = Math.round(U0 * 2.6);
    const { counts, empty } = usage(grid, palette.length);
    const availH = gridH + L * (labels4 ? 2 : 1);
    const lm = legendModel(counts, empty, palette, U0, availH);
    const gx0 = M + L;
    const gy0 = M + T + L;
    const rightLabels = labels4 ? L : 0;
    const legendX = gx0 + gridW + rightLabels + M;
    const width = legendX + lm.width + M;
    const height = Math.max(gy0 + gridH + rightLabels + M, M + T + lm.height + M);

    function draw(ctx, y0, sh) {
      if (o.bg !== 'transparent') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, y0, width, sh);
      }
      // Titre
      if (y0 < M + T) {
        const title = plate.name + ' — ' + w + ' × ' + h + ' picots';
        text(ctx, title, M, M + U0 * 0.75, U0 * 1.05, o, 700);
        const sub = [meta.project, meta.total > 1 ? 'plaque ' + meta.index + ' sur ' + meta.total : null,
          U.fmtInt(lm.total) + ' perles', meta.date].filter(Boolean).join('  ·  ');
        text(ctx, sub, M, M + U0 * 1.85, U0 * 0.55, o, 500, INK_SOFT);
      }
      // Repères colonnes (lettres) et lignes (chiffres)
      const lf = Math.round(Math.min(p * 0.5, L * 0.52));
      for (let i = 0; i < w; i++) {
        const x = gx0 + colX(i) + c / 2;
        const lab = U.colLetters(i);
        const size = lab.length > 2 ? lf * 0.78 : lf;
        text(ctx, lab, x, gy0 - L / 2, size, o, 700, INK, 'center');
        if (labels4) text(ctx, lab, x, gy0 + gridH + L / 2, size, o, 700, INK, 'center');
      }
      for (let j = 0; j < h; j++) {
        const y = gy0 + colX(j) + c / 2;
        if (y + p < y0 || y - p > y0 + sh) continue;
        const lab = String(j + 1);
        const size = lab.length > 2 ? lf * 0.82 : lf;
        text(ctx, lab, gx0 - L / 2, y, size, o, 700, INK, 'center');
        if (labels4) text(ctx, lab, gx0 + gridW + L / 2, y, size, o, 700, INK, 'center');
      }
      // Picots
      for (let j = 0; j < h; j++) {
        const y = gy0 + colX(j);
        if (y + c < y0 || y > y0 + sh) continue;
        for (let i = 0; i < w; i++) drawCell(ctx, gx0 + colX(i), y, c, grid[j * w + i], palette, o);
      }
      // Légende
      if (lm.entries.length || lm.empty) drawLegend(ctx, lm, legendX, M + T, counts, palette, U0, o);
    }
    return { width, height, draw, counts, empty };
  }

  /** Vue d'ensemble de toutes les plaques, sans codes, avec légende globale */
  function overviewLayout(plates, grids, palette, o, meta) {
    const bb = PP.geo.bboxOf(plates);
    const minSide = Math.max(600, o.minSide || 4320);
    let s = Math.ceil(minSide / Math.min(bb.w, bb.h));
    s = Math.max(3, Math.min(s, Math.floor(12000 / Math.max(bb.w, bb.h))));
    const gap = s >= 8 ? Math.max(1, Math.round(s * 0.08)) : 0;
    const U0 = Math.max(48, Math.round(minSide / 48));
    const M = U0;
    const T = Math.round(U0 * 2.6);
    const counts = new Int32Array(palette.length);
    let empty = 0;
    plates.forEach((p) => {
      const gr = grids[p.id];
      if (!gr) { empty += p.w * p.h; return; }
      const u = usage(gr, palette.length);
      u.counts.forEach((v, i) => (counts[i] += v));
      empty += u.empty;
    });
    const gw = bb.w * s, gh = bb.h * s;
    const lm = legendModel(counts, empty, palette, U0, gh);
    const gx0 = M, gy0 = M + T;
    const legendX = gx0 + gw + M;
    const width = legendX + lm.width + M;
    const height = Math.max(gy0 + gh + M, M + T + lm.height + M);

    function draw(ctx, y0, sh) {
      if (o.bg !== 'transparent') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, y0, width, sh);
      }
      if (y0 < M + T) {
        text(ctx, 'Vue d’ensemble — ' + plates.length + (plates.length > 1 ? ' plaques' : ' plaque'), M, M + U0 * 0.75, U0 * 1.05, o, 700);
        text(ctx, [meta.project, U.fmtInt(lm.total) + ' perles', meta.date].filter(Boolean).join('  ·  '), M, M + U0 * 1.85, U0 * 0.55, o, 500, INK_SOFT);
      }
      const c = s - gap;
      plates.forEach((p) => {
        const gr = grids[p.id];
        const px = gx0 + (p.x - bb.x) * s, py = gy0 + (p.y - bb.y) * s;
        if (py > y0 + sh || py + p.h * s < y0) return;
        for (let j = 0; j < p.h; j++) {
          const y = py + j * s;
          if (y + s < y0 || y > y0 + sh) continue;
          for (let i = 0; i < p.w; i++) {
            const v = gr ? gr[j * p.w + i] : -1;
            ctx.fillStyle = v >= 0 && palette[v] ? palette[v].hex : EMPTY;
            ctx.fillRect(px + i * s, y, c, c);
          }
        }
        ctx.lineWidth = Math.max(2, s * 0.25);
        ctx.strokeStyle = 'rgba(27,31,36,0.55)';
        ctx.strokeRect(px - gap / 2, py - gap / 2, p.w * s, p.h * s);
        // étiquette de la plaque
        const fs = Math.max(14, Math.min(U0 * 0.8, p.w * s * 0.12));
        measureCtx.font = '700 ' + Math.round(fs) + 'px ' + FONT;
        const tw = measureCtx.measureText(p.name).width;
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        rr(ctx, px + fs * 0.4, py + fs * 0.4, tw + fs * 0.9, fs * 1.5, fs * 0.3);
        ctx.fill();
        text(ctx, p.name, px + fs * 0.85, py + fs * 1.15, fs, { bg: 'white' }, 700);
      });
      if (lm.entries.length || lm.empty) drawLegend(ctx, lm, legendX, M + T, counts, palette, U0, o);
    }
    return { width, height, draw };
  }

  PP.render = { plateLayout, overviewLayout, usage, drawCell, rr };
})();
