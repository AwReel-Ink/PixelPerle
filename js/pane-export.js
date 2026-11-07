/* Pixel Perles v3 — étape Export : images des plaques (ZIP avec la vue d'ensemble), sauvegarde et import du projet */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const P = () => A.project;
  const ui = A.ui;

  function init() {
    ui.bindSeg($('expBg'), (v) => { P().exp.bg = v; A.touch(); refresh(); });
    ui.bindSeg($('expStyle'), (v) => { P().exp.style = v; A.touch(); refresh(); });
    [['expCodes', 'codes'], ['expGuides', 'guides'], ['expLabels4', 'labels4']].forEach(([id, key]) => {
      $(id).addEventListener('change', (e) => { P().exp[key] = e.target.checked; A.touch(); });
    });
    $('expMinSide').addEventListener('change', (e) => {
      P().exp.minSide = U.clamp(e.target.value | 0 || 4320, 1000, 10000);
      e.target.value = P().exp.minSide;
      A.touch();
      refresh();
    });
    $('expList').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (!li) return;
      if (e.target.closest('[data-act=png]')) { exportPlates([A.plateById(li.dataset.id)], false); return; }
      A.sel = li.dataset.id;
      refresh();
      A.stage.centerOnPlate(li.dataset.id);
    });
    $('expAll').addEventListener('click', () => exportPlates(P().plates, true));
    $('saveImg').addEventListener('click', () => A.saveProjectImage(false));
    $('shareImg').addEventListener('click', () => A.saveProjectImage(true));
    $('importBtn').addEventListener('click', async () => {
      const f = await PP.files.pickFile('.png,image/png,.json,application/json');
      if (f) await A.openFile(f);
    });
  }

  function refresh() {
    if (!A.project) return;
    const has = A.hasResult();
    $('exportEmpty').hidden = has;
    $('exportBody').hidden = !has;
    const fs = P().fileSaved;
    $('saveLast').textContent = fs ? 'Dernière sauvegarde de ce projet : ' + new Date(fs).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) + '.' : 'Ce projet n’a pas encore de sauvegarde.';
    if (!has) return;
    const e = P().exp;
    ui.setSeg($('expBg'), e.bg);
    ui.setSeg($('expStyle'), e.style);
    $('expCodes').checked = e.codes;
    $('expGuides').checked = e.guides;
    $('expLabels4').checked = e.labels4;
    $('expMinSide').value = e.minSide;
    $('expNote').textContent = (e.bg === 'transparent' ? 'transparent' : 'fond blanc') + ' · ' + (e.style === 'bead' ? 'perles' : 'cases') + ' · ' + e.minSide + ' px';
    const r = P().result;
    $('expList').innerHTML = P().plates.map((p) => {
      const g = r.grids[p.id];
      const u = g ? PP.render.usage(g, r.colors.length) : null;
      const nc = u ? u.counts.reduce((n, v) => n + (v > 0 ? 1 : 0), 0) : 0;
      const nb = u ? p.w * p.h - u.empty : 0;
      return '<li data-id="' + p.id + '"' + (p.id === A.sel ? ' class="selected"' : '') + '>' +
        '<span class="grow"><b>' + esc(p.name) + '</b><br><span class="meta">' + p.w + '×' + p.h + ' · ' + nc + ' coul. · ' + U.fmtInt(nb) + ' perles</span></span>' +
        '<button class="btn btn-sm" type="button" data-act="png"><svg class="ic"><use href="#i-export"/></svg>PNG</button></li>';
    }).join('');
  }

  function exportMeta(index, total) {
    return { project: P().name, date: new Date().toLocaleDateString('fr-FR'), index, total };
  }

  let exporting = false;
  async function exportPlates(plates, zip) {
    if (exporting || !plates.length) return;
    exporting = true;
    const r = P().result;
    const o = P().exp;
    const files = [];
    const status = $('expStatus');
    $('expAll').disabled = true;
    const steps = plates.length + (zip ? 1 : 0);
    try {
      for (let k = 0; k < plates.length; k++) {
        const p = plates[k];
        let g = r.grids[p.id];
        if (!g || g.length !== p.w * p.h) g = new Int16Array(p.w * p.h).fill(-1);
        const idx = P().plates.indexOf(p) + 1;
        const lay = PP.render.plateLayout(p, g, r.colors, o, exportMeta(idx, P().plates.length));
        status.textContent = 'Préparation de ' + p.name + ' (' + lay.width + ' × ' + lay.height + ' px)…';
        const blob = await PP.files.encodePNG(lay.width, lay.height, lay.draw, (f) => A.panels.setProgress('expProgress', (k + f) / steps));
        files.push({ name: U.safeFileName(P().name) + '_' + String(idx).padStart(2, '0') + '_' + U.safeFileName(p.name) + '.png', data: blob });
      }
      if (zip) {
        const lay = PP.render.overviewLayout(P().plates, r.grids, r.colors, o, exportMeta(0, P().plates.length));
        status.textContent = 'Préparation de la vue d’ensemble…';
        const blob = await PP.files.encodePNG(lay.width, lay.height, lay.draw, (f) => A.panels.setProgress('expProgress', (plates.length + f) / steps));
        files.unshift({ name: U.safeFileName(P().name) + '_00_vue-ensemble.png', data: blob });
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
      A.panels.setProgress('expProgress', null);
      $('expAll').disabled = false;
    }
  }

  A.panes.export = { init, refresh };
})();
