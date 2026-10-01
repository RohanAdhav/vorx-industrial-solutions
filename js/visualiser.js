(() => {
  'use strict';

  const MAX_SIDE = 1800; // longest side kept in memory; keeps phones fast
  const COLOURS = [
    ['Concrete grey', '#7b7a72'], ['Steel blue', '#4a657a'], ['Industrial green', '#4e7350'], ['Oxide red', '#9a5a4a'],
    ['Charcoal', '#2c2f31'], ['Sand', '#b59d68'], ['Off-white', '#dedbd0'], ['Navy', '#1f3a68']
  ];

  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const els = {
    stage: $('stage-wrap'), empty: $('empty'), file: $('file'), upload: $('btn-upload'), uploadEmpty: $('btn-upload-empty'),
    swatches: $('swatches'), coverage: $('coverage'), coverageVal: $('coverage-val'),
    apply: $('btn-apply'), clear: $('btn-clear'), download: $('btn-download'), status: $('status')
  };

  let base = null;                 // original pixels
  let areas = [];                  // applied areas: { mask, x0, y0, x1, y1, mean, rgb }
  let points = [];                 // corners being placed
  let active = -1;                 // last applied area; changes colour live
  let coverage = 0.92;
  let colourName = COLOURS[0][0];
  let rgb = hexToRgb(COLOURS[0][1]);

  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const say = (msg) => { els.status.textContent = msg; };

  function sync() { canvas.style.cursor = base ? 'crosshair' : 'default'; }

  /* ---------- colour swatches ---------- */
  COLOURS.forEach(([name, hex], i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.style.background = hex;
    b.title = name; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => {
      rgb = hexToRgb(hex); colourName = name;
      els.swatches.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
      if (!base) return;
      if (points.length === 0 && active >= 0) { areas[active].rgb = rgb; say(`Previewing ${name}. Choose another colour or download the preview.`); }
      else if (points.length >= 3) { applyCoating(); return; }   // colour picked after marking: apply it now
      render(true);
    });
    els.swatches.appendChild(b);
  });

  els.coverage.addEventListener('input', () => {
    coverage = els.coverage.value / 100;
    els.coverageVal.textContent = els.coverage.value + '%';
    render(true);
  });

  /* ---------- loading a photo ---------- */
  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) { say('That file is not an image. Choose a JPG, PNG or WebP photo.'); return; }
    try {
      let bmp;
      try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch { bmp = await createImageBitmap(file); }
      const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      canvas.width = Math.round(bmp.width * s); canvas.height = Math.round(bmp.height * s);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if (bmp.close) bmp.close();
      base = ctx.getImageData(0, 0, canvas.width, canvas.height);
      areas = []; points = []; active = -1;
      canvas.hidden = false; els.empty.hidden = true;
      render(true); sync();
      say(`${file.name} loaded. Click the corners of the concrete floor.`);
    } catch {
      say('This photo could not be opened. Try a different image.');
    }
  }

  els.upload.addEventListener('click', () => els.file.click());
  els.uploadEmpty.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => { loadFile(els.file.files[0]); els.file.value = ''; });
  [els.stage, els.upload].forEach((t) => {
    t.addEventListener('dragover', (e) => { e.preventDefault(); t.classList.add('dragging'); });
    t.addEventListener('dragleave', () => t.classList.remove('dragging'));
    t.addEventListener('drop', (e) => { e.preventDefault(); t.classList.remove('dragging'); loadFile(e.dataTransfer.files[0]); });
  });

  /* ---------- drawing ---------- */
  function paintArea(out, a) {
    const w = canvas.width, [cr, cg, cb] = a.rgb;
    for (let y = a.y0; y <= a.y1; y++) {
      for (let x = a.x0; x <= a.x1; x++) {
        const i = y * w + x, m = a.mask[i];
        if (!m) continue;
        const p = i * 4, r = out[p], g = out[p + 1], b = out[p + 2];
        // Keep the photo's own light and shadow: scale the colour by brightness relative to the area's average.
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const f = Math.max(0.3, Math.min(2, lum / a.mean));
        const s = Math.min(f, 1.3), hi = f > 1.3 ? (f - 1.3) * 110 : 0;
        const k = (m / 255) * coverage;
        out[p]     = r + (Math.min(255, cr * s + hi) - r) * k;
        out[p + 1] = g + (Math.min(255, cg * s + hi) - g) * k;
        out[p + 2] = b + (Math.min(255, cb * s + hi) - b) * k;
      }
    }
  }

  function render(overlay) {
    if (!base) return;
    const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
    areas.forEach((a) => paintArea(out.data, a));
    ctx.putImageData(out, 0, 0);
    if (overlay && points.length) drawPoints();
  }

  // canvas pixels per on-screen pixel (the photo is letterboxed inside the stage)
  function pxScale() {
    const r = canvas.getBoundingClientRect();
    return 1 / Math.min(r.width / canvas.width, r.height / canvas.height);
  }

  function drawPoints() {
    const u = pxScale();
    ctx.save();
    ctx.strokeStyle = '#ffc425'; ctx.fillStyle = '#ffc425'; ctx.lineWidth = 1.5 * u; ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
    points.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 4.5 * u, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
  }

  /* ---------- marking the floor ---------- */
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    const k = Math.min(r.width / canvas.width, r.height / canvas.height);
    const x = (e.clientX - r.left - (r.width - canvas.width * k) / 2) / k;
    const y = (e.clientY - r.top - (r.height - canvas.height * k) / 2) / k;
    return (x < 0 || y < 0 || x > canvas.width || y > canvas.height) ? null : [x, y];
  }

  canvas.addEventListener('click', (e) => {
    if (!base) return;
    const p = toCanvas(e);
    if (!p) return;                                   // click on the dark bars around the photo
    if (points.length === 0) active = -1;
    points.push(p);
    render(true);
    say(points.length < 3
      ? `${points.length} point${points.length > 1 ? 's' : ''} marked. Add at least three points.`
      : `${points.length} points marked. Apply coating preview when ready.`);
  });

  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => render(true), 120); });

  els.apply.addEventListener('click', applyCoating);

  function applyCoating() {
    if (!base) { say('Upload a floor photo first.'); return; }
    if (points.length < 3) { say('Add at least three points around the floor, then apply the coating.'); return; }
    const w = canvas.width, h = canvas.height;
    const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
    const mg = mc.getContext('2d', { willReadFrequently: true });
    mg.beginPath(); points.forEach((p, i) => (i ? mg.lineTo(p[0], p[1]) : mg.moveTo(p[0], p[1])));
    mg.closePath(); mg.fillStyle = '#fff'; mg.fill();
    const alpha = mg.getImageData(0, 0, w, h).data;
    const mask = new Uint8ClampedArray(w * h);
    let x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0, wsum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, a = alpha[i * 4 + 3];
        if (!a) continue;
        mask[i] = a;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        const p = i * 4;
        sum += ((0.299 * base.data[p] + 0.587 * base.data[p + 1] + 0.114 * base.data[p + 2]) / 255) * a;
        wsum += a;
      }
    }
    if (!wsum) { say('That shape has no area. Place the corners further apart.'); return; }
    areas.push({ mask, x0, y0, x1, y1, mean: Math.max(0.05, sum / wsum), rgb });
    active = areas.length - 1; points = [];
    render(true);
    say(`${colourName} coating preview applied. Choose another colour to compare, or download the preview.`);
  }

  els.clear.addEventListener('click', () => {
    if (!base) { say('No photo selected.'); return; }
    if (points.length) { points = []; say('Marked points cleared. Click the corners of the floor to start again.'); }
    else if (areas.length) { areas = []; active = -1; say('Coating removed. Click the corners of the floor to start again.'); }
    else say('Nothing to clear yet.');
    render(true);
  });

  els.download.addEventListener('click', () => {
    if (!base) { say('Upload a floor photo first.'); return; }
    if (points.length >= 3) applyCoating();                       // marked but not applied yet: apply, then download
    if (!areas.length) { say('Mark at least three points on the floor and choose a colour, then download.'); return; }
    render(false);                                  // export without the point markers
    canvas.toBlob((blob) => {
      render(true);
      if (!blob) { say('Could not create the image. Try again.'); return; }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'vorx-floor-preview.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      say('Preview downloaded.');
    }, 'image/png');
  });

  sync();
})();