/* Pixel Perles v3 — cœur : état de l'application, projets, palettes, persistance, fenêtres */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const db = PP.db;
  const $ = (id) => document.getElementById(id);

  // Dimensions relevées chez les fabricants (nombre de picots ; écart estimé à partir de la taille de la plaque)
  const PRESETS = [
    { id: 'artkal50', label: 'Artkal Mini — grande (50 × 50)', w: 50, h: 50, pitch: 2.9, note: 'Plaque de 14,5 cm, modèle standard.' },
    { id: 'artkal52', label: 'Artkal Mini — grande à repères (52 × 52)', w: 52, h: 52, pitch: 2.79, note: 'Même taille (14,5 cm), picots plus serrés et lignes de repère imprimées.' },
    { id: 'hama57', label: 'Hama Mini — grande (57 × 57)', w: 57, h: 57, pitch: 2.46, note: 'Plaque de 14 cm, 3 249 picots.' },
    { id: 'hama28', label: 'Hama Mini — petite (28 × 28)', w: 28, h: 28, pitch: 2.5, note: 'Plaque de 7 cm, 784 picots.' },
  ];

  const DEFAULT_SETTINGS = { ui: 'auto', theme: 'system', margin: 50, snap: true, lastProject: null, paletteId: null, plateType: 'artkal50', myPlates: [], openIds: [], beta: { screen: false }, dd: {} };

  const A = (PP.A = {
    PRESETS,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    project: null,
    palettes: [],
    tab: 'plates',
    sel: null,
    imgSrc: null,
    imgAdj: null,
    photo: { img: null, data: null, view: null, palId: null },
    photoTool: 'sample',
    hand: false,
    sample: null,
    selColorId: null,
    edit: { tool: 'brush', color: 0, size: 1, undo: [], redo: [], usedOnly: false },
    plateCache: new Map(),
    busy: false,
  });

  // ---------- Petites aides d'interface ----------
  A.toast = function (msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.textContent = msg;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 2) box.firstElementChild.remove();
    setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3200);
  };

  // Fenêtre modale ; actions : [{ label, value, kind: 'primary'|'danger'|'ghost' }]
  A.modal = function ({ title, body, actions, size, onOpen }) {
    return new Promise((resolve) => {
      const root = $('modalRoot');
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      const box = document.createElement('div');
      box.className = 'modal' + (size === 'sm' ? ' modal-sm' : '');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.innerHTML = '<div class="modal-head"><h2></h2><button class="icon-btn" type="button" data-close aria-label="Fermer"><svg class="ic"><use href="#i-close"/></svg></button></div><div class="modal-body"></div>';
      box.querySelector('h2').textContent = title || '';
      const bodyEl = box.querySelector('.modal-body');
      if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
      if (actions && actions.length) {
        const foot = document.createElement('div');
        foot.className = 'modal-foot';
        actions.forEach((a) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn' + (a.kind === 'primary' ? ' btn-primary' : a.kind === 'danger' ? ' btn-danger' : a.kind === 'ghost' ? ' btn-ghost' : '');
          b.textContent = a.label;
          b.addEventListener('click', () => close(typeof a.value === 'function' ? a.value(bodyEl) : a.value));
          foot.appendChild(b);
        });
        box.appendChild(foot);
      }
      back.appendChild(box);
      root.appendChild(back);
      const prevFocus = document.activeElement;
      function close(v) {
        back.remove();
        document.removeEventListener('keydown', onKey, true);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      }
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
      box.querySelector('[data-close]').addEventListener('click', () => close(null));
      A.closeModal = close;
      if (onOpen) onOpen(bodyEl, close);
      // pas de saisie au clavier imposée dans les grandes fenêtres (le clavier de la tablette masquerait tout)
      const first = box.querySelector(size === 'sm' ? 'input, select, textarea, .modal-foot .btn-primary, .modal-foot .btn-danger' : '.modal-foot .btn-primary');
      if (first) setTimeout(() => first.focus(), 30);
    });
  };

  A.confirm = function (message, okLabel, danger) {
    const p = document.createElement('p');
    p.textContent = message;
    return A.modal({
      title: 'Confirmer', body: p, size: 'sm',
      actions: [{ label: 'Annuler', value: false, kind: 'ghost' }, { label: okLabel || 'Confirmer', value: true, kind: danger ? 'danger' : 'primary' }],
    }).then((v) => v === true);
  };

  A.promptText = function (title, label, value, okLabel) {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.innerHTML = '<span class="label"></span><input type="text" maxlength="60">';
    wrap.querySelector('.label').textContent = label;
    const input = wrap.querySelector('input');
    input.value = value || '';
    return A.modal({
      title, body: wrap, size: 'sm',
      actions: [{ label: 'Annuler', value: null, kind: 'ghost' }, { label: okLabel || 'Valider', value: () => input.value.trim() || null, kind: 'primary' }],
      onOpen: (b, close) => input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value.trim() || null); } }),
    });
  };

  A.setSaveState = function (txt) { const el = $('saveState'); if (el) el.textContent = txt; };

  // ---------- Réglages ----------
  A.loadSettings = async function () {
    const s = await db.getMeta('settings', null);
    A.settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
    A.settings.custom = Object.assign({}, DEFAULT_SETTINGS.custom, A.settings.custom || {});
  };
  A.saveSettings = U.debounce(() => { db.setMeta('settings', A.settings).catch(() => {}); }, 300);

  A.applyTheme = function () {
    const t = A.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    if (A.stage) A.stage.readTheme();
  };

  A.autoUI = function () {
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    return coarse || window.innerWidth < 760 ? 'mobile' : 'desktop';
  };
  A.uiMode = function () { return A.settings.ui === 'auto' ? A.autoUI() : A.settings.ui; };
  A.applyUI = function () {
    const mobile = A.uiMode() === 'mobile';
    document.documentElement.classList.toggle('ui-mobile', mobile);
    const btn = $('uiToggle');
    btn.title = mobile ? 'Passer à l’interface PC' : 'Passer à l’interface mobile';
    btn.querySelector('use').setAttribute('href', mobile ? '#i-monitor' : '#i-phone');
    if (A.panels) A.panels.syncChrome();
    if (A.stage) requestAnimationFrame(() => A.stage.resize());
  };

  // ---------- Plaques ----------
  // modèles du commerce + « Mes plaques » enregistrées par l'utilisateur
  A.plateModels = () => PRESETS.concat((A.settings.myPlates || []).map((m) => Object.assign({ mine: true, note: 'Ma plaque.' }, m)));
  A.presetById = (id) => A.plateModels().find((p) => p.id === id) || PRESETS[0];
  A.saveMyPlate = function (spec) {
    const m = { id: 'my-' + U.uid(), label: spec.name || ('Ma plaque ' + spec.w + ' × ' + spec.h), w: spec.w, h: spec.h, pitch: spec.pitch };
    A.settings.myPlates = (A.settings.myPlates || []).concat([m]);
    A.settings.plateType = m.id;
    A.saveSettings();
    return m;
  };
  A.deleteMyPlate = function (id) {
    A.settings.myPlates = (A.settings.myPlates || []).filter((m) => m.id !== id);
    if (A.settings.plateType === id) A.settings.plateType = PRESETS[0].id;
    A.saveSettings();
  };

  A.currentPlateSpec = function () {
    const p = A.presetById(A.settings.plateType);
    return { preset: p.id, w: p.w, h: p.h, pitch: p.pitch };
  };

  A.nextPlateName = function () {
    const used = new Set(A.project.plates.map((p) => p.name));
    let n = A.project.plates.length + 1;
    while (used.has('P' + n)) n++;
    return 'P' + n;
  };

  A.makePlate = function (spec, x, y) {
    return { id: U.uid(), name: A.nextPlateName(), x, y, w: spec.w, h: spec.h, pitch: spec.pitch, preset: spec.preset };
  };

  A.platesBBox = function (plates) {
    plates = plates || A.project.plates;
    return plates.length ? PP.geo.bboxOf(plates) : null;
  };

  A.overlaps = function (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  };
  A.collides = function (rect, exceptId) {
    return A.project.plates.some((p) => p.id !== exceptId && A.overlaps(rect, p));
  };

  A.addPlate = function () {
    const spec = A.currentPlateSpec();
    const bb = A.platesBBox();
    const x = bb ? bb.x + bb.w : 0;
    const y = bb ? bb.y : 0;
    const p = A.makePlate(spec, x, y);
    A.project.plates.push(p);
    A.sel = p.id;
    A.touch();
    return p;
  };

  A.addPlateGrid = function (cols, rows) {
    const spec = A.currentPlateSpec();
    const bb = A.platesBBox();
    const ox = bb ? bb.x : 0;
    const oy = bb ? bb.y + bb.h : 0;
    let last = null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        last = A.makePlate(spec, ox + c * spec.w, oy + r * spec.h);
        A.project.plates.push(last);
      }
    }
    if (last) A.sel = last.id;
    A.touch();
  };

  A.duplicatePlate = function (id) {
    const src = A.project.plates.find((p) => p.id === id);
    if (!src) return;
    const bb = A.platesBBox();
    const p = A.makePlate({ w: src.w, h: src.h, pitch: src.pitch, preset: src.preset }, bb.x + bb.w, src.y);
    A.project.plates.push(p);
    A.sel = p.id;
    A.touch();
  };

  A.deletePlate = function (id) {
    A.project.plates = A.project.plates.filter((p) => p.id !== id);
    if (A.project.result && A.project.result.grids[id]) delete A.project.result.grids[id];
    A.plateCache.delete(id);
    if (A.sel === id) A.sel = null;
    A.touch();
  };

  // Zone de travail : boîte englobante (plaques + image) agrandie de la marge
  A.workBounds = function () {
    const m = A.settings.margin | 0 || 50;
    const rects = A.project.plates.slice();
    if (A.project.image) {
      const d = PP.geo.imgDims(A.project.image);
      rects.push({ x: A.project.image.x, y: A.project.image.y, w: d.w, h: d.h });
    }
    if (!rects.length) return { x: -m, y: -m, w: 2 * m, h: 2 * m };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    rects.forEach((r) => { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.ceil(x1); y1 = Math.ceil(y1);
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  };

  A.cellAt = function (wx, wy) {
    const x = Math.floor(wx), y = Math.floor(wy);
    for (let k = A.project.plates.length - 1; k >= 0; k--) {
      const p = A.project.plates[k];
      if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) {
        const i = x - p.x, j = y - p.y;
        return { plate: p, i, j, idx: j * p.w + i };
      }
    }
    return null;
  };

  A.plateById = (id) => A.project.plates.find((p) => p.id === id) || null;

  // ---------- Image ----------
  A.loadImageCanvas = async function () {
    A.imgSrc = null; A.imgAdj = null;
    const im = A.project && A.project.image;
    if (!im || !im.blob) return;
    try {
      const img = await U.loadImageFromBlob(im.blob);
      A.imgSrc = U.imageToCanvas(img, 3000);
      A.imgAdj = PP.convert.applyAdjust(A.imgSrc, A.project.adjust);
    } catch (e) {
      A.toast('L’image du projet est illisible.', 'error');
    }
  };

  A.refreshAdjusted = U.debounce(() => {
    if (!A.imgSrc) return;
    A.imgAdj = PP.convert.applyAdjust(A.imgSrc, A.project.adjust);
    A.redraw();
  }, 90);

  A.setImageFile = async function (file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(file.name || '')) {
      A.toast('Ce fichier n’est pas une image.', 'error');
      return;
    }
    let img;
    try { img = await U.loadImageFromBlob(file); }
    catch (e) { A.toast('Impossible de lire cette image. Essayez un fichier JPG ou PNG.', 'error'); return; }
    const canvas = U.imageToCanvas(img, 3000);
    const alpha = /png|webp|gif/.test(file.type);
    const blob = await new Promise((res) => canvas.toBlob(res, alpha ? 'image/png' : 'image/jpeg', 0.95));
    const keep = A.project.image;
    A.project.image = { blob, nw: canvas.width, nh: canvas.height, x: 0, y: 0, w: 50, rot: 0, flipH: false, flipV: false };
    A.imgSrc = canvas;
    A.imgAdj = PP.convert.applyAdjust(A.imgSrc, A.project.adjust);
    if (keep) {
      // conserve la largeur et la position précédentes
      A.project.image.x = keep.x; A.project.image.y = keep.y; A.project.image.w = keep.w;
    } else {
      A.fitImage();
    }
    A.touch();
    A.panels.refresh();
    A.stage.fitView();
  };

  A.fitImage = function () {
    const im = A.project.image;
    if (!im) return;
    const bb = A.platesBBox() || { x: 0, y: 0, w: 50, h: 50 };
    const rotated = im.rot % 180 !== 0;
    const ar = rotated ? im.nw / im.nh : im.nh / im.nw; // hauteur / largeur affichées
    let w = bb.w;
    if (w * ar > bb.h) w = bb.h / ar;
    w = Math.max(2, Math.round(w));
    const h = w * ar;
    im.w = w;
    im.x = Math.round(bb.x + (bb.w - w) / 2);
    im.y = Math.round(bb.y + (bb.h - h) / 2);
  };

  A.rotateImage = function (dir) {
    const im = A.project.image;
    if (!im) return;
    const d0 = PP.geo.imgDims(im);
    const cx = im.x + d0.w / 2, cy = im.y + d0.h / 2;
    im.rot = (im.rot + (dir > 0 ? 90 : 270)) % 360;
    // garde la même « taille » visuelle : la nouvelle largeur = ancienne hauteur
    im.w = Math.max(2, Math.round(d0.h));
    const d1 = PP.geo.imgDims(im);
    im.x = Math.round(cx - d1.w / 2);
    im.y = Math.round(cy - d1.h / 2);
    A.touch();
  };

  // ---------- Signature pour détecter un résultat périmé ----------
  A.geoSig = function () {
    const p = A.project;
    const im = p.image;
    return JSON.stringify({
      pl: p.plates.map((q) => [q.id, q.x, q.y, q.w, q.h]),
      im: im ? [im.x, im.y, im.w, im.rot, im.flipH, im.flipV, im.nw, im.nh, im.blob ? im.blob.size : 0] : null,
      ad: p.adjust,
    });
  };
  A.isStale = function () {
    const r = A.project && A.project.result;
    return !!(r && r.sig !== A.geoSig());
  };
  A.hasResult = () => !!(A.project && A.project.result);

  // ---------- Projets ----------
  function normalizeProject(p) {
    revive(p);
    p.plates = p.plates || [];
    p.adjust = Object.assign({ brightness: 0, contrast: 0, saturation: 0 }, p.adjust || {});
    p.conv = Object.assign({ paletteId: null, mode: 'mean', maxColors: 0, dither: 0, step: 10, dominant: true, outline: false }, p.conv || {});
    p.conv.maxColors = 0; // v3 : la réduction se fait après coup (Retouche › Limiter le nombre de couleurs)
    p.guide = Object.assign({ plateId: null, mode: 'color', color: null, row: 0, done: {}, others: 'dim', codes: true, rot: 0 }, p.guide || {});
    p.exp = Object.assign({ bg: 'white', style: 'square', codes: true, guides: true, labels4: true, minSide: 4320 }, p.exp || {});
    p.disp = Object.assign({ opacity: 85, beads: false, codes: true, overlay: false, layer: false, layerImg: 60, layerBeads: 70 }, p.disp || {});
    if (p.disp.overlay) { p.disp.layer = true; p.disp.overlay = false; } // ancienne superposition → dessin sur calque
    if (p.result) {
      Object.keys(p.result.grids).forEach((k) => {
        const g = p.result.grids[k];
        if (!(g instanceof Int16Array)) p.result.grids[k] = Int16Array.from(g);
      });
    }
    return p;
  }

  A.newProjectObject = function (name) {
    return normalizeProject({ id: U.uid(), name: name || 'Nouveau projet', created: Date.now(), updated: Date.now(), plates: [], image: null, result: null });
  };

  A.listProjects = async function () {
    const all = await db.getAll('projects');
    return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  };

  // Dans IndexedDB, l'image est rangée en octets (ArrayBuffer) et non en Blob : Safari perd parfois les Blob.
  const bytesCache = new WeakMap();
  async function storable(p) {
    if (!p.image || !p.image.blob) return p;
    let bytes = bytesCache.get(p.image.blob);
    if (!bytes) {
      bytes = await repairImageBytes(p);
      bytesCache.set(p.image.blob, bytes);
    }
    return Object.assign({}, p, { image: Object.assign({}, p.image, { blob: null, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), type: p.image.blob.type || 'image/png' }) });
  }
  // lit les octets de l'image ; si le Blob est devenu illisible, on la réencode depuis l'image affichée
  async function repairImageBytes(p) {
    try { return await U.blobBytes(p.image.blob); }
    catch (e) {
      if (p === A.project && A.imgSrc) {
        const b = await new Promise((res) => A.imgSrc.toBlob(res, 'image/png'));
        if (b) { p.image.blob = b; return U.blobBytes(b); }
      }
      throw new Error('L’image source du projet est illisible (' + (e && e.message ? e.message : 'erreur') + '). Rechargez l’image dans l’onglet Image.');
    }
  }
  A.storableProject = storable;
  function revive(p) {
    if (p && p.image && !p.image.blob && p.image.bytes) {
      p.image.blob = new Blob([p.image.bytes], { type: p.image.type || 'image/png' });
      delete p.image.bytes;
    }
    return p;
  }

  A.saveProjectNow = async function () {
    if (!A.project) return;
    try {
      await db.put('projects', await storable(A.project));
      A.setSaveState(db.available ? 'Enregistré' : 'Non enregistré (stockage indisponible)');
    } catch (e) {
      A.setSaveState('Échec de l’enregistrement');
      A.toast('Enregistrement impossible : ' + (e && e.message ? e.message : 'espace de stockage plein ?'), 'error');
    }
  };
  A.saveProject = U.debounce(() => A.saveProjectNow(), 500);

  A.touch = function () {
    if (!A.project) return;
    A.project.updated = Date.now();
    A.setSaveState('Enregistrement…');
    A.saveProject();
    A.redraw();
    if (A.projects) A.projects.refreshThumb();
  };

  A.openProject = async function (id) {
    const p = await db.get('projects', id);
    if (!p) return false;
    await A.setProject(normalizeProject(p));
    return true;
  };

  A.setProject = async function (p) {
    A.project = p;
    A.sel = null;
    A.edit.undo = []; A.edit.redo = [];
    A.edit.color = 0;
    A.plateCache.clear();
    A.settings.lastProject = p.id;
    A.saveSettings();
    await A.loadImageCanvas();
    if (A.panels) A.panels.refresh();
    if (A.stage) A.stage.fitView();
  };

  A.createProject = async function (name) {
    const p = A.newProjectObject(name);
    const spec = A.currentPlateSpec();
    p.plates.push({ id: U.uid(), name: 'P1', x: 0, y: 0, w: spec.w, h: spec.h, pitch: spec.pitch, preset: spec.preset });
    p.conv.paletteId = A.settings.paletteId || (A.palettes[0] && A.palettes[0].id) || null;
    await db.put('projects', await storable(p));
    await A.setProject(p);
    A.setTab('plates');
  };

  A.deleteProject = async function (id) {
    await db.del('projects', id);
    if (A.project && A.project.id === id) {
      const rest = await A.listProjects();
      if (rest.length) await A.setProject(normalizeProject(rest[0]));
      else await A.createProject('Nouveau projet');
    }
  };

  A.duplicateProject = async function () {
    const src = A.project;
    const copy = normalizeProject(Object.assign({}, src, {
      id: U.uid(), name: src.name + ' (copie)', created: Date.now(), updated: Date.now(),
      plates: src.plates.map((p) => Object.assign({}, p)),
      image: src.image ? Object.assign({}, src.image) : null,
      adjust: Object.assign({}, src.adjust), conv: Object.assign({}, src.conv), exp: Object.assign({}, src.exp), disp: Object.assign({}, src.disp), guide: JSON.parse(JSON.stringify(src.guide || {})),
      result: src.result ? {
        colors: src.result.colors.map((c) => Object.assign({}, c)),
        grids: Object.fromEntries(Object.entries(src.result.grids).map(([k, v]) => [k, Int16Array.from(v)])),
        sig: src.result.sig, date: src.result.date, edited: src.result.edited,
      } : null,
    }));
    await db.put('projects', await storable(copy));
    await A.setProject(copy);
    A.toast('Projet dupliqué.');
  };

  // ---------- Palettes ----------
  A.paletteById = (id) => A.palettes.find((p) => p.id === id) || null;
  A.currentPalette = function () {
    return A.paletteById(A.settings.paletteId) || A.palettes[0] || null;
  };
  A.convPalette = function () {
    return A.paletteById(A.project.conv.paletteId) || A.currentPalette();
  };

  A.newPaletteObject = function (name, colors) {
    return {
      id: U.uid(), name: name || 'Nouvelle palette', created: Date.now(), updated: Date.now(),
      colors: (colors || []).map((c) => ({ id: U.uid(), code: c.code, name: c.name || '', hex: U.normHex(c.hex) || '#888888' })),
      photo: null, wb: null,
    };
  };

  const palTimers = new Map();
  A.savePalette = function (pal, immediate) {
    pal.updated = Date.now();
    clearTimeout(palTimers.get(pal.id));
    const run = () => db.put('palettes', pal).catch((e) => A.toast('Palette non enregistrée : ' + e.message, 'error'));
    if (immediate) return run();
    palTimers.set(pal.id, setTimeout(run, 400));
  };

  A.addPalette = async function (pal) {
    A.palettes.push(pal);
    A.palettes.sort((a, b) => U.naturalCompare(a.name, b.name));
    await A.savePalette(pal, true);
    A.settings.paletteId = pal.id;
    A.saveSettings();
  };

  A.deletePalette = async function (id) {
    A.palettes = A.palettes.filter((p) => p.id !== id);
    await db.del('palettes', id);
    if (A.settings.paletteId === id) A.settings.paletteId = A.palettes[0] ? A.palettes[0].id : null;
    A.saveSettings();
  };

  // Code : 1 à 5 caractères (lettres, chiffres, - _ .), unique dans la palette
  A.codeError = function (pal, code, exceptId) {
    const c = String(code || '').trim();
    if (!c) return 'Donnez un code à la couleur (ex. J0).';
    if (c.length > 5) return 'Le code fait 5 caractères au maximum.';
    if (!/^[\p{L}\p{N}._-]+$/u.test(c)) return 'Utilisez seulement des lettres, des chiffres, « . », « - » ou « _ ».';
    const dup = pal.colors.find((x) => x.id !== exceptId && x.code.toLowerCase() === c.toLowerCase());
    if (dup) return 'Le code « ' + c + ' » est déjà utilisé.';
    return null;
  };

  // Suggestion du code suivant : J0 -> J1, Bl2 -> Bl3, 12 -> 13
  A.suggestCode = function (pal) {
    const last = pal.colors[pal.colors.length - 1];
    let base = last ? last.code : '';
    const m = /^(.*?)(\d+)$/.exec(base);
    let cand = m ? m[1] + (parseInt(m[2], 10) + 1) : base ? base + '1' : '1';
    let guard = 0;
    while (A.codeError(pal, cand) && guard++ < 500) {
      const mm = /^(.*?)(\d+)$/.exec(cand);
      cand = mm ? mm[1] + (parseInt(mm[2], 10) + 1) : cand + '1';
    }
    return cand.slice(0, 5);
  };

  A.parseColorLines = function (text) {
    const out = [];
    const bad = [];
    String(text || '').split(/\r?\n/).forEach((line, n) => {
      const l = line.trim();
      if (!l) return;
      const tokens = l.split(/[\s;,\t]+/).filter(Boolean);
      let hi = tokens.findIndex((t) => /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(t));
      if (hi < 0) hi = tokens.findIndex((t, i) => i > 0 && /^[0-9a-f]{6}$/i.test(t));
      if (hi < 0 || tokens.length < 2) { bad.push(n + 1); return; }
      const hex = U.normHex(tokens[hi]);
      tokens.splice(hi, 1);
      const code = tokens.shift() || '';
      out.push({ code, name: tokens.join(' '), hex });
    });
    return { colors: out, bad };
  };

  // ---------- Contenu d'exemple ----------
  const SAMPLE_COLORS = [
    ['B0', 'Blanc', '#F7F7F2'], ['G0', 'Gris clair', '#C9CBCC'], ['G1', 'Gris', '#8E9294'], ['G2', 'Gris foncé', '#55595C'], ['N0', 'Noir', '#1E1E1F'],
    ['J0', 'Jaune clair', '#FCEB8B'], ['J1', 'Jaune', '#F9D531'], ['J2', 'Jaune foncé', '#F1B419'],
    ['O0', 'Orange clair', '#FDB46C'], ['O1', 'Orange', '#F58A23'], ['O2', 'Orange foncé', '#E0601A'],
    ['R0', 'Rouge clair', '#F0626A'], ['R1', 'Rouge', '#D42A2F'], ['R2', 'Bordeaux', '#8E1D2B'],
    ['P0', 'Rose clair', '#F9C3D4'], ['P1', 'Rose', '#EC7FA9'], ['P2', 'Fuchsia', '#C93A86'],
    ['Vi0', 'Lilas', '#C7B2E3'], ['Vi1', 'Violet', '#7D4BA8'],
    ['Bl0', 'Bleu ciel', '#A9D6F2'], ['Bl1', 'Bleu', '#3D8CD6'], ['Bl2', 'Bleu marine', '#1F3E7A'], ['T0', 'Turquoise', '#3FC1C0'],
    ['V0', 'Vert clair', '#A8DB7E'], ['V1', 'Vert', '#4CA84A'], ['V2', 'Vert foncé', '#2A6B3A'],
    ['C0', 'Beige', '#EAD2AE'], ['C1', 'Peau', '#F1C3A0'], ['C2', 'Caramel', '#C98B52'], ['M0', 'Marron', '#8A5530'], ['M1', 'Marron foncé', '#553420'],
  ];

  A.samplePalette = function () {
    return A.newPaletteObject('Exemple (à remplacer par vos perles)', SAMPLE_COLORS.map(([code, name, hex]) => ({ code, name, hex })));
  };

  function sampleImageBlob() {
    const W = 800, H = 496;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const sky = x.createLinearGradient(0, 0, 0, H * 0.72);
    sky.addColorStop(0, '#3D8CD6'); sky.addColorStop(0.55, '#A9D6F2'); sky.addColorStop(1, '#FCE7B5');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    const circle = (cx, cy, r, col) => { x.fillStyle = col; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    circle(W * 0.73, H * 0.36, 78, '#FDB46C');
    circle(W * 0.73, H * 0.36, 62, '#F9D531');
    [[150, 90, 1], [330, 60, 0.8], [560, 120, 0.7]].forEach(([cx, cy, s]) => {
      circle(cx, cy, 30 * s, '#F7F7F2'); circle(cx + 32 * s, cy - 12 * s, 36 * s, '#F7F7F2'); circle(cx + 70 * s, cy, 28 * s, '#F7F7F2');
      x.fillStyle = '#F7F7F2'; x.fillRect(cx, cy, 70 * s, 28 * s);
    });
    const hill = (pts, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(0, H); pts.forEach(([a, b]) => x.lineTo(a, b)); x.lineTo(W, H); x.closePath(); x.fill(); };
    hill([[0, 300], [120, 220], [230, 280], [360, 190], [500, 270], [640, 210], [800, 280]], '#7D4BA8');
    x.fillStyle = 'rgba(169,214,242,0.35)'; x.fillRect(0, 180, W, 140);
    x.fillStyle = '#4CA84A';
    x.beginPath(); x.moveTo(0, H); x.lineTo(0, 340); x.quadraticCurveTo(220, 270, 420, 330); x.quadraticCurveTo(620, 380, 800, 320); x.lineTo(800, H); x.fill();
    x.fillStyle = '#2A6B3A';
    x.beginPath(); x.moveTo(0, H); x.lineTo(0, 420); x.quadraticCurveTo(300, 360, 520, 410); x.quadraticCurveTo(680, 445, 800, 400); x.lineTo(800, H); x.fill();
    // maison
    x.fillStyle = '#F7F7F2'; x.fillRect(470, 300, 120, 84);
    x.fillStyle = '#D42A2F'; x.beginPath(); x.moveTo(456, 304); x.lineTo(530, 246); x.lineTo(604, 304); x.closePath(); x.fill();
    x.fillStyle = '#553420'; x.fillRect(518, 334, 26, 50);
    x.fillStyle = '#3D8CD6'; x.fillRect(484, 318, 24, 22); x.fillRect(556, 318, 24, 22);
    // arbre
    x.fillStyle = '#8A5530'; x.fillRect(196, 310, 22, 90);
    circle(207, 290, 48, '#2A6B3A'); circle(178, 312, 34, '#2A6B3A'); circle(238, 312, 34, '#2A6B3A');
    circle(196, 280, 14, '#4CA84A');
    // fleurs
    [[90, 452], [130, 470], [320, 462], [650, 470], [710, 452]].forEach(([fx, fy]) => { circle(fx, fy, 9, '#EC7FA9'); circle(fx, fy, 4, '#F9D531'); });
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  A.sampleProject = async function (pal) {
    const p = A.newProjectObject('Exemple — paysage');
    p.plates.push({ id: U.uid(), name: 'P1', x: 0, y: 0, w: 50, h: 50, pitch: 2.9, preset: 'artkal50' });
    p.plates.push({ id: U.uid(), name: 'P2', x: 50, y: 0, w: 50, h: 50, pitch: 2.9, preset: 'artkal50' });
    const blob = await sampleImageBlob();
    p.image = { blob, nw: 800, nh: 496, x: 0, y: -6, w: 100, rot: 0, flipH: false, flipV: false };
    p.conv.paletteId = pal ? pal.id : null;
    return p;
  };

  // ---------- Conversion ----------
  // « Conversion » ouvre le comparateur : plusieurs rendus calculés en parallèle, l'utilisateur choisit.
  A.checkConvertible = function () {
    const p = A.project;
    if (!p.plates.length) { A.toast('Ajoutez au moins une plaque dans l’onglet Plateau.', 'error'); return null; }
    if (!p.image || !A.imgAdj) { A.toast('Importez d’abord une image.', 'error'); return null; }
    const pal = A.convPalette();
    if (!pal || !pal.colors.length) { A.toast('La palette choisie est vide. Ajoutez des couleurs dans l’onglet Palette.', 'error'); return null; }
    return pal;
  };

  A.runConversion = function () {
    if (A.busy || !A.project) return;
    if (!A.checkConvertible()) return;
    A.compare.open();
  };

  // Enregistre le rendu choisi dans le comparateur comme résultat du projet
  A.applyVariant = async function (item, colors, paletteName) {
    const p = A.project;
    if (p.result && p.result.edited) {
      const ok = await A.confirm('Ce rendu remplace les retouches faites à la main sur la conversion précédente. Continuer ?', 'Remplacer');
      if (!ok) return false;
    }
    const grids = {};
    Object.keys(item.grids).forEach((k) => { grids[k] = Int16Array.from(item.grids[k]); });
    if (p.conv.outline) addOutline(p.plates, grids, colors);
    p.result = {
      colors: colors.map((c) => ({ code: c.code, name: c.name, hex: c.hex })),
      paletteName,
      grids,
      sig: A.geoSig(),
      date: Date.now(),
      edited: false,
      variant: { mode: item.mode, dither: item.dither, auto: !!item.auto, kind: item.kind || null },
    };
    p.conv.mode = item.mode;
    if (item.mode === 'mean') p.conv.dither = item.dither;
    A.edit.undo = []; A.edit.redo = [];
    A.plateCache.clear();
    let best = 0;
    item.counts.forEach((v, i) => { if (v > item.counts[best]) best = i; });
    A.edit.color = best;
    A.touch();
    A.setTab('edit');
    if (A.uiMode() === 'mobile') { A.panels.setSheet(false); setTimeout(() => A.stage.fitView(), 80); }
    A.toast('Rendu « ' + item.label + ' » retenu : ' + item.used + ' couleur' + (item.used > 1 ? 's' : '') + '.');
    return true;
  };

  // Contour sombre : chaque perle posée qui touche un picot vide (ou le bord du motif) prend la couleur la plus foncée utilisée
  function addOutline(plates, grids, colors) {
    const used = new Set();
    Object.values(grids).forEach((g) => g.forEach((v) => { if (v >= 0) used.add(v); }));
    let dark = -1, dl = 1e9;
    used.forEach((i) => { const rgb = U.hexToRgb(colors[i].hex) || [0, 0, 0]; const l = U.relLum(rgb[0], rgb[1], rgb[2]); if (l < dl) { dl = l; dark = i; } });
    if (dark < 0) return;
    const bb = PP.geo.bboxOf(plates);
    const W = bb.w, H = bb.h, ras = new Int16Array(W * H).fill(-1);
    plates.forEach((p) => { const g = grids[p.id]; if (!g) return; for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) ras[(p.y - bb.y + j) * W + p.x - bb.x + i] = g[j * p.w + i]; });
    // pas de picot vide du tout : rien à entourer
    if (!ras.some((v) => v < 0)) return;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : ras[y * W + x]);
    plates.forEach((p) => {
      const g = grids[p.id]; if (!g) return;
      for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
        const x = p.x - bb.x + i, y = p.y - bb.y + j;
        if (ras[y * W + x] < 0) continue;
        if (at(x - 1, y) < 0 || at(x + 1, y) < 0 || at(x, y - 1) < 0 || at(x, y + 1) < 0) g[j * p.w + i] = dark;
      }
    });
  }

  A.variantLabel = function (v) {
    if (v.auto) return 'Meilleur rendu (' + A.auto.describe(v) + ')';
    return v.mode === 'dominant' ? 'Dominante' : v.dither === 0 ? 'Sans tramage' : 'Tramage ' + v.dither + ' %';
  };

  // ---------- Sauvegardes ----------
  A.APP_VERSION = '3.2.0';

  async function serializeProject(p) {
    const q = Object.assign({}, p);
    if (p.image) {
      revive(p);
      let url = null;
      if (p.image.blob) {
        const bytes = await repairImageBytes(p);
        url = 'data:' + (p.image.blob.type || 'image/png') + ';base64,' + (await U.blobToDataURL(new Blob([bytes]))).split(',')[1];
      }
      q.image = Object.assign({}, p.image, { blob: url, bytes: undefined });
    }
    if (p.result) q.result = Object.assign({}, p.result, { grids: Object.fromEntries(Object.entries(p.result.grids).map(([k, v]) => [k, Array.from(v)])) });
    return q;
  }
  async function deserializeProject(q) {
    if (q.image && typeof q.image.blob === 'string') q.image.blob = await U.dataURLToBlob(q.image.blob);
    return normalizeProject(q);
  }
  async function serializePalette(pal, withPhoto) {
    return Object.assign({}, pal, { photo: withPhoto && pal.photo ? await U.blobToDataURL(pal.photo) : null });
  }
  async function reloadPalettes() {
    A.palettes = (await db.getAll('palettes')).sort((a, b) => U.naturalCompare(a.name, b.name));
  }
  const stamp = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };

  A.exportBackup = async function () {
    const projects = await A.listProjects();
    const out = { format: 'pixel-perles-sauvegarde', version: 1, app: A.APP_VERSION, date: new Date().toISOString(), palettes: [], projects: [] };
    for (const pal of A.palettes) out.palettes.push(await serializePalette(pal, true));
    for (const p of projects) out.projects.push(await serializeProject(p));
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const r = await PP.files.saveFile('pixel-perles-sauvegarde-' + stamp() + '.json', blob);
    if (r === 'saved') A.toast('Sauvegarde exportée.');
  };

  async function importBackupData(data) {
    let np = 0, nl = 0;
    for (const pal of data.palettes || []) {
      if (pal.photo) pal.photo = await U.dataURLToBlob(pal.photo);
      await db.put('palettes', pal); nl++;
    }
    for (const p of data.projects || []) {
      await db.put('projects', await storable(await deserializeProject(p))); np++;
    }
    await reloadPalettes();
    A.toast(np + ' projet(s) et ' + nl + ' palette(s) restaurés.');
    if (A.project) {
      const fresh = await db.get('projects', A.project.id);
      if (fresh) await A.setProject(normalizeProject(fresh));
    }
    A.panels.refresh();
  }

  A.importBackup = async function (file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { A.toast('Ce fichier n’est pas une sauvegarde lisible.', 'error'); return; }
    if (!data || data.format !== 'pixel-perles-sauvegarde') { A.toast('Ce fichier n’est pas une sauvegarde Pixel Perles.', 'error'); return; }
    await importBackupData(data);
  };

  // Image d'un projet sans conversion : une simple carte avec son nom
  async function cardPNG(p) {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 630;
    const x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, c.width, c.height);
    try {
      if (A.imgSrc) {
        const iw = A.imgSrc.width, ih = A.imgSrc.height, s = Math.min(520 / iw, 520 / ih);
        x.drawImage(A.imgSrc, 640 + (520 - iw * s) / 2, 55 + (520 - ih * s) / 2, iw * s, ih * s);
      }
    } catch (e) { /* image indisponible */ }
    x.fillStyle = '#1B1F24';
    x.font = '700 56px system-ui, sans-serif';
    x.fillText('Sauvegarde Pixel Perles', 60, 130);
    x.font = '700 40px system-ui, sans-serif';
    x.fillText(p.name.slice(0, 24), 60, 200);
    x.font = '500 26px system-ui, sans-serif';
    x.fillStyle = '#5B6470';
    x.fillText('Projet pas encore converti · ' + new Date().toLocaleDateString('fr-FR'), 60, 250);
    x.fillText('À ouvrir avec Pixel Perles › Export › Importer', 60, 290);
    return new Promise((res) => c.toBlob(res, 'image/png'));
  }

  /** Image du modèle (vue d'ensemble + légende) qui contient aussi tout le projet, pour le restaurer ou le partager. */
  A.projectPayload = async function (p) {
    p = p || A.project;
    const pal = A.palettes.find((x) => x.id === p.conv.paletteId);
    return JSON.stringify({
      format: 'pixel-perles-projet', version: 1, app: A.APP_VERSION, date: new Date().toISOString(),
      project: await serializeProject(p),
      palette: pal ? await serializePalette(pal, false) : null,
    });
  };
  A.projectImage = async function (p) {
    p = p || A.project;
    const payload = await A.projectPayload(p);
    let png;
    if (p.result) {
      const o = Object.assign({}, p.exp, { bg: 'white', minSide: 1800 });
      const lay = PP.render.overviewLayout(p.plates, p.result.grids, p.result.colors, o, { project: p.name, date: new Date().toLocaleDateString('fr-FR'), index: 0, total: p.plates.length,
        title: 'Sauvegarde Pixel Perles', note: 'À ouvrir avec Pixel Perles › Export › Importer une sauvegarde' });
      png = await PP.files.encodePNG(lay.width, lay.height, lay.draw);
    } else png = await cardPNG(p);
    const blob = await PP.files.embedInPNG(png, payload);
    const d = new Date();
    const date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { blob, name: 'Sauvegarde Pixel Perles - ' + U.safeFileName(p.name).replace(/_/g, ' ') + ' - ' + date + '.png' };
  };

  /** Enregistre (ou partage) l'image-sauvegarde du projet ouvert. */
  A.saveProjectImage = async function (share) {
    if (!A.project) return;
    await A.saveProjectNow();
    A.toast('Préparation de la sauvegarde…');
    try {
      const { blob, name } = await A.projectImage();
      let r;
      try { r = share ? await PP.files.shareFile(name, blob, A.project.name) : await PP.files.saveFile(name, blob); }
      catch (e) { throw new Error('Le navigateur a refusé l’enregistrement du fichier (' + (e && e.message ? e.message : 'erreur') + ').'); }
      if (r === 'saved' || r === 'shared') {
        A.project.fileSaved = Date.now();
        A.saveProject();
        A.toast(r === 'shared' ? 'Sauvegarde partagée.' : 'Sauvegarde enregistrée : ' + name + ' (' + (blob.size / 1048576).toFixed(1) + ' Mo).');
        if (A.panels && A.panels.refreshExport) A.panels.refreshExport();
      }
    } catch (e) {
      console.error(e);
      A.toast(e.message || 'Impossible de préparer l’image du projet.', 'error');
    }
  };

  /** Ouvre une image-sauvegarde (.png), un projet ou une sauvegarde complète (.json). */
  A.openFile = async function (file) {
    if (!file) return;
    let text = null;
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name || '');
    try {
      text = isPng ? await PP.files.readFromPNG(file) : await file.text();
    } catch (e) { text = null; }
    if (!text) {
      A.toast(isPng
        ? 'Cette image ne contient pas de projet Pixel Perles. Une image passée par une messagerie (WhatsApp, Messenger, SMS…) est souvent recompressée : envoyez-la plutôt comme fichier (Fichiers, AirDrop, e-mail).'
        : 'Fichier illisible.', 'error');
      return;
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { A.toast('Ce fichier n’est pas un projet lisible.', 'error'); return; }
    if (data && data.format === 'pixel-perles-sauvegarde') { await importBackupData(data); return; }
    if (!data || data.format !== 'pixel-perles-projet' || !data.project) { A.toast('Ce fichier n’est pas un projet Pixel Perles.', 'error'); return; }
    if (data.palette && data.palette.id && !(await db.get('palettes', data.palette.id))) {
      await db.put('palettes', Object.assign({}, data.palette, { photo: null }));
      await reloadPalettes();
    }
    const p = await deserializeProject(data.project);
    if (await db.get('projects', p.id)) {
      // le projet existe encore ici : on garde les deux, rien n'est écrasé
      p.id = U.uid();
      p.name = p.name + ' (restauré)';
    }
    p.updated = Date.now();
    await db.put('projects', await storable(p));
    const ok = await A.projects.open(p.id);
    if (!ok) { A.toast('Import annulé : le projet reste disponible dans « Mes projets ».'); return; }
    A.toast('Projet « ' + p.name + ' » ouvert' + (data.date ? ', tel qu’enregistré le ' + new Date(data.date).toLocaleDateString('fr-FR') : '') + '.');
  };

  A.resetAll = async function () {
    await db.clearAll();
    location.reload();
  };

  A.normalizeProject = normalizeProject;
})();
