/* Pixel Perles v3 — étape Plateau : modèles de plaques, « Mes plaques », plaques du projet */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const P = () => A.project;
  const ui = A.ui;

  function fillModels() {
    const sel = $('plateType');
    const all = A.plateModels();
    const std = all.filter((m) => !m.mine), mine = all.filter((m) => m.mine);
    sel.innerHTML = '<optgroup label="Plaques du commerce">' + std.map((p) => '<option value="' + p.id + '">' + esc(p.label) + '</option>').join('') + '</optgroup>' +
      (mine.length ? '<optgroup label="Mes plaques">' + mine.map((p) => '<option value="' + p.id + '">' + esc(p.label) + ' (' + p.w + ' × ' + p.h + ')</option>').join('') + '</optgroup>' : '');
    if (!all.some((m) => m.id === A.settings.plateType)) A.settings.plateType = std[0].id;
    sel.value = A.settings.plateType;
    $('myList').innerHTML = mine.length ? mine.map((m) => '<li data-id="' + m.id + '"><span class="grow"><b>' + esc(m.label) + '</b><br><span class="meta">' + m.w + ' × ' + m.h + ' picots · ' + String(m.pitch).replace('.', ',') + ' mm</span></span>' +
      '<button class="icon-btn danger" type="button" data-act="del" title="Retirer de Mes plaques"><svg class="ic"><use href="#i-trash"/></svg></button></li>').join('') : '';
  }

  function refreshPlateType() {
    const s = A.currentPlateSpec();
    const pr = A.presetById(A.settings.plateType);
    $('plateTypeInfo').textContent = (pr.note ? pr.note + ' ' : '') + U.fmtInt(s.w * s.h) + ' picots, ≈ ' + ui.cm(s.w, s.pitch) + ' × ' + ui.cm(s.h, s.pitch) + ' cm une fois repassée.';
  }

  function markSelected(list) {
    list.querySelectorAll('li').forEach((li) => li.classList.toggle('selected', li.dataset.id === A.sel));
  }

  function init() {
    $('plateType').addEventListener('change', (e) => { A.settings.plateType = e.target.value; A.saveSettings(); refreshPlateType(); });
    $('addPlate').addEventListener('click', () => {
      const p = A.addPlate();
      refresh();
      A.stage.fitView();
      A.toast(p.name + ' ajoutée (' + p.w + ' × ' + p.h + ').');
    });
    $('addGrid').addEventListener('click', () => {
      const c = U.clamp($('gridCols').value | 0, 1, 10), r = U.clamp($('gridRows').value | 0, 1, 10);
      A.addPlateGrid(c, r);
      refresh();
      A.stage.fitView();
    });
    $('mySave').addEventListener('click', () => {
      const w = U.clamp($('myW').value | 0, 2, 400), h = U.clamp($('myH').value | 0, 2, 400);
      const pitch = U.clamp(parseFloat(String($('myPitch').value).replace(',', '.')) || 2.6, 1, 10);
      const name = $('myName').value.trim() || ('Ma plaque ' + w + ' × ' + h);
      const m = A.saveMyPlate({ w, h, pitch, name });
      $('myName').value = '';
      fillModels();
      refreshPlateType();
      A.toast('« ' + m.label + ' » ajoutée à Mes plaques et choisie comme modèle.');
    });
    $('myList').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act=del]');
      if (!b) return;
      const id = b.closest('li').dataset.id;
      const m = A.presetById(id);
      if (await A.confirm('Retirer « ' + m.label + ' » de Mes plaques ? Les plaques déjà posées dans vos projets ne changent pas.', 'Retirer', true)) {
        A.deleteMyPlate(id);
        fillModels();
        refreshPlateType();
      }
    });
    $('snapToggle').addEventListener('change', (e) => { A.settings.snap = e.target.checked; A.saveSettings(); });

    const list = $('plateList');
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      const id = li.dataset.id;
      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'dup') { A.duplicatePlate(id); refresh(); A.stage.fitView(); }
        if (act.dataset.act === 'del') {
          const pl = A.plateById(id);
          A.confirm('Supprimer la plaque « ' + pl.name + ' » ?', 'Supprimer', true).then((ok) => {
            if (ok) { A.deletePlate(id); A.panels.refresh(); }
          });
        }
        return;
      }
      A.sel = id;
      markSelected(list);
      if (e.target.tagName === 'INPUT') { A.redraw(); return; }
      A.stage.centerOnPlate(id);
    });
    list.addEventListener('input', (e) => {
      if (!e.target.matches('input[data-name]')) return;
      const pl = A.plateById(e.target.closest('li').dataset.id);
      const v = e.target.value.trim();
      if (pl && v) { pl.name = v.slice(0, 24); A.touch(); }
    });
  }

  function refresh() {
    if (!A.project) return;
    fillModels();
    refreshPlateType();
    $('snapToggle').checked = !!A.settings.snap;
    const list = $('plateList');
    const active = document.activeElement;
    const editing = active && active.matches && active.matches('#plateList input');
    if (!editing) {
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
    $('plateSummary').textContent = U.fmtInt(total) + ' picots au total · encombrement ' + bb.w + ' × ' + bb.h + ' picots (≈ ' + ui.cm(bb.w, pitch) + ' × ' + ui.cm(bb.h, pitch) + ' cm).';
  }

  A.panes.plates = { init, refresh };
})();
