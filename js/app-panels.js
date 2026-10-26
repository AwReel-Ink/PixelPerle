/* Pixel Perles — panneaux : plateau, palette & pipette, image, retouche, export, projets, paramètres */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const P = () => A.project;
  const isMobile = () => document.documentElement.classList.contains('ui-mobile');

  const panels = (A.panels = {});
  let sheetOpen = true;

  // ---------- Aides ----------
  function bindSeg(el, onChange) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.disabled) return;
      onChange(b.dataset.v);
    });
  }
  function setSeg(el, v) {
    el.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  }
  panels.setProgress = function (id, f) {
    const el = $(id);
    if (!el) return;
    if (f === null || f === undefined) { el.hidden = true; return; }
    el.hidden = false;
    el.firstElementChild.style.width = Math.round(f * 100) + '%';
  };
  const cm = (picots, pitch) => ((picots * (pitch || 2.6)) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 });

  // ---------- Onglets ----------
  A.setTab = function (tab) {
    if ((tab === 'edit' || tab === 'export') && !A.project) return;
    const prev = A.tab;
    A.tab = tab;
    document.querySelectorAll('.pane').forEach((s) => (s.hidden = s.dataset.pane !== tab));
    if (tab === 'palette') ensurePhoto();
    if (tab === 'edit') panels.refreshEdit();
    if (tab === 'export') panels.refreshExport();
    if (tab === 'plates') panels.refreshPlates();
    if (tab === 'image') panels.refreshImage();
    panels.syncChrome();
    if (tab === 'palette' || prev === 'palette') A.stage.fitView();
    else A.stage.onTabChange();
    if (isMobile()) setSheet(true);
    $('panel').scrollTop = 0;
  };

  panels.setSheet = (open) => setSheet(open);
  function setSheet(open) {
    sheetOpen = open;
    $('panel').classList.toggle('collapsed', isMobile() && !open);
    requestAnimationFrame(() => A.stage.resize());
  }

  panels.syncChrome = function () {
    const has = A.hasResult();
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === A.tab)));
    const pal = A.currentPalette();
    $('photoEmpty').hidden = !(A.tab === 'palette' && pal && !pal.photo);
    $('staleBanner').hidden = !((A.tab === 'edit' || A.tab === 'export') && A.isStale());
    $('quickbar').hidden = !(isMobile() && A.tab === 'edit' && has);
    $('coords').textContent = '';
    $('handBtn').setAttribute('aria-pressed', String(A.hand));
    $('panel').classList.toggle('collapsed', isMobile() && !sheetOpen);
    syncQuickbar();
  };

  // ---------- Initialisation ----------
  panels.init = function () {
    // onglets
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      if (isMobile() && b.dataset.tab === A.tab) { setSheet(!sheetOpen); return; }
      A.setTab(b.dataset.tab);
    });
    $('sheetHandle').addEventListener('click', () => setSheet(!sheetOpen));
    $('uiToggle').addEventListener('click', () => {
      A.settings.ui = A.uiMode() === 'mobile' ? 'desktop' : 'mobile';
      A.saveSettings();
      A.applyUI();
    });
    $('settingsBtn').addEventListener('click', openSettings);
    $('projectBtn').addEventListener('click', openProjects);
    $('zoomIn').addEventListener('click', () => A.stage.zoomBy(1.25));
    $('zoomOut').addEventListener('click', () => A.stage.zoomBy(0.8));
    $('zoomFit').addEventListener('click', () => A.stage.fitView());
    $('handBtn').addEventListener('click', () => { A.hand = !A.hand; panels.syncChrome(); A.stage.updateCursor(); });
    $('staleConvert').addEventListener('click', () => A.runConversion());

    initPlates();
    initPalette();
    initImage();
    initEdit();
    initExport();
  };

  panels.refresh = function () {
    if (!A.project) return;
    $('projectName').textContent = P().name;
    panels.refreshPlates();
    panels.refreshPalette();
    panels.refreshImage();
    panels.refreshEdit();
    panels.refreshExport();
    panels.syncChrome();
  };

  // =====================================================================
  // PLATEAU
  // =====================================================================
  function initPlates() {
    const sel = $('plateType');
    sel.innerHTML = A.PRESETS.map((p) => '<option value="' + p.id + '">' + esc(p.label) + '</option>').join('');
    sel.addEventListener('change', () => { A.settings.plateType = sel.value; A.saveSettings(); refreshPlateType(); });
    ['customW', 'customH', 'customPitch'].forEach((id) => $(id).addEventListener('input', () => {
      A.settings.custom = { w: +$('customW').value, h: +$('customH').value, pitch: +$('customPitch').value };
      A.saveSettings();
      refreshPlateType();
    }));
    $('addPlate').addEventListener('click', () => {
      const p = A.addPlate();
      panels.refreshPlates();
      A.stage.fitView();
      A.toast(p.name + ' ajoutée (' + p.w + ' × ' + p.h + ').');
    });
    $('addGrid').addEventListener('click', () => {
      const c = U.clamp($('gridCols').value | 0, 1, 10), r = U.clamp($('gridRows').value | 0, 1, 10);
      A.addPlateGrid(c, r);
      panels.refreshPlates();
      A.stage.fitView();
    });
    $('snapToggle').addEventListener('change', (e) => { A.settings.snap = e.target.checked; A.saveSettings(); });

    const list = $('plateList');
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const id = li.dataset.id;
      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'dup') { A.duplicatePlate(id); panels.refreshPlates(); A.stage.fitView(); }
        if (act.dataset.act === 'del') {
          const pl = A.plateById(id);
          A.confirm('Supprimer la plaque « ' + pl.name + ' » ?', 'Supprimer', true).then((ok) => {
            if (ok) { A.deletePlate(id); panels.refresh(); }
          });
        }
        return;
      }
      if (e.target.tagName === 'INPUT') { A.sel = id; markSelected(list); A.redraw(); return; }
      A.sel = id;
      markSelected(list);
      A.stage.centerOnPlate(id);
    });
    list.addEventListener('input', (e) => {
      if (!e.target.matches('input[data-name]')) return;
      const pl = A.plateById(e.target.closest('li').dataset.id);
      const v = e.target.value.trim();
      if (pl && v) { pl.name = v.slice(0, 24); A.touch(); }
    });
  }

  function markSelected(list) {
    list.querySelectorAll('li').forEach((li) => li.classList.toggle('selected', li.dataset.id === A.sel));
  }

  function refreshPlateType() {
    const id = A.settings.plateType;
    $('plateType').value = id;
    $('customSize').hidden = id !== 'custom';
    $('customW').value = A.settings.custom.w;
    $('customH').value = A.settings.custom.h;
    $('customPitch').value = A.settings.custom.pitch;
    const s = A.currentPlateSpec();
    const pr = A.presetById(id);
    $('plateTypeInfo').textContent = (id === 'custom' ? 'Assemblage ou plaque sur mesure. ' : pr.note + ' ') +
      U.fmtInt(s.w * s.h) + ' picots, ≈ ' + cm(s.w, s.pitch) + ' × ' + cm(s.h, s.pitch) + ' cm une fois repassée.';
  }

  panels.refreshPlates = function () {
    if (!A.project) return;
    refreshPlateType();
    $('snapToggle').checked = !!A.settings.snap;
    const list = $('plateList');
    const active = document.activeElement;
    const editingId = active && active.matches && active.matches('#plateList input') ? active.closest('li').dataset.id : null;
    if (!editingId) {
      list.innerHTML = P().plates.map((p) =>
        '<li data-id="' + p.id + '"' + (p.id === A.sel ? ' class="selected"' : '') + '>' +
        '<svg class="ic plate-ic" aria-hidden="true"><use href="#i-plates"/></svg>' +
        '<input type="text" data-name value="' + esc(p.name) + '" aria-label="Nom de la plaque" maxlength="24">' +
        '<span class="meta">' + p.w + '×' + p.h + '</span>' +
        '<button class="icon-btn" type="button" data-act="dup" title="Dupliquer"><svg class="ic"><use href="#i-copy"/></svg></button>' +
        '<button class="icon-btn danger" type="button" data-act="del" title="Supprimer"><svg class="ic"><use href="#i-trash"/></svg></button>' +
        '</li>').join('');
    } else markSelected(list);
    const n = P().plates.length;
    $('plateCount').textContent = n ? String(n) : '';
    if (!n) { $('plateSummary').textContent = 'Aucune plaque. Ajoutez-en une pour commencer.'; return; }
    const total = P().plates.reduce((s, p) => s + p.w * p.h, 0);
    const bb = A.platesBBox();
    const pitch = P().plates[0].pitch;
    $('plateSummary').textContent = U.fmtInt(total) + ' picots au total · encombrement ' + bb.w + ' × ' + bb.h + ' picots (≈ ' + cm(bb.w, pitch) + ' × ' + cm(bb.h, pitch) + ' cm).';
  };

  // =====================================================================
  // PALETTE
  // =====================================================================
  function initPalette() {
    $('paletteSelect').addEventListener('change', (e) => {
      A.settings.paletteId = e.target.value;
      A.saveSettings();
      A.sample = null; A.selColorId = null; A.photo.lastRect = null;
      ensurePhoto(true);
      panels.refreshPalette();
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
      panels.refreshPalette();
    });
    $('paletteDup').addEventListener('click', async () => {
      const src = A.currentPalette();
      if (!src) return;
      const copy = A.newPaletteObject(src.name + ' (copie)', src.colors);
      copy.photo = src.photo; copy.wb = src.wb ? JSON.parse(JSON.stringify(src.wb)) : null;
      await A.addPalette(copy);
      ensurePhoto(true);
      panels.refreshPalette();
    });
    $('paletteDel').addEventListener('click', async () => {
      const pal = A.currentPalette();
      if (!pal) return;
      const ok = await A.confirm('Supprimer la palette « ' + pal.name + ' » et ses ' + pal.colors.length + ' couleurs ? Les projets déjà convertis gardent leurs couleurs.', 'Supprimer', true);
      if (!ok) return;
      await A.deletePalette(pal.id);
      if (!A.palettes.length) await A.addPalette(A.newPaletteObject('Mes perles'));
      ensurePhoto(true);
      panels.refresh();
    });
    $('paletteImport').addEventListener('click', importPalette);
    $('paletteExport').addEventListener('click', exportPalette);

    const loadPhoto = (capture) => PP.files.pickFile('image/*', capture).then(setPalettePhoto);
    $('photoLoad').addEventListener('click', () => loadPhoto());
    $('photoEmptyLoad').addEventListener('click', () => loadPhoto());
    $('photoCamera').addEventListener('click', () => loadPhoto('environment'));
    bindSeg($('photoTool'), (v) => {
      A.photoTool = v;
      setSeg($('photoTool'), v);
      $('photoToolHint').textContent = v === 'white'
        ? 'Tracez un rectangle sur la feuille blanche (ou une perle blanche) : toutes les couleurs prélevées seront corrigées.'
        : v === 'hand' ? 'Faites glisser pour déplacer la photo. Pincez pour zoomer.'
          : 'Tracez un rectangle dans un compartiment : la teinte moyenne est calculée sans le trou des perles ni les reflets.';
      A.stage.updateCursor();
    });
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
      panels.refreshPalette();
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

  panels.refreshPalette = function () {
    fillPaletteSelects();
    const pal = A.currentPalette();
    $('paletteName').value = pal ? pal.name : '';
    refreshWB();
    refreshSample();
    refreshColorList();
    panels.syncChrome();
  };

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
      '<span class="swatch-btn" style="background:' + c.hex + '"><input type="color" value="' + c.hex.toLowerCase() + '" aria-label="Teinte de ' + esc(c.code) + '"></span>' +
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
    const c = U.imageToCanvas(img, 4096);
    pal.photo = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.93));
    pal.wb = null;
    A.sample = null;
    A.photo.lastRect = null;
    await A.savePalette(pal, true);
    A.photo.palId = null;
    await ensurePhoto(true);
    panels.refreshPalette();
    A.toast('Photo chargée. Commencez par le blanc de référence si une feuille blanche est visible.');
  }

  panels.setPalettePhoto = setPalettePhoto;

  async function ensurePhoto(force) {
    const pal = A.currentPalette();
    if (!pal || !pal.photo) {
      A.photo = { display: null, data: null, palId: pal ? pal.id : null, lastRect: null, selRect: null };
      panels.syncChrome();
      A.redraw();
      return;
    }
    if (!force && A.photo.palId === pal.id && A.photo.data) return;
    try {
      const img = await U.loadImageFromBlob(pal.photo);
      const c = U.imageToCanvas(img, 4096);
      const data = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
      A.photo = { src: c, data, palId: pal.id, display: c, lastRect: null, selRect: null };
      buildDisplay(pal);
      if (A.tab === 'palette') A.stage.fitView();
    } catch (e) {
      A.toast('La photo de cette palette est illisible.', 'error');
    }
    panels.syncChrome();
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

  panels.onPhotoRect = function (rect, pt) {
    if (!A.photo.data) return;
    if (!rect) {
      const n = Math.max(5, Math.round(Math.min(A.photo.data.width, A.photo.data.height) / 120));
      rect = { x: pt.x - n / 2, y: pt.y - n / 2, w: n, h: n };
    }
    const pal = A.currentPalette();
    if (A.photoTool === 'white') {
      const m = measure(rect, 0.1, 0.1);
      const T = 0.85; // la référence devient un blanc à ~237/255
      const gains = m.map((v) => U.clamp(T / Math.max(v, 0.002), 0.25, 8));
      pal.wb = { gains, rect: [rect.x, rect.y, rect.w, rect.h], on: true };
      A.savePalette(pal);
      buildDisplay(pal);
      refreshWB();
      A.toast('Balance des blancs réglée. Repassez sur la pipette pour prélever vos couleurs.');
      A.photoTool = 'sample';
      setSeg($('photoTool'), 'sample');
      A.redraw();
      return;
    }
    let lin = measure(rect, 0.18, 0.12);
    const g = wbGains(pal);
    if (g) lin = lin.map((v, i) => v * g[i]);
    const hex = U.rgbToHex(U.linToSrgb(lin[0]), U.linToSrgb(lin[1]), U.linToSrgb(lin[2]));
    A.sample = { hex, corrected: !!g };
    A.photo.lastRect = rect;
    $('sampleCode').value = A.suggestCode(pal);
    $('sampleName').value = '';
    $('sampleError').hidden = true;
    $('sampleCode').classList.remove('invalid');
    refreshSample();
    if (isMobile()) setSheet(true);
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
    panels.refreshPalette();
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
  // =====================================================================
  function initImage() {
    const pick = (capture) => PP.files.pickFile('image/*', capture).then((f) => A.setImageFile(f));
    $('imgLoad').addEventListener('click', () => pick());
    $('imgCamera').addEventListener('click', () => pick('environment'));
    $('imgRotL').addEventListener('click', () => { A.rotateImage(-1); panels.refreshImageInfo(); });
    $('imgRotR').addEventListener('click', () => { A.rotateImage(1); panels.refreshImageInfo(); });
    $('imgFlipH').addEventListener('click', () => { if (P().image) { P().image.flipH = !P().image.flipH; A.touch(); } });
    $('imgFlipV').addEventListener('click', () => { if (P().image) { P().image.flipV = !P().image.flipV; A.touch(); } });
    $('imgFit').addEventListener('click', () => { A.fitImage(); A.touch(); panels.refreshImageInfo(); A.stage.fitView(); });
    $('imgDel').addEventListener('click', async () => {
      if (!(await A.confirm('Retirer l’image de ce projet ?', 'Retirer', true))) return;
      P().image = null; A.imgSrc = null; A.imgAdj = null;
      A.touch();
      panels.refreshImage();
    });
    $('imgOpacity').addEventListener('input', (e) => {
      P().disp.opacity = +e.target.value;
      $('imgOpacityOut').textContent = e.target.value + ' %';
      A.touch();
    });
    [['adjBrightness', 'brightness'], ['adjContrast', 'contrast'], ['adjSaturation', 'saturation']].forEach(([id, key]) => {
      $(id).addEventListener('input', (e) => {
        P().adjust[key] = +e.target.value;
        $(id + 'Out').textContent = (e.target.value > 0 ? '+' : '') + e.target.value;
        A.refreshAdjusted();
        A.touch();
      });
    });
    $('adjReset').addEventListener('click', () => {
      P().adjust = { brightness: 0, contrast: 0, saturation: 0 };
      A.refreshAdjusted();
      A.touch();
      panels.refreshImage();
    });
    $('convPalette').addEventListener('change', (e) => { P().conv.paletteId = e.target.value; A.touch(); });
    bindSeg($('convMode'), (v) => { P().conv.mode = v; A.touch(); refreshConv(); });
    $('convMax').addEventListener('input', (e) => { P().conv.maxColors = U.clamp(e.target.value | 0, 0, 999); A.touch(); });
    $('convDither').addEventListener('input', (e) => { P().conv.dither = +e.target.value; $('convDitherOut').textContent = e.target.value + ' %'; A.touch(); });
    $('convertBtn').addEventListener('click', () => A.runConversion());
  }

  function refreshConv() {
    const c = P().conv;
    setSeg($('convMode'), c.mode);
    $('convModeHint').textContent = c.mode === 'dominant'
      ? 'Garde la couleur la plus présente dans le carré couvert par le picot : contours nets, idéal pour les logos et les dessins.'
      : 'Mélange les couleurs du carré couvert par le picot, puis prend la perle la plus proche : rendu doux, idéal pour les photos.';
    $('convMax').value = c.maxColors;
    $('convDither').value = c.dither;
    $('convDitherOut').textContent = c.dither + ' %';
    $('convDither').disabled = c.mode === 'dominant';
    $('ditherField').style.opacity = c.mode === 'dominant' ? 0.45 : 1;
    fillPaletteSelects();
  }

  panels.refreshImage = function () {
    if (!A.project) return;
    const im = P().image;
    $('imgTools').hidden = !im;
    $('adjustGroup').hidden = !im;
    $('imgLoadLabel').textContent = im ? 'Remplacer l’image' : 'Importer une image';
    $('imgOpacity').value = P().disp.opacity;
    $('imgOpacityOut').textContent = P().disp.opacity + ' %';
    [['adjBrightness', 'brightness'], ['adjContrast', 'contrast'], ['adjSaturation', 'saturation']].forEach(([id, key]) => {
      const v = P().adjust[key] || 0;
      $(id).value = v;
      $(id + 'Out').textContent = (v > 0 ? '+' : '') + v;
    });
    panels.refreshImageInfo();
    refreshConv();
  };

  panels.refreshImageInfo = function () {
    const im = P() && P().image;
    if (!im) { $('imgInfo').textContent = ''; return; }
    const d = PP.geo.imgDims(im);
    const pitch = P().plates[0] ? P().plates[0].pitch : 2.6;
    $('imgInfo').textContent = 'Image : ' + Math.round(d.w) + ' × ' + Math.round(d.h) + ' picots (≈ ' + cm(d.w, pitch) + ' × ' + cm(d.h, pitch) + ' cm) · source ' + im.nw + ' × ' + im.nh + ' px. Flèches du clavier : déplacer d’un picot.';
  };

  // =====================================================================
  // RETOUCHE
  // =====================================================================
  function initEdit() {
    const setTool = (v) => { A.edit.tool = v; panels.refreshEdit(); A.stage.updateCursor(); };
    bindSeg($('editTools'), setTool);
    $('quickbar').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tool]');
      if (b) setTool(b.dataset.tool);
    });
    $('qbColor').addEventListener('click', () => setSheet(true));
    $('qbUndo').addEventListener('click', () => A.stage.undo(false));
    bindSeg($('brushSize'), (v) => { A.edit.size = +v; panels.refreshEdit(); });
    $('undoBtn').addEventListener('click', () => A.stage.undo(false));
    $('redoBtn').addEventListener('click', () => A.stage.undo(true));
    $('swatchUsedOnly').addEventListener('change', (e) => { A.edit.usedOnly = e.target.checked; refreshSwatches(); });
    $('swatches').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      A.edit.color = +b.dataset.i;
      if (A.edit.tool !== 'brush' && A.edit.tool !== 'fill') A.edit.tool = 'brush';
      panels.refreshEdit();
    });
    $('viewBeads').addEventListener('change', (e) => { P().disp.beads = e.target.checked; A.touch(); });
    $('viewCodes').addEventListener('change', (e) => { P().disp.codes = e.target.checked; A.touch(); });
    $('viewOverlay').addEventListener('change', (e) => { P().disp.overlay = e.target.checked; A.touch(); });
    $('replBtn').addEventListener('click', replaceColor);
    $('cleanBtn').addEventListener('click', cleanIsolated);
  }

  function usageAll() {
    const r = P().result;
    const counts = new Int32Array(r.colors.length);
    let empty = 0, total = 0;
    P().plates.forEach((p) => {
      const g = r.grids[p.id];
      if (!g) { empty += p.w * p.h; return; }
      for (let i = 0; i < g.length; i++) { if (g[i] >= 0) { counts[g[i]]++; total++; } else empty++; }
    });
    return { counts, empty, total };
  }

  function refreshSwatches(u) {
    const r = P().result;
    if (!r) return;
    u = u || usageAll();
    const order = r.colors.map((_, i) => i).sort((a, b) => U.naturalCompare(r.colors[a].code, r.colors[b].code));
    $('swatches').innerHTML = order.filter((i) => !A.edit.usedOnly || u.counts[i] > 0).map((i) => {
      const c = r.colors[i];
      return '<button type="button" data-i="' + i + '" style="background:' + c.hex + ';color:' + U.textOn(c.hex) + '" aria-pressed="' + (i === A.edit.color) + '" title="' + esc(c.code + ' ' + c.name) + ' — ' + u.counts[i] + ' perle(s)">' + esc(c.code) + (u.counts[i] ? '<small>' + u.counts[i] + '</small>' : '') + '</button>';
    }).join('');
  }

  function syncQuickbar() {
    const qb = $('quickbar');
    if (qb.hidden) return;
    qb.querySelectorAll('button[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === A.edit.tool)));
    const r = P() && P().result;
    const c = r && r.colors[A.edit.color];
    const el = $('qbColor');
    if (c) { el.style.background = c.hex; el.style.color = U.textOn(c.hex); el.textContent = c.code; }
  }

  panels.refreshEdit = function () {
    if (!A.project) return;
    const has = A.hasResult();
    $('editEmpty').hidden = has;
    $('editBody').hidden = !has;
    document.querySelector('#tabs [data-tab=edit]').classList.toggle('muted', !has);
    if (!has) { panels.syncChrome(); return; }
    const r = P().result;
    if (A.edit.color >= r.colors.length) A.edit.color = 0;
    setSeg($('editTools'), A.edit.tool);
    setSeg($('brushSize'), A.edit.size);
    $('undoBtn').disabled = !A.edit.undo.length;
    $('redoBtn').disabled = !A.edit.redo.length;
    $('swatchUsedOnly').checked = A.edit.usedOnly;
    const u = usageAll();
    refreshSwatches(u);
    const c = r.colors[A.edit.color];
    $('activeColorLabel').textContent = c ? c.code + (c.name ? ' · ' + c.name : '') : '';
    $('viewBeads').checked = P().disp.beads;
    $('viewCodes').checked = P().disp.codes;
    $('viewOverlay').checked = P().disp.overlay;
    $('viewOverlay').disabled = !P().image;
    const used = r.colors.map((x, i) => i).filter((i) => u.counts[i] > 0).sort((a, b) => U.naturalCompare(r.colors[a].code, r.colors[b].code));
    const all = r.colors.map((x, i) => i).sort((a, b) => U.naturalCompare(r.colors[a].code, r.colors[b].code));
    const opt = (i) => '<option value="' + i + '">' + esc(r.colors[i].code + (r.colors[i].name ? ' — ' + r.colors[i].name : '')) + '</option>';
    const fromVal = $('replFrom').value, toVal = $('replTo').value;
    $('replFrom').innerHTML = used.map(opt).join('');
    $('replTo').innerHTML = all.map(opt).join('');
    if (used.includes(+fromVal)) $('replFrom').value = fromVal;
    if (toVal !== '') $('replTo').value = toVal;
    $('editStats').textContent = U.fmtInt(u.total) + ' perles · ' + used.length + ' couleur' + (used.length > 1 ? 's' : '') + ' · ' + U.fmtInt(u.empty) + ' picot' + (u.empty > 1 ? 's' : '') + ' vide' + (u.empty > 1 ? 's' : '') + '. Palette : ' + (r.paletteName || '—') + '.';
    panels.syncChrome();
    panels.refreshExport();
  };

  function scopePlates(scope) {
    if (scope === 'sel') {
      const p = A.plateById(A.sel);
      if (!p) { A.toast('Sélectionnez d’abord une plaque en cliquant dessus.', 'error'); return null; }
      return [p];
    }
    return P().plates;
  }

  function replaceColor() {
    const from = +$('replFrom').value, to = +$('replTo').value;
    if (isNaN(from) || isNaN(to) || from === to) { A.toast('Choisissez deux couleurs différentes.', 'error'); return; }
    const plates = scopePlates($('replScope').value);
    if (!plates) return;
    const changes = [];
    plates.forEach((p) => {
      const g = P().result.grids[p.id];
      if (!g) return;
      for (let i = 0; i < g.length; i++) if (g[i] === from) { changes.push({ pid: p.id, idx: i, old: from, nv: to }); g[i] = to; }
      A.plateCache.delete(p.id);
    });
    if (!changes.length) { A.toast('Aucune perle de cette couleur dans la sélection.'); return; }
    A.stage.pushUndo(changes);
    A.toast(changes.length + ' perle(s) remplacée(s).');
  }

  function cleanIsolated() {
    const plates = scopePlates($('cleanScope').value);
    if (!plates) return;
    const r = P().result;
    const valAt = (wx, wy) => {
      const c = A.cellAt(wx + 0.5, wy + 0.5);
      if (!c) return -1;
      const g = r.grids[c.plate.id];
      return g ? g[c.idx] : -1;
    };
    const changes = [];
    plates.forEach((p) => {
      const g = r.grids[p.id];
      if (!g) return;
      const snap = Int16Array.from(g);
      for (let j = 0; j < p.h; j++) {
        for (let i = 0; i < p.w; i++) {
          const v = snap[j * p.w + i];
          if (v < 0) continue;
          const votes = new Map();
          let same = false;
          for (let dy = -1; dy <= 1 && !same; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const ii = i + dx, jj = j + dy;
              const n = ii >= 0 && ii < p.w && jj >= 0 && jj < p.h ? snap[jj * p.w + ii] : valAt(p.x + ii, p.y + jj);
              if (n === v) { same = true; break; }
              if (n >= 0) votes.set(n, (votes.get(n) || 0) + (dx && dy ? 1 : 2));
            }
          }
          if (same || !votes.size) continue;
          let best = -1, bv = -1;
          votes.forEach((cnt, k) => { if (cnt > bv) { bv = cnt; best = k; } });
          const idx = j * p.w + i;
          changes.push({ pid: p.id, idx, old: v, nv: best });
          g[idx] = best;
        }
      }
      A.plateCache.delete(p.id);
    });
    if (!changes.length) { A.toast('Aucune perle isolée trouvée.'); return; }
    A.stage.pushUndo(changes);
    A.toast(changes.length + ' perle(s) isolée(s) corrigée(s). Ctrl+Z pour annuler.');
  }

  // =====================================================================
  // EXPORT
  // =====================================================================
  function initExport() {
    bindSeg($('expBg'), (v) => { P().exp.bg = v; A.touch(); panels.refreshExport(); });
    bindSeg($('expStyle'), (v) => { P().exp.style = v; A.touch(); panels.refreshExport(); });
    [['expCodes', 'codes'], ['expGuides', 'guides'], ['expLabels4', 'labels4']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => { P().exp[key] = e.target.checked; A.touch(); });
    });
    $('expMinSide').addEventListener('change', (e) => {
      P().exp.minSide = U.clamp(e.target.value | 0 || 4320, 1000, 10000);
      e.target.value = P().exp.minSide;
      A.touch();
      panels.refreshExport();
    });
    $('expList').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      if (e.target.closest('[data-act=png]')) { exportPlates([A.plateById(li.dataset.id)], false); return; }
      A.sel = li.dataset.id;
      panels.refreshExport();
      A.stage.centerOnPlate(li.dataset.id);
    });
    $('expAll').addEventListener('click', () => exportPlates(P().plates, true));
    $('expOverview').addEventListener('click', exportOverview);
  }

  panels.refreshExport = function () {
    if (!A.project) return;
    const has = A.hasResult();
    $('exportEmpty').hidden = has;
    $('exportBody').hidden = !has;
    if (!has) return;
    const e = P().exp;
    setSeg($('expBg'), e.bg);
    setSeg($('expStyle'), e.style);
    $('expCodes').checked = e.codes;
    $('expGuides').checked = e.guides;
    $('expLabels4').checked = e.labels4;
    $('expMinSide').value = e.minSide;
    const r = P().result;
    $('expList').innerHTML = P().plates.map((p) => {
      const g = r.grids[p.id];
      const u = g ? PP.render.usage(g, r.colors.length) : null;
      const nc = u ? u.counts.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) : 0;
      const nb = u ? p.w * p.h - u.empty : 0;
      const px = Math.ceil(e.minSide / Math.min(p.w, p.h));
      return '<li data-id="' + p.id + '"' + (p.id === A.sel ? ' class="selected"' : '') + '>' +
        '<span style="flex:1;min-width:0"><b>' + esc(p.name) + '</b><br><span class="meta">' + p.w + '×' + p.h + ' · ' + nc + ' coul. · ' + U.fmtInt(nb) + ' perles · ' + px + ' px/perle</span></span>' +
        '<button class="btn btn-sm" type="button" data-act="png"><svg class="ic"><use href="#i-export"/></svg>PNG</button></li>';
    }).join('');
  };

  function exportMeta(index, total) {
    const d = new Date();
    return { project: P().name, date: d.toLocaleDateString('fr-FR'), index, total };
  }

  let exporting = false;
  async function exportPlates(plates, zip) {
    if (exporting || !plates.length) return;
    exporting = true;
    const r = P().result;
    const o = P().exp;
    const files = [];
    const status = $('expStatus');
    $('expAll').disabled = true; $('expOverview').disabled = true;
    try {
      for (let k = 0; k < plates.length; k++) {
        const p = plates[k];
        let g = r.grids[p.id];
        if (!g || g.length !== p.w * p.h) g = new Int16Array(p.w * p.h).fill(-1);
        const idx = P().plates.indexOf(p) + 1;
        const lay = PP.render.plateLayout(p, g, r.colors, o, exportMeta(idx, P().plates.length));
        status.textContent = 'Préparation de ' + p.name + ' (' + lay.width + ' × ' + lay.height + ' px)…';
        const blob = await PP.files.encodePNG(lay.width, lay.height, lay.draw, (f) => panels.setProgress('expProgress', (k + f) / (plates.length + (zip ? 1 : 0))));
        files.push({ name: U.safeFileName(P().name) + '_' + String(idx).padStart(2, '0') + '_' + U.safeFileName(p.name) + '.png', data: blob });
      }
      if (zip) {
        const lay = PP.render.overviewLayout(P().plates, r.grids, r.colors, o, exportMeta(0, P().plates.length));
        status.textContent = 'Préparation de la vue d’ensemble…';
        const blob = await PP.files.encodePNG(lay.width, lay.height, lay.draw, (f) => panels.setProgress('expProgress', (plates.length + f) / (plates.length + 1)));
        files.push({ name: U.safeFileName(P().name) + '_00_vue-ensemble.png', data: blob });
        status.textContent = 'Création de l’archive…';
        const z = await PP.files.makeZip(files);
        const res = await PP.files.saveFile(U.safeFileName(P().name) + '.zip', z);
        status.textContent = res === 'saved' ? files.length + ' images exportées dans ' + U.safeFileName(P().name) + '.zip (' + (z.size / 1048576).toFixed(1) + ' Mo).' : 'Export annulé.';
      } else {
        for (const f of files) {
          const res = await PP.files.saveFile(f.name, f.data);
          status.textContent = res === 'saved' ? f.name + ' exporté (' + (f.data.size / 1048576).toFixed(1) + ' Mo).' : 'Export annulé.';
        }
      }
    } catch (e) {
      console.error(e);
      status.textContent = '';
      A.toast(e.message || 'L’export a échoué.', 'error');
    } finally {
      exporting = false;
      panels.setProgress('expProgress', null);
      $('expAll').disabled = false; $('expOverview').disabled = false;
    }
  }

  async function exportOverview() {
    if (exporting) return;
    exporting = true;
    const r = P().result;
    try {
      const lay = PP.render.overviewLayout(P().plates, r.grids, r.colors, P().exp, exportMeta(0, P().plates.length));
      $('expStatus').textContent = 'Préparation de la vue d’ensemble (' + lay.width + ' × ' + lay.height + ' px)…';
      const blob = await PP.files.encodePNG(lay.width, lay.height, lay.draw, (f) => panels.setProgress('expProgress', f));
      const name = U.safeFileName(P().name) + '_vue-ensemble.png';
      const res = await PP.files.saveFile(name, blob);
      $('expStatus').textContent = res === 'saved' ? name + ' exporté.' : 'Export annulé.';
    } catch (e) {
      A.toast(e.message || 'L’export a échoué.', 'error');
    } finally {
      exporting = false;
      panels.setProgress('expProgress', null);
    }
  }

  // =====================================================================
  // PROJETS
  // =====================================================================
  async function openProjects() {
    const list = await A.listProjects();
    const body = document.createElement('div');
    body.style.display = 'contents';
    body.innerHTML =
      '<div class="btn-row">' +
      '<button class="btn btn-primary" type="button" data-a="new"><svg class="ic"><use href="#i-plus"/></svg>Nouveau projet</button>' +
      '<button class="btn" type="button" data-a="rename">Renommer</button>' +
      '<button class="btn" type="button" data-a="dup"><svg class="ic"><use href="#i-copy"/></svg>Dupliquer</button>' +
      '</div>' +
      '<ul class="proj-list">' + list.map((p) =>
        '<li data-id="' + p.id + '"' + (A.project && p.id === A.project.id ? ' class="current"' : '') + '>' +
        '<span class="p-name">' + esc(p.name) + '</span>' +
        '<span class="p-date">' + new Date(p.updated || p.created || Date.now()).toLocaleDateString('fr-FR') + '</span>' +
        (A.project && p.id === A.project.id ? '<span class="p-date"><b>ouvert</b></span>' : '<button class="btn btn-sm" type="button" data-a="open">Ouvrir</button>') +
        '<button class="icon-btn danger" type="button" data-a="del" title="Supprimer"><svg class="ic"><use href="#i-trash"/></svg></button>' +
        '</li>').join('') + '</ul>';
    A.modal({
      title: 'Projets', body,
      onOpen: (b, close) => {
        b.addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-a]');
          if (!btn) return;
          const li = btn.closest('li[data-id]');
          const a = btn.dataset.a;
          if (a === 'new') {
            close();
            const name = await A.promptText('Nouveau projet', 'Nom du projet', 'Mon modèle', 'Créer');
            if (name) await A.createProject(name);
          } else if (a === 'rename') {
            close();
            const name = await A.promptText('Renommer le projet', 'Nom du projet', P().name, 'Renommer');
            if (name) { P().name = name; $('projectName').textContent = name; A.touch(); }
          } else if (a === 'dup') {
            close();
            await A.duplicateProject();
          } else if (a === 'open' && li) {
            close();
            await A.openProject(li.dataset.id);
          } else if (a === 'del' && li) {
            const pr = list.find((x) => x.id === li.dataset.id);
            close();
            if (await A.confirm('Supprimer définitivement le projet « ' + pr.name + ' » ?', 'Supprimer', true)) {
              await A.deleteProject(pr.id);
              A.toast('Projet supprimé.');
            }
          }
        });
      },
    });
  }

  // =====================================================================
  // PARAMÈTRES
  // =====================================================================
  async function openSettings() {
    const persisted = await PP.db.persisted();
    const est = await PP.db.estimate();
    const s = A.settings;
    const body = document.createElement('div');
    body.style.display = 'contents';
    body.innerHTML =
      '<div class="field"><span class="label">Interface</span><div class="seg" id="setUI"><button type="button" data-v="auto">Automatique</button><button type="button" data-v="desktop">PC</button><button type="button" data-v="mobile">Mobile / tablette</button></div></div>' +
      '<div class="field"><span class="label">Thème</span><div class="seg" id="setTheme"><button type="button" data-v="system">Système</button><button type="button" data-v="light">Clair</button><button type="button" data-v="dark">Sombre</button></div></div>' +
      '<label class="field"><span class="label">Espace libre autour des plaques (picots)</span><input type="number" id="setMargin" min="10" max="300" value="' + (s.margin | 0) + '"></label>' +
      '<p class="hint">À chaque déplacement, une plaque peut s’éloigner de cette distance ; la zone s’agrandit ensuite d’autant. 50 picots ≈ 300 px à l’écran au zoom 60 %.</p>' +
      '<div class="group"><div class="group-head"><h3>Stockage</h3></div>' +
      '<p class="hint">' + (PP.db.available ? 'Projets et palettes sont enregistrés dans ce navigateur (IndexedDB)' + (est && est.usage ? ', ' + (est.usage / 1048576).toFixed(1) + ' Mo utilisés' : '') + '.' : 'Le stockage du navigateur est indisponible : vos données seront perdues à la fermeture. Exportez une sauvegarde.') + '</p>' +
      '<p class="hint" id="persistInfo">' + (persisted ? 'Protection activée : le navigateur ne videra pas ces données de lui-même.' : 'Le navigateur peut effacer ces données s’il manque de place. Activez la protection et exportez régulièrement une sauvegarde.') + '</p>' +
      '<div class="btn-row">' + (persisted ? '' : '<button class="btn btn-sm" type="button" id="setPersist">Protéger mes données</button>') +
      '<button class="btn btn-sm" type="button" id="setBackup"><svg class="ic"><use href="#i-export"/></svg>Exporter une sauvegarde</button>' +
      '<button class="btn btn-sm" type="button" id="setRestore"><svg class="ic"><use href="#i-upload"/></svg>Restaurer</button></div></div>' +
      '<div class="group desktop-only"><div class="group-head"><h3>Raccourcis clavier</h3></div><dl class="kbd-list">' +
      '<dt>1 … 5</dt><dd>Changer d’étape</dd><dt>Molette · + / −</dt><dd>Zoomer</dd><dt>0</dt><dd>Tout afficher</dd>' +
      '<dt>Espace + glisser</dt><dd>Déplacer la vue (ou clic droit / molette enfoncée)</dd>' +
      '<dt>Flèches (Maj : ×10)</dt><dd>Déplacer la plaque ou l’image sélectionnée</dd><dt>Suppr</dt><dd>Supprimer la plaque sélectionnée</dd>' +
      '<dt>R · Maj+R</dt><dd>Pivoter l’image</dd><dt>F · Maj+F</dt><dd>Miroir de l’image</dd>' +
      '<dt>B · E · I · G · H</dt><dd>Pinceau, gomme, pipette, remplissage, main</dd><dt>[ · ]</dt><dd>Taille du pinceau</dd>' +
      '<dt>Ctrl+Z · Ctrl+Y</dt><dd>Annuler, rétablir</dd><dt>Ctrl+Entrée</dt><dd>Lancer la conversion</dd></dl></div>' +
      '<div class="group"><div class="group-head"><h3>Zone sensible</h3></div><div class="btn-row"><button class="btn btn-sm" type="button" id="setReset" style="color:var(--danger)">Tout effacer</button></div></div>';
    A.modal({
      title: 'Paramètres', body,
      onOpen: (b, close) => {
        const ui = b.querySelector('#setUI'), th = b.querySelector('#setTheme');
        setSeg(ui, s.ui); setSeg(th, s.theme);
        bindSeg(ui, (v) => { s.ui = v; setSeg(ui, v); A.saveSettings(); A.applyUI(); });
        bindSeg(th, (v) => { s.theme = v; setSeg(th, v); A.saveSettings(); A.applyTheme(); });
        b.querySelector('#setMargin').addEventListener('change', (e) => { s.margin = U.clamp(e.target.value | 0 || 50, 10, 300); e.target.value = s.margin; A.saveSettings(); A.redraw(); });
        const pb = b.querySelector('#setPersist');
        if (pb) pb.addEventListener('click', async () => {
          const ok = await PP.db.persist();
          b.querySelector('#persistInfo').textContent = ok ? 'Protection activée.' : 'Le navigateur a refusé. Installer l’application sur l’écran d’accueil aide souvent ; pensez aux sauvegardes.';
          if (ok) pb.remove();
        });
        b.querySelector('#setBackup').addEventListener('click', () => A.exportBackup());
        b.querySelector('#setRestore').addEventListener('click', async () => {
          const f = await PP.files.pickFile('.json,application/json');
          if (f) { close(); await A.importBackup(f); }
        });
        b.querySelector('#setReset').addEventListener('click', async () => {
          close();
          if (await A.confirm('Effacer tous les projets, palettes et réglages de ce navigateur ? Cette action est définitive.', 'Tout effacer', true)) A.resetAll();
        });
      },
    });
  }
})();
