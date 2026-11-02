/* Pixel Perles — dessin d'un ensemble de plaques converties dans un canvas (utilisé par le comparateur) */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;

  function plateCanvas(cache, p, grid, rgb, emptyRgb) {
    let c = cache.get(p.id);
    if (c && c.width === p.w && c.height === p.h) return c;
    c = document.createElement('canvas');
    c.width = p.w; c.height = p.h;
    const cx = c.getContext('2d');
    const id = cx.createImageData(p.w, p.h);
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      const col = v >= 0 && rgb[v] ? rgb[v] : emptyRgb;
      id.data[i * 4] = col[0]; id.data[i * 4 + 1] = col[1]; id.data[i * 4 + 2] = col[2]; id.data[i * 4 + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    cache.set(p.id, c);
    return c;
  }

  /**
   * o : { W, H, view: {x, y, s}, plates, grids, colors, rgb, cache (Map), theme, beads, codes }
   */
  function draw(ctx, o) {
    const t = o.theme;
    const v = o.view;
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, o.W, o.H);
    if (!o.grids) return;
    o.plates.forEach((p) => {
      const sx = (p.x - v.x) * v.s, sy = (p.y - v.y) * v.s, sw = p.w * v.s, sh = p.h * v.s;
      if (sx > o.W || sy > o.H || sx + sw < 0 || sy + sh < 0) return;
      const grid = o.grids[p.id];
      if (!grid) {
        ctx.fillStyle = t.empty;
        ctx.fillRect(sx, sy, sw, sh);
      } else if (v.s < 7) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(plateCanvas(o.cache, p, grid, o.rgb, t.emptyRgb || [220, 220, 220]), sx, sy, sw, sh);
        ctx.imageSmoothingEnabled = true;
      } else {
        const gap = Math.max(1, v.s * 0.08);
        const c = v.s - gap;
        const codes = o.codes && v.s >= 24;
        const i0 = Math.max(0, Math.floor(v.x - p.x)), i1 = Math.min(p.w, Math.ceil(v.x + o.W / v.s - p.x));
        const j0 = Math.max(0, Math.floor(v.y - p.y)), j1 = Math.min(p.h, Math.ceil(v.y + o.H / v.s - p.y));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let j = j0; j < j1; j++) {
          for (let i = i0; i < i1; i++) {
            const val = grid[j * p.w + i];
            const x = sx + i * v.s + gap / 2, y = sy + j * v.s + gap / 2;
            if (val < 0 || !o.colors[val]) {
              ctx.fillStyle = t.empty;
              ctx.fillRect(x + c * 0.12, y + c * 0.12, c * 0.76, c * 0.76);
              continue;
            }
            const hex = o.colors[val].hex;
            ctx.fillStyle = hex;
            if (o.beads) {
              ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c / 2, 0, Math.PI * 2); ctx.fill();
              if (!codes) {
                ctx.fillStyle = U.shade(hex, 0.62);
                ctx.beginPath(); ctx.arc(x + c / 2, y + c / 2, c * 0.17, 0, Math.PI * 2); ctx.fill();
              }
            } else {
              ctx.fillRect(x, y, c, c);
            }
            if (codes) {
              const code = o.colors[val].code;
              ctx.fillStyle = U.textOn(hex);
              ctx.font = '700 ' + Math.round(c * (code.length <= 2 ? 0.4 : code.length === 3 ? 0.32 : 0.25)) + 'px system-ui, sans-serif';
              ctx.fillText(code, x + c / 2, y + c / 2 + 1);
            }
          }
        }
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = t.edge;
      ctx.strokeRect(Math.round(sx) + 0.5, Math.round(sy) + 0.5, Math.round(sw) - 1, Math.round(sh) - 1);
    });
  }

  function fit(bb, W, H, pad) {
    const s = Math.max(0.2, Math.min((W - 2 * pad) / bb.w, (H - 2 * pad) / bb.h));
    return { s, x: bb.x + bb.w / 2 - W / 2 / s, y: bb.y + bb.h / 2 - H / 2 / s };
  }

  PP.gridview = { draw, fit };
})();
