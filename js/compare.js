/* Pixel Perles — comparateur de rendus : tous les tramages calculés en parallèle, affichés côte à côte,
   zoom et déplacement synchronisés, cases à cocher pour écarter les rendus, validation du rendu choisi. */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;

  const C = (A.compare = {});
  const cache = { sig: null, prep: null, map: new Map() };
  let st = null; // état du comparateur ouvert
  let uncheckSeq = 0;

  const keyOf = (v) => v.mode + ':' + v.dither;

  function sigNow(pal) {
    return A.geoSig() + '|' + pal.id + ':' + pal.updated + ':' + pal.colors.length + '|' + (A.project.conv.maxColors | 0);
  }

  function baseVariants() {
    const c = A.project.conv;
    const step = [5, 10, 20, 25].includes(c.step) ? c.step : 10;
    const list = [];
    for (let d = 0; d <= 100; d += step) list.push({ mode: 'mean', dither: d });
    if (list[list.length - 1].dither !== 100) list.push({ mode: 'mean', dither: 100 });
    if (c.dominant) list.push({ mode: 'dominant', dither: 0 });
    return list;
  }
  function refineVariants(center) {
    const lo = Math.max(0, center - 10), hi = Math.min(100, center + 10);
    const set = new Set();
    for (let d = lo; d <= hi; d += 2) set.add(d);
    set.add(center);
    return Array.from(set).sort((a, b) => a - b).map((d) => ({ mode: 'mean', dither: d }));
  }
  C.variantCount = () => (A.project ? baseVariants().length : 0);

  function defaultPer() {
    const w = window.innerWidth;
    return w < 640 ? 1 : w < 1100 ? 2 : 3;
  }

  // ---------- Ouverture ----------
  C.open = async function (variants, refineOf) {
    const pal = A.checkConvertible();
    if (!pal) return;
    const sig = sigNow(pal);
    if (cache.sig !== sig) { cache.sig = sig; cache.prep = null; cache.map = new Map(); }
    const first = !st;
    const keepView = st && st.view;
    const prevChecked = st ? new Map(st.items.map((it) => [it.key, it])) : null;
    if (!st) {
      st = { per: A.settings.cmpPer || defaultPer(), view: null, selected: null };
    }
    st.pal = pal;
    st.colors = pal.colors.map((c) => ({ code: c.code, name: c.name, hex: c.hex }));
    st.rgb = st.colors.map((c) => U.hexToRgb(c.hex) || [0, 0, 0]);
    st.plates = A.project.plates.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, w: p.w, h: p.h }));
    st.bb = PP.geo.bboxOf(st.plates);
    st.refineOf = refineOf === undefined ? null : refineOf;
    st.variants = variants || baseVariants();
    // le « Meilleur rendu » (Rendu Auto) ouvre la liste, sauf quand on affine autour d'un tramage
    if (!variants) st.variants = [{ mode: 'best', dither: 0 }].concat(st.variants);
    st.items = st.variants.map((v, i) => {
      if (v.mode === 'best') {
        const prev = prevChecked && prevChecked.get('best');
        return { key: 'best', mode: 'best', dither: 0, label: '★ Meilleur rendu', order: -1, checked: prev ? prev.checked : true, uncheckedAt: prev ? prev.uncheckedAt : 0, cache: new Map(), status: 'pending' };
      }
      const key = keyOf(v);
      const prev = prevChecked && prevChecked.get(key);
      const it = { key, mode: v.mode, dither: v.dither, label: A.variantLabel(v), order: i, checked: prev ? prev.checked : true, uncheckedAt: prev ? prev.uncheckedAt : 0, cache: new Map() };
      const r = cache.map.get(key);
      if (r) Object.assign(it, r, { status: r.error ? 'error' : 'done' });
      else it.status = 'pending';
      return it;
    });
    if (!st.items.some((it) => it.key === st.selected)) {
      const r = A.project.result && A.project.result.variant;
      const want = r ? (r.auto ? 'best' : keyOf(r)) : keyOf({ mode: A.project.conv.mode, dither: A.project.conv.dither });
      st.selected = st.items.some((it) => it.key === want) ? want : null;
    }
    if (first) show();
    buildCards();
    if (!keepView) st.view = null;
    syncToolbar();
    layoutCards();
    if (st.selected && first) setTimeout(() => scrollToItem(st.selected), 60);

    const todo = st.items.filter((it) => it.status === 'pending' && it.key !== 'best');
    const myItems = st.items;
    try {
      if (todo.length) {
      if (!cache.prep) {
        setStatus('Préparation de l’image…');
        const prep = await PP.convert.prepare({ plates: A.project.plates, image: A.project.image, src: A.imgAdj });
        if (!st || cache.sig !== sig) return;
        cache.prep = prep;
      }
      st.startedAt = performance.now();
      setStatus();
      await PP.convert.runBatch(cache.prep, st.colors, todo.map((it) => ({ key: it.key, mode: it.mode, dither: it.dither })), A.project.conv.maxColors | 0, (key, r) => {
        const res = r.error ? { error: r.error } : { grids: r.grids, counts: r.counts, isolated: r.isolated, used: r.used, stockInfo: r.stockInfo };
        if (cache.sig === sig) cache.map.set(key, res);
        if (!st || st.items !== myItems) return;
        const it = st.items.find((x) => x.key === key);
        if (!it) return;
        Object.assign(it, res, { status: r.error ? 'error' : 'done' });
        it.cache = new Map();
        updateFoot(it);
        drawItem(it);
        syncToolbar();
      }, { stock: A.stockArray(pal.colors) });
      }
      // puis le meilleur rendu, calculé avec les règles du Rendu Auto
      const best = st && st.items === myItems && st.items.find((x) => x.key === 'best');
      if (best) {
        const item = await A.auto.compute(pal);
        if (!st || st.items !== myItems) return;
        best.autoItem = item;
        Object.assign(best, { grids: item.grids, counts: item.counts, used: item.used, isolated: item.isolated, stockInfo: item.stockInfo, status: 'done', sub: A.auto.describe(item) });
        best.cache = new Map();
        const subEl = best.el && best.el.querySelector('.cmp-sub');
        if (subEl) subEl.textContent = best.sub;
        updateFoot(best);
        drawItem(best);
        syncToolbar();
      }
    } catch (e) {
      console.error(e);
      A.toast(e.message || 'La conversion a échoué.', 'error');
    }
  };

  function show() {
    $('toasts').innerHTML = '';
    const el = $('compare');
    el.hidden = false;
    document.documentElement.classList.add('cmp-open');
    document.addEventListener('keydown', onKey, true);
  }

  C.close = function () {
    PP.convert.cancelBatch();
    // les rendus inachevés seront recalculés à la prochaine ouverture
    $('compare').hidden = true;
    document.documentElement.classList.remove('cmp-open');
    document.removeEventListener('keydown', onKey, true);
    st = null;
    $('cmpStrip').innerHTML = '';
  };
  C.isOpen = () => !!st;

  // ---------- Cartes ----------
  function buildCards() {
    const strip = $('cmpStrip');
    strip.innerHTML = st.items.map((it) =>
      '<article class="cmp-card" data-key="' + it.key + '">' +
      '<header class="cmp-head"><span class="cmp-label">' + esc(it.label) + '</span>' +
      (it.mode === 'dominant' ? '<span class="cmp-sub">contours nets</span>' : it.mode === 'best' ? '<span class="cmp-sub">' + esc(it.sub || 'règles du Rendu Auto') + '</span>' : '') +
      '<label class="cmp-check" title="Garder ce rendu dans la comparaison"><input type="checkbox"' + (it.checked ? ' checked' : '') + ' aria-label="Garder « ' + esc(it.label) + ' »"></label></header>' +
      '<div class="cmp-view"><canvas></canvas></div>' +
      '<footer class="cmp-foot"></footer></article>').join('');
    st.items.forEach((it) => {
      it.el = strip.querySelector('[data-key="' + it.key + '"]');
      it.canvas = it.el.querySelector('canvas');
      it.ctx = it.canvas.getContext('2d');
      updateFoot(it);
    });
    applyOrder();
  }

  function updateFoot(it) {
    if (!it.el) return;
    const f = it.el.querySelector('.cmp-foot');
    if (it.status === 'pending') f.textContent = 'Calcul en cours…';
    else if (it.status === 'error') f.textContent = 'Échec : ' + (it.error || 'erreur inconnue');
    else {
      const note = A.stockNote(it.stockInfo, st.colors);
      f.innerHTML = '<b>' + it.used + '</b> couleur' + (it.used > 1 ? 's' : '') + ' · <b>' + U.fmtInt(it.isolated) + '</b> perle' + (it.isolated > 1 ? 's' : '') + ' isolée' + (it.isolated > 1 ? 's' : '') +
        (note ? '<br><span class="cmp-stock">Stock restant : ' + esc(note) + '</span>' : '');
    }
  }

  function applyOrder() {
    // cochés dans l'ordre naturel, puis décochés dans l'ordre où on les a écartés
    const on = st.items.filter((x) => x.checked).sort((a, b) => a.order - b.order);
    const off = st.items.filter((x) => !x.checked).sort((a, b) => a.uncheckedAt - b.uncheckedAt);
    on.concat(off).forEach((it, i) => {
      it.el.style.order = i;
      it.el.classList.toggle('off', !it.checked);
      it.el.classList.toggle('selected', it.key === st.selected);
      it.el.querySelector('input[type=checkbox]').checked = it.checked;
    });
    st.sorted = on.concat(off);
  }

  function layoutCards() {
    const strip = $('cmpStrip');
    strip.style.setProperty('--per', st.per);
    requestAnimationFrame(() => { sizeCanvases(); drawAll(); });
  }

  function sizeCanvases() {
    if (!st) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    st.items.forEach((it) => {
      const box = it.canvas.parentElement.getBoundingClientRect();
      w = box.width; h = box.height;
      it.canvas.width = Math.max(1, Math.round(box.width * dpr));
      it.canvas.height = Math.max(1, Math.round(box.height * dpr));
    });
    const changed = !st.cw || Math.abs(st.cw - w) > 1 || Math.abs(st.ch - h) > 1;
    st.cw = w; st.ch = h; st.dpr = dpr;
    if (!st.view || (changed && st.fitted)) fitView();
  }

  function fitView() {
    if (!st || !st.cw) return;
    st.view = PP.gridview.fit(st.bb, st.cw, st.ch, 10);
    st.fitted = true;
    drawAll();
  }

  let rafPending = false;
  function drawAll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!st) return;
      const sr = $('cmpStrip').getBoundingClientRect();
      st.items.forEach((it) => {
        const r = it.el.getBoundingClientRect();
        if (r.right < sr.left - 40 || r.left > sr.right + 40) { it.dirty = true; return; }
        drawItem(it);
      });
      updateZoomLabel();
    });
  }

  function drawItem(it) {
    if (!st || !st.view || !it.ctx) return;
    it.dirty = false;
    const theme = A.stage.getTheme();
    const ctx = it.ctx;
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    PP.gridview.draw(ctx, {
      W: st.cw, H: st.ch, view: st.view, plates: st.plates,
      grids: it.status === 'done' ? it.grids : null, colors: st.colors, rgb: st.rgb, cache: it.cache, theme,
      beads: A.project.disp.beads, codes: A.project.disp.codes,
    });
    if (it.status !== 'done') {
      ctx.fillStyle = theme.ink2;
      ctx.font = '600 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.status === 'error' ? 'Échec du calcul' : 'Calcul…', st.cw / 2, st.ch / 2);
    }
  }

  function setStatus(txt) {
    if (!st) return;
    const el = $('cmpStatus');
    if (txt) { el.textContent = txt; return; }
    const done = st.items.filter((x) => x.status !== 'pending').length;
    const on = st.items.filter((x) => x.checked).length;
    const par = PP.convert.usesWorkers ? ' en parallèle (' + PP.convert.poolSize() + ' cœurs)' : '';
    if (done < st.items.length) el.textContent = 'Calcul' + par + ' : ' + done + ' / ' + st.items.length;
    else el.textContent = st.items.length + ' rendus' + (on < st.items.length ? ' · ' + on + ' gardé' + (on > 1 ? 's' : '') : '') + (st.selected ? '' : ' · touchez un rendu pour le choisir');
  }

  function syncToolbar() {
    if (!st) return;
    $('cmpPer').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === st.per)));
    const sel = st.items.find((x) => x.key === st.selected);
    const rb = $('cmpRefine');
    rb.disabled = !sel || sel.mode !== 'mean';
    rb.querySelector('span').textContent = sel && sel.mode === 'mean' ? 'Affiner autour de ' + sel.dither + ' %' : 'Affiner';
    $('cmpBase').hidden = st.refineOf === null;
    const v = $('cmpValidate');
    const target = selectedOrOnly();
    v.disabled = !target || target.status !== 'done';
    v.querySelector('span').textContent = target ? 'Valider « ' + target.label + ' »' : 'Valider';
    $('cmpRecheck').disabled = st.items.every((x) => x.checked);
    setStatus();
  }

  function selectedOrOnly() {
    const sel = st.items.find((x) => x.key === st.selected);
    if (sel) return sel;
    const on = st.items.filter((x) => x.checked);
    return on.length === 1 ? on[0] : null;
  }

  function select(key) {
    st.selected = key;
    applyOrder();
    syncToolbar();
  }

  function scrollToItem(key) {
    const it = st && st.items.find((x) => x.key === key);
    if (it && it.el) it.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  // Réordonne les cartes sans déplacer la vue : la carte de repère reste exactement au même endroit
  function keepView(toggled, fn) {
    const strip = $('cmpStrip');
    const sr = strip.getBoundingClientRect();
    const left = (x) => x.el.getBoundingClientRect().left;
    const vis = st.sorted.filter((x) => { const r = x.el.getBoundingClientRect(); return r.right > sr.left + 4 && r.left < sr.right - 4; });
    let anchor = null, desired = 0;
    if (vis.length && vis[0] !== toggled) { anchor = vis[0]; desired = left(anchor); }
    else if (vis.length && toggled) {
      // la carte touchée était la première visible : celle qui la suit prend sa place
      const i = st.sorted.indexOf(toggled);
      anchor = st.sorted.slice(i + 1).find((x) => x.checked) || null;
      desired = left(toggled);
    }
    strip.style.scrollSnapType = 'none';
    fn();
    if (anchor) strip.scrollLeft += left(anchor) - desired;
    requestAnimationFrame(() => requestAnimationFrame(() => { strip.style.scrollSnapType = ''; }));
  }

  function toggle(it, on) {
    keepView(it, () => {
      it.checked = on;
      if (!on) {
        it.uncheckedAt = ++uncheckSeq;
        if (st.selected === it.key) st.selected = null;
      }
      applyOrder();
    });
    syncToolbar();
    drawAll();
  }

  async function validate() {
    const it = selectedOrOnly();
    if (!it || it.status !== 'done') {
      A.toast('Touchez d’abord le rendu que vous préférez.', 'error');
      return;
    }
    const s = st;
    const ok = await A.applyVariant(it.key === 'best' ? it.autoItem : it, s.colors, s.pal.name);
    if (ok && st === s) C.close();
  }

  // ---------- Zoom et déplacement synchronisés ----------
  function zoomAt(px, py, f) {
    const v = st.view;
    if (!v) return;
    const wx = v.x + px / v.s, wy = v.y + py / v.s;
    v.s = U.clamp(v.s * f, 0.3, 80);
    v.x = wx - px / v.s; v.y = wy - py / v.s;
    st.fitted = false;
    drawAll();
  }
  function updateZoomLabel() {
    if (!st || !st.view) return;
    $('cmpZoom').textContent = Math.round((st.view.s / 10) * 100) + ' %';
  }

  const pointers = new Map();
  let gesture = null;
  function local(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function initEvents() {
    const strip = $('cmpStrip');
    strip.addEventListener('change', (e) => {
      if (!st || e.target.type !== 'checkbox') return;
      const it = st.items.find((x) => x.key === e.target.closest('.cmp-card').dataset.key);
      // la case garde le focus en partant en fin de liste : sans ça, le navigateur suit la case et la vue saute
      e.target.blur();
      if (it) toggle(it, e.target.checked);
    });
    strip.addEventListener('click', (e) => {
      if (!st || e.target.closest('.cmp-check')) return;
      const card = e.target.closest('.cmp-card');
      if (!card || e.target.tagName === 'CANVAS') return;
      select(card.dataset.key);
    });
    strip.addEventListener('dblclick', (e) => {
      const card = e.target.closest('.cmp-card');
      if (card && st) { select(card.dataset.key); validate(); }
    });
    strip.addEventListener('scroll', () => {
      if (st && st.items.some((x) => x.dirty)) drawAll();
    }, { passive: true });

    strip.addEventListener('pointerdown', (e) => {
      if (!st || e.target.tagName !== 'CANVAS') return;
      const canvas = e.target;
      canvas.setPointerCapture(e.pointerId);
      const pt = local(e, canvas);
      pointers.set(e.pointerId, pt);
      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: st.view.s, wx: st.view.x + mid.x / st.view.s, wy: st.view.y + mid.y / st.view.s };
        return;
      }
      gesture = { type: 'pan', sx: pt.x, sy: pt.y, vx: st.view.x, vy: st.view.y, moved: false, key: canvas.closest('.cmp-card').dataset.key };
    });
    strip.addEventListener('pointermove', (e) => {
      if (!st || !gesture || !pointers.has(e.pointerId)) return;
      const canvas = e.target.tagName === 'CANVAS' ? e.target : null;
      if (!canvas) return;
      const pt = local(e, canvas);
      pointers.set(e.pointerId, pt);
      const v = st.view;
      if (gesture.type === 'pinch' && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        v.s = U.clamp(gesture.s0 * ((Math.hypot(a.x - b.x, a.y - b.y) || 1) / gesture.d0), 0.3, 80);
        v.x = gesture.wx - mid.x / v.s; v.y = gesture.wy - mid.y / v.s;
        st.fitted = false;
        drawAll();
      } else if (gesture.type === 'pan') {
        if (Math.abs(pt.x - gesture.sx) + Math.abs(pt.y - gesture.sy) > 5) gesture.moved = true;
        if (!gesture.moved) return;
        v.x = gesture.vx - (pt.x - gesture.sx) / v.s;
        v.y = gesture.vy - (pt.y - gesture.sy) / v.s;
        st.fitted = false;
        drawAll();
      }
    });
    const end = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (gesture && gesture.type === 'pan' && !gesture.moved && e.type === 'pointerup' && st) select(gesture.key);
      if (pointers.size === 0) gesture = null;
      else if (gesture && gesture.type === 'pinch' && pointers.size < 2) gesture = null;
    };
    strip.addEventListener('pointerup', end);
    strip.addEventListener('pointercancel', end);
    strip.addEventListener('wheel', (e) => {
      if (!st) return;
      if (e.target.tagName !== 'CANVAS') return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        strip.scrollLeft += e.deltaX || e.deltaY;
        return;
      }
      const pt = local(e, e.target);
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(pt.x, pt.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    }, { passive: false });

    new ResizeObserver(() => { if (st) { sizeCanvases(); drawAll(); } }).observe(strip);

    $('cmpPer').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || !st) return;
      st.per = +b.dataset.v;
      A.settings.cmpPer = st.per;
      A.saveSettings();
      syncToolbar();
      layoutCards();
      setTimeout(() => { if (st && st.selected) scrollToItem(st.selected); }, 80);
    });
    $('cmpZoomIn').addEventListener('click', () => st && zoomAt(st.cw / 2, st.ch / 2, 1.3));
    $('cmpZoomOut').addEventListener('click', () => st && zoomAt(st.cw / 2, st.ch / 2, 1 / 1.3));
    $('cmpFit').addEventListener('click', () => st && fitView());
    $('cmpRecheck').addEventListener('click', () => {
      if (!st) return;
      keepView(null, () => { st.items.forEach((x) => { x.checked = true; }); applyOrder(); });
      syncToolbar(); drawAll();
    });
    $('cmpRefine').addEventListener('click', () => {
      const sel = st && st.items.find((x) => x.key === st.selected);
      if (!sel || sel.mode !== 'mean') return;
      C.open(refineVariants(sel.dither), sel.dither);
    });
    $('cmpBase').addEventListener('click', () => st && C.open(null));
    $('cmpPrev').addEventListener('click', () => $('cmpStrip').scrollBy({ left: -$('cmpStrip').clientWidth / st.per, behavior: 'smooth' }));
    $('cmpNext').addEventListener('click', () => $('cmpStrip').scrollBy({ left: $('cmpStrip').clientWidth / st.per, behavior: 'smooth' }));
    $('cmpCancel').addEventListener('click', () => C.close());
    $('cmpValidate').addEventListener('click', validate);
  }

  function onKey(e) {
    if (!st || document.querySelector('.modal-backdrop')) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); C.close(); return; }
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
    const list = st.sorted.filter((x) => x.checked);
    const idx = list.findIndex((x) => x.key === st.selected);
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation();
      if (!list.length) return;
      const n = idx < 0 ? 0 : U.clamp(idx + (k === 'ArrowRight' ? 1 : -1), 0, list.length - 1);
      select(list[n].key);
      scrollToItem(list[n].key);
    } else if (k === ' ' && st.selected) {
      e.preventDefault(); e.stopPropagation();
      const it = st.items.find((x) => x.key === st.selected);
      toggle(it, !it.checked);
    } else if (k === 'Enter') {
      e.preventDefault(); e.stopPropagation(); validate();
    } else if (k === '+' || k === '=') { e.stopPropagation(); zoomAt(st.cw / 2, st.ch / 2, 1.3); }
    else if (k === '-') { e.stopPropagation(); zoomAt(st.cw / 2, st.ch / 2, 1 / 1.3); }
    else if (k === '0') { e.stopPropagation(); fitView(); }
    else e.stopPropagation();
  }

  initEvents();
})();
