/* Pixel Perles v3 — projets ouverts : jusqu'à 3 onglets dans la barre du haut, chacun avec son aperçu,
   son étape, sa vue et son historique d'annulation. Mes projets, nouveau projet, import. */
(function () {
  'use strict';
  const PP = window.PP;
  const U = PP.util;
  const A = PP.A;
  const $ = (id) => document.getElementById(id);
  const esc = U.escapeHtml;
  const MAX_OPEN = 3;

  const PR = (A.projects = {});
  const sessions = new Map(); // id → { project, undo, redo, color, tab, view, imgSrc, imgAdj }

  const openIds = () => (A.settings.openIds = (A.settings.openIds || []).filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_OPEN));

  // ---------- Aperçu (vignette) ----------
  function makeThumb(p, imgSrc) {
    const S = 72;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const x = c.getContext('2d');
    x.fillStyle = '#E8EBEF';
    x.fillRect(0, 0, S, S);
    try {
      if (p.result && p.plates.length) {
        const bb = PP.geo.bboxOf(p.plates);
        const k = Math.min(S / bb.w, S / bb.h);
        const ox = (S - bb.w * k) / 2, oy = (S - bb.h * k) / 2;
        const img = x.createImageData(S, S);
        const rgb = p.result.colors.map((cc) => U.hexToRgb(cc.hex) || [0, 0, 0]);
        for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
          const wx = Math.floor((px - ox) / k) + bb.x, wy = Math.floor((py - oy) / k) + bb.y;
          const pl = p.plates.find((q) => wx >= q.x && wy >= q.y && wx < q.x + q.w && wy < q.y + q.h);
          const o = (py * S + px) * 4;
          let col = [232, 235, 239];
          if (pl) {
            const g = p.result.grids[pl.id];
            const v = g ? g[(wy - pl.y) * pl.w + (wx - pl.x)] : -1;
            col = v >= 0 && rgb[v] ? rgb[v] : [223, 225, 229];
          }
          img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
        }
        x.putImageData(img, 0, 0);
      } else if (imgSrc) {
        const k = Math.max(S / imgSrc.width, S / imgSrc.height);
        x.drawImage(imgSrc, (S - imgSrc.width * k) / 2, (S - imgSrc.height * k) / 2, imgSrc.width * k, imgSrc.height * k);
      }
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }
  PR.refreshThumb = U.debounce(() => {
    if (!A.project) return;
    const t = makeThumb(A.project, A.imgSrc);
    if (t && t !== A.project.thumb) { A.project.thumb = t; A.saveProject(); renderTabs(); }
  }, 1500);

  // ---------- Onglets ----------
  function renderTabs() {
    const ids = openIds();
    const nav = $('projTabs');
    nav.innerHTML = ids.map((id) => {
      const s = sessions.get(id);
      const p = s ? s.project : null;
      const name = p ? p.name : '…';
      const cur = A.project && A.project.id === id;
      return '<div class="ptab' + (cur ? ' cur' : '') + '" data-id="' + id + '" role="tab" aria-selected="' + cur + '" title="' + esc(name) + '">' +
        '<button class="ptab-main" type="button" data-a="go">' + (p && p.thumb ? '<img alt="" src="' + p.thumb + '">' : '<span class="ptab-ph"></span>') +
        '<span class="ptab-name">' + esc(name) + '</span></button>' +
        '<button class="ptab-x" type="button" data-a="close" title="Fermer l’onglet (le projet reste dans « Mes projets »)"><svg class="ic"><use href="#i-close"/></svg></button></div>';
    }).join('');
    $('projAdd').hidden = false;
  }
  PR.renderTabs = renderTabs;

  // ---------- Ouverture et bascule ----------
  function stash() {
    if (!A.project) return;
    const s = sessions.get(A.project.id) || {};
    Object.assign(s, {
      project: A.project, undo: A.edit.undo, redo: A.edit.redo, color: A.edit.color, tab: A.tab,
      view: A.stage.getView(), imgSrc: A.imgSrc, imgAdj: A.imgAdj,
    });
    sessions.set(A.project.id, s);
  }

  async function load(id) {
    const s = sessions.get(id);
    if (s && s.project) return s.project;
    const p = await PP.db.get('projects', id);
    if (!p) return null;
    const q = A.normalizeProject(p);
    sessions.set(id, Object.assign(sessions.get(id) || {}, { project: q }));
    return q;
  }

  async function activate(id) {
    if (A.compare && A.compare.isOpen()) A.compare.close();
    if (A.project && A.project.id !== id) { await A.saveProjectNow(); stash(); }
    const p = await load(id);
    if (!p) return false;
    const s = sessions.get(id) || {};
    A.project = p;
    A.sel = null;
    A.edit.undo = s.undo || [];
    A.edit.redo = s.redo || [];
    A.edit.color = s.color || 0;
    A.plateCache.clear();
    A.settings.lastProject = id;
    A.saveSettings();
    if (s.imgSrc) { A.imgSrc = s.imgSrc; A.imgAdj = s.imgAdj; }
    else await A.loadImageCanvas();
    if (!p.thumb) { p.thumb = makeThumb(p, A.imgSrc); }
    renderTabs();
    A.panels.refresh();
    A.setTab(s.tab || 'plates', true);
    if (s.view) A.stage.setView(s.view); else A.stage.fitView();
    return true;
  }

  /** Ouvre un projet dans un onglet ; si les 3 sont pris, demande lequel remplacer. */
  PR.open = async function (id, proj) {
    if (proj) sessions.set(id, Object.assign(sessions.get(id) || {}, { project: proj }));
    const ids = openIds();
    if (!ids.includes(id)) {
      if (ids.length >= MAX_OPEN) {
        const out = await chooseSlot();
        if (!out) return false;
        const k = ids.indexOf(out);
        if (A.project && A.project.id === out) { await A.saveProjectNow(); stash(); }
        sessions.delete(out);
        ids[k] = id;
      } else ids.push(id);
      A.settings.openIds = ids;
      A.saveSettings();
    }
    return activate(id);
  };
  PR.switchTo = (id) => activate(id);
  PR.preload = async function () { for (const id of openIds()) { try { await load(id); } catch (e) { /* ignore */ } } };
  PR.isOpen = (id) => openIds().includes(id);

  PR.close = async function (id) {
    const ids = openIds();
    const k = ids.indexOf(id);
    if (k < 0) return;
    if (A.project && A.project.id === id) await A.saveProjectNow();
    ids.splice(k, 1);
    sessions.delete(id);
    A.settings.openIds = ids;
    A.saveSettings();
    if (A.project && A.project.id === id) {
      A.project = null;
      if (ids.length) await activate(ids[Math.max(0, k - 1)]);
      else {
        const all = await A.listProjects();
        const other = all.find((p) => p.id !== id);
        if (other) await PR.open(other.id);
        else await A.createProject('Nouveau projet');
      }
    } else renderTabs();
  };

  /** Oublie un projet supprimé. */
  PR.forget = function (id) {
    sessions.delete(id);
    A.settings.openIds = openIds().filter((x) => x !== id);
    A.saveSettings();
  };

  // ---------- Choix de l'onglet à remplacer ----------
  function chooseSlot() {
    const body = document.createElement('div');
    body.style.display = 'contents';
    body.innerHTML = '<p class="hint">Trois projets sont déjà ouverts. Lequel voulez-vous fermer pour faire de la place ? Il restera dans « Mes projets ».</p>' +
      '<div class="slot-grid">' + openIds().map((id) => {
        const p = (sessions.get(id) || {}).project;
        return '<button class="slot-card" type="button" data-id="' + id + '">' +
          (p && p.thumb ? '<img alt="" src="' + p.thumb + '">' : '<span class="ptab-ph big"></span>') +
          '<b>' + esc(p ? p.name : 'Projet') + '</b><span class="hint">Remplacer</span></button>';
      }).join('') + '</div>';
    return new Promise((resolve) => {
      let picked = null;
      A.modal({
        title: 'Remplacer quel projet ?', body,
        actions: [{ label: 'Annuler', value: null, kind: 'ghost' }],
        onOpen: (b, close) => {
          b.addEventListener('click', (e) => {
            const c = e.target.closest('.slot-card');
            if (c) { picked = c.dataset.id; close(); }
          });
        },
      }).then(() => resolve(picked));
    });
  }

  // ---------- Menu « + » : nouveau, Mes projets, importer ----------
  PR.menu = async function () {
    const list = await A.listProjects();
    const body = document.createElement('div');
    body.style.display = 'contents';
    const ids = openIds();
    body.innerHTML =
      '<div class="btn-row">' +
      '<button class="btn btn-primary" type="button" data-a="new"><svg class="ic"><use href="#i-plus"/></svg>Nouveau projet</button>' +
      '<button class="btn" type="button" data-a="import"><svg class="ic"><use href="#i-upload"/></svg>Importer une sauvegarde</button>' +
      '</div>' +
      '<h3 class="modal-sub">Mes projets</h3>' +
      '<ul class="proj-list">' + list.map((p) => {
        const open = ids.includes(p.id);
        return '<li data-id="' + p.id + '"' + (A.project && p.id === A.project.id ? ' class="current"' : '') + '>' +
          (p.thumb ? '<img class="p-thumb" alt="" src="' + p.thumb + '">' : '<span class="p-thumb ptab-ph"></span>') +
          '<span class="p-name">' + esc(p.name) + '<small>' + new Date(p.updated || p.created || Date.now()).toLocaleDateString('fr-FR') + (open ? ' · ouvert' : '') + '</small></span>' +
          (A.project && p.id === A.project.id ? '' : '<button class="btn btn-sm" type="button" data-a="open">' + (open ? 'Afficher' : 'Ouvrir') + '</button>') +
          '<button class="icon-btn" type="button" data-a="rename" title="Renommer"><svg class="ic"><use href="#i-brush"/></svg></button>' +
          '<button class="icon-btn" type="button" data-a="dup" title="Dupliquer"><svg class="ic"><use href="#i-copy"/></svg></button>' +
          '<button class="icon-btn danger" type="button" data-a="del" title="Supprimer"><svg class="ic"><use href="#i-trash"/></svg></button>' +
          '</li>';
      }).join('') + '</ul>';
    A.modal({
      title: 'Projets', body,
      onOpen: (b, close) => {
        b.addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-a]');
          if (!btn) return;
          const li = btn.closest('li[data-id]');
          const a = btn.dataset.a;
          const pr = li && list.find((x) => x.id === li.dataset.id);
          if (a === 'new') {
            close();
            const name = await A.promptText('Nouveau projet', 'Nom du projet', 'Mon modèle', 'Créer');
            if (name) await A.createProject(name);
          } else if (a === 'import') {
            const f = await PP.files.pickFile('.png,image/png,.json,application/json');
            if (f) { close(); await A.openFile(f); }
          } else if (a === 'open' && pr) {
            close();
            await PR.open(pr.id);
          } else if (a === 'rename' && pr) {
            close();
            await PR.rename(pr.id);
          } else if (a === 'dup' && pr) {
            close();
            if (A.project && A.project.id !== pr.id) await PR.open(pr.id);
            await A.duplicateProject();
          } else if (a === 'del' && pr) {
            close();
            if (await A.confirm('Supprimer définitivement le projet « ' + pr.name + ' » ?', 'Supprimer', true)) {
              await A.deleteProject(pr.id);
              A.toast('Projet supprimé.');
            }
          }
        });
      },
    });
  };

  PR.rename = async function (id) {
    const p = await load(id);
    if (!p) return;
    const name = await A.promptText('Renommer le projet', 'Nom du projet', p.name, 'Renommer');
    if (!name) return;
    p.name = name;
    p.updated = Date.now();
    if (A.project && A.project.id === id) A.touch();
    else await PP.db.put('projects', await A.storableProject(p));
    renderTabs();
  };

  // ---------- Branchements ----------
  PR.init = function () {
    $('projAdd').addEventListener('click', () => PR.menu());
    $('projTabs').addEventListener('click', async (e) => {
      const tab = e.target.closest('.ptab');
      if (!tab) return;
      const a = e.target.closest('[data-a]');
      if (a && a.dataset.a === 'close') { await PR.close(tab.dataset.id); return; }
      if (A.project && A.project.id === tab.dataset.id) { PR.rename(tab.dataset.id); return; }
      await activate(tab.dataset.id);
    });
  };

  // les fonctions du cœur passent par les onglets
  A.setProject = async function (p) {
    sessions.set(p.id, Object.assign(sessions.get(p.id) || {}, { project: p, undo: [], redo: [], view: null, imgSrc: null, imgAdj: null, tab: null }));
    return PR.open(p.id, p);
  };
  const del = A.deleteProject;
  A.deleteProject = async function (id) {
    await PP.db.del('projects', id);
    const wasOpen = openIds().includes(id);
    const wasCur = A.project && A.project.id === id;
    PR.forget(id);
    if (wasCur) {
      A.project = null;
      const ids = openIds();
      if (ids.length) await activate(ids[0]);
      else {
        const rest = await A.listProjects();
        if (rest.length) await PR.open(rest[0].id);
        else await A.createProject('Nouveau projet');
      }
    } else if (wasOpen) renderTabs();
    void del;
  };
})();
