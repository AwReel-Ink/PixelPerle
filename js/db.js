/* Pixel Perles — stockage IndexedDB (projets, palettes, réglages) avec repli en mémoire */
(function () {
  'use strict';
  const PP = (window.PP = window.PP || {});
  const DB_NAME = 'pixel-perles';
  const DB_VERSION = 1;
  const STORES = ['projects', 'palettes', 'meta'];

  let dbp = null;
  let memory = null; // repli si IndexedDB est indisponible

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('palettes')) db.createObjectStore('palettes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    }).then((db) => {
      if (!db) {
        memory = { projects: new Map(), palettes: new Map(), meta: new Map() };
      }
      return db;
    });
    return dbp;
  }

  function reqP(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction annulée'));
    });
  }

  const keyOf = (store, v) => (store === 'meta' ? v.key : v.id);

  const api = {
    get available() { return !memory; },
    async ready() { await open(); return !memory; },
    async getAll(store) {
      const db = await open();
      if (!db) return Array.from(memory[store].values());
      return tx(store, 'readonly', (s) => reqP(s.getAll()));
    },
    async get(store, key) {
      const db = await open();
      if (!db) return memory[store].get(key) || null;
      return tx(store, 'readonly', (s) => reqP(s.get(key))).then((r) => r || null);
    },
    async put(store, value) {
      const db = await open();
      if (!db) { memory[store].set(keyOf(store, value), value); return; }
      return tx(store, 'readwrite', (s) => reqP(s.put(value)));
    },
    async del(store, key) {
      const db = await open();
      if (!db) { memory[store].delete(key); return; }
      return tx(store, 'readwrite', (s) => reqP(s.delete(key)));
    },
    async clearAll() {
      const db = await open();
      if (!db) { STORES.forEach((s) => memory[s].clear()); return; }
      for (const st of STORES) await tx(st, 'readwrite', (s) => reqP(s.clear()));
    },
    async getMeta(key, def) {
      const r = await api.get('meta', key);
      return r ? r.value : def;
    },
    async setMeta(key, value) {
      return api.put('meta', { key, value });
    },
    async persist() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          if (await navigator.storage.persisted()) return true;
          return await navigator.storage.persist();
        }
      } catch (e) { /* ignore */ }
      return false;
    },
    async persisted() {
      try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; }
      catch (e) { return false; }
    },
    async estimate() {
      try { return navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; }
      catch (e) { return null; }
    },
  };

  PP.db = api;
})();
