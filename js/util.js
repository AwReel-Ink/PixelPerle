/* Pixel Perles — utilitaires : couleurs (sRGB, CIELAB, CIEDE2000), CRC32, divers */
(function () {
  'use strict';
  const PP = (window.PP = window.PP || {});

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function debounce(fn, ms) {
    let t = null;
    const d = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
    d.flush = function () { clearTimeout(t); fn(); };
    return d;
  }

  // ---------- Couleurs ----------
  function hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function normHex(hex) {
    const rgb = hexToRgb(hex);
    return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : null;
  }
  function rgbToHex(r, g, b) {
    const t = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    return ('#' + t(r) + t(g) + t(b)).toUpperCase();
  }

  // Table sRGB(0..255) -> linéaire (0..1)
  const S2L = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linToSrgb(v) {
    v = clamp(v, 0, 1);
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return c * 255;
  }

  // Linéaire -> CIELAB (D65)
  function linToLab(r, g, b) {
    let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
    let y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
    let z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function rgbToLab(r, g, b) {
    return linToLab(S2L[r | 0], S2L[g | 0], S2L[b | 0]);
  }

  const RAD = Math.PI / 180;
  const POW25_7 = Math.pow(25, 7);
  // CIEDE2000 (kL = kC = kH = 1)
  function deltaE2000(l1, l2) {
    const L1 = l1[0], a1 = l1[1], b1 = l1[2];
    const L2 = l2[0], a2 = l2[1], b2 = l2[2];
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const Cb = (C1 + C2) / 2;
    const Cb7 = Math.pow(Cb, 7);
    const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + POW25_7)));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    let h1p = Math.atan2(b1, a1p) / RAD; if (h1p < 0) h1p += 360;
    let h2p = Math.atan2(b2, a2p) / RAD; if (h2p < 0) h2p += 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
    const Lbp = (L1 + L2) / 2;
    const Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p;
    if (C1p * C2p !== 0) {
      if (Math.abs(h1p - h2p) > 180) hbp = h2p + h1p < 360 ? (hbp + 360) / 2 : (hbp - 360) / 2;
      else hbp = hbp / 2;
    }
    const T = 1 - 0.17 * Math.cos((hbp - 30) * RAD) + 0.24 * Math.cos(2 * hbp * RAD) +
      0.32 * Math.cos((3 * hbp + 6) * RAD) - 0.2 * Math.cos((4 * hbp - 63) * RAD);
    const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Cbp7 = Math.pow(Cbp, 7);
    const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7));
    const Lb50 = (Lbp - 50) * (Lbp - 50);
    const Sl = 1 + (0.015 * Lb50) / Math.sqrt(20 + Lb50);
    const Sc = 1 + 0.045 * Cbp;
    const Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(2 * dTheta * RAD) * Rc;
    const tl = dLp / Sl, tc = dCp / Sc, th = dHp / Sh;
    return Math.sqrt(tl * tl + tc * tc + th * th + Rt * tc * th);
  }

  // Luminance relative (pour choisir texte noir/blanc)
  function relLum(r, g, b) {
    return 0.2126 * S2L[r | 0] + 0.7152 * S2L[g | 0] + 0.0722 * S2L[b | 0];
  }
  function textOn(hex) {
    const c = hexToRgb(hex) || [0, 0, 0];
    return relLum(c[0], c[1], c[2]) > 0.22 ? '#111111' : '#FFFFFF';
  }
  function shade(hex, f) {
    const c = hexToRgb(hex) || [0, 0, 0];
    return rgbToHex(c[0] * f, c[1] * f, c[2] * f);
  }

  // Lettres de colonnes façon tableur : 0 -> A, 25 -> Z, 26 -> AA
  function colLetters(i) {
    let s = '';
    i = i + 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  // Tri naturel des codes (J2 avant J10)
  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  const naturalCompare = (a, b) => collator.compare(String(a), String(b));

  // ---------- CRC32 ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8, crc) {
    let c = crc === undefined ? 0xffffffff : crc;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return c;
  }
  const crc32Final = (c) => (c ^ 0xffffffff) >>> 0;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function safeFileName(s) {
    return String(s || 'fichier').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'fichier';
  }

  const nf = new Intl.NumberFormat('fr-FR');
  const fmtInt = (n) => nf.format(Math.round(n));

  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  async function dataURLToBlob(url) {
    const r = await fetch(url);
    return r.blob();
  }

  function loadImageFromBlob(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image illisible')); };
      img.src = url;
    });
  }

  // Copie l'image dans un canvas, réduite si elle dépasse maxSide
  function imageToCanvas(img, maxSide) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const s = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  PP.util = {
    clamp, uid, debounce, hexToRgb, normHex, rgbToHex, S2L, linToSrgb, linToLab, rgbToLab,
    deltaE2000, relLum, textOn, shade, colLetters, naturalCompare, crc32, crc32Final,
    escapeHtml, safeFileName, fmtInt, blobToDataURL, dataURLToBlob, loadImageFromBlob,
    imageToCanvas, nextFrame, yieldUI,
  };
})();
