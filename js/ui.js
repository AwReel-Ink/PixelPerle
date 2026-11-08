/* Pixel Perles v3 — coque de l'application : étapes, panneau (côté ou bas), menus déroulants, paramètres */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const isMobile = () => document.documentElement.classList.contains('ui-mobile');

  const panels = (A.panels = {});
  A.panes = A.panes || {};
  let sheetOpen = true;

  // ---------- Aides communes ----------
  const ui = (A.ui = {});
  ui.bindSeg = function (el, onChange) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.disabled) return;
      onChange(b.dataset.v);
    });
  };
  ui.setSeg = function (el, v) {
    el.querySelectorAll('button[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  };
  ui.cm = (picots, pitch) => ((picots * (pitch || 2.6)) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  panels.setProgress = function (id, f) {
    const el = $(id);
    if (!el) return;
    if (f === null || f === undefined) { el.hidden = true; return; }
    el.hidden = false;
    el.firstElementChild.style.width = Math.round(f * 100) + '%';
  };

  // menus déroulants : l'état ouvert / fermé de chacun est mémorisé
  function initDropdowns() {
    document.querySelectorAll('details.dd[data-dd]').forEach((d) => {
      const k = d.dataset.dd;
      if (A.settings.dd && k in A.settings.dd) d.open = !!A.settings.dd[k];
      d.addEventListener('toggle', () => {
        A.settings.dd = A.settings.dd || {};
        A.settings.dd[k] = d.open;
        A.saveSettings();
      });
    });
  }

  // ---------- Étapes ----------
  A.setTab = function (tab, keepSheet) {
    if (!A.project) return;
    const prev = A.tab;
    A.tab = tab;
    if (prev === 'guide' && tab !== 'guide' && A.guide) A.guide.leave();
    document.querySelectorAll('.pane').forEach((s) => (s.hidden = s.dataset.pane !== tab));
    document.documentElement.classList.toggle('in-guide', tab === 'guide');
    const pane = A.panes[tab];
    if (pane && pane.show) pane.show();
    if (pane && pane.refresh) pane.refresh();
    panels.syncChrome();
    if (tab === 'guide') { if (A.guide) A.guide.enter(); }
    else if (tab === 'palette' || prev === 'palette') A.stage.fitView();
    else A.stage.onTabChange();
    if (!keepSheet) setSheet(true);
    $('panel').scrollTop = 0;
  };

  // Tiroir : sur le côté (PC, tablette en paysage) le panneau rentre et laisse une bande avec « > » ;
  // en bas (tablette en portrait, téléphone) il se replie sur son titre.
  const isSide = () => !isMobile() || (window.matchMedia && matchMedia('(orientation: landscape)').matches);
  panels.setSheet = (open) => setSheet(open);
  panels.isPanelOpen = () => sheetOpen;
  function applyDrawer() {
    const side = isSide();
    document.documentElement.classList.toggle('panel-shut', side && !sheetOpen);
    $('panel').classList.toggle('collapsed', !side && !sheetOpen);
    const b = $('drawerBtn');
    b.title = sheetOpen ? 'Rentrer le menu' : 'Afficher le menu';
    b.setAttribute('aria-expanded', String(sheetOpen));
  }
  function setSheet(open) {
    const changed = sheetOpen !== open;
    sheetOpen = open;
    applyDrawer();
    if (changed) requestAnimationFrame(() => { A.stage.resize(); if (A.guide) A.guide.resize(); });
  }

  panels.syncChrome = function () {
    if (!A.project) return;
    const has = A.hasResult();
    document.querySelectorAll('#tabs button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.tab === A.tab));
      if (b.dataset.tab === 'edit' || b.dataset.tab === 'guide') b.classList.toggle('muted', !has);
    });
    const pal = A.currentPalette();
    $('photoEmpty').hidden = !(A.tab === 'palette' && pal && !pal.photo);
    $('staleBanner').hidden = !((A.tab === 'edit' || A.tab === 'export') && A.isStale());
    $('quickbar').hidden = !(isMobile() && A.tab === 'edit' && has);
    $('coords').textContent = '';
    $('handBtn').setAttribute('aria-pressed', String(A.hand));
    applyDrawer();
    document.documentElement.classList.toggle('beta-screen', !!(A.settings.beta && A.settings.beta.screen));
    if (A.panes.edit && A.panes.edit.syncQuickbar) A.panes.edit.syncQuickbar();
  };

  panels.refresh = function () {
    if (!A.project) return;
    Object.values(A.panes).forEach((p) => { if (p.refresh) p.refresh(); });
    if (A.projects) A.projects.renderTabs();
    panels.syncChrome();
  };
  // compatibilité avec les modules qui appellent encore les anciens noms
  ['Plates', 'Palette', 'Image', 'Edit', 'Export'].forEach((n) => {
    const key = n === 'Plates' ? 'plates' : n.toLowerCase();
    panels['refresh' + n] = () => { const p = A.panes[key]; if (p && p.refresh) p.refresh(); };
  });
  panels.refreshImageInfo = () => { const p = A.panes.image; if (p && p.refreshInfo) p.refreshInfo(); };
  panels.refreshGuidePane = () => { const p = A.panes.guide; if (p && p.refresh) p.refresh(); };

  // ---------- Initialisation ----------
  panels.init = function () {
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      if (b.dataset.tab === A.tab) { setSheet(!sheetOpen); return; }
      A.setTab(b.dataset.tab);
    });
    $('sheetHandle').addEventListener('click', () => setSheet(!sheetOpen));
    $('drawerBtn').addEventListener('click', (e) => { e.stopPropagation(); setSheet(!sheetOpen); });
    // panneau rentré : toute la bande ouvre le menu
    $('panel').addEventListener('click', () => { if (document.documentElement.classList.contains('panel-shut')) setSheet(true); });
    window.addEventListener('resize', U.debounce(() => { applyDrawer(); A.stage.resize(); if (A.guide) A.guide.resize(); }, 120));
    $('uiToggle').addEventListener('click', () => {
      A.settings.ui = A.uiMode() === 'mobile' ? 'desktop' : 'mobile';
      A.saveSettings();
      A.applyUI();
    });
    $('settingsBtn').addEventListener('click', openSettings);
    $('zoomIn').addEventListener('click', () => A.stage.zoomBy(1.25));
    $('zoomOut').addEventListener('click', () => A.stage.zoomBy(0.8));
    $('zoomFit').addEventListener('click', () => A.stage.fitView());
    $('handBtn').addEventListener('click', () => { A.hand = !A.hand; panels.syncChrome(); A.stage.updateCursor(); });
    $('staleConvert').addEventListener('click', () => A.runConversion());
    initDropdowns();
    Object.values(A.panes).forEach((p) => { if (p.init) p.init(); });
    if (PP.detect) PP.detect.init(); // détection automatique et nuancier (étape Palette)
    if (A.projects) A.projects.init();
  };

  // ---------- Paramètres ----------
  async function openSettings() {
    const persisted = await PP.db.persisted();
    const est = await PP.db.estimate();
    const s = A.settings;
    s.beta = s.beta || { screen: false };
    const body = document.createElement('div');
    body.style.display = 'contents';
    body.innerHTML =
      '<div class="field"><span class="label">Interface</span><div class="seg" id="setUI"><button type="button" data-v="auto">Automatique</button><button type="button" data-v="desktop">PC</button><button type="button" data-v="mobile">Tablette</button></div></div>' +
      '<div class="field"><span class="label">Thème</span><div class="seg" id="setTheme"><button type="button" data-v="system">Système</button><button type="button" data-v="light">Clair</button><button type="button" data-v="dark">Sombre</button></div></div>' +
      '<label class="field"><span class="label">Espace libre autour des plaques (picots)</span><input type="number" id="setMargin" min="10" max="300" value="' + (s.margin | 0) + '"></label>' +
      '<div class="group"><div class="group-head"><h3>Stockage</h3></div>' +
      '<p class="hint">' + (PP.db.available ? 'Projets et palettes sont enregistrés dans ce navigateur' + (est && est.usage ? ' (' + (est.usage / 1048576).toFixed(1) + ' Mo)' : '') + '.' : 'Le stockage du navigateur est indisponible : vos données seront perdues à la fermeture.') + ' Pour garder un projet en lieu sûr : <b>Export › Sauvegarde du projet</b>.</p>' +
      '<p class="hint" id="persistInfo">' + (persisted ? 'Protection activée : le navigateur ne videra pas ces données de lui-même.' : 'Sur iPad, Safari peut effacer les données d’un site qu’on n’ouvre plus : ajoutez l’application à l’écran d’accueil, et activez la protection.') + '</p>' +
      '<div class="btn-row">' + (persisted ? '' : '<button class="btn btn-sm" type="button" id="setPersist">Protéger mes données</button>') +
      '<button class="btn btn-sm" type="button" id="setBackup"><svg class="ic"><use href="#i-export"/></svg>Sauvegarde complète</button>' +
      '<button class="btn btn-sm" type="button" id="setRestore"><svg class="ic"><use href="#i-upload"/></svg>Restaurer</button></div>' +
      '<p class="hint">La sauvegarde complète réunit tous les projets et toutes les palettes dans un fichier, pour changer d’appareil.</p></div>' +
      '<div class="group"><div class="group-head"><h3>Bêta</h3></div>' +
      '<label class="check"><input type="checkbox" id="setBetaScreen"' + (s.beta.screen ? ' checked' : '') + '><span>Pose sur l’écran : la plaque transparente posée sur la tablette, calée au picot près</span></label>' +
      '<p class="hint">Ajoute le bouton « Poser sur l’écran » dans la pose guidée. Demande un calage de l’écran la première fois.</p></div>' +
      '<div class="group desktop-only"><div class="group-head"><h3>Raccourcis clavier</h3></div><dl class="kbd-list">' +
      '<dt>1 … 6</dt><dd>Changer d’étape</dd><dt>Molette · + / −</dt><dd>Zoomer</dd><dt>0</dt><dd>Tout afficher</dd>' +
      '<dt>Espace + glisser</dt><dd>Déplacer la vue</dd>' +
      '<dt>Flèches (Maj : ×10)</dt><dd>Déplacer la plaque ou l’image</dd><dt>Suppr</dt><dd>Supprimer la plaque sélectionnée</dd>' +
      '<dt>R · Maj+R</dt><dd>Pivoter l’image</dd><dt>F · Maj+F</dt><dd>Miroir de l’image</dd>' +
      '<dt>B · E · I · G · H</dt><dd>Pinceau, gomme, pipette, remplissage, main</dd><dt>[ · ]</dt><dd>Taille du pinceau</dd>' +
      '<dt>Ctrl+Z · Ctrl+Y</dt><dd>Annuler, rétablir</dd><dt>Ctrl+Entrée</dt><dd>Lancer la conversion</dd>' +
      '<dt>← → · Espace</dt><dd>Pose guidée : bloc précédent / suivant, bloc posé</dd></dl></div>' +
      '<div class="group"><div class="group-head"><h3>Zone sensible</h3></div><div class="btn-row"><button class="btn btn-sm" type="button" id="setReset" style="color:var(--danger)">Tout effacer</button></div></div>' +
      '<p class="about">Version ' + A.APP_VERSION + ' - Leroy Aurélien - 2026 - Tous droits réservés - Réalisé avec IA</p>';
    A.modal({
      title: 'Paramètres', body,
      onOpen: (b, close) => {
        const uiEl = b.querySelector('#setUI'), th = b.querySelector('#setTheme');
        ui.setSeg(uiEl, s.ui); ui.setSeg(th, s.theme);
        ui.bindSeg(uiEl, (v) => { s.ui = v; ui.setSeg(uiEl, v); A.saveSettings(); A.applyUI(); });
        ui.bindSeg(th, (v) => { s.theme = v; ui.setSeg(th, v); A.saveSettings(); A.applyTheme(); });
        b.querySelector('#setMargin').addEventListener('change', (e) => { s.margin = U.clamp(e.target.value | 0 || 50, 10, 300); e.target.value = s.margin; A.saveSettings(); A.redraw(); });
        b.querySelector('#setBetaScreen').addEventListener('change', (e) => { s.beta.screen = e.target.checked; A.saveSettings(); panels.syncChrome(); });
        const pb = b.querySelector('#setPersist');
        if (pb) pb.addEventListener('click', async () => {
          const ok = await PP.db.persist();
          b.querySelector('#persistInfo').textContent = ok ? 'Protection activée.' : 'Le navigateur a refusé. Installer l’application sur l’écran d’accueil aide souvent ; gardez vos sauvegardes.';
          if (ok) pb.remove();
        });
        b.querySelector('#setBackup').addEventListener('click', () => A.exportBackup());
        b.querySelector('#setRestore').addEventListener('click', async () => {
          const f = await PP.files.pickFile('.json,application/json,.png,image/png');
          if (f) { close(); await A.openFile(f); }
        });
        b.querySelector('#setReset').addEventListener('click', async () => {
          close();
          if (await A.confirm('Effacer tous les projets, palettes et réglages de ce navigateur ? Cette action est définitive.', 'Tout effacer', true)) A.resetAll();
        });
      },
    });
  }
  panels.openSettings = openSettings;
})();
