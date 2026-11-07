/* Pixel Perles v3 — étape Palette : palettes, photo des perles, pipette, balance des blancs, stock restant */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const P = () => A.project;
  const ui = A.ui;
  const isMobile = () => document.documentElement.classList.contains('ui-mobile');

  function initPalette() {
    $('paletteSelect').addEventListener('change', (e) => {
      A.settings.paletteId = e.target.value;
      A.saveSettings();
      A.sample = null; A.selColorId = null; A.photo.lastRect = null;
      if (A.detect) { A.detect.active = false; A.detect.cands = []; }
      ensurePhoto(true);
      refresh();
    });
    $('paletteName').addEventListener('input', (e) => {
      const pal = A.currentPalette();
      if (!pal) return;
      pal.name = e.target.value.trim() || 'Palette sans nom';
      A.savePalette(pal);
      fillPaletteSelects();
    });
    $('paletteNew').addEventListener('click', async () => {
      const name = await A.promptText('Nouvelle palette', 'Nom de la palette', 'Mes perles', 'Créer');
      if (!name) return;
      await A.addPalette(A.newPaletteObject(name));
      ensurePhoto(true);
      refresh();
    });
    $('paletteDup').addEventListener('click', async () => {
      const src = A.currentPalette();
      if (!src) return;
      const copy = A.newPaletteObject(src.name + ' (copie)', src.colors);
      copy.photo = src.photo; copy.wb = src.wb ? JSON.parse(JSON.stringify(src.wb)) : null;
      await A.addPalette(copy);
      ensurePhoto(true);
      refresh();
    });
    $('paletteDel').addEventListener('click', async () => {
      const pal = A.currentPalette();
      if (!pal) return;
      const ok = await A.confirm('Supprimer la palette « ' + pal.name + ' » et ses ' + pal.colors.length + ' couleurs ? Les projets déjà convertis gardent leurs couleurs.', 'Supprimer', true);
      if (!ok) return;
      await A.deletePalette(pal.id);
      if (!A.palettes.length) await A.addPalette(A.newPaletteObject('Mes perles'));
      ensurePhoto(true);
      A.panels.refresh();
    });
    $('paletteImport').addEventListener('click', importPalette);
    $('paletteExport').addEventListener('click', exportPalette);

    const loadPhoto = (capture) => PP.files.pickFile('image/*', capture).then(setPalettePhoto);
    $('photoLoad').addEventListener('click', () => loadPhoto());
    $('photoEmptyLoad').addEventListener('click', () => loadPhoto());
    $('photoCamera').addEventListener('click', () => loadPhoto('environment'));
    ui.bindSeg($('photoTool'), (v) => A.panels.setPhotoTool(v));
    A.panels.setPhotoTool = (v) => {
      A.photoTool = v;
      ui.setSeg($('photoTool'), v);
      $('photoToolHint').textContent = v === 'white'
        ? 'Tracez un rectangle sur la feuille blanche (ou une perle blanche) : toutes les couleurs prélevées seront corrigées.'
        : v === 'hand' ? 'Faites glisser pour déplacer la photo. Pincez pour zoomer.'
          : 'Tracez un rectangle dans un compartiment : la teinte moyenne est calculée sans le trou des perles ni les reflets.';
      A.stage.updateCursor();
    };
    $('wbOn').addEventListener('change', (e) => {
      const pal = A.currentPalette();
      if (!pal || !pal.wb) return;
      pal.wb.on = e.target.checked;
      A.savePalette(pal);
      buildDisplay(pal);
      refreshWB();
    });
    $('wbClear').addEventListener('click', () => {
      const pal = A.currentPalette();
      if (!pal) return;
      pal.wb = null;
      A.savePalette(pal);
      buildDisplay(pal);
      refreshWB();
    });

    // Échantillon
    $('sampleAdd').addEventListener('click', addSample);
    $('sampleReplace').addEventListener('click', () => {
      const pal = A.currentPalette();
      const c = pal && pal.colors.find((x) => x.id === A.selColorId);
      if (!c || !A.sample) return;
      c.hex = A.sample.hex;
      A.savePalette(pal);
      A.toast('Teinte de « ' + c.code + ' » mise à jour.');
      A.sample = null;
      refresh();
    });
    $('sampleCancel').addEventListener('click', () => { A.sample = null; A.photo.lastRect = null; refreshSample(); A.redraw(); });
    [$('sampleCode'), $('sampleName')].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSample(); }));
    $('sampleCode').addEventListener('input', () => { $('sampleError').hidden = true; $('sampleCode').classList.remove('invalid'); });

    // Liste des couleurs
    const list = $('colorList');
    list.addEventListener('input', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const pal = A.currentPalette();
      const c = pal.colors.find((x) => x.id === li.dataset.id);
      if (!c) return;
      const t = e.target;
      if (t.dataset.f === 'code') {
        const err = A.codeError(pal, t.value, c.id);
        t.classList.toggle('invalid', !!err);
        t.title = err || '';
        if (!err) { c.code = t.value.trim(); A.savePalette(pal); }
      } else if (t.dataset.f === 'name') {
        c.name = t.value.trim(); A.savePalette(pal);
      } else if (t.dataset.f === 'hex') {
        const h = U.normHex(t.value);
        t.classList.toggle('invalid', !h);
        if (h) { c.hex = h; li.querySelector('.swatch-btn').style.background = h; li.querySelector('input[type=color]').value = h.toLowerCase(); A.savePalette(pal); }
      } else if (t.type === 'color') {
        c.hex = U.normHex(t.value);
        li.querySelector('.swatch-btn').style.background = c.hex;
        const hx = li.querySelector('[data-f=hex]'); if (hx) hx.value = c.hex;
        A.savePalette(pal);
      }
    });
    list.addEventListener('focusout', (e) => {
      if (e.target.dataset && e.target.dataset.f === 'code' && e.target.classList.contains('invalid')) {
        A.toast(e.target.title || 'Code invalide.', 'error');
      }
    });
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const pal = A.currentPalette();
      if (e.target.closest('[data-act=del]')) {
        const c = pal.colors.find((x) => x.id === li.dataset.id);
        pal.colors = pal.colors.filter((x) => x.id !== li.dataset.id);
        if (A.selColorId === li.dataset.id) A.selColorId = null;
        A.savePalette(pal);
        refreshColorList();
        refreshSample();
        if (c) A.toast('« ' + c.code + ' » supprimée.');
        return;
      }
      if (e.target.closest('input')) return;
      A.selColorId = A.selColorId === li.dataset.id ? null : li.dataset.id;
      list.querySelectorAll('li').forEach((x) => x.classList.toggle('selected', x.dataset.id === A.selColorId));
      refreshSample();
    });
    $('colorNamesAsCodes').addEventListener('click', namesAsCodes);
    $('colorStock').addEventListener('click', () => openStock(A.currentPalette()));
    $('colorSort').addEventListener('click', () => {
      const pal = A.currentPalette();
      if (!pal) return;
      pal.colors.sort((a, b) => U.naturalCompare(a.code, b.code));
      A.savePalette(pal);
      refreshColorList();
    });
    $('colorAdd').addEventListener('click', () => {
      const pal = A.currentPalette();
      if (!pal) return;
      const c = { id: U.uid(), code: A.suggestCode(pal), name: '', hex: '#888888' };
      pal.colors.push(c);
      A.savePalette(pal);
      refreshColorList();
      const input = $('colorList').querySelector('li[data-id="' + c.id + '"] [data-f=code]');
      if (input) { input.focus(); input.select(); }
    });
    $('bulkAdd').addEventListener('click', () => {
      const pal = A.currentPalette();
      if (!pal) return;
      const { colors, bad } = A.parseColorLines($('bulkText').value);
      let added = 0;
      const skipped = [];
      colors.forEach((c) => {
        if (A.codeError(pal, c.code)) { skipped.push(c.code || '?'); return; }
        pal.colors.push({ id: U.uid(), code: c.code, name: c.name, hex: c.hex });
        added++;
      });
      A.savePalette(pal);
      refreshColorList();
      if (added) $('bulkText').value = '';
      let msg = added + ' couleur(s) ajoutée(s).';
      if (skipped.length) msg += ' Codes ignorés (doublon ou invalide) : ' + skipped.slice(0, 6).join(', ') + (skipped.length > 6 ? '…' : '') + '.';
      if (bad.length) msg += ' Lignes sans teinte lisible : ' + bad.slice(0, 6).join(', ') + '.';
      A.toast(msg, added ? null : 'error');
    });
  }

  // ---------- Stock restant ----------
  function stockSummary(pal) {
    if (!pal) return '';
    const lim = pal.colors.filter((c) => c.stock != null && c.stock !== '');
    if (!lim.length) return 'Aucune limite : toutes vos couleurs sont en quantité suffisante.';
    const out = lim.filter((c) => +c.stock === 0), few = lim.filter((c) => +c.stock > 0);
    const parts = [];
    if (out.length) parts.push(out.length + ' épuisée' + (out.length > 1 ? 's' : '') + ' (' + out.slice(0, 4).map((c) => c.code).join(', ') + (out.length > 4 ? '…' : '') + ')');
    if (few.length) parts.push(few.slice(0, 4).map((c) => c.code + ' : ' + c.stock).join(', ') + (few.length > 4 ? '…' : ''));
    return parts.join(' · ');
  }
  function refreshStockSummary() {
    const el = $('stockSummary');
    if (el) el.textContent = stockSummary(A.project ? A.convPalette() : null);
  }

  function openStock(pal) {
    if (!pal) return;
    const body = document.createElement('div');
    body.style.display = 'contents';
    body.innerHTML =
      '<p class="hint">Laissez vide quand vous en avez assez. Une limite ne change le rendu que si l’image demande plus de perles qu’il n’en reste : vos perles vont alors là où elles comptent le plus, et la couleur proche suivante complète.</p>' +
      '<div class="field-inline"><input type="text" id="stockSearch" placeholder="Rechercher un code ou un nom" autocomplete="off"><button class="btn btn-sm btn-ghost" type="button" id="stockReset">Tout remettre à « assez »</button></div>' +
      '<ul class="stock-list" id="stockList"></ul>';
    const save = () => { A.savePalette(pal); refreshColorList(); refreshStockSummary(); };
    function list() {
      const q = body.querySelector('#stockSearch').value.trim().toLowerCase();
      body.querySelector('#stockList').innerHTML = pal.colors.filter((c) => !q || c.code.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q)).map((c) => {
        const v = c.stock == null || c.stock === '' ? '' : String(c.stock);
        return '<li data-id="' + c.id + '" class="' + (v === '0' ? 'out' : v ? 'few' : '') + '">' +
          '<span class="cat-sw" style="background:' + c.hex + '"></span><b>' + esc(c.code) + '</b><span class="cat-nm">' + esc(c.name || '') + '</span>' +
          '<input type="number" min="0" step="1" inputmode="numeric" data-f="stock" value="' + v + '" placeholder="assez" aria-label="Perles restantes de ' + esc(c.code) + '">' +
          '<button class="btn btn-sm" type="button" data-act="out">Épuisée</button>' +
          '<button class="icon-btn" type="button" data-act="clear" title="J’en ai assez"><svg class="ic"><use href="#i-close"/></svg></button></li>';
      }).join('');
    }
    A.modal({
      title: 'Stock restant · ' + pal.name, body,
      actions: [{ label: 'Terminé', value: true, kind: 'primary' }],
      onOpen: (b) => {
        b.querySelector('#stockSearch').addEventListener('input', list);
        b.querySelector('#stockReset').addEventListener('click', () => { pal.colors.forEach((c) => { delete c.stock; }); save(); list(); });
        const ul = b.querySelector('#stockList');
        ul.addEventListener('input', (e) => {
          const li = e.target.closest('li[data-id]');
          const c = li && pal.colors.find((x) => x.id === li.dataset.id);
          if (!c) return;
          const t = e.target.value.trim();
          if (t === '') delete c.stock; else c.stock = Math.max(0, parseInt(t, 10) || 0);
          li.className = c.stock === 0 ? 'out' : c.stock > 0 ? 'few' : '';
          save();
        });
        ul.addEventListener('click', (e) => {
          const li = e.target.closest('li[data-id]');
          const c = li && pal.colors.find((x) => x.id === li.dataset.id);
          const act = e.target.closest('[data-act]');
          if (!c || !act) return;
          if (act.dataset.act === 'out') c.stock = 0; else delete c.stock;
          save();
          list();
        });
        list();
      },
    });
  }
  A.panels.openStock = openStock;

  // Le nom devient le code (ex. code « 30 », nom « C15 » → code « C15 ») ; le projet ouvert suit
  async function namesAsCodes() {
    const pal = A.currentPalette();
    if (!pal) return;
    const todo = pal.colors.filter((c) => (c.name || '').trim() && c.name.trim() !== c.code);
    if (!todo.length) { A.toast('Aucune couleur n’a un nom différent de son code.'); return; }
    const next = new Map(pal.colors.map((c) => [c.id, c.code]));
    const refused = [];
    todo.forEach((c) => {
      const n = c.name.trim();
      if (n.length > 5 || !/^[\p{L}\p{N}._-]+$/u.test(n)) refused.push(c.code + ' (« ' + n + ' » : 5 caractères max., sans espace)');
      else next.set(c.id, n);
    });
    // doublons après renommage : on garde l'ancien code pour les couleurs concernées
    const count = new Map();
    next.forEach((v) => count.set(v.toLowerCase(), (count.get(v.toLowerCase()) || 0) + 1));
    todo.forEach((c) => {
      const v = next.get(c.id);
      if (v !== c.code && count.get(v.toLowerCase()) > 1) { refused.push(c.code + ' (« ' + v + ' » est déjà pris)'); next.set(c.id, c.code); }
    });
    const changes = pal.colors.filter((c) => next.get(c.id) !== c.code);
    if (!changes.length) { A.toast('Aucun nom utilisable comme code. ' + refused.slice(0, 3).join(' ; '), 'error'); return; }
    const ex = changes.slice(0, 3).map((c) => c.code + ' → ' + next.get(c.id)).join(', ');
    const ok = await A.confirm(changes.length + ' couleur' + (changes.length > 1 ? 's' : '') + ' vont prendre leur nom comme code (' + ex + (changes.length > 3 ? '…' : '') + '). Les noms sont conservés, et la conversion du projet ouvert est mise à jour.' + (refused.length ? ' Non modifiées : ' + refused.length + '.' : ''), 'Remplacer les codes');
    if (!ok) return;
    const map = new Map();
    changes.forEach((c) => { map.set(c.code + '|' + c.hex, next.get(c.id)); c.code = next.get(c.id); });
    A.savePalette(pal, true);
    const r = A.project && A.project.result;
    let upd = 0;
    if (r) r.colors.forEach((rc) => { const k = map.get(rc.code + '|' + rc.hex); if (k) { rc.code = k; upd++; } });
    if (upd) { A.plateCache.clear(); A.touch(); }
    refreshColorList();
    A.panels.refreshEdit();
    A.toast(changes.length + ' code' + (changes.length > 1 ? 's' : '') + ' remplacé' + (changes.length > 1 ? 's' : '') + (upd ? ', projet mis à jour' : '') + '.' + (refused.length ? ' Non modifiées : ' + refused.slice(0, 3).join(' ; ') + (refused.length > 3 ? '…' : '') : ''));
  }

  function fillPaletteSelects() {
    const opts = A.palettes.map((p) => '<option value="' + p.id + '">' + esc(p.name) + ' (' + p.colors.length + ')</option>').join('');
    const cur = A.currentPalette();
    $('paletteSelect').innerHTML = opts;
    if (cur) $('paletteSelect').value = cur.id;
    $('convPalette').innerHTML = opts;
    if (A.project) {
      const cp = A.convPalette();
      if (cp) $('convPalette').value = cp.id;
    }
  }

  function refresh() {
    fillPaletteSelects();
    if (PP.detect) { PP.detect.refreshRefSelect(); A.detect.render(); }
    const pal = A.currentPalette();
    $('paletteName').value = pal ? pal.name : '';
    refreshWB();
    refreshSample();
    refreshColorList();
    A.panels.syncChrome();
  }


  function refreshColorList() {
    const pal = A.currentPalette();
    const list = $('colorList');
    if (!pal) { list.innerHTML = ''; return; }
    $('colorCount').textContent = String(pal.colors.length);
    if (!pal.colors.length) {
      list.innerHTML = '<li class="empty-note" style="display:block">Aucune couleur. Prélevez-en sur la photo, ajoutez-les à la main ou collez une liste.</li>';
      return;
    }
    list.innerHTML = pal.colors.map((c) =>
      '<li data-id="' + c.id + '"' + (c.id === A.selColorId ? ' class="selected"' : '') + '>' +
      '<span class="swatch-btn" style="background:' + c.hex + '"><input type="color" value="' + c.hex.toLowerCase() + '" aria-label="Teinte de ' + esc(c.code) + '">' +
      (c.stock != null && c.stock !== '' ? '<span class="stock-badge' + (+c.stock === 0 ? ' out' : '') + '" title="Stock restant">' + (+c.stock === 0 ? '0' : c.stock) + '</span>' : '') + '</span>' +
      '<input class="c-code" type="text" data-f="code" maxlength="5" value="' + esc(c.code) + '" aria-label="Code" autocomplete="off">' +
      '<input type="text" data-f="name" maxlength="40" value="' + esc(c.name) + '" placeholder="Nom" aria-label="Nom" autocomplete="off">' +
      '<input class="c-hex" type="text" data-f="hex" maxlength="7" value="' + c.hex + '" aria-label="Teinte hexadécimale" autocomplete="off" spellcheck="false">' +
      '<button class="icon-btn danger" type="button" data-act="del" title="Supprimer"><svg class="ic"><use href="#i-trash"/></svg></button>' +
      '</li>').join('');
    fillPaletteSelects();
  }

  function refreshSample() {
    const card = $('sampleCard');
    if (!A.sample) { card.hidden = true; return; }
    card.hidden = false;
    $('sampleSwatch').style.background = A.sample.hex;
    $('sampleHex').textContent = A.sample.hex + (A.sample.corrected ? ' · balance des blancs appliquée' : '');
    const pal = A.currentPalette();
    const sel = pal && pal.colors.find((x) => x.id === A.selColorId);
    $('sampleReplace').hidden = !sel;
    if (sel) $('sampleReplace').textContent = 'Remplacer « ' + sel.code + ' »';
  }

  function refreshWB() {
    const pal = A.currentPalette();
    const wb = pal && pal.wb;
    $('wbStatus').textContent = wb ? 'Balance des blancs : réglée' : 'Balance des blancs : non réglée';
    $('wbStatus').classList.toggle('ok', !!wb);
    $('wbOnWrap').hidden = !wb;
    $('wbClear').hidden = !wb;
    if (wb) $('wbOn').checked = wb.on !== false;
    $('wbBox').hidden = !(pal && pal.photo);
  }

  function addSample() {
    const pal = A.currentPalette();
    if (!pal || !A.sample) return;
    const code = $('sampleCode').value.trim();
    const err = A.codeError(pal, code);
    if (err) {
      $('sampleError').textContent = err;
      $('sampleError').hidden = false;
      $('sampleCode').classList.add('invalid');
      $('sampleCode').focus();
      return;
    }
    pal.colors.push({ id: U.uid(), code, name: $('sampleName').value.trim(), hex: A.sample.hex });
    A.savePalette(pal);
    A.toast('« ' + code + ' » ajoutée à la palette.');
    A.sample = null;
    A.photo.lastRect = null;
    refreshSample();
    refreshColorList();
    A.redraw();
  }

  // Photo de la palette
  async function setPalettePhoto(file) {
    if (!file) return;
    const pal = A.currentPalette();
    if (!pal) return;
    let img;
    try { img = await U.loadImageFromBlob(file); }
    catch (e) { A.toast('Impossible de lire cette photo. Essayez un fichier JPG ou PNG.', 'error'); return; }
    const c = U.imageToCanvas(img, 16000, 12e6);
    pal.photo = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.93));
    pal.wb = null;
    A.sample = null;
    A.photo.lastRect = null;
    await A.savePalette(pal, true);
    A.photo.palId = null;
    await ensurePhoto(true);
    refresh();
    A.toast('Photo chargée. Choisissez votre nuancier puis « Détecter les couleurs », ou prélevez-les à la pipette.');
  }

  A.panels.setPalettePhoto = setPalettePhoto;

  async function ensurePhoto(force) {
    const pal = A.currentPalette();
    if (!pal || !pal.photo) {
      A.photo = { display: null, data: null, palId: pal ? pal.id : null, lastRect: null, selRect: null };
      A.panels.syncChrome();
      A.redraw();
      return;
    }
    if (!force && A.photo.palId === pal.id && A.photo.data) return;
    try {
      const img = await U.loadImageFromBlob(pal.photo);
      const c = U.imageToCanvas(img, 16000, 12e6);
      const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      A.photo = { src: c, data, palId: pal.id, display: c, lastRect: null, selRect: null };
      buildDisplay(pal);
      if (A.tab === 'palette') A.stage.fitView();
    } catch (e) {
      A.toast('La photo de cette palette est illisible.', 'error');
    }
    A.panels.syncChrome();
  }

  function wbGains(pal) {
    return pal && pal.wb && pal.wb.on !== false ? pal.wb.gains : null;
  }

  function buildDisplay(pal) {
    if (!A.photo.src) return;
    const g = wbGains(pal);
    if (!g) { A.photo.display = A.photo.src; A.redraw(); return; }
    const src = A.photo.data;
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const octx = out.getContext('2d');
    const id = octx.createImageData(src.width, src.height);
    const luts = g.map((gain) => {
      const l = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) l[i] = U.linToSrgb(U.S2L[i] * gain);
      return l;
    });
    const s = src.data, d = id.data;
    for (let i = 0; i < s.length; i += 4) {
      d[i] = luts[0][s[i]]; d[i + 1] = luts[1][s[i + 1]]; d[i + 2] = luts[2][s[i + 2]]; d[i + 3] = 255;
    }
    octx.putImageData(id, 0, 0);
    A.photo.display = out;
    A.redraw();
  }

  // Moyenne robuste d'une zone : on écarte les pixels les plus sombres (trou, ombres) et les plus clairs (reflets)
  function measure(rect, lowTrim, highTrim) {
    const data = A.photo.data;
    const x0 = U.clamp(Math.floor(rect.x), 0, data.width - 1), y0 = U.clamp(Math.floor(rect.y), 0, data.height - 1);
    const x1 = U.clamp(Math.ceil(rect.x + rect.w), x0 + 1, data.width), y1 = U.clamp(Math.ceil(rect.y + rect.h), y0 + 1, data.height);
    const area = (x1 - x0) * (y1 - y0);
    const step = Math.max(1, Math.floor(Math.sqrt(area / 60000)));
    const px = [];
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const k = (y * data.width + x) * 4;
        const r = U.S2L[data.data[k]], g = U.S2L[data.data[k + 1]], b = U.S2L[data.data[k + 2]];
        px.push([0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b]);
      }
    }
    px.sort((a, b) => a[0] - b[0]);
    const lo = Math.floor(px.length * lowTrim), hi = Math.max(lo + 1, Math.ceil(px.length * (1 - highTrim)));
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = lo; i < hi && i < px.length; i++) { r += px[i][1]; g += px[i][2]; b += px[i][3]; n++; }
    return n ? [r / n, g / n, b / n] : [0, 0, 0];
  }

  A.panels.measureLin = function (rect) {
    const g = wbGains(A.currentPalette());
    const lin = measure(rect, 0.6, 0.08);
    return g ? lin.map((v, i) => v * g[i]) : lin;
  };
  A.panels.rebuildPhoto = function () { buildDisplay(A.currentPalette()); refreshWB(); };

  A.panels.onPhotoRect = function (rect, pt) {
    if (!A.photo.data) return;
    if (A.detect && A.detect.onRect(rect, pt)) return;
    if (!rect) {
      const n = Math.max(5, Math.round(Math.min(A.photo.data.width, A.photo.data.height) / 120));
      rect = { x: pt.x - n / 2, y: pt.y - n / 2, w: n, h: n };
    }
    const pal = A.currentPalette();
    if (A.photoTool === 'white') {
      const m = measure(rect, 0.1, 0.1);
      const T = 0.92; // la feuille blanche devient un blanc à ~246/255
      const gains = m.map((v) => U.clamp(T / Math.max(v, 0.002), 0.25, 8));
      pal.wb = { gains, rect: [rect.x, rect.y, rect.w, rect.h], on: true };
      A.savePalette(pal);
      buildDisplay(pal);
      refreshWB();
      A.toast('Balance des blancs réglée. Repassez sur la pipette pour prélever vos couleurs.');
      A.photoTool = 'sample';
      ui.setSeg($('photoTool'), 'sample');
      A.redraw();
      return;
    }
    // on garde la surface éclairée des perles : ni le trou, ni l'ombre entre les perles, ni les reflets
    const lin = A.panels.measureLin(rect);
    const g = wbGains(pal);
    const hex = U.rgbToHex(U.linToSrgb(lin[0]), U.linToSrgb(lin[1]), U.linToSrgb(lin[2]));
    A.sample = { hex, corrected: !!g };
    A.photo.lastRect = rect;
    $('sampleCode').value = A.suggestCode(pal);
    $('sampleName').value = '';
    // avec un nuancier : on propose le code et le nom du fabricant le plus proche
    const near = PP.detect.nearestRef(pal, hex);
    if (near && !A.codeError(pal, near.c.code)) {
      $('sampleCode').value = near.c.code;
      $('sampleName').value = near.c.name || '';
      A.sample.ref = near;
    }
    $('sampleError').hidden = true;
    $('sampleCode').classList.remove('invalid');
    refreshSample();
    if (isMobile()) A.panels.setSheet(true);
    else { $('sampleCode').focus(); $('sampleCode').select(); }
    $('sampleCard').scrollIntoView({ block: 'nearest' });
    A.redraw();
  };

  async function importPalette() {
    const f = await PP.files.pickFile('.json,.txt,.csv,application/json,text/plain');
    if (!f) return;
    const text = await f.text();
    let pal = null;
    try {
      const d = JSON.parse(text);
      if (d && Array.isArray(d.colors)) {
        pal = A.newPaletteObject(d.name || f.name.replace(/\.\w+$/, ''), d.colors.filter((c) => c && c.hex && U.normHex(c.hex)).map((c) => ({ code: String(c.code || '').slice(0, 5), name: c.name || '', hex: c.hex })));
      }
    } catch (e) {
      const { colors } = A.parseColorLines(text);
      if (colors.length) pal = A.newPaletteObject(f.name.replace(/\.\w+$/, ''), colors);
    }
    if (!pal || !pal.colors.length) { A.toast('Aucune couleur trouvée dans ce fichier.', 'error'); return; }
    // codes vides ou en double : on les renomme
    const seen = new Set();
    pal.colors.forEach((c, i) => {
      let code = (c.code || '').trim() || String(i + 1);
      while (seen.has(code.toLowerCase())) code = (code + '+').slice(-5);
      seen.add(code.toLowerCase());
      c.code = code;
    });
    await A.addPalette(pal);
    ensurePhoto(true);
    refresh();
    A.toast('Palette « ' + pal.name + ' » importée (' + pal.colors.length + ' couleurs).');
  }

  async function exportPalette() {
    const pal = A.currentPalette();
    if (!pal) return;
    const data = { format: 'pixel-perles-palette', version: 1, name: pal.name, colors: pal.colors.map((c) => ({ code: c.code, name: c.name, hex: c.hex })) };
    const r = await PP.files.saveFile('palette-' + U.safeFileName(pal.name) + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    if (r === 'saved') A.toast('Palette exportée.');
  }

  // =====================================================================
  // IMAGE

  A.palUi = { openStock, refreshStockSummary, fillPaletteSelects, ensurePhoto };
  A.panes.palette = { init: initPalette, refresh, show: () => ensurePhoto() };
})();
