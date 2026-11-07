/* Pixel Perles v3 — étape Retouche : outils, couleur active (menu déroulant), limiter les couleurs, corrections */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const P = () => A.project;
  const ui = A.ui;
  const init = initEdit;

  function initEdit() {
    const setTool = (v) => { A.edit.tool = v; refresh(); A.stage.updateCursor(); };
    ui.bindSeg($('editTools'), setTool);
    $('quickbar').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-tool]');
      if (b) setTool(b.dataset.tool);
    });
    $('qbColor').addEventListener('click', () => { A.panels.setSheet(true); $('colorDD').open = true; });
    $('qbUndo').addEventListener('click', () => A.stage.undo(false));
    ui.bindSeg($('brushSize'), (v) => { A.edit.size = +v; refresh(); });
    $('undoBtn').addEventListener('click', () => A.stage.undo(false));
    $('redoBtn').addEventListener('click', () => A.stage.undo(true));
    $('swatchUsedOnly').addEventListener('change', (e) => { A.edit.usedOnly = e.target.checked; refreshSwatches(); });
    $('swatches').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      A.edit.color = +b.dataset.i;
      if (A.edit.tool !== 'brush' && A.edit.tool !== 'fill') A.edit.tool = 'brush';
      $('colorDD').open = false;
      refresh();
    });
    $('viewBeads').addEventListener('change', (e) => { P().disp.beads = e.target.checked; A.touch(); });
    $('viewCodes').addEventListener('change', (e) => { P().disp.codes = e.target.checked; A.touch(); });
    $('viewOverlay').addEventListener('change', (e) => { P().disp.overlay = e.target.checked; A.touch(); });
    $('replBtn').addEventListener('click', replaceColor);
    $('cleanBtn').addEventListener('click', cleanIsolated);
    $('reduceBtn').addEventListener('click', () => A.compare.openReduce());
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

  function refresh() {
    if (!A.project) return;
    const has = A.hasResult();
    $('editEmpty').hidden = has;
    $('editBody').hidden = !has;
    document.querySelector('#tabs [data-tab=edit]').classList.toggle('muted', !has);
    if (!has) { A.panels.syncChrome(); return; }
    const r = P().result;
    if (A.edit.color >= r.colors.length) A.edit.color = 0;
    ui.setSeg($('editTools'), A.edit.tool);
    ui.setSeg($('brushSize'), A.edit.size);
    $('undoBtn').disabled = !A.edit.undo.length;
    $('redoBtn').disabled = !A.edit.redo.length;
    $('swatchUsedOnly').checked = A.edit.usedOnly;
    const u = usageAll();
    refreshSwatches(u);
    const c = r.colors[A.edit.color];
    $('activeColorLabel').textContent = c ? c.code + (c.name ? ' · ' + c.name : '') + ' — ' + U.fmtInt(u.counts[A.edit.color] || 0) + ' perle' + ((u.counts[A.edit.color] || 0) > 1 ? 's' : '') : '';
    $('activeSw').style.background = c ? c.hex : 'transparent';
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
    $('reduceCount').textContent = 'Le modèle utilise ' + used.length + ' couleur' + (used.length > 1 ? 's' : '') + '.';
    $('reduceBtn').disabled = used.length <= 2;
    $('editStats').textContent = U.fmtInt(u.total) + ' perles · ' + used.length + ' couleur' + (used.length > 1 ? 's' : '') + ' · ' + U.fmtInt(u.empty) + ' picot' + (u.empty > 1 ? 's' : '') + ' vide' + (u.empty > 1 ? 's' : '') + '. Palette : ' + (r.paletteName || '—') + (r.variant ? ' · rendu ' + A.variantLabel(r.variant).toLowerCase() : '') + '.';
    A.panels.syncChrome();
    A.panels.refreshExport();
  }

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


  A.panes.edit = { init, refresh, syncQuickbar };
})();
