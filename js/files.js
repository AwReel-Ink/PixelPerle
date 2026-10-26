/* Pixel Perles — encodeur PNG par bandes (évite la limite de taille des canvas sur mobile),
   archive ZIP (sans compression) et enregistrement de fichiers */
(function () {
  'use strict';
  const PP = (window.PP = window.PP || {});
  const U = PP.util;

  const enc = new TextEncoder();

  function u32be(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }

  function pngChunk(type, data) {
    const typeBytes = enc.encode(type);
    const out = new Uint8Array(12 + data.length);
    out.set(u32be(data.length), 0);
    out.set(typeBytes, 4);
    out.set(data, 8);
    let c = U.crc32(typeBytes);
    c = U.crc32(data, c);
    out.set(u32be(U.crc32Final(c)), 8 + data.length);
    return out;
  }

  /**
   * Encode un PNG RGBA de width × height en dessinant l'image par bandes horizontales.
   * draw(ctx, y0, h) dessine la scène complète ; le contexte est déjà décalé de -y0 et
   * limité à la bande, il suffit de dessiner en coordonnées de l'image finale.
   */
  async function encodePNG(width, height, draw, onProgress) {
    width = Math.round(width); height = Math.round(height);
    if (typeof CompressionStream === 'undefined') {
      return encodeFallback(width, height, draw);
    }
    const stripH = Math.max(8, Math.min(512, Math.floor(3e6 / width)));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = stripH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const cs = new CompressionStream('deflate'); // format zlib, celui qu'attend PNG
    const writer = cs.writable.getWriter();
    const parts = [];
    const reading = (async () => {
      const reader = cs.readable.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
    })();

    const rowLen = width * 4;
    let prev = null;
    for (let y0 = 0; y0 < height; y0 += stripH) {
      const h = Math.min(stripH, height - y0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, stripH);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, width, h); ctx.clip();
      ctx.translate(0, -y0);
      draw(ctx, y0, h);
      ctx.restore();
      const data = ctx.getImageData(0, 0, width, h).data;
      const out = new Uint8Array(h * (rowLen + 1));
      for (let r = 0; r < h; r++) {
        const o = r * (rowLen + 1);
        const s = r * rowLen;
        const row = data.subarray(s, s + rowLen);
        if (!prev) {
          out[o] = 0;
          out.set(row, o + 1);
        } else {
          out[o] = 2; // filtre « Up » : très efficace sur des aplats
          for (let i = 0; i < rowLen; i++) out[o + 1 + i] = (row[i] - prev[i]) & 255;
        }
        prev = row;
      }
      await writer.write(out);
      if (onProgress) onProgress(Math.min(1, (y0 + h) / height));
      await U.yieldUI();
    }
    await writer.close();
    await reading;

    let total = 0;
    parts.forEach((p) => (total += p.length));
    const idat = new Uint8Array(total);
    let off = 0;
    parts.forEach((p) => { idat.set(p, off); off += p.length; });

    const ihdr = new Uint8Array(13);
    ihdr.set(u32be(width), 0);
    ihdr.set(u32be(height), 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return new Blob([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
  }

  function encodeFallback(width, height, draw) {
    if (width * height > 16.7e6) {
      return Promise.reject(new Error('Ce navigateur ne peut pas produire une image aussi grande. Réduisez la taille d’export dans les options.'));
    }
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    draw(ctx, 0, height);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Échec de l’encodage PNG'))), 'image/png'));
  }

  // ---------- ZIP (méthode « stockage » : les PNG sont déjà compressés) ----------
  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  async function makeZip(files) {
    const now = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(await f.data.arrayBuffer());
      const crc = U.crc32Final(U.crc32(data));
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true);
      lh.setUint16(10, now.time, true);
      lh.setUint16(12, now.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, now.time, true);
      ch.setUint16(14, now.date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    let cdSize = 0;
    central.forEach((c) => (cdSize += c.length));
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  // ---------- Enregistrement ----------
  let downloadsP = null;
  function downloadsCap() {
    if (!downloadsP) {
      downloadsP = (window.claude && typeof window.claude.use === 'function')
        ? Promise.resolve(window.claude.use('downloads')).catch(() => null)
        : Promise.resolve(null);
    }
    return downloadsP;
  }

  async function saveFile(filename, blob) {
    const dl = await downloadsCap();
    if (dl) {
      try {
        await dl.save({ filename, data: blob });
        return 'saved';
      } catch (e) {
        if (e && e.code === 'declined') return 'declined';
        if (e && e.code === 'rate_limited') throw new Error('Un enregistrement est déjà en attente de confirmation.');
        // autre erreur : on tente le téléchargement classique
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'saved';
  }

  function pickFile(accept, capture) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '*/*';
      if (capture) input.setAttribute('capture', capture);
      input.style.position = 'fixed';
      input.style.left = '-1000px';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        input.remove();
        resolve(f || null);
      }, { once: true });
      input.click();
    });
  }

  PP.files = { encodePNG, makeZip, saveFile, pickFile, downloadsCap };
})();
