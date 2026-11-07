/* Pixel Perles v3 — étape Image : import, placement, réglages (menu déroulant), conversion */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const P = () => A.project;
  const ui = A.ui;
  const ADJ = [['adjBrightness', 'brightness'], ['adjContrast', 'contrast'], ['adjSaturation', 'saturation']];

  function init() {
    const pick = (capture) => PP.files.pickFile('image/*', capture).then((f) => A.setImageFile(f));
    $('imgLoad').addEventListener('click', () => pick());
    $('imgCamera').addEventListener('click', () => pick('environment'));
    $('imgRotL').addEventListener('click', () => { A.rotateImage(-1); refreshInfo(); });
    $('imgRotR').addEventListener('click', () => { A.rotateImage(1); refreshInfo(); });
    $('imgFlipH').addEventListener('click', () => { if (P().image) { P().image.flipH = !P().image.flipH; A.touch(); } });
    $('imgFlipV').addEventListener('click', () => { if (P().image) { P().image.flipV = !P().image.flipV; A.touch(); } });
    $('imgFit').addEventListener('click', () => { A.fitImage(); A.touch(); refreshInfo(); A.stage.fitView(); });
    $('imgDel').addEventListener('click', async () => {
      if (!(await A.confirm('Retirer l’image de ce projet ?', 'Retirer', true))) return;
      P().image = null; A.imgSrc = null; A.imgAdj = null;
      A.touch();
      refresh();
    });
    $('imgOpacity').addEventListener('input', (e) => {
      P().disp.opacity = +e.target.value;
      $('imgOpacityOut').textContent = e.target.value + ' %';
      A.touch();
    });
    ADJ.forEach(([id, key]) => {
      $(id).addEventListener('input', (e) => {
        P().adjust[key] = +e.target.value;
        $(id + 'Out').textContent = (e.target.value > 0 ? '+' : '') + e.target.value;
        A.refreshAdjusted();
        A.touch();
        adjNote();
      });
    });
    $('adjReset').addEventListener('click', () => {
      P().adjust = { brightness: 0, contrast: 0, saturation: 0 };
      A.refreshAdjusted();
      A.touch();
      refresh();
    });
    $('convPalette').addEventListener('change', (e) => { P().conv.paletteId = e.target.value; A.touch(); refreshConv(); });
    $('convStep').addEventListener('change', (e) => { P().conv.step = +e.target.value; A.touch(); refreshConv(); });
    $('convDominant').addEventListener('change', (e) => { P().conv.dominant = e.target.checked; A.touch(); refreshConv(); });
    $('convOutline').addEventListener('change', (e) => { P().conv.outline = e.target.checked; A.touch(); });
    $('convertBtn').addEventListener('click', () => A.runConversion());
    ui.bindSeg($('convKind'), (v) => { P().conv.kind = v; A.touch(); refreshConv(); });
    $('stockBtn').addEventListener('click', () => A.palUi.openStock(A.convPalette()));
  }

  function adjNote() {
    const a = P().adjust;
    const n = ADJ.filter(([, k]) => a[k]).length;
    $('adjNote').textContent = n ? n + ' réglage' + (n > 1 ? 's' : '') : '';
  }

  function refreshConv() {
    const c = P().conv;
    $('convStep').value = String([5, 10, 20, 25].includes(c.step) ? c.step : 10);
    $('convDominant').checked = !!c.dominant;
    $('convOutline').checked = !!c.outline;
    const n = A.compare.variantCount();
    $('convertLabel').textContent = (n + 1) + ' rendus calculés et comparés côte à côte';
    ui.setSeg($('convKind'), c.kind || 'auto');
    let out = '';
    if ((c.kind || 'auto') === 'auto' && A.imgAdj) {
      try { out = A.auto.classify(A.imgAdj).kind === 'photo' ? '· reconnue : photo' : '· reconnue : dessin'; } catch (e) { out = ''; }
    }
    $('convKindOut').textContent = out;
    A.palUi.refreshStockSummary();
    A.palUi.fillPaletteSelects();
  }

  function refresh() {
    if (!A.project) return;
    const im = P().image;
    $('imgTools').hidden = !im;
    $('adjustGroup').hidden = !im;
    $('imgLoadLabel').textContent = im ? 'Remplacer l’image' : 'Importer une image';
    $('imgOpacity').value = P().disp.opacity;
    $('imgOpacityOut').textContent = P().disp.opacity + ' %';
    ADJ.forEach(([id, key]) => {
      const v = P().adjust[key] || 0;
      $(id).value = v;
      $(id + 'Out').textContent = (v > 0 ? '+' : '') + v;
    });
    adjNote();
    refreshInfo();
    refreshConv();
  }

  function refreshInfo() {
    const im = P() && P().image;
    if (!im) { $('imgInfo').textContent = ''; return; }
    const d = PP.geo.imgDims(im);
    const pitch = P().plates[0] ? P().plates[0].pitch : 2.6;
    $('imgInfo').textContent = 'Image : ' + Math.round(d.w) + ' × ' + Math.round(d.h) + ' picots (≈ ' + ui.cm(d.w, pitch) + ' × ' + ui.cm(d.h, pitch) + ' cm) · source ' + im.nw + ' × ' + im.nh + ' px.';
  }

  A.panes.image = { init, refresh, refreshInfo };
})();
