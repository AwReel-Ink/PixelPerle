/* Pixel Perles — détection automatique des couleurs sur la photo d'une boîte de perles,
   correspondance avec un nuancier de fabricant, et choix direct dans un nuancier. */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const core = PP.convert.core;

  // =====================================================================
  // Analyse de la photo
  // =====================================================================
  const lab = (lin) => core.linToLab(lin[0], lin[1], lin[2]);
  const de76 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const linToHex = (l) => U.rgbToHex(U.linToSrgb(l[0]), U.linToSrgb(l[1]), U.linToSrgb(l[2]));
  const hexToLin = (hex) => { const c = U.hexToRgb(hex) || [0, 0, 0]; return [U.S2L[c[0]], U.S2L[c[1]], U.S2L[c[2]]]; };
  // part du plus petit des deux rectangles recouverte par l'autre (0 = disjoints, 1 = l'un contient l'autre)
  function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.min(a.w * a.h, b.w * b.h);
  }
  const union = (a, b) => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  // regroupe les rectangles qui se touchent en un seul (une même case ne doit avoir qu'un cadre)
  function foldRects(rects) {
    const out = rects.map((r) => Object.assign({}, r));
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < out.length && !again; i++) {
        for (let j = i + 1; j < out.length; j++) {
          if (overlap(out[i], out[j]) > 0) { out[i] = union(out[i], out[j]); out.splice(j, 1); again = true; break; }
        }
      }
    }
    return out;
  }

  /**
   * Découpe la photo en petits blocs. Le fond uniforme (page blanche d'une charte, table…) est repéré sur les bords
   * et écarté ; chaque bloc reçoit la teinte de la surface éclairée des perles (sans fond, trous ni reflets).
   * Les blocs voisins de teinte proche forment des zones : une zone de bonne taille = une couleur candidate.
   * Fonctionne aussi bien sur une charte (cases séparées par du blanc) que sur une boîte à compartiments.
   */
  function analyze(img, gains, opts) {
    opts = opts || {};
    const Wd = img.width, Hd = img.height, d = img.data;
    const S2L = U.S2L;

    // 1. Fond : couleur dominante et uniforme du pourtour de l'image
    const border = [];
    const stepB = Math.max(1, Math.round((Wd + Hd) / 1200));
    const pushPx = (x, y) => { const k = (y * Wd + x) * 4; border.push([d[k], d[k + 1], d[k + 2]]); };
    for (let x = 2; x < Wd - 2; x += stepB) { pushPx(x, 2); pushPx(x, Hd - 3); }
    for (let y = 2; y < Hd - 2; y += stepB) { pushPx(2, y); pushPx(Wd - 3, y); }
    const med = [0, 1, 2].map((c) => { const v = border.map((q) => q[c]).sort((a, b) => a - b); return v[v.length >> 1]; });
    const near = border.filter((q) => Math.abs(q[0] - med[0]) < 16 && Math.abs(q[1] - med[1]) < 16 && Math.abs(q[2] - med[2]) < 16).length;
    const bg = near / border.length > 0.7 ? med : null;
    const bgTol = 16;

    // 2. Blocs
    const bs = Math.max(3, Math.round(Math.min(Wd, Hd) / 140));
    const gw = Math.floor(Wd / bs), gh = Math.floor(Hd / bs);
    const nB = gw * gh;
    const bl = new Float32Array(nB * 3);
    const fg = new Uint8Array(nB);
    const step = Math.max(1, Math.floor(bs / 6));
    const trimLo = opts.trimLo == null ? 0.55 : opts.trimLo, trimHi = opts.trimHi == null ? 0.93 : opts.trimHi;
    const px = [];
    for (let by = 0; by < gh; by++) {
      for (let bx = 0; bx < gw; bx++) {
        px.length = 0;
        let total = 0;
        for (let y = by * bs; y < (by + 1) * bs; y += step) {
          for (let x = bx * bs; x < (bx + 1) * bs; x += step) {
            const k = (y * Wd + x) * 4;
            total++;
            if (bg && Math.abs(d[k] - bg[0]) < bgTol && Math.abs(d[k + 1] - bg[1]) < bgTol && Math.abs(d[k + 2] - bg[2]) < bgTol) continue;
            const r = S2L[d[k]], g = S2L[d[k + 1]], b = S2L[d[k + 2]];
            px.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
          }
        }
        const bi = by * gw + bx;
        if (px.length < total * 0.5) continue; // surtout du fond
        fg[bi] = 1;
        px.sort((a, b) => a[0] - b[0]);
        const lo = Math.floor(px.length * trimLo), hi = Math.max(lo + 1, Math.ceil(px.length * trimHi));
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = lo; i < hi && i < px.length; i++) { r += px[i][1]; g += px[i][2]; b += px[i][3]; n++; }
        bl[bi * 3] = r / n; bl[bi * 3 + 1] = g / n; bl[bi * 3 + 2] = b / n;
      }
    }
    const labs0 = new Array(nB);
    for (let i = 0; i < nB; i++) if (fg[i]) labs0[i] = lab([bl[i * 3], bl[i * 3 + 1], bl[i * 3 + 2]]);

    // 3. Zones : croissance de régions sur les blocs de premier plan
    const T = opts.sens || 8;
    const regionOf = new Int32Array(nB).fill(-1);
    const regions = [];
    const queue = new Int32Array(nB);
    for (let s = 0; s < nB; s++) {
      if (!fg[s] || regionOf[s] >= 0) continue;
      const id = regions.length;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      regionOf[s] = id;
      const m = labs0[s].slice();
      let cnt = 1;
      const members = [s];
      while (qh < qt) {
        const c = queue[qh++];
        const cx = c % gw, cy = (c / gw) | 0;
        const nbs = [cx > 0 ? c - 1 : -1, cx < gw - 1 ? c + 1 : -1, cy > 0 ? c - gw : -1, cy < gh - 1 ? c + gw : -1];
        for (const nb of nbs) {
          if (nb < 0 || !fg[nb] || regionOf[nb] >= 0) continue;
          const L = labs0[nb];
          if (de76(L, m) > T || de76(L, labs0[c]) > T * 0.8) continue;
          regionOf[nb] = id;
          queue[qt++] = nb;
          members.push(nb);
          cnt++;
          m[0] += (L[0] - m[0]) / cnt; m[1] += (L[1] - m[1]) / cnt; m[2] += (L[2] - m[2]) / cnt;
        }
      }
      regions.push({ id, members });
    }

    // 4. Filtrage : taille comparable aux autres zones, forme compacte (ni texte, ni bandeau, ni cloison)
    const stats = regions.map((rg) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      rg.members.forEach((bi) => {
        const x = bi % gw, y = (bi / gw) | 0;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      });
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      return { rg, x0, y0, w, h, n: rg.members.length, fill: rg.members.length / (w * h), aspect: Math.max(w, h) / Math.min(w, h) };
    });
    const shaped = stats.filter((s) => s.n >= 6 && Math.min(s.w, s.h) >= 3 && s.aspect <= 3.2 && s.fill >= 0.4);
    const sizes = shaped.map((s) => s.n).sort((a, b) => a - b);
    const p75 = sizes.length ? sizes[Math.floor(sizes.length * 0.75)] : 0;
    const minN = Math.max(6, Math.round(p75 * 0.22));

    let cands = [];
    shaped.forEach((s) => {
      if (s.n < minN) return;
      // teinte : blocs intérieurs de préférence (les bords mélangent deux couleurs)
      const inRg = (bi) => regionOf[bi] === s.rg.id;
      const inner = s.rg.members.filter((bi) => {
        const x = bi % gw, y = (bi / gw) | 0;
        return x > 0 && y > 0 && x < gw - 1 && y < gh - 1 && inRg(bi - 1) && inRg(bi + 1) && inRg(bi - gw) && inRg(bi + gw);
      });
      const use = inner.length >= 4 ? inner : s.rg.members;
      let r = 0, g = 0, b = 0;
      use.forEach((bi) => { r += bl[bi * 3]; g += bl[bi * 3 + 1]; b += bl[bi * 3 + 2]; });
      const n = use.length;
      cands.push({
        lin0: [r / n, g / n, b / n], area: s.n,
        rects: [{ x: s.x0 * bs, y: s.y0 * bs, w: s.w * bs, h: s.h * bs }],
        bg: !bg && s.n > nB * 0.2,
      });
    });

    // 5. Balance des blancs automatique
    let autoWB = null;
    if (!gains) {
      if (bg && Math.min(...bg) > 150) {
        // fond clair uniforme (page d'une charte, feuille sous tout le sujet) : on le neutralise sans changer l'exposition
        const l = bg.map((v) => S2L[v]);
        const Y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
        const gn = l.map((v) => U.clamp(Y / Math.max(v, 0.002), 0.25, 8));
        if (Math.max(...gn.map((v) => Math.abs(v - 1))) > 0.02) { gains = gn; autoWB = { gains, rect: null, from: 'fond' }; }
      } else {
        // sinon : la plus grande zone très claire (feuille blanche posée dans la photo), même teintée par une lampe chaude
        let best = null;
        cands.forEach((c) => {
          const L = lab(c.lin0);
          const chroma = Math.hypot(L[1], L[2]);
          if (L[0] < 60 || chroma > 45 || c.area < nB * 0.012) return;
          const score = L[0] * 3 + Math.log(c.area) * 6 - chroma * 0.5;
          if (!best || score > best.score) best = { c, score };
        });
        if (best) {
          const l = best.c.lin0;
          const Tw = opts.white || 0.92;
          gains = [Tw / Math.max(l[0], 0.002), Tw / Math.max(l[1], 0.002), Tw / Math.max(l[2], 0.002)].map((v) => U.clamp(v, 0.25, 8));
          const r = best.c.rects[0];
          autoWB = { gains, rect: [r.x, r.y, r.w, r.h], from: 'feuille' };
          best.c.sheet = true;
        }
      }
    }
    const gn = gains || [1, 1, 1];
    cands.forEach((c) => {
      c.lin = [c.lin0[0] * gn[0], c.lin0[1] * gn[1], c.lin0[2] * gn[2]];
      c.lab = lab(c.lin);
      c.hex = linToHex(c.lin);
    });

    // 6. Zones de couleur identique (un compartiment coupé par une ombre, deux compartiments pareils)
    cands.sort((a, b) => b.area - a.area);
    const merged = [];
    const mergeT = opts.merge || 1.6;
    cands.forEach((c) => {
      const twin = merged.find((m) => !m.sheet && !c.sheet && !m.bg && !c.bg && core.de2000(m.lab, c.lab) < mergeT);
      if (twin) {
        const n = twin.area + c.area;
        twin.lin = twin.lin.map((v, i) => (v * twin.area + c.lin[i] * c.area) / n);
        twin.area = n;
        twin.lab = lab(twin.lin);
        twin.hex = linToHex(twin.lin);
        twin.rects.push(...c.rects);
      } else merged.push(c);
    });

    // 6 bis. Deux cadres qui se chevauchent décrivent la même case (variations de teinte, reflet, perle translucide) :
    // on les réunit en une seule couleur, quelle que soit la différence de teinte
    const minOverlap = opts.overlap == null ? 0.2 : opts.overlap;
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < merged.length && !again; i++) {
        const a = merged[i];
        if (a.bg || a.sheet) continue;
        for (let j = i + 1; j < merged.length; j++) {
          const b = merged[j];
          if (b.bg || b.sheet) continue;
          if (!a.rects.some((ra) => b.rects.some((rb) => overlap(ra, rb) > minOverlap))) continue;
          const n = a.area + b.area;
          a.lin = a.lin.map((v, k) => (v * a.area + b.lin[k] * b.area) / n);
          a.area = n;
          a.lab = lab(a.lin);
          a.hex = linToHex(a.lin);
          a.rects = foldRects(a.rects.concat(b.rects));
          merged.splice(j, 1);
          again = true;
          break;
        }
      }
    }
    merged.sort((a, b) => b.area - a.area);

    // 7. Ordre de lecture : de haut en bas, puis de gauche à droite (comme sur la charte)
    const hs = merged.map((c) => c.rects[0].h).sort((a, b) => a - b);
    const rowTol = (hs[hs.length >> 1] || bs) * 0.5;
    merged.sort((a, b) => (a.rects[0].y + a.rects[0].h / 2) - (b.rects[0].y + b.rects[0].h / 2));
    let rowY = -Infinity, row = -1;
    merged.forEach((c) => {
      const cy = c.rects[0].y + c.rects[0].h / 2;
      if (cy - rowY > rowTol) { row++; rowY = cy; }
      c.row = row;
    });
    merged.sort((a, b) => a.row - b.row || a.rects[0].x - b.rects[0].x);
    return { cands: merged, autoWB, blockSize: bs, background: bg };
  }

  // =====================================================================
  // Nuancier : correspondances
  // =====================================================================
  let KL = 1.5; // la luminosité d'une photo est moins fiable que la teinte : on la pondère moins
  const refLabCache = new Map();
  function refLabs(cat) {
    if (refLabCache.has(cat.id)) return refLabCache.get(cat.id);
    const list = cat.colors.map((c) => {
      const rgb = U.hexToRgb(c.hex);
      return lab([U.S2L[rgb[0]], U.S2L[rgb[1]], U.S2L[rgb[2]]]);
    });
    refLabCache.set(cat.id, list);
    return list;
  }
  function matches(cat, labv, n) {
    const labs = refLabs(cat);
    return cat.colors.map((c, i) => ({ c, d: core.de2000(labv, labs[i], KL) })).sort((a, b) => a.d - b.d).slice(0, n || 4);
  }
  function labOfHex(hex) {
    const rgb = U.hexToRgb(hex) || [0, 0, 0];
    return lab([U.S2L[rgb[0]], U.S2L[rgb[1]], U.S2L[rgb[2]]]);
  }
  function nearestRef(pal, hex) {
    const cat = pal && pal.ref ? PP.catalogById(pal.ref) : null;
    if (!cat) return null;
    return matches(cat, labOfHex(hex), 1)[0] || null;
  }

  // =====================================================================
  // Interface
  // =====================================================================
  const D = (A.detect = { active: false, cands: [], sel: null, crop: false, hexMode: 'ref' });
  const pal = () => A.currentPalette();
  const catalog = () => { const p = pal(); return p && p.ref ? PP.catalogById(p.ref) : null; };

  function refreshRefSelect() {
    const sel = $('refCatalog');
    sel.innerHTML = '<option value="">Aucun (codes libres)</option>' + PP.catalogs.map((c) => '<option value="' + c.id + '">' + esc(c.label) + ' · ' + c.colors.length + ' couleurs</option>').join('');
    const p = pal();
    sel.value = (p && p.ref) || '';
  }

  function existingMatch(p, c) {
    if (!p) return null;
    for (const x of p.colors) {
      if (c.code && x.code.toLowerCase() === c.code.toLowerCase()) return x;
      if (core.de2000(labOfHex(x.hex), c.lab) < 1.5) return x;
    }
    return null;
  }

  function assignRef(c, m) {
    c.ref = m ? m.c : null;
    c.refD = m ? m.d : null;
    if (m) { c.code = m.c.code; c.name = m.c.name || ''; }
  }

  let seq = 0;
  D.run = async function () {
    const p = pal();
    if (!p || !A.photo.data) { A.toast('Chargez d’abord une photo de vos perles.', 'error'); return; }
    $('detectBtn').disabled = true;
    $('detectBtn').querySelector('span').textContent = 'Analyse…';
    await U.nextFrame();
    try {
      const gains = p.wb && p.wb.on !== false ? p.wb.gains : null;
      const res = analyze(A.photo.data, gains, { sens: +$('detSens').value || 8 });
      if (res.autoWB) {
        p.wb = { gains: res.autoWB.gains, rect: res.autoWB.rect, on: true, auto: true };
        A.savePalette(p);
        A.panels.rebuildPhoto();
        A.toast(res.autoWB.from === 'feuille' ? 'Feuille blanche repérée : balance des blancs réglée automatiquement.' : 'Fond clair repéré : balance des blancs réglée automatiquement.');
      }
      const cat = catalog();
      const autoCode = { colors: p.colors.slice() };
      let cands = res.cands.map((c) => ({ id: ++seq, rects: c.rects, lab: c.lab, hex: c.hex, area: c.area, bg: c.bg, sheet: !!c.sheet }));
      if (cat) {
        // chaque zone reçoit la perle la plus proche, sans donner deux fois le même code :
        // les paires les plus proches sont servies d'abord ; une zone dont la perle est déjà prise reçoit la suivante,
        // sauf si elle a vraiment la même teinte (deux compartiments identiques) : elle rejoint alors l'autre zone.
        cands.forEach((c) => { c.alts = matches(cat, c.lab, 6); });
        const order = cands.filter((c) => !c.bg && !c.sheet).concat(cands.filter((c) => c.bg || c.sheet));
        const pairs = [];
        order.forEach((c, ci) => c.alts.forEach((m, k) => pairs.push({ c, m, k, pri: c.bg || c.sheet ? 1 : 0 })));
        pairs.sort((a, b) => a.pri - b.pri || a.m.d - b.m.d);
        const taken = new Map();
        const done = new Set();
        const absorbed = new Set();
        pairs.forEach(({ c, m }) => {
          if (done.has(c)) return;
          const owner = taken.get(m.c.code);
          if (!owner) { assignRef(c, m); taken.set(m.c.code, c); done.add(c); return; }
          if (!c.bg && !c.sheet && core.de2000(owner.lab, c.lab) < 1.5) {
            owner.rects.push(...c.rects); owner.area += c.area; absorbed.add(c); done.add(c);
          }
        });
        cands = cands.filter((c) => !absorbed.has(c));
        cands.forEach((c) => {
          if (!done.has(c)) { c.ref = null; c.code = A.suggestCode(autoCode); autoCode.colors.push({ code: c.code }); c.name = ''; }
        });
      } else {
        cands.forEach((c) => { c.code = A.suggestCode(autoCode); autoCode.colors.push({ code: c.code }); c.name = ''; });
      }
      cands.forEach((c) => {
        c.dup = existingMatch(p, c);
        // trop loin de toute perle du nuancier : logo, texte, décor… décoché d'office
        c.far = !!(cat && (!c.ref || c.refD > 20));
        c.checked = !c.bg && !c.sheet && !c.dup && !c.far;
      });
      D.cands = cands;
      D.cands.forEach((c, i) => { c.num = i + 1; });
      D.active = true;
      D.sel = null;
      D.crop = false;
      D.hexMode = cat ? (D.hexMode || 'ref') : 'photo';
      render();
      A.redraw();
      const n = D.cands.filter((c) => c.checked).length;
      if (!D.cands.length) A.toast('Aucune zone de couleur nette trouvée. Essayez une sensibilité plus élevée, ou tracez les cadres à la main.', 'error');
      else A.toast(D.cands.length + ' couleur' + (D.cands.length > 1 ? 's' : '') + ' détectée' + (D.cands.length > 1 ? 's' : '') + ', ' + n + ' cochée' + (n > 1 ? 's' : '') + '. Vérifiez les cadres sur la photo.');
    } catch (e) {
      console.error(e);
      A.toast('La détection a échoué : ' + e.message, 'error');
    } finally {
      $('detectBtn').disabled = false;
      $('detectBtn').querySelector('span').textContent = D.active ? 'Relancer la détection' : 'Détecter les couleurs';
    }
  };

  function hueKey(L) {
    const c = Math.hypot(L[1], L[2]);
    if (c < 10) return -1000 + (100 - L[0]); // neutres en tête, du clair au foncé
    const h = (Math.atan2(L[2], L[1]) * 180) / Math.PI;
    return ((h + 360 + 60) % 360) * 10 + (100 - L[0]) / 10;
  }

  let listFor = null;
  function fillRefCodes(cat) {
    const id = cat ? cat.id : '';
    if (listFor === id) return;
    listFor = id;
    $('refCodes').innerHTML = cat ? cat.colors.map((c) => '<option value="' + esc(c.code) + '">' + esc(c.name || c.code) + '</option>').join('') : '';
  }

  // Code saisi à la main : s'il existe dans le nuancier, la détection est rattachée à cette perle
  function setCodeFromInput(c, value) {
    const v = String(value || '').trim();
    c.code = v;
    const cat = catalog();
    if (!cat || !v) return false;
    const m = cat.colors.find((x) => x.code.toLowerCase() === v.toLowerCase());
    if (!m) {
      if (c.ref && c.ref.code.toLowerCase() !== v.toLowerCase()) {
        if (c.name === (c.ref.name || '')) c.name = '';
        c.ref = null; c.refD = null;
      }
      return false;
    }
    const d = core.de2000(c.lab, labOfHex(m.hex), KL);
    c.ref = m; c.refD = d;
    c.code = m.code;
    c.name = m.name || '';
    c.alts = (c.alts || []).filter((x) => x.c.code !== m.code);
    c.alts.unshift({ c: m, d });
    c.far = false;
    c.dup = existingMatch(pal(), c);
    return true;
  }

  function render() {
    const box = $('detectBox');
    box.hidden = !D.active;
    if (!D.active) return;
    const cat = catalog();
    fillRefCodes(cat);
    $('detHexField').hidden = !cat;
    $('detHex').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === D.hexMode)));
    const n = D.cands.filter((c) => c.checked).length;
    $('detCount').textContent = D.cands.length + ' détectée' + (D.cands.length > 1 ? 's' : '') + ' · ' + n + ' cochée' + (n > 1 ? 's' : '');
    $('detAdd').querySelector('span').textContent = 'Ajouter ' + n + ' couleur' + (n > 1 ? 's' : '') + ' à la palette';
    $('detAdd').disabled = !n;
    showHint();
    $('detList').innerHTML = D.cands.map((c) => {
      const flags = [];
      if (c.sheet) flags.push('Feuille de référence');
      if (c.bg) flags.push('Fond probable');
      if (c.dup) flags.push('Déjà dans la palette (' + esc(c.dup.code) + ')');
      if (c.far) flags.push(c.ref ? 'Loin du nuancier (logo, texte ?)' : 'Aucune perle libre du nuancier ne correspond');
      let meta = '';
      if (cat && c.alts) {
        meta = '<select data-f="ref" aria-label="Correspondance dans le nuancier">' +
          c.alts.map((m, k) => '<option value="' + k + '"' + (c.ref && m.c.code === c.ref.code ? ' selected' : '') + '>' + esc(m.c.code + (m.c.name ? ' ' + m.c.name : '')) + ' · écart ' + m.d.toFixed(1).replace('.', ',') + '</option>').join('') +
          '<option value="-1"' + (!c.ref ? ' selected' : '') + '>Aucune correspondance</option></select>';
      }
      return '<li class="det-item' + (c.id === D.sel ? ' selected' : '') + (c.checked ? '' : ' off') + '" data-id="' + c.id + '">' +
        '<input type="checkbox"' + (c.checked ? ' checked' : '') + ' aria-label="Garder la couleur ' + c.num + '">' +
        '<span class="det-num">' + c.num + '</span>' +
        '<span class="det-sw" style="background:' + c.hex + '" title="Mesurée : ' + c.hex + '"></span>' +
        '<span class="det-sw' + (c.ref ? '' : ' none') + '" style="background:' + (c.ref ? c.ref.hex : 'transparent') + '" title="' + (c.ref ? 'Nuancier : ' + c.ref.hex : 'Pas de nuancier') + '"></span>' +
        '<input class="c-code" type="text" data-f="code" maxlength="5" value="' + esc(c.code || '') + '" aria-label="Code (tapez ou choisissez une référence du nuancier)"' + (cat ? ' list="refCodes" title="Tapez ou choisissez une référence du nuancier"' : '') + ' autocomplete="off" autocapitalize="characters" spellcheck="false">' +
        '<input type="text" data-f="name" maxlength="40" value="' + esc(c.name || '') + '" placeholder="Nom" aria-label="Nom" autocomplete="off">' +
        '<div class="det-meta">' + (meta || '<span class="spacer"></span>') +
        '<span class="det-acts">' +
        '<button class="icon-btn" type="button" data-act="crop" title="Recadrer : tracez un nouveau rectangle sur la photo"><svg class="ic"><use href="#i-target"/></svg></button>' +
        '<button class="icon-btn' + (D.mergeInto === c.id ? ' on' : '') + '" type="button" data-act="merge" title="Fusionner avec une autre couleur"><svg class="ic"><use href="#i-merge"/></svg></button>' +
        '<button class="icon-btn danger" type="button" data-act="del" title="Supprimer cette détection"><svg class="ic"><use href="#i-trash"/></svg></button>' +
        '</span>' +
        (flags.length ? '<span class="det-flag">' + flags.join(' · ') + '</span>' : '') + '</div>' +
        '</li>';
    }).join('');
  }
  D.render = render;

  function showHint() {
    const el = $('detCropHint');
    const into = D.mergeInto && D.cands.find((x) => x.id === D.mergeInto);
    el.hidden = !D.crop && !into;
    el.textContent = into ? 'Touchez la couleur à réunir avec n° ' + into.num + ' (dans la liste ou sur la photo). Rappuyez sur le bouton pour annuler.' : 'Tracez le nouveau cadre sur la photo.';
  }

  // Réunit la détection « fromId » dans « intoId » : cadres regroupés, teinte moyennée, code de « intoId » conservé
  function mergeCands(intoId, fromId) {
    const a = D.cands.find((x) => x.id === intoId), b = D.cands.find((x) => x.id === fromId);
    if (!a || !b || a === b) return;
    const wa = Math.max(1, a.area || 0), wb = Math.max(1, b.area || 0);
    const la = hexToLin(a.hex), lb = hexToLin(b.hex);
    const lin = la.map((v, k) => (v * wa + lb[k] * wb) / (wa + wb));
    a.hex = linToHex(lin);
    a.lab = lab(lin);
    a.area = wa + wb;
    a.rects = foldRects(a.rects.concat(b.rects));
    const cat = catalog();
    if (cat) {
      a.alts = matches(cat, a.lab, 6);
      if (a.ref && !a.alts.some((m) => m.c.code === a.ref.code)) a.alts.push({ c: a.ref, d: a.refD || 0 });
    }
    a.checked = a.checked || b.checked;
    D.cands = D.cands.filter((x) => x !== b);
    D.mergeInto = null;
    D.sel = a.id;
    render();
    A.redraw();
    A.toast('N° ' + b.num + ' réuni avec n° ' + a.num + '.');
  }

  function removeCand(id) {
    const c = D.cands.find((x) => x.id === id);
    if (!c) return;
    D.cands = D.cands.filter((x) => x !== c);
    if (D.sel === id) D.sel = null;
    if (D.mergeInto === id) D.mergeInto = null;
    render();
    A.redraw();
    A.toast('Détection n° ' + c.num + ' supprimée.');
  }

  function select(id, focus) {
    if (D.mergeInto && D.mergeInto !== id) { mergeCands(D.mergeInto, id); return; }
    D.sel = id;
    D.crop = false;
    $('detList').querySelectorAll('.det-item').forEach((li) => li.classList.toggle('selected', +li.dataset.id === id));
    showHint();
    const c = D.cands.find((x) => x.id === id);
    if (c && focus) A.stage.focusPhoto(c.rects[0]);
    A.redraw();
  }

  // Rectangle tracé sur la photo pendant la détection
  D.onRect = function (rect, pt) {
    if (!D.active || A.photoTool !== 'sample') return false;
    if (!rect) {
      // simple toucher : sélectionne le cadre touché
      const hit = D.cands.slice().reverse().find((c) => c.rects.some((r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h));
      if (hit) {
        select(hit.id);
        const li = $('detList').querySelector('[data-id="' + hit.id + '"]');
        if (li) li.scrollIntoView({ block: 'nearest' });
        return true;
      }
      return false;
    }
    const p = pal();
    const lin = A.panels.measureLin(rect);
    const hex = U.rgbToHex(U.linToSrgb(lin[0]), U.linToSrgb(lin[1]), U.linToSrgb(lin[2]));
    const labv = labOfHex(hex);
    const cat = catalog();
    let c = D.crop ? D.cands.find((x) => x.id === D.sel) : null;
    if (c) {
      c.rects = [rect];
      c.hex = hex; c.lab = labv;
    } else {
      c = { id: ++seq, num: D.cands.length + 1, rects: [rect], hex, lab: labv, area: 0, checked: true };
      if (!cat) { c.code = A.suggestCode({ colors: p.colors.concat(D.cands) }); c.name = ''; }
      D.cands.push(c);
    }
    if (cat) { c.alts = matches(cat, labv, 5); assignRef(c, c.alts[0]); }
    c.dup = existingMatch(p, c);
    c.bg = false; c.sheet = false;
    D.sel = c.id;
    D.crop = false;
    render();
    A.redraw();
    const li = $('detList').querySelector('[data-id="' + c.id + '"]');
    if (li) li.scrollIntoView({ block: 'nearest' });
    return true;
  };

  // Cadres numérotés sur la photo
  D.draw = function (ctx, v) {
    if (!D.active) return;
    ctx.save();
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    D.cands.forEach((c) => {
      const sel = c.id === D.sel;
      c.rects.forEach((r, k) => {
        const x = (r.x - v.x) * v.s, y = (r.y - v.y) * v.s, w = r.w * v.s, h = r.h * v.s;
        ctx.setLineDash(c.checked ? [] : [5, 4]);
        ctx.lineWidth = sel ? 5 : 3.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeRect(x, y, w, h);
        ctx.lineWidth = sel ? 2.5 : 1.5;
        ctx.strokeStyle = sel ? '#FF4FA0' : c.checked ? '#FFFFFF' : 'rgba(255,255,255,0.55)';
        ctx.strokeRect(x, y, w, h);
        if (w >= 34 && h >= 26 && (k === 0 || w > 40)) {
          const label = String(c.num);
          const bw = Math.max(22, ctx.measureText(label).width + 12);
          ctx.setLineDash([]);
          ctx.fillStyle = sel ? '#FF4FA0' : c.checked ? '#111111' : 'rgba(17,17,17,0.6)';
          PP.render.rr(ctx, x + 3, y + 3, bw, 20, 5);
          ctx.fill();
          ctx.fillStyle = c.hex;
          ctx.beginPath(); ctx.arc(x + 3 + bw + 9, y + 13, 7, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 1.5; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(label, x + 3 + bw / 2, y + 13.5);
        }
      });
    });
    ctx.restore();
  };

  function addChecked() {
    const p = pal();
    if (!p) return;
    const cat = catalog();
    let added = 0;
    const renamed = [];
    D.cands.filter((c) => c.checked).forEach((c) => {
      let code = String(c.code || '').trim() || A.suggestCode(p);
      if (A.codeError(p, code)) {
        const base = code.slice(0, 4);
        let k = 2;
        while (A.codeError(p, (base + k).slice(0, 5)) && k < 99) k++;
        renamed.push(code + ' → ' + (base + k).slice(0, 5));
        code = (base + k).slice(0, 5);
      }
      const hex = cat && c.ref && D.hexMode === 'ref' ? c.ref.hex : c.hex;
      p.colors.push({ id: U.uid(), code, name: (c.name || '').trim(), hex: U.normHex(hex) });
      added++;
    });
    A.savePalette(p);
    D.active = false;
    D.cands = [];
    D.sel = null;
    render();
    A.panels.refreshPalette();
    A.redraw();
    A.toast(added + ' couleur' + (added > 1 ? 's' : '') + ' ajoutée' + (added > 1 ? 's' : '') + ' à « ' + p.name + ' ».' + (renamed.length ? ' Codes déjà pris, renommés : ' + renamed.join(', ') + '.' : ''));
  }

  // ---------- Choisir directement dans un nuancier ----------
  function openCatalog() {
    const p = pal();
    if (!p) return;
    let cat = catalog() || PP.catalogById('artkal_c_photo') || PP.catalogs[0];
    const body = document.createElement('div');
    body.style.display = 'contents';
    body.innerHTML =
      '<label class="field"><span class="label">Nuancier</span><select id="catSel">' + PP.catalogs.map((c) => '<option value="' + c.id + '">' + esc(c.label) + '</option>').join('') + '</select></label>' +
      '<div class="field-inline"><input type="text" id="catSearch" placeholder="Rechercher un code ou un nom (ex. C15, blue)" autocomplete="off"><span class="count" id="catCount"></span></div>' +
      '<details class="disclosure"><summary>Coller la liste de vos codes</summary>' +
      '<textarea id="catPaste" rows="3" spellcheck="false" placeholder="C01 C02 C15 C78 C103…"></textarea>' +
      '<div class="field-inline"><button class="btn btn-sm" type="button" id="catPasteBtn">Cocher ces codes</button><span class="hint" id="catPasteMsg"></span></div></details>' +
      '<div class="btn-row"><button class="btn btn-sm btn-ghost" type="button" id="catAllVis">Cocher les couleurs affichées</button><button class="btn btn-sm btn-ghost" type="button" id="catNone">Tout décocher</button></div>' +
      '<ul class="cat-list" id="catList"></ul>' +
      '<p class="hint">Teintes : relevés communautaires du projet beadcolors (licence MIT). Elles sont proches des vraies perles mais pas exactes ; vous pouvez les corriger ensuite à la pipette.</p>';
    const chosen = new Set();
    let addBtn = null;
    const has = (code) => p.colors.some((x) => x.code.toLowerCase() === code.toLowerCase());
    function list() {
      const q = body.querySelector('#catSearch').value.trim().toLowerCase();
      const items = cat.colors.filter((c) => !q || c.code.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q));
      body.querySelector('#catCount').textContent = items.length + ' / ' + cat.colors.length;
      body.querySelector('#catList').innerHTML = items.map((c) => {
        const own = has(c.code);
        return '<li class="' + (own ? 'own' : '') + '"><label><input type="checkbox" data-code="' + esc(c.code) + '"' + (own ? ' disabled checked' : chosen.has(c.code) ? ' checked' : '') + '>' +
          '<span class="cat-sw" style="background:' + c.hex + '"></span><b>' + esc(c.code) + '</b><span class="cat-nm">' + esc(c.name || '') + (own ? ' · déjà dans la palette' : '') + '</span></label></li>';
      }).join('');
      if (addBtn) { addBtn.textContent = 'Ajouter ' + chosen.size + ' couleur' + (chosen.size > 1 ? 's' : ''); addBtn.disabled = !chosen.size; }
    }
    A.modal({
      title: 'Choisir dans le nuancier', body,
      actions: [
        { label: 'Annuler', value: null, kind: 'ghost' },
        { label: 'Ajouter', value: () => 'add', kind: 'primary' },
      ],
      onOpen: (b) => {
        addBtn = b.parentElement.querySelector('.modal-foot .btn-primary');
        const sel = b.querySelector('#catSel');
        sel.value = cat.id;
        sel.addEventListener('change', () => { cat = PP.catalogById(sel.value); chosen.clear(); list(); });
        b.querySelector('#catSearch').addEventListener('input', list);
        b.querySelector('#catList').addEventListener('change', (e) => {
          const code = e.target.dataset.code;
          if (!code) return;
          if (e.target.checked) chosen.add(code); else chosen.delete(code);
          list();
        });
        b.querySelector('#catAllVis').addEventListener('click', () => {
          b.querySelectorAll('#catList input:not(:disabled)').forEach((i) => chosen.add(i.dataset.code));
          list();
        });
        b.querySelector('#catNone').addEventListener('click', () => { chosen.clear(); list(); });
        b.querySelector('#catPasteBtn').addEventListener('click', () => {
          const want = b.querySelector('#catPaste').value.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
          const byCode = new Map(cat.colors.map((c) => [c.code.toLowerCase(), c.code]));
          const unknown = [];
          let n = 0;
          want.forEach((t) => {
            const code = byCode.get(t.toLowerCase());
            if (!code) { unknown.push(t); return; }
            if (!has(code)) { chosen.add(code); n++; }
          });
          b.querySelector('#catPasteMsg').textContent = n + ' code' + (n > 1 ? 's' : '') + ' coché' + (n > 1 ? 's' : '') + (unknown.length ? ' · inconnus dans ce nuancier : ' + unknown.slice(0, 8).join(', ') + (unknown.length > 8 ? '…' : '') : '');
          list();
        });
        list();
      },
    }).then((v) => {
      if (v !== 'add' || !chosen.size) return;
      cat.colors.filter((c) => chosen.has(c.code) && !has(c.code)).forEach((c) => {
        p.colors.push({ id: U.uid(), code: c.code, name: c.name || '', hex: c.hex });
      });
      if (!p.ref) p.ref = cat.id;
      A.savePalette(p);
      A.panels.refreshPalette();
      A.toast(chosen.size + ' couleur' + (chosen.size > 1 ? 's' : '') + ' du nuancier ajoutée' + (chosen.size > 1 ? 's' : '') + '.');
    });
  }

  function init() {
    refreshRefSelect();
    $('refCatalog').addEventListener('change', (e) => {
      const p = pal();
      if (!p) return;
      p.ref = e.target.value || null;
      A.savePalette(p);
      // recalcule les correspondances si une détection est en cours
      const cat = catalog();
      D.cands.forEach((c) => {
        if (cat) { c.alts = matches(cat, c.lab, 5); assignRef(c, c.alts[0]); }
        else { c.alts = null; c.ref = null; }
        c.dup = existingMatch(p, c);
      });
      if (cat) D.hexMode = 'ref';
      render();
    });
    $('detectBtn').addEventListener('click', D.run);
    $('catalogBtn').addEventListener('click', openCatalog);
    $('detSens').addEventListener('input', (e) => { $('detSensOut').textContent = e.target.value; });
    $('detSens').addEventListener('change', () => { if (D.active) D.run(); });
    $('detHex').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      D.hexMode = b.dataset.v;
      render();
    });
    $('detAll').addEventListener('click', () => { D.cands.forEach((c) => { c.checked = true; }); render(); A.redraw(); });
    $('detNone').addEventListener('click', () => { D.cands.forEach((c) => { c.checked = false; }); render(); A.redraw(); });
    $('detAdd').addEventListener('click', addChecked);
    $('detCancel').addEventListener('click', () => { D.active = false; D.cands = []; D.sel = null; D.mergeInto = null; render(); A.redraw(); $('detectBtn').querySelector('span').textContent = 'Détecter les couleurs'; });
    const list = $('detList');
    list.addEventListener('change', (e) => {
      const li = e.target.closest('.det-item');
      if (!li) return;
      const c = D.cands.find((x) => x.id === +li.dataset.id);
      if (!c) return;
      if (e.target.type === 'checkbox') {
        c.checked = e.target.checked;
        li.classList.toggle('off', !c.checked);
        const n = D.cands.filter((x) => x.checked).length;
        $('detCount').textContent = D.cands.length + ' détectées · ' + n + ' cochée' + (n > 1 ? 's' : '');
        $('detAdd').querySelector('span').textContent = 'Ajouter ' + n + ' couleur' + (n > 1 ? 's' : '') + ' à la palette';
        $('detAdd').disabled = !n;
        A.redraw();
      } else if (e.target.dataset.f === 'code') {
        const linked = setCodeFromInput(c, e.target.value);
        const twin = D.cands.find((x) => x !== c && x.code && x.code.toLowerCase() === c.code.toLowerCase());
        render();
        if (twin) A.toast('Le code ' + c.code + ' est aussi donné au n° ' + twin.num + '. Fusionnez-les ou changez l’un des deux.', 'error');
        else if (linked) A.toast('N° ' + c.num + ' rattaché à ' + c.code + (c.name ? ' ' + c.name : '') + '.');
      } else if (e.target.dataset.f === 'ref') {
        const k = +e.target.value;
        assignRef(c, k >= 0 ? c.alts[k] : null);
        if (k < 0 && !c.code) c.code = A.suggestCode(pal());
        c.dup = existingMatch(pal(), c);
        render();
      }
    });
    list.addEventListener('input', (e) => {
      const li = e.target.closest('.det-item');
      const c = li && D.cands.find((x) => x.id === +li.dataset.id);
      if (!c) return;
      if (e.target.dataset.f === 'code') {
        c.code = e.target.value.trim();
        // choix dans la liste de suggestions : on rattache tout de suite
        if (e.inputType === 'insertReplacementText' || e.inputType === undefined) {
          const cat = catalog();
          if (cat && cat.colors.some((x) => x.code.toLowerCase() === c.code.toLowerCase())) e.target.blur();
        }
      }
      if (e.target.dataset.f === 'name') c.name = e.target.value;
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('.det-item');
      if (!li) return;
      const id = +li.dataset.id;
      if (e.target.closest('[data-act=del]')) { removeCand(id); return; }
      if (e.target.closest('[data-act=merge]')) {
        D.crop = false;
        if (D.mergeInto === id) D.mergeInto = null;
        else { D.mergeInto = null; select(id, true); D.mergeInto = id; }
        render();
        A.redraw();
        return;
      }
      if (e.target.closest('[data-act=crop]')) {
        D.mergeInto = null;
        select(id, true);
        D.crop = true;
        showHint();
        A.panels.setPhotoTool('sample');
        if (document.documentElement.classList.contains('ui-mobile')) A.panels.setSheet(false);
        return;
      }
      if (e.target.closest('input, select')) { if (D.sel !== id) select(id, true); return; }
      select(id, true);
    });
  }

  PP.detect = { setKL: (v) => { KL = v; }, analyze, matches, nearestRef, init, refreshRefSelect, labOfHex };
})();
