/* Pixel Perles — démarrage, raccourcis clavier, glisser-déposer, service worker */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const db = PP.db;

  function isTyping(t) {
    if (!t) return false;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
    return t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'button'].includes(t.type);
  }

  document.addEventListener('keydown', (e) => {
    if (!A.project || document.querySelector('.modal-backdrop')) return;
    const typing = isTyping(e.target);
    if (e.key === ' ' && !typing) {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault();
      A.stage.setSpace(true);
      return;
    }
    if (typing) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (ctrl && k === 'z') { e.preventDefault(); if (A.hasResult()) A.stage.undo(e.shiftKey); return; }
    if (ctrl && k === 'y') { e.preventDefault(); if (A.hasResult()) A.stage.undo(true); return; }
    if (ctrl && e.key === 'Enter') { e.preventDefault(); A.runConversion(); return; }
    if (ctrl || e.altKey) return;
    const tabs = { 1: 'plates', 2: 'palette', 3: 'image', 4: 'edit', 5: 'export' };
    if (tabs[e.key]) { A.setTab(tabs[e.key]); return; }
    if (e.key === '+' || e.key === '=') { A.stage.zoomBy(1.25); return; }
    if (e.key === '-' || e.key === '_') { A.stage.zoomBy(0.8); return; }
    if (e.key === '0') { A.stage.fitView(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      const st = e.shiftKey ? 10 : 1;
      const [dx, dy] = arrows[e.key];
      if (A.tab === 'plates' && A.sel) { e.preventDefault(); A.stage.nudgePlate(A.sel, dx * st, dy * st); A.panels.refreshPlates(); }
      else if (A.tab === 'image' && A.project.image) { e.preventDefault(); A.stage.nudgeImage(dx * st, dy * st); }
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && A.tab === 'plates' && A.sel) {
      e.preventDefault();
      const p = A.plateById(A.sel);
      A.confirm('Supprimer la plaque « ' + p.name + ' » ?', 'Supprimer', true).then((ok) => { if (ok) { A.deletePlate(p.id); A.panels.refresh(); } });
      return;
    }
    if (e.key === 'Escape') {
      if (A.sample) { A.sample = null; A.photo.lastRect = null; A.panels.refreshPalette(); A.redraw(); return; }
      if (A.sel) { A.sel = null; A.panels.refreshPlates(); A.redraw(); }
      return;
    }
    if (A.tab === 'image' && A.project.image) {
      if (k === 'r') { A.rotateImage(e.shiftKey ? -1 : 1); A.panels.refreshImageInfo(); return; }
      if (k === 'f') { if (e.shiftKey) A.project.image.flipV = !A.project.image.flipV; else A.project.image.flipH = !A.project.image.flipH; A.touch(); return; }
    }
    if (A.tab === 'edit' && A.hasResult()) {
      const tools = { b: 'brush', e: 'erase', i: 'pick', g: 'fill', h: 'hand' };
      if (tools[k]) { A.edit.tool = tools[k]; A.panels.refreshEdit(); A.stage.updateCursor(); return; }
      if (e.key === '[') { A.edit.size = Math.max(1, A.edit.size - 1); A.panels.refreshEdit(); A.redraw(); return; }
      if (e.key === ']') { A.edit.size = Math.min(3, A.edit.size + 1); A.panels.refreshEdit(); A.redraw(); return; }
    } else if (k === 'h') {
      A.hand = !A.hand;
      A.panels.syncChrome();
      A.stage.updateCursor();
    }
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') A.stage.setSpace(false); });
  window.addEventListener('blur', () => A.stage.setSpace(false));

  // Glisser-déposer et coller une image
  async function takeImage(file) {
    if (!file || !/^image\//.test(file.type)) return false;
    if (A.tab === 'palette') await A.panels.setPalettePhoto(file);
    else { await A.setImageFile(file); A.setTab('image'); }
    return true;
  }
  const stage = document.getElementById('stage');
  stage.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    takeImage(f).then((ok) => { if (!ok && f) A.toast('Déposez un fichier image (JPG, PNG…).', 'error'); });
  });
  document.addEventListener('paste', (e) => {
    if (isTyping(e.target)) return;
    const items = (e.clipboardData && e.clipboardData.files) || [];
    if (items[0]) takeImage(items[0]);
  });

  async function main() {
    A.stage.readTheme();
    await A.loadSettings();
    A.applyTheme();
    A.applyUI();
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => A.stage.readTheme());
    window.addEventListener('resize', U.debounce(() => { if (A.settings.ui === 'auto') A.applyUI(); }, 200));
    A.panels.init();

    const ok = await db.ready();
    if (!ok) A.toast('Le stockage du navigateur est indisponible : exportez vos palettes et vos images avant de fermer.', 'error');

    let firstRun = false;
    A.palettes = (await db.getAll('palettes')).sort((a, b) => U.naturalCompare(a.name, b.name));
    if (!A.palettes.length) {
      const sp = A.samplePalette();
      await db.put('palettes', sp);
      A.palettes = [sp];
      A.settings.paletteId = sp.id;
      firstRun = true;
    }
    let proj = A.settings.lastProject ? await db.get('projects', A.settings.lastProject) : null;
    if (!proj) proj = (await A.listProjects())[0] || null;
    if (!proj) {
      proj = await A.sampleProject(A.palettes[0]);
      await db.put('projects', proj);
      firstRun = true;
    }
    await A.setProject(A.normalizeProject(proj));
    A.setTab(firstRun ? 'image' : 'plates');
    A.saveSettings();
    A.setSaveState(db.available ? 'Enregistré' : 'Non enregistré');
    if (firstRun) A.toast('Bienvenue ! Un exemple est chargé : appuyez sur « Conversion » pour voir le résultat.');

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.PP_EMBEDDED) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  main().catch((e) => {
    console.error(e);
    A.toast('Erreur au démarrage : ' + e.message, 'error');
  });
})();
