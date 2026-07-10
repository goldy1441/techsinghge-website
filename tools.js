/* ============================================================
   Tool implementations — registered into the TOOLS[] registry
   defined in app.js. Every function below runs 100% client-side.
   ============================================================ */

/* ---------- shared helpers specific to tools ---------- */
function dataUrlToUint8(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function loadImageEl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This browser could not decode "' + file.name + '".'));
    img.src = URL.createObjectURL(file);
  });
}
function convertImageFile(file, format, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Conversion failed')), format, quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('This browser could not decode "' + file.name + '".'));
    img.src = URL.createObjectURL(file);
  });
}

async function renderThumbsWithInk(bytes, maxW, computeInk) {
  maxW = maxW || 140;
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const thumbs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = maxW / vp1.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    let ink = null;
    if (computeInk) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0, sampled = 0;
      for (let p = 0; p < data.length; p += 4 * 5) {
        sampled++;
        if (data[p] < 245 || data[p + 1] < 245 || data[p + 2] < 245) nonWhite++;
      }
      ink = sampled ? nonWhite / sampled : 0;
    }
    thumbs.push({ dataUrl: canvas.toDataURL('image/png'), width: vp1.width, height: vp1.height, ink });
  }
  return { thumbs, numPages: pdf.numPages };
}

async function rasterizePdf(bytes, { scale, quality, grayscale, filter }, onProgress) {
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const outDoc = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext('2d');
    if (filter) ctx.filter = filter;
    else if (grayscale) ctx.filter = 'grayscale(1)';
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const jpegBytes = dataUrlToUint8(canvas.toDataURL('image/jpeg', quality));
    const img = await outDoc.embedJpg(jpegBytes);
    const outPage = outDoc.addPage([vp1.width, vp1.height]);
    outPage.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    if (onProgress) onProgress(i, pdf.numPages);
  }
  return outDoc.save();
}

/** Generic loader: dropzone for one PDF -> bytes + thumbnails, shown in gridSlot */
function pdfPickerWithGrid(body, dzSlot, gridSlot, gridOpts, onReady, computeInk) {
  function mountDropzone() {
    dzSlot.innerHTML = '';
    const dz = makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse',
      accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body);
        const file = files[0];
        dzSlot.innerHTML = '<div class="mini-note">Reading pages…</div>';
        try {
          const bytes = await fileToUint8(file);
          const { thumbs } = await renderThumbsWithInk(bytes, 140, computeInk);
          dzSlot.innerHTML = `<div class="mini-note">Loaded <b></b> — ${thumbs.length} page(s), ${fmtSize(file.size)}. <button class="tspdf-btn tspdf-btn-ghost change-file-btn" type="button" style="margin-left:8px;">Change file</button></div>`;
          $('.mini-note b', dzSlot).textContent = file.name;
          $('.change-file-btn', dzSlot).addEventListener('click', () => { gridSlot.innerHTML = ''; mountDropzone(); onReady(null, null, null); });
          onReady(bytes, thumbs, file);
        } catch (e) {
          showError(body, 'Could not read this PDF — it may be corrupted or password protected. (' + e.message + ')');
        }
      }
    });
    dzSlot.appendChild(dz);
  }
  mountDropzone();
}

/* ================================================================
   1. MERGE PDF
   ================================================================ */
registerTool({
  id: 'merge', name: 'Merge PDF', category: 'organize',
  desc: 'Combine multiple PDFs into a single file, in any order.',
  render(body) {
    mountWorkspace(body, '<div class="list-slot"></div><div class="mini-note">Drag files by the ⠿ handle to set the merge order.</div>');
    const dzSlot = $('.dz-slot', body), listSlot = $('.list-slot', body), runBtn = $('.run-btn', body);
    const dz = makeDropzone({
      label: 'Drop PDF files here', hint: 'or click to browse — choose 2 or more PDFs',
      accept: 'application/pdf', multiple: true,
      onFiles: (files) => {
        clearError(body);
        const existing = listSlot.querySelector('.file-list') ? getFileListOrder(listSlot.querySelector('.file-list')) : [];
        const merged = existing.concat(files);
        buildFileList(listSlot, merged);
        runBtn.disabled = merged.length < 2;
      }
    });
    dzSlot.appendChild(dz);
    runBtn.addEventListener('click', async () => {
      clearError(body);
      const ul = listSlot.querySelector('.file-list');
      const ordered = ul ? getFileListOrder(ul) : [];
      if (ordered.length < 2) { showError(body, 'Add at least 2 PDF files.'); return; }
      runBtn.disabled = true;
      try {
        const out = await PDFDocument.create();
        for (let i = 0; i < ordered.length; i++) {
          setProgress(body, Math.round(10 + 80 * i / ordered.length), `Merging ${ordered[i].name}…`);
          const bytes = await fileToUint8(ordered[i]);
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach(p => out.addPage(p));
        }
        setProgress(body, 95, 'Saving…');
        const bytes = await out.save();
        hideProgress(body);
        showResult(body, { message: `Merged ${ordered.length} files (${fmtSize(bytes.length)}).`, onDownload: () => downloadBytes(bytes, 'merged.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Merge failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   2. SPLIT PDF
   ================================================================ */
registerTool({
  id: 'split', name: 'Split PDF', category: 'organize',
  desc: 'Break a PDF into individual pages or two parts.',
  render(body) {
    const extra = `
      <div class="grid-slot"></div>
      <div class="opt-row" id="splitOpts" style="display:none;">
        <div class="opt-field">
          <span>Split mode</span>
          <div class="radio-group">
            <label><input type="radio" name="splitMode" value="all" checked> Every page as its own PDF (ZIP)</label>
            <label><input type="radio" name="splitMode" value="point"> Split into two PDFs at a page</label>
          </div>
        </div>
        <div class="opt-field" id="splitPointField" style="display:none;max-width:160px;">
          <span>Split after page</span>
          <input type="number" id="splitPoint" min="1" value="1">
        </div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, numPages = 0;
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      if (!bytes) { runBtn.disabled = true; $('#splitOpts', body).style.display = 'none'; return; }
      pdfBytes = bytes; numPages = thumbs.length;
      buildPageGrid(gridSlot, thumbs, {});
      $('#splitOpts', body).style.display = '';
      $('#splitPoint', body).max = numPages;
      runBtn.disabled = false;
    });
    $all('input[name=splitMode]', body).forEach(r => r.addEventListener('change', () => {
      $('#splitPointField', body).style.display = $('input[name=splitMode]:checked', body).value === 'point' ? '' : 'none';
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const mode = $('input[name=splitMode]:checked', body).value;
      runBtn.disabled = true;
      try {
        const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const zip = new JSZip();
        if (mode === 'all') {
          for (let i = 0; i < numPages; i++) {
            setProgress(body, Math.round(90 * (i + 1) / numPages), `Page ${i + 1}/${numPages}…`);
            const doc = await PDFDocument.create();
            const [p] = await doc.copyPages(src, [i]);
            doc.addPage(p);
            zip.file(`page-${String(i + 1).padStart(2, '0')}.pdf`, await doc.save());
          }
        } else {
          const point = Math.min(numPages - 1, Math.max(1, parseInt($('#splitPoint', body).value, 10) || 1));
          const part1 = await PDFDocument.create();
          (await part1.copyPages(src, Array.from({ length: point }, (_, i) => i))).forEach(p => part1.addPage(p));
          const part2 = await PDFDocument.create();
          (await part2.copyPages(src, Array.from({ length: numPages - point }, (_, i) => i + point))).forEach(p => part2.addPage(p));
          zip.file('part-1.pdf', await part1.save());
          zip.file('part-2.pdf', await part2.save());
        }
        setProgress(body, 95, 'Zipping…');
        const blob = await zip.generateAsync({ type: 'blob' });
        hideProgress(body);
        showResult(body, { message: 'Split complete — download the ZIP.', onDownload: () => downloadBlob(blob, 'split-pages.zip') });
      } catch (e) { hideProgress(body); showError(body, 'Split failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   3. REMOVE PAGES
   ================================================================ */
registerTool({
  id: 'remove-pages', name: 'Remove Pages', category: 'organize',
  desc: 'Delete specific pages from a PDF.',
  render(body) {
    mountWorkspace(body, '<div class="grid-slot"></div><div class="mini-note">Tick the pages you want to remove.</div>');
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, pg = null;
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      if (!bytes) { runBtn.disabled = true; return; }
      pdfBytes = bytes;
      pg = buildPageGrid(gridSlot, thumbs, { checkbox: true });
      runBtn.disabled = false;
    });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes || !pg) { showError(body, 'Load a PDF first.'); return; }
      const remove = new Set(pg.getSelected());
      if (remove.size === 0) { showError(body, 'Select at least one page to remove.'); return; }
      runBtn.disabled = true;
      try {
        const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const keep = src.getPageIndices().filter(i => !remove.has(i));
        if (keep.length === 0) { showError(body, "You can't remove every page."); runBtn.disabled = false; return; }
        setProgress(body, 40, 'Rebuilding PDF…');
        const out = await PDFDocument.create();
        (await out.copyPages(src, keep)).forEach(p => out.addPage(p));
        const bytes = await out.save();
        hideProgress(body);
        showResult(body, { message: `Removed ${remove.size} page(s). ${keep.length} page(s) remain.`, onDownload: () => downloadBytes(bytes, 'removed-pages.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   4. EXTRACT PAGES
   ================================================================ */
registerTool({
  id: 'extract-pages', name: 'Extract Pages', category: 'organize',
  desc: 'Pull selected pages out into a new PDF.',
  render(body) {
    mountWorkspace(body, '<div class="grid-slot"></div><div class="mini-note">Tick the pages you want to keep.</div>');
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, pg = null;
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      if (!bytes) { runBtn.disabled = true; return; }
      pdfBytes = bytes;
      pg = buildPageGrid(gridSlot, thumbs, { checkbox: true });
      runBtn.disabled = false;
    });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes || !pg) { showError(body, 'Load a PDF first.'); return; }
      const keep = pg.getSelected().sort((a, b) => a - b);
      if (keep.length === 0) { showError(body, 'Select at least one page to extract.'); return; }
      runBtn.disabled = true;
      try {
        const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        setProgress(body, 40, 'Building PDF…');
        const out = await PDFDocument.create();
        (await out.copyPages(src, keep)).forEach(p => out.addPage(p));
        const bytes = await out.save();
        hideProgress(body);
        showResult(body, { message: `Extracted ${keep.length} page(s).`, onDownload: () => downloadBytes(bytes, 'extracted-pages.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   5. ORGANIZE PDF (reorder / rotate / delete)
   ================================================================ */
registerTool({
  id: 'organize', name: 'Organize PDF', category: 'organize',
  desc: 'Drag to reorder, rotate or delete pages.',
  render(body) {
    mountWorkspace(body, '<div class="grid-slot"></div><div class="mini-note">Drag thumbnails to reorder. Use ⟲ ⟳ to rotate, 🗑 to delete a page.</div>');
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, pg = null;
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      if (!bytes) { runBtn.disabled = true; return; }
      pdfBytes = bytes;
      pg = buildPageGrid(gridSlot, thumbs, { drag: true, rotate: true, del: true });
      runBtn.disabled = false;
    });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes || !pg) { showError(body, 'Load a PDF first.'); return; }
      const order = pg.getOrder();
      if (order.length === 0) { showError(body, 'At least one page must remain.'); return; }
      runBtn.disabled = true;
      try {
        const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        setProgress(body, 40, 'Rebuilding PDF…');
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, order);
        copied.forEach((p, i) => {
          const delta = pg.getRotation(order[i]);
          if (delta) p.setRotation(degrees((p.getRotation().angle + delta) % 360));
          out.addPage(p);
        });
        const bytes = await out.save();
        hideProgress(body);
        showResult(body, { message: `New PDF with ${order.length} page(s) ready.`, onDownload: () => downloadBytes(bytes, 'organized.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   6. ROTATE PDF
   ================================================================ */
registerTool({
  id: 'rotate', name: 'Rotate PDF', category: 'organize',
  desc: 'Rotate all or selected pages 90° at a time.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <button class="tspdf-btn tspdf-btn-ghost" id="rotAllL" type="button">⟲ Rotate all left</button>
        <button class="tspdf-btn tspdf-btn-ghost" id="rotAllR" type="button">⟳ Rotate all right</button>
      </div>
      <div class="grid-slot"></div>
      <div class="mini-note">Or rotate individual pages using the ⟲ ⟳ buttons on each thumbnail.</div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, pg = null;
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      if (!bytes) { runBtn.disabled = true; return; }
      pdfBytes = bytes;
      pg = buildPageGrid(gridSlot, thumbs, { rotate: true });
      runBtn.disabled = false;
    });
    $('#rotAllL', body).addEventListener('click', () => pg && pg.rotateAll(-90));
    $('#rotAllR', body).addEventListener('click', () => pg && pg.rotateAll(90));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes || !pg) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = doc.getPages();
        pages.forEach((p, i) => {
          const delta = pg.getRotation(i);
          if (delta) p.setRotation(degrees((p.getRotation().angle + delta) % 360));
        });
        setProgress(body, 70, 'Saving…');
        const bytes = await doc.save();
        hideProgress(body);
        showResult(body, { message: 'Rotation applied.', onDownload: () => downloadBytes(bytes, 'rotated.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   7. IMAGE TO PDF
   ================================================================ */
registerTool({
  id: 'image-to-pdf', name: 'Image to PDF', category: 'convert',
  desc: 'Combine JPG or PNG images into one PDF.',
  render(body) {
    const extra = `
      <div class="list-slot"></div>
      <div class="opt-row">
        <div class="opt-field">
          <span>Page size</span>
          <div class="radio-group">
            <label><input type="radio" name="imgFit" value="native" checked> Match each image's size</label>
            <label><input type="radio" name="imgFit" value="a4"> Fit to A4</label>
          </div>
        </div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), listSlot = $('.list-slot', body), runBtn = $('.run-btn', body);
    const dz = makeDropzone({
      label: 'Drop JPG/PNG images here', hint: 'or click to browse — order can be dragged below',
      accept: 'image/jpeg,image/png', multiple: true,
      onFiles: (files) => {
        clearError(body);
        const existing = listSlot.querySelector('.file-list') ? getFileListOrder(listSlot.querySelector('.file-list')) : [];
        const merged = existing.concat(files.filter(f => f.type === 'image/jpeg' || f.type === 'image/png'));
        buildFileList(listSlot, merged);
        runBtn.disabled = merged.length < 1;
      }
    });
    dzSlot.appendChild(dz);
    runBtn.addEventListener('click', async () => {
      clearError(body);
      const ul = listSlot.querySelector('.file-list');
      const ordered = ul ? getFileListOrder(ul) : [];
      if (ordered.length === 0) { showError(body, 'Add at least one image.'); return; }
      const fitA4 = $('input[name=imgFit]:checked', body).value === 'a4';
      runBtn.disabled = true;
      try {
        const out = await PDFDocument.create();
        for (let i = 0; i < ordered.length; i++) {
          setProgress(body, Math.round(90 * (i + 1) / ordered.length), `Adding ${ordered[i].name}…`);
          const bytes = await fileToUint8(ordered[i]);
          const img = ordered[i].type === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
          if (fitA4) {
            const page = out.addPage([595.28, 841.89]);
            const margin = 36;
            const maxW = 595.28 - margin * 2, maxH = 841.89 - margin * 2;
            const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
            const w = img.width * ratio, hgt = img.height * ratio;
            page.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - hgt) / 2, width: w, height: hgt });
          } else {
            const page = out.addPage([img.width, img.height]);
            page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          }
        }
        const bytes = await out.save();
        hideProgress(body);
        showResult(body, { message: `Built a ${ordered.length}-page PDF (${fmtSize(bytes.length)}).`, onDownload: () => downloadBytes(bytes, 'images.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   8. PDF TO IMAGE
   ================================================================ */
registerTool({
  id: 'pdf-to-image', name: 'PDF to Image', category: 'convert',
  desc: 'Export every page as a JPG or PNG.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field">
          <span>Format</span>
          <select id="imgFormat"><option value="png">PNG</option><option value="jpeg" selected>JPG</option></select>
        </div>
        <div class="opt-field">
          <span>Resolution</span>
          <select id="imgScale"><option value="1">Low (fast)</option><option value="1.5" selected>Medium</option><option value="2.5">High</option></select>
        </div>
      </div>
      <div class="grid-slot"></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, numPages = 0;
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      if (!bytes) { runBtn.disabled = true; return; }
      pdfBytes = bytes; numPages = thumbs.length;
      buildPageGrid(gridSlot, thumbs, {});
      runBtn.disabled = false;
    });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const fmt = $('#imgFormat', body).value, scale = parseFloat($('#imgScale', body).value);
      const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      const ext = fmt === 'png' ? 'png' : 'jpg';
      runBtn.disabled = true;
      try {
        const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
        const zip = new JSZip();
        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(body, Math.round(90 * i / pdf.numPages), `Page ${i}/${pdf.numPages}…`);
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width; canvas.height = vp.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          const blob = await new Promise(res => canvas.toBlob(res, mime, 0.9));
          if (pdf.numPages === 1) {
            hideProgress(body);
            showResult(body, { message: 'Image ready.', onDownload: () => downloadBlob(blob, `page-1.${ext}`) });
            runBtn.disabled = false;
            return;
          }
          zip.file(`page-${String(i).padStart(2, '0')}.${ext}`, blob);
        }
        setProgress(body, 95, 'Zipping…');
        const blob = await zip.generateAsync({ type: 'blob' });
        hideProgress(body);
        showResult(body, { message: `${numPages} image(s) ready.`, onDownload: () => downloadBlob(blob, 'pdf-images.zip') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   9. PDF TO TEXT
   ================================================================ */
registerTool({
  id: 'pdf-to-text', name: 'PDF to Text', category: 'convert',
  desc: 'Extract all readable text from a PDF.',
  render(body) {
    const extra = `<div class="opt-field"><span>Extracted text</span><textarea id="txtOut" readonly placeholder="Text will appear here after you run this tool…"></textarea></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let file = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: (files) => { file = files[0]; clearError(body); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!file) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const bytes = await fileToUint8(file);
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        let full = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(body, Math.round(90 * i / pdf.numPages), `Page ${i}/${pdf.numPages}…`);
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          full += content.items.map(it => it.str).join(' ') + '\n\n--- page ' + i + ' ---\n\n';
        }
        $('#txtOut', body).value = full.trim();
        hideProgress(body);
        showResult(body, { message: 'Text extracted — preview above, or download the .txt file.', onDownload: () => downloadBlob(new Blob([full], { type: 'text/plain' }), 'extracted-text.txt') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   10. TEXT TO PDF
   ================================================================ */
registerTool({
  id: 'text-to-pdf', name: 'Text to PDF', category: 'convert',
  desc: 'Turn plain text into a formatted PDF document.',
  render(body) {
    const extra = `
      <div class="opt-field"><span>Your text</span><textarea id="txtIn" placeholder="Type or paste text here…"></textarea></div>
      <div class="opt-row">
        <div class="opt-field" style="max-width:160px;"><span>Font size</span><select id="txtSize"><option>10</option><option selected>12</option><option>14</option><option>16</option></select></div>
      </div>`;
    mountWorkspace(body, extra);
    const runBtn = $('.run-btn', body);
    $('.dz-slot', body).remove();
    $('#txtIn', body).addEventListener('input', () => { runBtn.disabled = !$('#txtIn', body).value.trim(); });
    runBtn.disabled = true;
    runBtn.addEventListener('click', async () => {
      clearError(body);
      const text = $('#txtIn', body).value;
      if (!text.trim()) { showError(body, 'Type some text first.'); return; }
      const size = parseInt($('#txtSize', body).value, 10);
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pageW = 595.28, pageH = 841.89, margin = 56;
        const lineH = size * 1.35;
        const lines = wrapText(text, font, size, pageW - margin * 2);
        let page = doc.addPage([pageW, pageH]);
        let y = pageH - margin;
        lines.forEach(line => {
          if (y < margin) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
          page.drawText(line, { x: margin, y, size, font, color: rgb(0.09, 0.08, 0.15) });
          y -= lineH;
        });
        const bytes = await doc.save();
        showResult(body, { message: `Built a ${doc.getPageCount()}-page PDF.`, onDownload: () => downloadBytes(bytes, 'document.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   11. CSV TO PDF
   ================================================================ */
registerTool({
  id: 'csv-to-pdf', name: 'CSV to PDF', category: 'convert',
  desc: 'Render a CSV spreadsheet as a PDF table.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">Large sheets are automatically paginated with a repeated header row.</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let rows = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a CSV file here', hint: 'or click to browse', accept: '.csv,text/csv', multiple: false,
      onFiles: (files) => {
        clearError(body);
        Papa.parse(files[0], {
          complete: (res) => { rows = res.data.filter(r => r.some(c => (c || '').toString().trim() !== '')); runBtn.disabled = !rows.length; },
          error: (err) => showError(body, 'Could not parse CSV: ' + err.message)
        });
      }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!rows || !rows.length) { showError(body, 'Load a CSV first.'); return; }
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
        const pageW = 841.89, pageH = 595.28, margin = 30; // landscape A4
        const cols = rows[0].length;
        const colW = (pageW - margin * 2) / cols;
        const rowH = 20, fSize = 9;
        function truncate(f, text, size, maxW) {
          text = (text == null) ? '' : String(text);
          if (f.widthOfTextAtSize(text, size) <= maxW) return text;
          while (text.length > 0 && f.widthOfTextAtSize(text + '…', size) > maxW) text = text.slice(0, -1);
          return text + '…';
        }
        let page = doc.addPage([pageW, pageH]);
        let y = pageH - margin;
        function drawHeader() {
          rows[0].forEach((cell, c) => {
            page.drawText(truncate(fontBold, cell, fSize, colW - 8), { x: margin + c * colW + 4, y: y - 14, size: fSize, font: fontBold, color: rgb(1, 1, 1) });
          });
          page.drawRectangle({ x: margin, y: y - rowH, width: colW * cols, height: rowH, color: rgb(0.31, 0.17, 0.85) });
          rows[0].forEach((cell, c) => {
            page.drawText(truncate(fontBold, cell, fSize, colW - 8), { x: margin + c * colW + 4, y: y - 14, size: fSize, font: fontBold, color: rgb(1, 1, 1) });
          });
          y -= rowH;
        }
        drawHeader();
        for (let r = 1; r < rows.length; r++) {
          if (y < margin + rowH) { page = doc.addPage([pageW, pageH]); y = pageH - margin; drawHeader(); }
          if (r % 2 === 0) page.drawRectangle({ x: margin, y: y - rowH, width: colW * cols, height: rowH, color: rgb(0.97, 0.96, 1) });
          rows[r].forEach((cell, c) => {
            if (c >= cols) return;
            page.drawText(truncate(font, cell, fSize, colW - 8), { x: margin + c * colW + 4, y: y - 14, size: fSize, font, color: rgb(0.1, 0.08, 0.16) });
          });
          y -= rowH;
        }
        const bytes = await doc.save();
        showResult(body, { message: `Built a ${doc.getPageCount()}-page table PDF from ${rows.length - 1} row(s).`, onDownload: () => downloadBytes(bytes, 'table.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   12. WATERMARK PDF
   ================================================================ */
registerTool({
  id: 'watermark', name: 'Watermark PDF', category: 'edit',
  desc: 'Stamp diagonal or custom text across every page.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field"><span>Watermark text</span><input type="text" id="wmText" value="CONFIDENTIAL"></div>
        <div class="opt-field" style="max-width:120px;"><span>Font size</span><input type="number" id="wmSize" value="48" min="8" max="200"></div>
        <div class="opt-field" style="max-width:160px;"><span>Rotation (°)</span><input type="number" id="wmAngle" value="45" min="-90" max="90"></div>
        <div class="opt-field" style="max-width:200px;"><span>Opacity <span class="range-val" id="wmOpacVal">35%</span></span><input type="range" id="wmOpac" min="5" max="90" value="35"></div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); pdfBytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    $('#wmOpac', body).addEventListener('input', e => { $('#wmOpacVal', body).textContent = e.target.value + '%'; });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const text = $('#wmText', body).value || 'WATERMARK';
      const size = parseInt($('#wmSize', body).value, 10) || 48;
      const angle = parseInt($('#wmAngle', body).value, 10) || 0;
      const opacity = parseInt($('#wmOpac', body).value, 10) / 100;
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        doc.getPages().forEach(page => {
          const { width, height } = page.getSize();
          const textWidth = font.widthOfTextAtSize(text, size);
          page.drawText(text, {
            x: width / 2 - textWidth / 2, y: height / 2, size, font,
            color: rgb(0.31, 0.17, 0.85), opacity, rotate: degrees(angle)
          });
        });
        const bytes = await doc.save();
        showResult(body, { message: 'Watermark applied to every page.', onDownload: () => downloadBytes(bytes, 'watermarked.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   13. ADD PAGE NUMBERS
   ================================================================ */
registerTool({
  id: 'page-number', name: 'Add Page Numbers', category: 'edit',
  desc: 'Number every page, with your choice of position and style.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field" style="max-width:170px;"><span>Position</span><div class="corner-pick" id="pnCorner">
          <button data-pos="tl" title="Top left">↖</button><button data-pos="tc" title="Top center">↑</button><button data-pos="tr" title="Top right">↗</button>
          <button data-pos="ml" title="Middle left">←</button><button data-pos="c" title="Center">•</button><button data-pos="mr" title="Middle right">→</button>
          <button data-pos="bl" title="Bottom left">↙</button><button data-pos="bc" class="active" title="Bottom center">↓</button><button data-pos="br" title="Bottom right">↘</button>
        </div></div>
        <div class="opt-field" style="max-width:170px;"><span>Format</span><select id="pnFormat">
          <option value="n">1, 2, 3…</option>
          <option value="pn" selected>Page 1, Page 2…</option>
          <option value="ntotal">1 of N, 2 of N…</option>
          <option value="pntotal">Page 1 of N…</option>
        </select></div>
        <div class="opt-field" style="max-width:120px;"><span>Start at</span><input type="number" id="pnStart" value="1" min="1"></div>
        <div class="opt-field" style="max-width:110px;"><span>Font size</span><input type="number" id="pnSize" value="11" min="6" max="40"></div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, corner = 'bc';
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); pdfBytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    $all('#pnCorner button', body).forEach(btn => btn.addEventListener('click', () => {
      $all('#pnCorner button', body).forEach(b => b.classList.remove('active'));
      btn.classList.add('active'); corner = btn.dataset.pos;
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const format = $('#pnFormat', body).value, start = parseInt($('#pnStart', body).value, 10) || 1, size = parseInt($('#pnSize', body).value, 10) || 11;
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pages = doc.getPages(); const total = pages.length;
        pages.forEach((page, i) => {
          const n = start + i;
          let label = String(n);
          if (format === 'pn') label = `Page ${n}`;
          if (format === 'ntotal') label = `${n} of ${total}`;
          if (format === 'pntotal') label = `Page ${n} of ${total}`;
          const { width, height } = page.getSize();
          const tw = font.widthOfTextAtSize(label, size);
          const margin = 24;
          let x = width / 2 - tw / 2, y = margin;
          if (corner.includes('l')) x = margin;
          if (corner.includes('r')) x = width - tw - margin;
          if (corner[0] === 't') y = height - margin - size;
          if (corner[0] === 'm' || corner === 'c') y = height / 2;
          page.drawText(label, { x, y, size, font, color: rgb(0.09, 0.08, 0.15) });
        });
        const bytes = await doc.save();
        showResult(body, { message: `Numbered ${total} page(s).`, onDownload: () => downloadBytes(bytes, 'numbered.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   14. CROP PDF
   ================================================================ */
registerTool({
  id: 'crop', name: 'Crop PDF', category: 'edit',
  desc: 'Trim margins from every page with live preview.',
  render(body) {
    const extra = `
      <div class="opt-row" id="cropRow" style="display:none;">
        <div class="opt-field"><span>Top <span class="range-val" id="cTV">0%</span></span><input type="range" id="cropTop" min="0" max="40" value="0"></div>
        <div class="opt-field"><span>Bottom <span class="range-val" id="cBV">0%</span></span><input type="range" id="cropBottom" min="0" max="40" value="0"></div>
        <div class="opt-field"><span>Left <span class="range-val" id="cLV">0%</span></span><input type="range" id="cropLeft" min="0" max="40" value="0"></div>
        <div class="opt-field"><span>Right <span class="range-val" id="cRV">0%</span></span><input type="range" id="cropRight" min="0" max="40" value="0"></div>
      </div>
      <div id="cropPreviewWrap" style="display:none;text-align:center;">
        <div style="display:inline-block;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:#fff;">
          <img id="cropPreviewImg" style="display:block;max-width:260px;">
        </div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null;
    function updatePreview() {
      const t = +$('#cropTop', body).value, b = +$('#cropBottom', body).value, l = +$('#cropLeft', body).value, r = +$('#cropRight', body).value;
      $('#cTV', body).textContent = t + '%'; $('#cBV', body).textContent = b + '%';
      $('#cLV', body).textContent = l + '%'; $('#cRV', body).textContent = r + '%';
      $('#cropPreviewImg', body).style.clipPath = `inset(${t}% ${r}% ${b}% ${l}%)`;
    }
    $all('#cropRow input', body).forEach(inp => inp.addEventListener('input', updatePreview));
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body); pdfBytes = await fileToUint8(files[0]); runBtn.disabled = false;
        const { thumbs } = await renderThumbsWithInk(pdfBytes, 260, false);
        $('#cropPreviewImg', body).src = thumbs[0].dataUrl;
        $('#cropRow', body).style.display = ''; $('#cropPreviewWrap', body).style.display = '';
        updatePreview();
      }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const t = +$('#cropTop', body).value / 100, b = +$('#cropBottom', body).value / 100, l = +$('#cropLeft', body).value / 100, r = +$('#cropRight', body).value / 100;
      if (t + b >= 0.95 || l + r >= 0.95) { showError(body, 'Crop margins are too large.'); return; }
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        doc.getPages().forEach(page => {
          const { width, height } = page.getSize();
          const x = width * l, y = height * b, w = width * (1 - l - r), hgt = height * (1 - t - b);
          page.setCropBox(x, y, w, hgt);
          page.setMediaBox(x, y, w, hgt);
        });
        const bytes = await doc.save();
        showResult(body, { message: 'Crop applied to every page.', onDownload: () => downloadBytes(bytes, 'cropped.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   15. ADD IMAGE TO PDF
   ================================================================ */
registerTool({
  id: 'add-image', name: 'Add Image to PDF', category: 'edit',
  desc: 'Stamp a logo, photo or signature onto pages.',
  render(body) {
    const extra = `
      <div class="opt-field"><span>Image (JPG or PNG)</span><div class="img-dz-slot"></div></div>
      <div class="opt-row">
        <div class="opt-field" style="max-width:170px;"><span>Position</span><div class="corner-pick" id="aiCorner">
          <button data-pos="tl" class="active" title="Top left">↖</button><button data-pos="tc" title="Top center">↑</button><button data-pos="tr" title="Top right">↗</button>
          <button data-pos="ml" title="Middle left">←</button><button data-pos="c" title="Center">•</button><button data-pos="mr" title="Middle right">→</button>
          <button data-pos="bl" title="Bottom left">↙</button><button data-pos="bc" title="Bottom center">↓</button><button data-pos="br" title="Bottom right">↘</button>
        </div></div>
        <div class="opt-field"><span>Size <span class="range-val" id="aiSizeVal">20%</span> of page width</span><input type="range" id="aiSize" min="5" max="80" value="20"></div>
      </div>
      <div class="grid-slot"></div>
      <div class="mini-note">Tick specific pages to stamp, or leave none ticked to apply to every page.</div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), imgDzSlot = $('.img-dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, pg = null, imgFile = null, corner = 'tl';
    let havePdf = false, haveImg = false;
    function refreshRun() { runBtn.disabled = !(havePdf && haveImg); }
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      havePdf = !!bytes; pdfBytes = bytes;
      if (bytes) pg = buildPageGrid(gridSlot, thumbs, { checkbox: true }); else pg = null;
      refreshRun();
    });
    imgDzSlot.appendChild(makeDropzone({
      label: 'Drop an image here', hint: 'JPG or PNG', accept: 'image/jpeg,image/png', multiple: false,
      onFiles: (files) => { imgFile = files[0]; haveImg = true; imgDzSlot.innerHTML = `<div class="mini-note">Image: <b>${imgFile.name}</b></div>`; refreshRun(); }
    }));
    $all('#aiCorner button', body).forEach(btn => btn.addEventListener('click', () => {
      $all('#aiCorner button', body).forEach(b => b.classList.remove('active')); btn.classList.add('active'); corner = btn.dataset.pos;
    }));
    $('#aiSize', body).addEventListener('input', e => { $('#aiSizeVal', body).textContent = e.target.value + '%'; });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes || !imgFile) { showError(body, 'Load both a PDF and an image.'); return; }
      const sizePct = parseInt($('#aiSize', body).value, 10) / 100;
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const imgBytes = await fileToUint8(imgFile);
        const img = imgFile.type === 'image/png' ? await doc.embedPng(imgBytes) : await doc.embedJpg(imgBytes);
        const selected = pg.getSelected();
        const pages = doc.getPages();
        const targets = selected.length ? selected : pages.map((_, i) => i);
        targets.forEach(i => {
          const page = pages[i];
          const { width, height } = page.getSize();
          const w = width * sizePct, hgt = w * (img.height / img.width);
          const margin = 20;
          let x = margin, y = height - hgt - margin;
          if (corner.includes('r')) x = width - w - margin;
          if (corner === 'tc' || corner === 'bc' || corner === 'c') x = width / 2 - w / 2;
          if (corner[0] === 'b') y = margin;
          if (corner[0] === 'm' || corner === 'c') y = height / 2 - hgt / 2;
          page.drawImage(img, { x, y, width: w, height: hgt });
        });
        const bytes = await doc.save();
        showResult(body, { message: `Image added to ${targets.length} page(s).`, onDownload: () => downloadBytes(bytes, 'image-added.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   16. COMPRESS PDF
   ================================================================ */
registerTool({
  id: 'compress', name: 'Compress PDF', category: 'optimize',
  desc: 'Shrink file size — best for scanned or image-heavy PDFs.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field"><span>Compression level</span><select id="cmpLevel">
          <option value="low">Smallest file (lower quality)</option>
          <option value="mid" selected>Balanced</option>
          <option value="high">Best quality (larger file)</option>
        </select></div>
      </div>
      <div class="mini-note">This re-renders each page as an optimized image, so it works best on scanned documents or PDFs full of photos. Text-only PDFs are usually already small and may not shrink further.</div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, origSize = 0;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); pdfBytes = await fileToUint8(files[0]); origSize = files[0].size; runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const level = $('#cmpLevel', body).value;
      const cfg = { low: { scale: 1.0, quality: 0.45 }, mid: { scale: 1.4, quality: 0.65 }, high: { scale: 2.0, quality: 0.82 } }[level];
      runBtn.disabled = true;
      try {
        const bytes = await rasterizePdf(pdfBytes, { scale: cfg.scale, quality: cfg.quality, grayscale: false },
          (i, total) => setProgress(body, Math.round(90 * i / total), `Page ${i}/${total}…`));
        hideProgress(body);
        const diff = origSize - bytes.length;
        const msg = diff > 0
          ? `${fmtSize(origSize)} → ${fmtSize(bytes.length)} (${Math.round(100 * diff / origSize)}% smaller).`
          : `${fmtSize(origSize)} → ${fmtSize(bytes.length)}. This PDF was already efficient, so the result may not be smaller.`;
        showResult(body, { message: msg, onDownload: () => downloadBytes(bytes, 'compressed.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   17. GRAYSCALE PDF
   ================================================================ */
registerTool({
  id: 'grayscale-pdf', name: 'Grayscale PDF', category: 'optimize',
  desc: 'Convert every page to black & white — great for printing.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">Pages are re-rendered in grayscale at print-friendly resolution.</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); pdfBytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const bytes = await rasterizePdf(pdfBytes, { scale: 1.8, quality: 0.85, grayscale: true },
          (i, total) => setProgress(body, Math.round(90 * i / total), `Page ${i}/${total}…`));
        hideProgress(body);
        showResult(body, { message: 'Converted to grayscale.', onDownload: () => downloadBytes(bytes, 'grayscale.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   18. REMOVE BLANK PAGES
   ================================================================ */
registerTool({
  id: 'remove-blank-pages', name: 'Remove Blank Pages', category: 'optimize',
  desc: 'Auto-detect and strip empty pages from a scanned PDF.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field"><span>Sensitivity <span class="range-val" id="rbSensVal">0.5%</span> ink threshold</span><input type="range" id="rbSens" min="1" max="30" value="5"></div>
      </div>
      <div class="grid-slot"></div>
      <div class="mini-note">Pages outlined in amber were auto-detected as blank and pre-selected. Untick any you want to keep, then run.</div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null, allThumbs = null, pg = null;
    function rebuildGrid() {
      const sens = parseInt($('#rbSens', body).value, 10) / 1000;
      $('#rbSensVal', body).textContent = (sens * 100).toFixed(1) + '%';
      const blankSet = new Set();
      allThumbs.forEach((t, i) => { if (t.ink !== null && t.ink <= sens) blankSet.add(i); });
      pg = buildPageGrid(gridSlot, allThumbs, { checkbox: true, preSelected: blankSet, blankSet });
      runBtn.disabled = false;
    }
    pdfPickerWithGrid(body, dzSlot, gridSlot, {}, (bytes, thumbs) => {
      if (!bytes) { runBtn.disabled = true; allThumbs = null; return; }
      pdfBytes = bytes; allThumbs = thumbs; rebuildGrid();
    }, true);
    $('#rbSens', body).addEventListener('change', () => { if (allThumbs) rebuildGrid(); });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes || !pg) { showError(body, 'Load a PDF first.'); return; }
      const remove = new Set(pg.getSelected());
      if (remove.size === 0) { showError(body, 'No pages selected for removal.'); return; }
      runBtn.disabled = true;
      try {
        const src = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const keep = src.getPageIndices().filter(i => !remove.has(i));
        if (keep.length === 0) { showError(body, "You can't remove every page."); runBtn.disabled = false; return; }
        const out = await PDFDocument.create();
        (await out.copyPages(src, keep)).forEach(p => out.addPage(p));
        const bytes = await out.save();
        showResult(body, { message: `Removed ${remove.size} blank page(s). ${keep.length} remain.`, onDownload: () => downloadBytes(bytes, 'no-blanks.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   19. EDIT / REMOVE PDF METADATA
   ================================================================ */
registerTool({
  id: 'metadata', name: 'Edit PDF Metadata', category: 'edit',
  desc: 'View, change, or wipe a PDF\u2019s title, author, and other info.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field"><span>Title</span><input type="text" id="mdTitle"></div>
        <div class="opt-field"><span>Author</span><input type="text" id="mdAuthor"></div>
      </div>
      <div class="opt-row">
        <div class="opt-field"><span>Subject</span><input type="text" id="mdSubject"></div>
        <div class="opt-field"><span>Keywords (comma separated)</span><input type="text" id="mdKeywords"></div>
      </div>
      <div class="actions"><button type="button" class="tspdf-btn tspdf-btn-ghost" id="mdWipeBtn">Wipe all metadata instead</button></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let doc = null, wipe = false;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body);
        try {
          const bytes = await fileToUint8(files[0]);
          doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
          $('#mdTitle', body).value = doc.getTitle() || '';
          $('#mdAuthor', body).value = doc.getAuthor() || '';
          $('#mdSubject', body).value = doc.getSubject() || '';
          $('#mdKeywords', body).value = (doc.getKeywords() || '');
          runBtn.disabled = false;
        } catch (e) { showError(body, 'Could not read this PDF: ' + e.message); }
      }
    }));
    $('#mdWipeBtn', body).addEventListener('click', () => {
      wipe = !wipe;
      $('#mdWipeBtn', body).textContent = wipe ? 'Wiping selected \u2713 (click to cancel)' : 'Wipe all metadata instead';
      $all('#mdTitle, #mdAuthor, #mdSubject, #mdKeywords', body).forEach(inp => inp.disabled = wipe);
    });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!doc) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        if (wipe) {
          doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]);
          doc.setProducer(''); doc.setCreator(''); doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
        } else {
          doc.setTitle($('#mdTitle', body).value || '');
          doc.setAuthor($('#mdAuthor', body).value || '');
          doc.setSubject($('#mdSubject', body).value || '');
          doc.setKeywords(($('#mdKeywords', body).value || '').split(',').map(s => s.trim()).filter(Boolean));
          doc.setModificationDate(new Date());
        }
        const bytes = await doc.save();
        showResult(body, { message: wipe ? 'Metadata wiped.' : 'Metadata updated.', onDownload: () => downloadBytes(bytes, 'metadata-updated.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   20. PAGES PER SHEET (N-UP)
   ================================================================ */
registerTool({
  id: 'pages-per-sheet', name: 'Pages Per Sheet', category: 'organize',
  desc: 'Combine 2 or 4 pages onto a single printable sheet.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field"><span>Layout</span><select id="npsLayout">
          <option value="2">2 pages per sheet</option>
          <option value="4" selected>4 pages per sheet</option>
        </select></div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); pdfBytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const n = parseInt($('#npsLayout', body).value, 10);
      const cols = n === 2 ? 2 : 2, rows = n === 2 ? 1 : 2;
      runBtn.disabled = true;
      try {
        const src = await pdfjsLib.getDocument({ data: pdfBytes.slice() }).promise;
        const out = await PDFDocument.create();
        const sheetW = 842, sheetH = 595; // A4 landscape points
        const cellW = sheetW / cols, cellH = sheetH / rows;
        for (let start = 1; start <= src.numPages; start += n) {
          const sheet = out.addPage([sheetW, sheetH]);
          for (let slot = 0; slot < n && (start + slot) <= src.numPages; slot++) {
            setProgress(body, Math.round(90 * (start + slot) / src.numPages), `Page ${start + slot}/${src.numPages}\u2026`);
            const page = await src.getPage(start + slot);
            const vp1 = page.getViewport({ scale: 1 });
            const targetScale = Math.min(cellW / vp1.width, cellH / vp1.height) * 0.94;
            const vp = page.getViewport({ scale: targetScale * 2 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width; canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            const jpg = dataUrlToUint8(canvas.toDataURL('image/jpeg', 0.85));
            const img = await out.embedJpg(jpg);
            const drawW = vp1.width * targetScale, drawH = vp1.height * targetScale;
            const col = slot % cols, row = Math.floor(slot / cols);
            const x = col * cellW + (cellW - drawW) / 2;
            const y = sheetH - (row + 1) * cellH + (cellH - drawH) / 2;
            sheet.drawImage(img, { x, y, width: drawW, height: drawH });
          }
        }
        hideProgress(body);
        const bytes = await out.save();
        showResult(body, { message: `Combined into ${out.getPageCount()} sheet(s).`, onDownload: () => downloadBytes(bytes, 'pages-per-sheet.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   21. CHANGE PDF PAGE SIZE
   ================================================================ */
registerTool({
  id: 'page-size', name: 'Change PDF Page Size', category: 'edit',
  desc: 'Resize every page to A4, Letter, Legal, or A3.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field"><span>Target size</span><select id="psSize">
          <option value="595.28x841.89">A4</option>
          <option value="612x792">US Letter</option>
          <option value="612x1008">US Legal</option>
          <option value="841.89x1190.55">A3</option>
        </select></div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); pdfBytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      const [tw, th] = $('#psSize', body).value.split('x').map(Number);
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        doc.getPages().forEach(page => {
          const { width, height } = page.getSize();
          const scale = Math.min(tw / width, th / height);
          page.scale(scale, scale);
          const newW = width * scale, newH = height * scale;
          page.setSize(tw, th);
          page.translateContent((tw - newW) / 2, (th - newH) / 2);
        });
        const bytes = await doc.save();
        showResult(body, { message: `Resized ${doc.getPageCount()} page(s).`, onDownload: () => downloadBytes(bytes, 'resized.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   22. QR CODE GENERATOR
   ================================================================ */
registerTool({
  id: 'qr-code', name: 'QR Code Generator', category: 'convert',
  desc: 'Turn text, a link, or Wi-Fi info into a downloadable QR code.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field" style="flex:1 1 100%;"><span>Text or URL</span><textarea id="qrText" style="min-height:80px;" placeholder="https://example.com"></textarea></div>
      </div>
      <div class="opt-row">
        <div class="opt-field"><span>Size (px)</span><input type="number" id="qrSize" value="300" min="100" max="1000"></div>
      </div>
      <div id="qrPreview" style="margin-top:10px;display:flex;justify-content:center;"></div>`;
    body.innerHTML = `
      <div class="msg-error"></div>
      ${extra}
      <div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn">Generate</button></div>
      <div class="result-box"><div class="ok-icon">\u2713</div><p></p><button class="tspdf-btn tspdf-btn-primary result-download">Download PNG</button></div>
    `;
    const runBtn = $('.run-btn', body);
    let qrObj = null;
    runBtn.addEventListener('click', () => {
      clearError(body);
      const text = $('#qrText', body).value.trim();
      if (!text) { showError(body, 'Type some text or a URL first.'); return; }
      const size = Math.min(1000, Math.max(100, parseInt($('#qrSize', body).value, 10) || 300));
      const preview = $('#qrPreview', body);
      preview.innerHTML = '';
      qrObj = new QRCode(preview, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });
      showResult(body, {
        message: 'QR code ready.',
        onDownload: () => {
          setTimeout(() => {
            const img = preview.querySelector('img');
            const canvas = preview.querySelector('canvas');
            if (canvas) { downloadBlob(dataURLtoBlob(canvas.toDataURL('image/png')), 'qr-code.png'); }
            else if (img) { downloadBlob(dataURLtoBlob(img.src), 'qr-code.png'); }
          }, 60);
        }
      });
    });
    function dataURLtoBlob(dataUrl) {
      const bytes = dataUrlToUint8(dataUrl);
      return new Blob([bytes], { type: 'image/png' });
    }
  }
});

/* ================================================================
   23. PASSWORD GENERATOR
   ================================================================ */
registerTool({
  id: 'password-generator', name: 'Password Generator', category: 'convert',
  desc: 'Create strong random passwords, generated locally.',
  render(body) {
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field"><span>Length <span class="range-val" id="pgLenVal">16</span></span><input type="range" id="pgLen" min="6" max="64" value="16"></div>
      </div>
      <div class="opt-row">
        <div class="opt-field radio-group" style="flex-direction:column;align-items:flex-start;">
          <label><input type="checkbox" id="pgUpper" checked> Uppercase (A-Z)</label>
          <label><input type="checkbox" id="pgLower" checked> Lowercase (a-z)</label>
          <label><input type="checkbox" id="pgNums" checked> Numbers (0-9)</label>
          <label><input type="checkbox" id="pgSymbols" checked> Symbols (!@#\$%...)</label>
        </div>
      </div>
      <div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn">Generate password</button></div>
      <div class="result-box show" style="text-align:left;">
        <p style="font-family:'JetBrains Mono',monospace;font-size:16px;color:var(--ink);word-break:break-all;" id="pgOutput">Click generate\u2026</p>
        <button class="tspdf-btn tspdf-btn-ghost" id="pgCopyBtn">Copy to clipboard</button>
      </div>
      <div class="msg-error"></div>`;
    $('#pgLen', body).addEventListener('input', e => $('#pgLenVal', body).textContent = e.target.value);
    $('.run-btn', body).addEventListener('click', () => {
      clearError(body);
      const len = parseInt($('#pgLen', body).value, 10);
      let chars = '';
      if ($('#pgUpper', body).checked) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      if ($('#pgLower', body).checked) chars += 'abcdefghijkmnpqrstuvwxyz';
      if ($('#pgNums', body).checked) chars += '23456789';
      if ($('#pgSymbols', body).checked) chars += '!@#$%^&*()-_=+[]{}';
      if (!chars) { showError(body, 'Pick at least one character type.'); return; }
      const arr = new Uint32Array(len);
      crypto.getRandomValues(arr);
      let out = '';
      for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
      $('#pgOutput', body).textContent = out;
    });
    $('#pgCopyBtn', body).addEventListener('click', async () => {
      const txt = $('#pgOutput', body).textContent;
      if (!txt || txt === 'Click generate\u2026') return;
      try { await navigator.clipboard.writeText(txt); $('#pgCopyBtn', body).textContent = 'Copied \u2713'; setTimeout(() => $('#pgCopyBtn', body).textContent = 'Copy to clipboard', 1500); }
      catch (e) { showError(body, 'Could not copy automatically \u2014 select the text manually.'); }
    });
  }
});

/* ================================================================
   24. VIEW PDF
   ================================================================ */
registerTool({
  id: 'view-pdf', name: 'View PDF', category: 'organize',
  desc: 'Open and page through a PDF right in your browser.',
  render(body) {
    body.innerHTML = `<div class="dz-slot"></div><div class="msg-error"></div><div id="vpPages" style="display:flex;flex-direction:column;gap:16px;align-items:center;max-height:600px;overflow-y:auto;margin-top:12px;"></div>`;
    const dzSlot = $('.dz-slot', body);
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse to view it', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body);
        const holder = $('#vpPages', body);
        holder.innerHTML = '<div class="mini-note">Rendering\u2026</div>';
        try {
          const bytes = await fileToUint8(files[0]);
          const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
          holder.innerHTML = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 1.3 });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width; canvas.height = vp.height;
            canvas.style.maxWidth = '100%';
            canvas.style.border = '1px solid var(--line)';
            canvas.style.borderRadius = '8px';
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            holder.appendChild(canvas);
          }
        } catch (e) { showError(body, 'Could not open this PDF: ' + e.message); }
      }
    }));
  }
});

/* ================================================================
   25. REPAIR PDF
   ================================================================ */
registerTool({
  id: 'repair-pdf', name: 'Repair PDF', category: 'optimize',
  desc: 'Re-build a PDF\u2019s internal structure to fix minor corruption.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">This re-parses and rewrites the PDF\u2019s internal structure \u2014 it can fix broken cross-reference tables and similar minor issues, but can\u2019t recover severely damaged or truncated files.</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let file = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: (files) => { clearError(body); file = files[0]; runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!file) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const bytes = await fileToUint8(file);
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
        const out = await doc.save({ useObjectStreams: false });
        showResult(body, { message: `Rebuilt successfully (${fmtSize(out.length)}).`, onDownload: () => downloadBytes(out, 'repaired.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Could not repair this file \u2014 it may be too badly damaged: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   26. FILL PDF FORM
   ================================================================ */
registerTool({
  id: 'fill-form', name: 'Fill PDF Form', category: 'edit',
  desc: 'Fill in a PDF\u2019s existing fillable form fields and flatten it.',
  render(body) {
    mountWorkspace(body, '<div class="grid-slot"></div><div class="mini-note">Only works on PDFs that already contain fillable form fields (AcroForm). Fields are auto-detected below.</div>');
    const dzSlot = $('.dz-slot', body), gridSlot = $('.grid-slot', body), runBtn = $('.run-btn', body);
    let doc = null, form = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body); gridSlot.innerHTML = '';
        try {
          const bytes = await fileToUint8(files[0]);
          doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
          form = doc.getForm();
          const fields = form.getFields();
          if (!fields.length) { showError(body, 'This PDF has no fillable form fields.'); runBtn.disabled = true; return; }
          const wrap = h('<div></div>');
          fields.forEach(f => {
            const name = f.getName();
            const row = h(`<div class="opt-field" style="margin-bottom:12px;"><span>${name}</span></div>`);
            let input;
            if (window.PDFLib.PDFCheckBox && f instanceof window.PDFLib.PDFCheckBox) {
              input = h('<input type="checkbox">');
            } else {
              input = h('<input type="text">');
            }
            input.dataset.field = name;
            row.appendChild(input);
            wrap.appendChild(row);
          });
          gridSlot.appendChild(wrap);
          runBtn.disabled = false;
        } catch (e) { showError(body, 'Could not read this PDF\u2019s form: ' + e.message); }
      }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!doc || !form) { showError(body, 'Load a PDF form first.'); return; }
      runBtn.disabled = true;
      try {
        $all('input[data-field]', gridSlot).forEach(input => {
          const name = input.dataset.field;
          try {
            if (input.type === 'checkbox') {
              const cb = form.getCheckBox(name);
              input.checked ? cb.check() : cb.uncheck();
            } else {
              form.getTextField(name).setText(input.value || '');
            }
          } catch (e) { /* skip fields of unsupported types */ }
        });
        form.flatten();
        const bytes = await doc.save();
        showResult(body, { message: 'Form filled and flattened.', onDownload: () => downloadBytes(bytes, 'filled-form.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   27. WEBP TO JPG/PNG
   ================================================================ */
registerTool({
  id: 'webp-convert', name: 'WEBP to JPG/PNG', category: 'convert',
  desc: 'Convert WEBP images to JPG or PNG, one by one or in bulk.',
  render(body) {
    const extra = `<div class="opt-row"><div class="opt-field"><span>Output format</span><select id="wpFormat"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option></select></div></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop WEBP image(s) here', hint: 'or click to browse \u2014 multiple allowed', accept: 'image/webp', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one WEBP file.'); return; }
      const format = $('#wpFormat', body).value;
      const ext = format === 'image/png' ? 'png' : 'jpg';
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '';
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Converting ${files[i].name}\u2026`);
          const blob = await convertImage(files[i], format);
          lastBlob = blob; lastName = files[i].name.replace(/\.webp$/i, '') + '.' + ext;
          if (zip) zip.file(lastName, blob);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Converted ${files.length} image(s).`, onDownload: () => downloadBlob(zipBlob, 'converted-images.zip') });
        } else {
          showResult(body, { message: 'Converted 1 image.', onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
    function convertImage(file, format) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Conversion failed')), format, 0.92);
          URL.revokeObjectURL(img.src);
        };
        img.onerror = () => reject(new Error('This browser could not decode this WEBP file.'));
        img.src = URL.createObjectURL(file);
      });
    }
  }
});

/* ================================================================
   28. HEIC TO JPG/PNG
   ================================================================ */
registerTool({
  id: 'heic-convert', name: 'HEIC to JPG/PNG', category: 'convert',
  desc: 'Convert iPhone HEIC photos to JPG or PNG.',
  render(body) {
    const extra = `<div class="opt-row"><div class="opt-field"><span>Output format</span><select id="hcFormat"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option></select></div></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop HEIC image(s) here', hint: 'or click to browse \u2014 multiple allowed', accept: '.heic,.heif', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one HEIC file.'); return; }
      const format = $('#hcFormat', body).value;
      const ext = format === 'image/png' ? 'png' : 'jpg';
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '';
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Converting ${files[i].name}\u2026`);
          const result = await heic2any({ blob: files[i], toType: format, quality: 0.9 });
          const blob = Array.isArray(result) ? result[0] : result;
          lastBlob = blob; lastName = files[i].name.replace(/\.(heic|heif)$/i, '') + '.' + ext;
          if (zip) zip.file(lastName, blob);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Converted ${files.length} image(s).`, onDownload: () => downloadBlob(zipBlob, 'converted-images.zip') });
        } else {
          showResult(body, { message: 'Converted 1 image.', onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Conversion failed \u2014 this browser or file may not be supported: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   29. UNLOCK PDF (permission-restricted PDFs)
   ================================================================ */
registerTool({
  id: 'unlock-pdf', name: 'Unlock PDF', category: 'optimize',
  desc: 'Strip owner-password print/copy/edit restrictions from a PDF.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">This removes owner-password restrictions (print/copy/edit locks). It cannot open a PDF that needs a password just to <b>view</b> it \u2014 that requires the correct password, which this tool does not attempt to guess or crack.</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let file = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: (files) => { clearError(body); file = files[0]; runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!file) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const bytes = await fileToUint8(file);
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const out = await doc.save();
        showResult(body, { message: 'Restrictions removed (if this PDF only needed a password to open, this file will look unchanged).', onDownload: () => downloadBytes(out, 'unlocked.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   30. REVERSE PAGE ORDER
   ================================================================ */
registerTool({
  id: 'reverse-pages', name: 'Reverse Page Order', category: 'organize',
  desc: 'Flip a PDF so the last page becomes the first.',
  render(body) {
    mountWorkspace(body);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let file = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: (files) => { clearError(body); file = files[0]; runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!file) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const bytes = await fileToUint8(file);
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const out = await PDFDocument.create();
        const indices = src.getPageIndices().reverse();
        const pages = await out.copyPages(src, indices);
        pages.forEach(p => out.addPage(p));
        const result = await out.save();
        showResult(body, { message: `Reversed ${pages.length} page(s).`, onDownload: () => downloadBytes(result, 'reversed.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   31. SPLIT BY PAGE RANGES
   ================================================================ */
registerTool({
  id: 'split-ranges', name: 'Split by Page Ranges', category: 'organize',
  desc: 'Split a PDF into multiple files using custom ranges like 1-3,5,7-9.',
  render(body) {
    const extra = `<div class="opt-field"><span>Ranges (comma-separated, e.g. 1-3,5,7-9)</span><input type="text" id="srRanges" placeholder="1-3,5,7-9"></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let bytes = null, numPages = 0;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body);
        try {
          bytes = await fileToUint8(files[0]);
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
          numPages = doc.getPageCount();
          runBtn.disabled = false;
        } catch (e) { showError(body, 'Could not read this PDF: ' + e.message); }
      }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!bytes) { showError(body, 'Load a PDF first.'); return; }
      const raw = $('#srRanges', body).value.trim();
      if (!raw) { showError(body, 'Enter at least one page range.'); return; }
      let parts;
      try { parts = parseRanges(raw, numPages); } catch (e) { showError(body, e.message); return; }
      runBtn.disabled = true;
      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const zip = parts.length > 1 ? new JSZip() : null;
        let lastBytes = null;
        for (let i = 0; i < parts.length; i++) {
          setProgress(body, Math.round(90 * i / parts.length), `Building part ${i + 1}…`);
          const out = await PDFDocument.create();
          const pages = await out.copyPages(src, parts[i]);
          pages.forEach(p => out.addPage(p));
          const partBytes = await out.save();
          lastBytes = partBytes;
          if (zip) zip.file(`part-${i + 1}.pdf`, partBytes);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Created ${parts.length} PDF(s).`, onDownload: () => downloadBlob(zipBlob, 'split-ranges.zip') });
        } else {
          showResult(body, { message: 'Created 1 PDF.', onDownload: () => downloadBytes(lastBytes, 'part-1.pdf', 'application/pdf') });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
    function parseRanges(raw, total) {
      return raw.split(',').map(s => s.trim()).filter(Boolean).map(seg => {
        const m = seg.match(/^(\d+)(?:-(\d+))?$/);
        if (!m) throw new Error(`Invalid range: "${seg}"`);
        let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
        if (a < 1 || b > total || a > b) throw new Error(`Range "${seg}" is out of bounds (PDF has ${total} pages).`);
        const idx = [];
        for (let p = a; p <= b; p++) idx.push(p - 1);
        return idx;
      });
    }
  }
});

/* ================================================================
   32. INSERT BLANK PAGES
   ================================================================ */
registerTool({
  id: 'insert-blank-pages', name: 'Insert Blank Pages', category: 'organize',
  desc: 'Add one or more blank pages at any position in a PDF.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field" style="max-width:170px;"><span>Insert after page</span><input type="number" id="ibPos" value="0" min="0"></div>
        <div class="opt-field" style="max-width:150px;"><span>Number of pages</span><input type="number" id="ibCount" value="1" min="1" max="50"></div>
      </div>
      <div class="mini-note">Use 0 to insert blank pages at the very beginning.</div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let bytes = null, numPages = 0;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body);
        try {
          bytes = await fileToUint8(files[0]);
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
          numPages = doc.getPageCount();
          $('#ibPos', body).max = numPages;
          runBtn.disabled = false;
        } catch (e) { showError(body, 'Could not read this PDF: ' + e.message); }
      }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!bytes) { showError(body, 'Load a PDF first.'); return; }
      const pos = Math.max(0, Math.min(numPages, parseInt($('#ibPos', body).value, 10) || 0));
      const count = Math.max(1, Math.min(50, parseInt($('#ibCount', body).value, 10) || 1));
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = doc.getPages();
        const size = pages.length ? [pages[0].getWidth(), pages[0].getHeight()] : [595.28, 841.89];
        for (let i = 0; i < count; i++) doc.insertPage(pos + i, size);
        const out = await doc.save();
        showResult(body, { message: `Inserted ${count} blank page(s).`, onDownload: () => downloadBytes(out, 'with-blanks.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   33. DUPLICATE A PAGE
   ================================================================ */
registerTool({
  id: 'duplicate-page', name: 'Duplicate a Page', category: 'organize',
  desc: 'Repeat one page of a PDF, right after the original.',
  render(body) {
    const extra = `
      <div class="opt-row">
        <div class="opt-field" style="max-width:150px;"><span>Page number</span><input type="number" id="dpPage" value="1" min="1"></div>
        <div class="opt-field" style="max-width:150px;"><span>Copies to add</span><input type="number" id="dpCount" value="1" min="1" max="20"></div>
      </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let bytes = null, numPages = 0;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => {
        clearError(body);
        try {
          bytes = await fileToUint8(files[0]);
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
          numPages = doc.getPageCount();
          $('#dpPage', body).max = numPages;
          runBtn.disabled = false;
        } catch (e) { showError(body, 'Could not read this PDF: ' + e.message); }
      }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!bytes) { showError(body, 'Load a PDF first.'); return; }
      const pageNum = parseInt($('#dpPage', body).value, 10) || 1;
      const count = Math.max(1, Math.min(20, parseInt($('#dpCount', body).value, 10) || 1));
      if (pageNum < 1 || pageNum > numPages) { showError(body, `Enter a page between 1 and ${numPages}.`); return; }
      runBtn.disabled = true;
      try {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const out = await PDFDocument.create();
        const idx = pageNum - 1;
        for (let i = 0; i < numPages; i++) {
          const [copied] = await out.copyPages(src, [i]);
          out.addPage(copied);
          if (i === idx) {
            for (let c = 0; c < count; c++) {
              const [dup] = await out.copyPages(src, [i]);
              out.addPage(dup);
            }
          }
        }
        const result = await out.save();
        showResult(body, { message: `Page ${pageNum} duplicated ${count} time(s).`, onDownload: () => downloadBytes(result, 'duplicated.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   34. IMAGE FORMAT CONVERTER
   ================================================================ */
registerTool({
  id: 'image-convert', name: 'Image Format Converter', category: 'convert',
  desc: 'Convert JPG, PNG, WEBP and other images to JPG, PNG or WEBP.',
  render(body) {
    const extra = `<div class="opt-row"><div class="opt-field"><span>Output format</span><select id="icFormat"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WEBP</option></select></div><div class="opt-field"><span>Quality <span class="range-val" id="icQVal">90%</span></span><input type="range" id="icQuality" min="10" max="100" value="90"></div></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let files = [];
    $('#icQuality', body).addEventListener('input', () => { $('#icQVal', body).textContent = $('#icQuality', body).value + '%'; });
    dzSlot.appendChild(makeDropzone({
      label: 'Drop image file(s) here', hint: 'or click to browse — multiple allowed', accept: 'image/*', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one image file.'); return; }
      const format = $('#icFormat', body).value;
      const quality = parseInt($('#icQuality', body).value, 10) / 100;
      const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '';
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Converting ${files[i].name}…`);
          const blob = await convertImageFile(files[i], format, quality);
          lastBlob = blob; lastName = files[i].name.replace(/\.[^.]+$/, '') + '.' + ext;
          if (zip) zip.file(lastName, blob);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Converted ${files.length} image(s).`, onDownload: () => downloadBlob(zipBlob, 'converted-images.zip') });
        } else {
          showResult(body, { message: 'Converted 1 image.', onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   35. MARKDOWN TO PDF
   ================================================================ */
registerTool({
  id: 'markdown-to-pdf', name: 'Markdown to PDF', category: 'convert',
  desc: 'Turn a .md file or pasted Markdown into a formatted PDF.',
  render(body) {
    const extra = `<div class="opt-field"><span>Markdown text</span><textarea id="mdIn" placeholder="# Title

Some text...

- bullet one
- bullet two"></textarea></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    const textarea = $('#mdIn', body);
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a .md or .txt file here', hint: 'or paste Markdown below', accept: '.md,.markdown,.txt', multiple: false,
      onFiles: async (files) => { clearError(body); textarea.value = await files[0].text(); runBtn.disabled = !textarea.value.trim(); }
    }));
    textarea.addEventListener('input', () => { runBtn.disabled = !textarea.value.trim(); });
    runBtn.disabled = true;
    runBtn.addEventListener('click', async () => {
      clearError(body);
      const src = textarea.value;
      if (!src.trim()) { showError(body, 'Paste or load some Markdown first.'); return; }
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const bold = await doc.embedFont(StandardFonts.HelveticaBold);
        const pageW = 595.28, pageH = 841.89, margin = 56;
        let page = doc.addPage([pageW, pageH]);
        let y = pageH - margin;
        const ensureRoom = (need) => { if (y - need < margin) { page = doc.addPage([pageW, pageH]); y = pageH - margin; } };
        src.split(/\r?\n/).forEach(raw => {
          const line = raw.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
          let size = 12, useFont = font, prefix = '', indent = 0;
          if (/^#\s+/.test(line)) { size = 22; useFont = bold; }
          else if (/^##\s+/.test(line)) { size = 18; useFont = bold; }
          else if (/^###\s+/.test(line)) { size = 15; useFont = bold; }
          else if (/^[-*]\s+/.test(line)) { prefix = '•  '; indent = 14; }
          else if (line.trim() === '') { y -= 10; return; }
          const text = line.replace(/^#{1,3}\s+/, '').replace(/^[-*]\s+/, '');
          const lineH = size * 1.4;
          const wrapped = wrapText(prefix + text, useFont, size, pageW - margin * 2 - indent);
          wrapped.forEach(w => { ensureRoom(lineH); page.drawText(w, { x: margin + indent, y, size, font: useFont, color: rgb(0.09, 0.08, 0.15) }); y -= lineH; });
          if (/^#{1,3}\s+/.test(line)) y -= 6;
        });
        const bytes = await doc.save();
        showResult(body, { message: `Built a ${doc.getPageCount()}-page PDF.`, onDownload: () => downloadBytes(bytes, 'document.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   36. LOREM IPSUM PDF GENERATOR
   ================================================================ */
registerTool({
  id: 'lorem-pdf', name: 'Lorem Ipsum PDF Generator', category: 'convert',
  desc: 'Generate a placeholder PDF filled with dummy text for mockups.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="max-width:160px;"><span>Paragraphs</span><input type="number" id="liParas" value="6" min="1" max="60"></div>
      <div class="opt-field" style="max-width:160px;"><span>Words per paragraph</span><input type="number" id="liWords" value="60" min="10" max="300"></div>
      <div class="opt-field" style="max-width:160px;"><span>Font size</span><select id="liSize"><option>10</option><option selected>12</option><option>14</option></select></div>
    </div>`;
    mountWorkspace(body, extra);
    $('.dz-slot', body).remove();
    const runBtn = $('.run-btn', body);
    runBtn.disabled = false;
    const WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');
    runBtn.addEventListener('click', async () => {
      clearError(body);
      const paras = Math.max(1, Math.min(60, parseInt($('#liParas', body).value, 10) || 6));
      const wordsPer = Math.max(10, Math.min(300, parseInt($('#liWords', body).value, 10) || 60));
      const size = parseInt($('#liSize', body).value, 10);
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const bold = await doc.embedFont(StandardFonts.HelveticaBold);
        const pageW = 595.28, pageH = 841.89, margin = 56;
        let page = doc.addPage([pageW, pageH]);
        let y = pageH - margin;
        const lineH = size * 1.4;
        for (let p = 0; p < paras; p++) {
          let text = '';
          for (let w = 0; w < wordsPer; w++) text += (w === 0 ? '' : ' ') + WORDS[Math.floor(Math.random() * WORDS.length)];
          text = text.charAt(0).toUpperCase() + text.slice(1) + '.';
          if (p === 0) {
            if (y - 30 < margin) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
            page.drawText('Lorem Ipsum Placeholder', { x: margin, y, size: 20, font: bold, color: rgb(0.09, 0.08, 0.15) });
            y -= 32;
          }
          const wrapped = wrapText(text, font, size, pageW - margin * 2);
          wrapped.forEach(line => {
            if (y < margin) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
            page.drawText(line, { x: margin, y, size, font, color: rgb(0.15, 0.14, 0.22) });
            y -= lineH;
          });
          y -= lineH * 0.6;
        }
        const bytes = await doc.save();
        showResult(body, { message: `Built a ${doc.getPageCount()}-page placeholder PDF.`, onDownload: () => downloadBytes(bytes, 'lorem-ipsum.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   37. PDF INFO & WORD COUNT
   ================================================================ */
registerTool({
  id: 'pdf-info', name: 'PDF Info & Word Count', category: 'convert',
  desc: 'Instantly see page count, size, and estimated word count.',
  render(body) {
    mountWorkspace(body, '<div id="piResult" class="mini-note" style="display:none;"></div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    runBtn.textContent = 'Analyze';
    let file = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: (files) => { clearError(body); file = files[0]; runBtn.disabled = false; $('#piResult', body).style.display = 'none'; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!file) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const bytes = await fileToUint8(file);
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = doc.getPageCount();
        setProgress(body, 30, 'Reading text…');
        const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        let wordCount = 0, charCount = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress(body, Math.round(30 + 60 * i / pdf.numPages), `Scanning page ${i}…`);
          const content = await (await pdf.getPage(i)).getTextContent();
          const text = content.items.map(it => it.str).join(' ');
          charCount += text.length;
          wordCount += text.split(/\s+/).filter(Boolean).length;
        }
        hideProgress(body);
        const firstSize = doc.getPages()[0] ? doc.getPages()[0].getSize() : { width: 0, height: 0 };
        const box = $('#piResult', body);
        box.style.display = 'block';
        box.innerHTML = `<b>${file.name}</b><br>Pages: ${pages}<br>File size: ${fmtSize(file.size)}<br>Page dimensions: ${Math.round(firstSize.width)} × ${Math.round(firstSize.height)} pt<br>Estimated words: ${wordCount.toLocaleString()}<br>Estimated characters: ${charCount.toLocaleString()}`;
        showResult(body, { message: 'Analysis complete — see the summary above.', onDownload: () => downloadBlob(new Blob([box.innerText], { type: 'text/plain' }), 'pdf-info.txt') });
      } catch (e) { hideProgress(body); showError(body, 'Could not analyze this PDF: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   38. JSON TO PDF
   ================================================================ */
registerTool({
  id: 'json-to-pdf', name: 'JSON to PDF', category: 'convert',
  desc: 'Pretty-print a JSON file as a readable, monospaced PDF.',
  render(body) {
    mountWorkspace(body);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let file = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a .json file here', hint: 'or click to browse', accept: '.json,application/json', multiple: false,
      onFiles: (files) => { clearError(body); file = files[0]; runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!file) { showError(body, 'Load a JSON file first.'); return; }
      runBtn.disabled = true;
      try {
        const raw = await file.text();
        let pretty;
        try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch (e) { throw new Error('This file is not valid JSON.'); }
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Courier);
        const size = 9.5, pageW = 595.28, pageH = 841.89, margin = 44;
        const lineH = size * 1.45;
        let page = doc.addPage([pageW, pageH]);
        let y = pageH - margin;
        pretty.split('\n').forEach(rawLine => {
          const wrapped = wrapText(rawLine, font, size, pageW - margin * 2);
          wrapped.forEach(l => {
            if (y < margin) { page = doc.addPage([pageW, pageH]); y = pageH - margin; }
            page.drawText(l, { x: margin, y, size, font, color: rgb(0.1, 0.1, 0.18) });
            y -= lineH;
          });
        });
        const bytes = await doc.save();
        showResult(body, { message: `Built a ${doc.getPageCount()}-page PDF.`, onDownload: () => downloadBytes(bytes, file.name.replace(/\.json$/i, '') + '.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   39. ADD PAGE BORDER
   ================================================================ */
registerTool({
  id: 'add-border', name: 'Add Page Border', category: 'edit',
  desc: 'Draw a clean border frame around every page of a PDF.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="max-width:150px;"><span>Border width (pt)</span><input type="number" id="abWidth" value="2" min="0.5" max="20" step="0.5"></div>
      <div class="opt-field" style="max-width:150px;"><span>Inset from edge (pt)</span><input type="number" id="abInset" value="18" min="0" max="80"></div>
      <div class="opt-field" style="max-width:150px;"><span>Color</span><input type="color" id="abColor" value="#161327"></div>
    </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let bytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); bytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!bytes) { showError(body, 'Load a PDF first.'); return; }
      const w = parseFloat($('#abWidth', body).value) || 2;
      const inset = parseFloat($('#abInset', body).value) || 18;
      const hex = $('#abColor', body).value;
      const col = rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        doc.getPages().forEach(page => {
          const { width, height } = page.getSize();
          page.drawRectangle({ x: inset, y: inset, width: width - inset * 2, height: height - inset * 2, borderColor: col, borderWidth: w, opacity: 0, borderOpacity: 1 });
        });
        const out = await doc.save();
        showResult(body, { message: `Added a border to ${doc.getPageCount()} page(s).`, onDownload: () => downloadBytes(out, 'bordered.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   40. HEADER & FOOTER TEXT
   ================================================================ */
registerTool({
  id: 'header-footer', name: 'Header & Footer Text', category: 'edit',
  desc: 'Add repeating header and footer text, with page number placeholders.',
  render(body) {
    const extra = `
      <div class="opt-field"><span>Header text (optional)</span><input type="text" id="hfHeader" placeholder="e.g. Company Confidential"></div>
      <div class="opt-field"><span>Footer text (optional)</span><input type="text" id="hfFooter" placeholder="e.g. Page {page} of {total}"></div>
      <div class="opt-row">
        <div class="opt-field" style="max-width:130px;"><span>Font size</span><input type="number" id="hfSize" value="10" min="6" max="24"></div>
      </div>
      <div class="mini-note">Use <code>{page}</code> and <code>{total}</code> anywhere in the text to insert live page numbers.</div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let bytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); bytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!bytes) { showError(body, 'Load a PDF first.'); return; }
      const headerT = $('#hfHeader', body).value, footerT = $('#hfFooter', body).value;
      if (!headerT.trim() && !footerT.trim()) { showError(body, 'Enter header and/or footer text.'); return; }
      const size = parseInt($('#hfSize', body).value, 10) || 10;
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pages = doc.getPages(); const total = pages.length; const margin = 30;
        pages.forEach((page, i) => {
          const { width, height } = page.getSize();
          const sub = (t) => t.replace(/\{page\}/g, String(i + 1)).replace(/\{total\}/g, String(total));
          if (headerT.trim()) { const t = sub(headerT); const tw = font.widthOfTextAtSize(t, size); page.drawText(t, { x: width / 2 - tw / 2, y: height - margin, size, font, color: rgb(0.35, 0.34, 0.46) }); }
          if (footerT.trim()) { const t = sub(footerT); const tw = font.widthOfTextAtSize(t, size); page.drawText(t, { x: width / 2 - tw / 2, y: margin - size, size, font, color: rgb(0.35, 0.34, 0.46) }); }
        });
        const out = await doc.save();
        showResult(body, { message: `Applied to ${total} page(s).`, onDownload: () => downloadBytes(out, 'header-footer.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   41. INVERT PDF COLORS
   ================================================================ */
registerTool({
  id: 'invert-colors', name: 'Invert PDF Colors', category: 'edit',
  desc: 'Flip a PDF to a dark, inverted color scheme (great for night reading).',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">This rasterizes each page, so the result is image-based (not selectable text).</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let pdfBytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); pdfBytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!pdfBytes) { showError(body, 'Load a PDF first.'); return; }
      runBtn.disabled = true;
      try {
        const bytes = await rasterizePdf(pdfBytes, { scale: 1.8, quality: 0.9, filter: 'invert(1)' },
          (i, total) => setProgress(body, Math.round(90 * i / total), `Inverting page ${i} of ${total}…`));
        hideProgress(body);
        showResult(body, { message: 'Colors inverted.', onDownload: () => downloadBytes(bytes, 'inverted.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   42. BATES NUMBERING
   ================================================================ */
registerTool({
  id: 'bates-numbering', name: 'Bates Numbering', category: 'edit',
  desc: 'Stamp sequential legal/document control numbers on every page.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="max-width:150px;"><span>Prefix</span><input type="text" id="bnPrefix" placeholder="DOC-" value="DOC-"></div>
      <div class="opt-field" style="max-width:150px;"><span>Start number</span><input type="number" id="bnStart" value="1" min="0"></div>
      <div class="opt-field" style="max-width:150px;"><span>Digits (padding)</span><input type="number" id="bnPad" value="5" min="1" max="10"></div>
    </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let bytes = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a PDF file here', hint: 'or click to browse', accept: 'application/pdf', multiple: false,
      onFiles: async (files) => { clearError(body); bytes = await fileToUint8(files[0]); runBtn.disabled = false; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!bytes) { showError(body, 'Load a PDF first.'); return; }
      const prefix = $('#bnPrefix', body).value || '';
      const start = parseInt($('#bnStart', body).value, 10) || 0;
      const pad = Math.max(1, Math.min(10, parseInt($('#bnPad', body).value, 10) || 5));
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const font = await doc.embedFont(StandardFonts.Helvetica);
        doc.getPages().forEach((page, i) => {
          const label = prefix + String(start + i).padStart(pad, '0');
          const { width } = page.getSize();
          const size = 9;
          const tw = font.widthOfTextAtSize(label, size);
          page.drawText(label, { x: width - tw - 24, y: 20, size, font, color: rgb(0.35, 0.34, 0.46) });
        });
        const out = await doc.save();
        showResult(body, { message: `Stamped ${doc.getPageCount()} page(s).`, onDownload: () => downloadBytes(out, 'bates-numbered.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   43. IMAGE WATERMARK
   ================================================================ */
registerTool({
  id: 'image-watermark', name: 'Image Watermark', category: 'edit',
  desc: 'Stamp a diagonal, semi-transparent text watermark onto images.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="flex:1 1 100%;"><span>Watermark text</span><input type="text" id="iwText" placeholder="e.g. DRAFT" value="SAMPLE"></div>
      <div class="opt-field" style="max-width:150px;"><span>Opacity <span class="range-val" id="iwOpVal">35%</span></span><input type="range" id="iwOpacity" min="5" max="80" value="35"></div>
    </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    $('#iwOpacity', body).addEventListener('input', () => { $('#iwOpVal', body).textContent = $('#iwOpacity', body).value + '%'; });
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop image file(s) here', hint: 'or click to browse — multiple allowed', accept: 'image/*', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one image.'); return; }
      const text = $('#iwText', body).value.trim() || 'SAMPLE';
      const opacity = parseInt($('#iwOpacity', body).value, 10) / 100;
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '';
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Stamping ${files[i].name}…`);
          const img = await loadImageEl(files[i]);
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const fontSize = Math.max(24, Math.round(canvas.width / 10));
          ctx.font = `bold ${fontSize}px sans-serif`;
          ctx.fillStyle = `rgba(255,255,255,${opacity})`;
          ctx.strokeStyle = `rgba(0,0,0,${opacity * 0.6})`;
          ctx.lineWidth = Math.max(1, fontSize / 20);
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(-Math.PI / 6);
          ctx.strokeText(text, 0, 0);
          ctx.fillText(text, 0, 0);
          ctx.restore();
          const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
          lastBlob = blob; lastName = files[i].name.replace(/\.[^.]+$/, '') + '-watermarked.png';
          if (zip) zip.file(lastName, blob);
          URL.revokeObjectURL(img.src);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Watermarked ${files.length} image(s).`, onDownload: () => downloadBlob(zipBlob, 'watermarked-images.zip') });
        } else {
          showResult(body, { message: 'Watermarked 1 image.', onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   44. ADD CAPTION TO IMAGE
   ================================================================ */
registerTool({
  id: 'image-caption', name: 'Add Caption to Image', category: 'edit',
  desc: 'Add a clean caption banner to the bottom of photos.',
  render(body) {
    const extra = `<div class="opt-field"><span>Caption text</span><input type="text" id="icapText" placeholder="e.g. Site visit — 12 June 2026"></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop image file(s) here', hint: 'or click to browse — multiple allowed', accept: 'image/*', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one image.'); return; }
      const text = $('#icapText', body).value.trim();
      if (!text) { showError(body, 'Type a caption first.'); return; }
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '';
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Captioning ${files[i].name}…`);
          const img = await loadImageEl(files[i]);
          const bandH = Math.max(44, Math.round(img.naturalHeight * 0.08));
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight + bandH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          ctx.fillStyle = '#161327';
          ctx.fillRect(0, img.naturalHeight, canvas.width, bandH);
          ctx.fillStyle = '#ffffff';
          const fontSize = Math.max(14, Math.round(bandH * 0.4));
          ctx.font = `600 ${fontSize}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(text, canvas.width / 2, img.naturalHeight + bandH / 2, canvas.width - 40);
          const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
          lastBlob = blob; lastName = files[i].name.replace(/\.[^.]+$/, '') + '-captioned.png';
          if (zip) zip.file(lastName, blob);
          URL.revokeObjectURL(img.src);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Captioned ${files.length} image(s).`, onDownload: () => downloadBlob(zipBlob, 'captioned-images.zip') });
        } else {
          showResult(body, { message: 'Captioned 1 image.', onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   45. WIFI QR CODE GENERATOR
   ================================================================ */
registerTool({
  id: 'wifi-qr', name: 'WiFi QR Code Generator', category: 'edit',
  desc: 'Create a scannable QR code that connects devices to your WiFi.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field"><span>Network name (SSID)</span><input type="text" id="wfSsid" placeholder="MyHomeWiFi"></div>
      <div class="opt-field"><span>Password</span><input type="text" id="wfPass" placeholder="••••••••"></div>
      <div class="opt-field" style="max-width:150px;"><span>Security</span><select id="wfSec"><option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option><option value="nopass">None</option></select></div>
    </div>
    <div id="wfPreview" style="margin-top:10px;display:flex;justify-content:center;"></div>`;
    body.innerHTML = `<div class="msg-error"></div>${extra}<div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn">Generate</button></div><div class="result-box"><div class="ok-icon">✓</div><p></p><button class="tspdf-btn tspdf-btn-primary result-download">Download PNG</button></div>`;
    const runBtn = $('.run-btn', body);
    runBtn.addEventListener('click', () => {
      clearError(body);
      const ssid = $('#wfSsid', body).value.trim();
      const pass = $('#wfPass', body).value;
      const sec = $('#wfSec', body).value;
      if (!ssid) { showError(body, 'Enter a network name.'); return; }
      const esc = (s) => s.replace(/([\\;,:"])/g, '\\$1');
      const payload = `WIFI:T:${sec};S:${esc(ssid)};` + (sec === 'nopass' ? '' : `P:${esc(pass)};`) + `;`;
      const preview = $('#wfPreview', body);
      preview.innerHTML = '';
      new QRCode(preview, { text: payload, width: 280, height: 280, correctLevel: QRCode.CorrectLevel.M });
      showResult(body, { message: 'Scan this with a phone camera to join the network.', onDownload: () => {
        setTimeout(() => {
          const canvas = preview.querySelector('canvas'); const img = preview.querySelector('img');
          if (canvas) downloadBlob(new Blob([dataUrlToUint8(canvas.toDataURL('image/png'))], { type: 'image/png' }), 'wifi-qr.png');
          else if (img) downloadBlob(new Blob([dataUrlToUint8(img.src)], { type: 'image/png' }), 'wifi-qr.png');
        }, 60);
      } });
    });
  }
});

/* ================================================================
   46. CONTACT CARD QR CODE
   ================================================================ */
registerTool({
  id: 'vcard-qr', name: 'Contact Card QR Code', category: 'edit',
  desc: 'Generate a QR code that saves a contact straight to a phone.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field"><span>Full name</span><input type="text" id="vcName" placeholder="Jane Doe"></div>
      <div class="opt-field"><span>Phone</span><input type="text" id="vcPhone" placeholder="+91 98765 43210"></div>
      <div class="opt-field"><span>Email</span><input type="text" id="vcEmail" placeholder="jane@example.com"></div>
      <div class="opt-field"><span>Organization</span><input type="text" id="vcOrg" placeholder="Company name"></div>
    </div>
    <div id="vcPreview" style="margin-top:10px;display:flex;justify-content:center;"></div>`;
    body.innerHTML = `<div class="msg-error"></div>${extra}<div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn">Generate</button></div><div class="result-box"><div class="ok-icon">✓</div><p></p><button class="tspdf-btn tspdf-btn-primary result-download">Download PNG</button></div>`;
    const runBtn = $('.run-btn', body);
    runBtn.addEventListener('click', () => {
      clearError(body);
      const name = $('#vcName', body).value.trim();
      if (!name) { showError(body, 'Enter at least a name.'); return; }
      const phone = $('#vcPhone', body).value.trim(), email = $('#vcEmail', body).value.trim(), org = $('#vcOrg', body).value.trim();
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nN:${name}\nFN:${name}\n${org ? 'ORG:' + org + '\n' : ''}${phone ? 'TEL:' + phone + '\n' : ''}${email ? 'EMAIL:' + email + '\n' : ''}END:VCARD`;
      const preview = $('#vcPreview', body);
      preview.innerHTML = '';
      new QRCode(preview, { text: vcard, width: 280, height: 280, correctLevel: QRCode.CorrectLevel.M });
      showResult(body, { message: 'Scan to save this contact.', onDownload: () => {
        setTimeout(() => {
          const canvas = preview.querySelector('canvas'); const img = preview.querySelector('img');
          if (canvas) downloadBlob(new Blob([dataUrlToUint8(canvas.toDataURL('image/png'))], { type: 'image/png' }), 'contact-qr.png');
          else if (img) downloadBlob(new Blob([dataUrlToUint8(img.src)], { type: 'image/png' }), 'contact-qr.png');
        }, 60);
      } });
    });
  }
});

/* ================================================================
   47. IMAGE COMPRESSOR
   ================================================================ */
registerTool({
  id: 'image-compress', name: 'Image Compressor', category: 'optimize',
  desc: 'Shrink JPG/PNG file sizes by adjusting quality, right in your browser.',
  render(body) {
    const extra = `<div class="opt-field"><span>Quality <span class="range-val" id="cmpQVal">70%</span></span><input type="range" id="cmpQuality" min="10" max="95" value="70"></div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    $('#cmpQuality', body).addEventListener('input', () => { $('#cmpQVal', body).textContent = $('#cmpQuality', body).value + '%'; });
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop JPG/PNG image(s) here', hint: 'or click to browse — multiple allowed', accept: 'image/jpeg,image/png', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one JPG or PNG.'); return; }
      const quality = parseInt($('#cmpQuality', body).value, 10) / 100;
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '', totalBefore = 0, totalAfter = 0;
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Compressing ${files[i].name}…`);
          totalBefore += files[i].size;
          const blob = await convertImageFile(files[i], 'image/jpeg', quality);
          totalAfter += blob.size;
          lastBlob = blob; lastName = files[i].name.replace(/\.[^.]+$/, '') + '-compressed.jpg';
          if (zip) zip.file(lastName, blob);
        }
        hideProgress(body);
        const saved = totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Compressed ${files.length} image(s), ~${saved}% smaller.`, onDownload: () => downloadBlob(zipBlob, 'compressed-images.zip') });
        } else {
          showResult(body, { message: `Compressed: ${fmtSize(totalBefore)} → ${fmtSize(totalAfter)} (~${saved}% smaller).`, onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   48. IMAGE RESIZER
   ================================================================ */
registerTool({
  id: 'image-resize', name: 'Image Resizer', category: 'optimize',
  desc: 'Resize images to exact dimensions or a percentage scale.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="max-width:150px;"><span>Mode</span><select id="rsMode"><option value="pct">Scale %</option><option value="px">Exact width (px)</option></select></div>
      <div class="opt-field" style="max-width:150px;"><span id="rsLabel">Scale (%)</span><input type="number" id="rsValue" value="50" min="1"></div>
    </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    $('#rsMode', body).addEventListener('change', () => {
      const mode = $('#rsMode', body).value;
      $('#rsLabel', body).textContent = mode === 'pct' ? 'Scale (%)' : 'Width (px)';
      $('#rsValue', body).value = mode === 'pct' ? 50 : 800;
    });
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop image file(s) here', hint: 'or click to browse — multiple allowed', accept: 'image/*', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one image.'); return; }
      const mode = $('#rsMode', body).value, value = parseFloat($('#rsValue', body).value) || 50;
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '';
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Resizing ${files[i].name}…`);
          const img = await loadImageEl(files[i]);
          let w, h2;
          if (mode === 'pct') { w = Math.max(1, Math.round(img.naturalWidth * value / 100)); h2 = Math.max(1, Math.round(img.naturalHeight * value / 100)); }
          else { w = Math.max(1, Math.round(value)); h2 = Math.max(1, Math.round(img.naturalHeight * (w / img.naturalWidth))); }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h2;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h2);
          const isPng = /\.png$/i.test(files[i].name);
          const blob = await new Promise(res => canvas.toBlob(res, isPng ? 'image/png' : 'image/jpeg', 0.9));
          lastBlob = blob; lastName = files[i].name.replace(/\.[^.]+$/, '') + `-${w}x${h2}.` + (isPng ? 'png' : 'jpg');
          if (zip) zip.file(lastName, blob);
          URL.revokeObjectURL(img.src);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Resized ${files.length} image(s).`, onDownload: () => downloadBlob(zipBlob, 'resized-images.zip') });
        } else {
          showResult(body, { message: 'Resized 1 image.', onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   49. IMAGE ROTATOR
   ================================================================ */
registerTool({
  id: 'image-rotate', name: 'Image Rotator', category: 'optimize',
  desc: 'Rotate images 90°, 180°, or 270° in bulk.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="max-width:170px;"><span>Rotate</span><select id="irAngle"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option></select></div>
    </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop image file(s) here', hint: 'or click to browse — multiple allowed', accept: 'image/*', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one image.'); return; }
      const angle = parseInt($('#irAngle', body).value, 10);
      runBtn.disabled = true;
      try {
        const zip = files.length > 1 ? new JSZip() : null;
        let lastBlob = null, lastName = '';
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Rotating ${files[i].name}…`);
          const img = await loadImageEl(files[i]);
          const swap = angle === 90 || angle === 270;
          const canvas = document.createElement('canvas');
          canvas.width = swap ? img.naturalHeight : img.naturalWidth;
          canvas.height = swap ? img.naturalWidth : img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(angle * Math.PI / 180);
          ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
          const isPng = /\.png$/i.test(files[i].name);
          const blob = await new Promise(res => canvas.toBlob(res, isPng ? 'image/png' : 'image/jpeg', 0.92));
          lastBlob = blob; lastName = files[i].name.replace(/\.[^.]+$/, '') + '-rotated.' + (isPng ? 'png' : 'jpg');
          if (zip) zip.file(lastName, blob);
          URL.revokeObjectURL(img.src);
        }
        hideProgress(body);
        if (zip) {
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          showResult(body, { message: `Rotated ${files.length} image(s).`, onDownload: () => downloadBlob(zipBlob, 'rotated-images.zip') });
        } else {
          showResult(body, { message: 'Rotated 1 image.', onDownload: () => downloadBlob(lastBlob, lastName) });
        }
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   50. BATCH RENAME FILES
   ================================================================ */
registerTool({
  id: 'batch-rename', name: 'Batch Rename Files', category: 'optimize',
  desc: 'Rename a batch of files using a pattern, then download as a ZIP.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="flex:1 1 220px;"><span>Name pattern</span><input type="text" id="brPattern" value="file-{n}" placeholder="file-{n}"></div>
      <div class="opt-field" style="max-width:130px;"><span>Start number</span><input type="number" id="brStart" value="1" min="0"></div>
      <div class="opt-field" style="max-width:130px;"><span>Digits</span><input type="number" id="brPad" value="2" min="1" max="6"></div>
    </div>
    <div class="mini-note">Use <code>{n}</code> in the pattern for the sequence number. Original file extensions are kept.</div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop any files here', hint: 'or click to browse — multiple allowed', accept: '', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one file.'); return; }
      const pattern = $('#brPattern', body).value.trim() || 'file-{n}';
      const start = parseInt($('#brStart', body).value, 10) || 0;
      const pad = Math.max(1, Math.min(6, parseInt($('#brPad', body).value, 10) || 2));
      runBtn.disabled = true;
      try {
        const zip = new JSZip();
        files.forEach((f, i) => {
          const ext = (f.name.match(/\.[^.]+$/) || [''])[0];
          const n = String(start + i).padStart(pad, '0');
          const newName = pattern.replace(/\{n\}/g, n) + ext;
          zip.file(newName, f);
        });
        setProgress(body, 50, 'Zipping…');
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        hideProgress(body);
        showResult(body, { message: `Renamed ${files.length} file(s).`, onDownload: () => downloadBlob(zipBlob, 'renamed-files.zip') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   51. TEXT CASE CONVERTER
   ================================================================ */
registerTool({
  id: 'text-case-converter', name: 'Text Case Converter', category: 'convert',
  desc: 'Convert pasted text to UPPERCASE, lowercase, Title Case or Sentence case.',
  render(body) {
    const extra = `<div class="opt-field"><span>Your text</span><textarea id="tcIn" placeholder="Paste text here…"></textarea></div>
    <div class="opt-row"><div class="opt-field" style="max-width:200px;"><span>Convert to</span><select id="tcMode">
      <option value="upper">UPPERCASE</option><option value="lower">lowercase</option><option value="title">Title Case</option><option value="sentence">Sentence case</option>
    </select></div></div>`;
    mountWorkspace(body, extra);
    $('.dz-slot', body).remove();
    const runBtn = $('.run-btn', body);
    const textarea = $('#tcIn', body);
    textarea.addEventListener('input', () => { runBtn.disabled = !textarea.value.trim(); });
    runBtn.disabled = true;
    runBtn.addEventListener('click', () => {
      clearError(body);
      const text = textarea.value;
      if (!text.trim()) { showError(body, 'Paste some text first.'); return; }
      const mode = $('#tcMode', body).value;
      let out = text;
      if (mode === 'upper') out = text.toUpperCase();
      else if (mode === 'lower') out = text.toLowerCase();
      else if (mode === 'title') out = text.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
      else if (mode === 'sentence') out = text.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, c => c.toUpperCase());
      textarea.value = out;
      showResult(body, { message: 'Text converted (also updated above).', onDownload: () => downloadBlob(new Blob([out], { type: 'text/plain' }), 'converted-text.txt') });
    });
  }
});

/* ================================================================
   52. IMAGE CONTACT SHEET PDF
   ================================================================ */
registerTool({
  id: 'contact-sheet', name: 'Image Contact Sheet PDF', category: 'edit',
  desc: 'Arrange multiple photos into a neat grid on PDF pages.',
  render(body) {
    const extra = `<div class="opt-row">
      <div class="opt-field" style="max-width:150px;"><span>Columns</span><input type="number" id="csCols" value="3" min="1" max="6"></div>
      <div class="opt-field" style="max-width:150px;"><span>Rows per page</span><input type="number" id="csRows" value="3" min="1" max="6"></div>
    </div>`;
    mountWorkspace(body, extra);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let files = [];
    dzSlot.appendChild(makeDropzone({
      label: 'Drop JPG/PNG image files here', hint: 'or click to browse — choose 2 or more images', accept: 'image/jpeg,image/png', multiple: true,
      onFiles: (fs) => { clearError(body); files = fs; runBtn.disabled = files.length === 0; }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!files.length) { showError(body, 'Add at least one image.'); return; }
      const cols = Math.max(1, Math.min(6, parseInt($('#csCols', body).value, 10) || 3));
      const rows = Math.max(1, Math.min(6, parseInt($('#csRows', body).value, 10) || 3));
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.create();
        const pageW = 595.28, pageH = 841.89, margin = 30, gap = 10;
        const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
        const cellH = (pageH - margin * 2 - gap * (rows - 1)) / rows;
        const perPage = cols * rows;
        let page = null, slot = 0;
        for (let i = 0; i < files.length; i++) {
          setProgress(body, Math.round(90 * i / files.length), `Placing ${files[i].name}…`);
          if (slot % perPage === 0) page = doc.addPage([pageW, pageH]);
          const idx = slot % perPage;
          const col = idx % cols, row = Math.floor(idx / cols);
          const bytes = await fileToUint8(files[i]);
          let img;
          try { img = await doc.embedJpg(bytes); }
          catch (e1) { try { img = await doc.embedPng(bytes); } catch (e2) { throw new Error(`"${files[i].name}" is not a JPG or PNG.`); } }
          const scale = Math.min(cellW / img.width, cellH / img.height);
          const w = img.width * scale, h = img.height * scale;
          const x = margin + col * (cellW + gap) + (cellW - w) / 2;
          const y = pageH - margin - (row + 1) * cellH - row * gap + (cellH - h) / 2;
          page.drawImage(img, { x, y, width: w, height: h });
          slot++;
        }
        const out = await doc.save();
        hideProgress(body);
        showResult(body, { message: `Built a ${doc.getPageCount()}-page contact sheet.`, onDownload: () => downloadBytes(out, 'contact-sheet.pdf', 'application/pdf') });
      } catch (e) { hideProgress(body); showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ================================================================
   OFFICE & BUSINESS TOOLS
   Uses: SheetJS (XLSX global) for Excel, JsBarcode (JsBarcode global)
   for barcodes. Both loaded via CDN alongside the existing libraries.
   ================================================================ */

/* ---------- Excel to CSV ---------- */
registerTool({
  id: 'excel-to-csv', name: 'Excel to CSV', category: 'office',
  desc: 'Convert an Excel spreadsheet to a plain CSV file.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">Converts the first sheet in the workbook.</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let wb = null, fname = 'sheet';
    dzSlot.appendChild(makeDropzone({
      label: 'Drop an Excel file here', hint: 'or click to browse — .xlsx or .xls', accept: '.xlsx,.xls', multiple: false,
      onFiles: (files) => {
        clearError(body);
        fname = files[0].name.replace(/\.[^.]+$/, '');
        const reader = new FileReader();
        reader.onload = (e) => {
          try { wb = XLSX.read(e.target.result, { type: 'array' }); runBtn.disabled = false; }
          catch (err) { showError(body, 'Could not read this file: ' + err.message); }
        };
        reader.onerror = () => showError(body, 'Could not read this file.');
        reader.readAsArrayBuffer(files[0]);
      }
    }));
    runBtn.addEventListener('click', () => {
      clearError(body);
      if (!wb) { showError(body, 'Load an Excel file first.'); return; }
      try {
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        showResult(body, { message: `Converted "${wb.SheetNames[0]}" to CSV.`, onDownload: () => downloadBlob(new Blob([csv], { type: 'text/csv' }), fname + '.csv') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
    });
  }
});

/* ---------- CSV to Excel ---------- */
registerTool({
  id: 'csv-to-excel', name: 'CSV to Excel', category: 'office',
  desc: 'Convert a CSV file into a proper Excel workbook.',
  render(body) {
    mountWorkspace(body);
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let rows = null, fname = 'data';
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a CSV file here', hint: 'or click to browse', accept: '.csv,text/csv', multiple: false,
      onFiles: (files) => {
        clearError(body);
        fname = files[0].name.replace(/\.[^.]+$/, '');
        Papa.parse(files[0], {
          complete: (res) => { rows = res.data.filter(r => r.some(c => (c || '').toString().trim() !== '')); runBtn.disabled = !rows.length; },
          error: (err) => showError(body, 'Could not parse CSV: ' + err.message)
        });
      }
    }));
    runBtn.addEventListener('click', () => {
      clearError(body);
      if (!rows || !rows.length) { showError(body, 'Load a CSV first.'); return; }
      try {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        showResult(body, { message: `Built an Excel workbook with ${rows.length} row(s).`, onDownload: () => downloadBlob(new Blob([out], { type: 'application/octet-stream' }), fname + '.xlsx') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
    });
  }
});

/* ---------- Excel to PDF ---------- */
registerTool({
  id: 'excel-to-pdf', name: 'Excel to PDF', category: 'office',
  desc: 'Render an Excel sheet as a paginated PDF table.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">Converts the first sheet; large sheets are paginated automatically.</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let rows = null;
    dzSlot.appendChild(makeDropzone({
      label: 'Drop an Excel file here', hint: 'or click to browse — .xlsx or .xls', accept: '.xlsx,.xls', multiple: false,
      onFiles: (files) => {
        clearError(body);
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false }).filter(r => r.some(c => (c || '').toString().trim() !== ''));
            runBtn.disabled = !rows.length;
          } catch (err) { showError(body, 'Could not read this file: ' + err.message); }
        };
        reader.readAsArrayBuffer(files[0]);
      }
    }));
    runBtn.addEventListener('click', async () => {
      clearError(body);
      if (!rows || !rows.length) { showError(body, 'Load an Excel file first.'); return; }
      runBtn.disabled = true;
      try {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
        const pageW = 841.89, pageH = 595.28, margin = 30;
        const cols = Math.max(...rows.map(r => r.length));
        const colW = (pageW - margin * 2) / cols;
        const rowH = 20, fSize = 9;
        function truncate(f, text, size, maxW) {
          text = (text == null) ? '' : String(text);
          if (f.widthOfTextAtSize(text, size) <= maxW) return text;
          while (text.length > 0 && f.widthOfTextAtSize(text + '…', size) > maxW) text = text.slice(0, -1);
          return text + '…';
        }
        let page = doc.addPage([pageW, pageH]);
        let y = pageH - margin;
        function drawHeader() {
          page.drawRectangle({ x: margin, y: y - rowH, width: colW * cols, height: rowH, color: rgb(0.31, 0.17, 0.85) });
          (rows[0] || []).forEach((cell, c) => {
            page.drawText(truncate(fontBold, cell, fSize, colW - 8), { x: margin + c * colW + 4, y: y - 14, size: fSize, font: fontBold, color: rgb(1, 1, 1) });
          });
          y -= rowH;
        }
        drawHeader();
        for (let r = 1; r < rows.length; r++) {
          if (y < margin + rowH) { page = doc.addPage([pageW, pageH]); y = pageH - margin; drawHeader(); }
          if (r % 2 === 0) page.drawRectangle({ x: margin, y: y - rowH, width: colW * cols, height: rowH, color: rgb(0.97, 0.96, 1) });
          (rows[r] || []).forEach((cell, c) => {
            if (c >= cols) return;
            page.drawText(truncate(font, cell, fSize, colW - 8), { x: margin + c * colW + 4, y: y - 14, size: fSize, font, color: rgb(0.1, 0.08, 0.16) });
          });
          y -= rowH;
        }
        const bytes = await doc.save();
        showResult(body, { message: `Built a ${doc.getPageCount()}-page table PDF.`, onDownload: () => downloadBytes(bytes, 'spreadsheet.pdf', 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ---------- Excel to JSON ---------- */
registerTool({
  id: 'excel-to-json', name: 'Excel to JSON', category: 'office',
  desc: 'Convert an Excel sheet into JSON data.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">Uses the first row as field names.</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let data = null, fname = 'data';
    dzSlot.appendChild(makeDropzone({
      label: 'Drop an Excel file here', hint: 'or click to browse — .xlsx or .xls', accept: '.xlsx,.xls', multiple: false,
      onFiles: (files) => {
        clearError(body);
        fname = files[0].name.replace(/\.[^.]+$/, '');
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            runBtn.disabled = !data.length;
          } catch (err) { showError(body, 'Could not read this file: ' + err.message); }
        };
        reader.readAsArrayBuffer(files[0]);
      }
    }));
    runBtn.addEventListener('click', () => {
      clearError(body);
      if (!data || !data.length) { showError(body, 'Load an Excel file first.'); return; }
      const json = JSON.stringify(data, null, 2);
      showResult(body, { message: `Converted ${data.length} row(s) to JSON.`, onDownload: () => downloadBlob(new Blob([json], { type: 'application/json' }), fname + '.json') });
    });
  }
});

/* ---------- JSON to Excel ---------- */
registerTool({
  id: 'json-to-excel', name: 'JSON to Excel', category: 'office',
  desc: 'Convert a JSON array of records into an Excel workbook.',
  render(body) {
    mountWorkspace(body, '<div class="mini-note">Expects a JSON array of objects, e.g. [{"name":"A","qty":2}].</div>');
    const dzSlot = $('.dz-slot', body), runBtn = $('.run-btn', body);
    let data = null, fname = 'data';
    dzSlot.appendChild(makeDropzone({
      label: 'Drop a JSON file here', hint: 'or click to browse', accept: '.json,application/json', multiple: false,
      onFiles: (files) => {
        clearError(body);
        fname = files[0].name.replace(/\.[^.]+$/, '');
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const parsed = JSON.parse(e.target.result);
            data = Array.isArray(parsed) ? parsed : [parsed];
            runBtn.disabled = !data.length;
          } catch (err) { showError(body, 'That file is not valid JSON: ' + err.message); }
        };
        reader.readAsText(files[0]);
      }
    }));
    runBtn.addEventListener('click', () => {
      clearError(body);
      if (!data || !data.length) { showError(body, 'Load a JSON file first.'); return; }
      try {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        showResult(body, { message: `Built an Excel workbook with ${data.length} row(s).`, onDownload: () => downloadBlob(new Blob([out], { type: 'application/octet-stream' }), fname + '.xlsx') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
    });
  }
});

/* ---------- Merge Excel Files ---------- */
registerTool({
  id: 'merge-excel', name: 'Merge Excel Files', category: 'office',
  desc: 'Combine multiple Excel files into one workbook.',
  render(body) {
    mountWorkspace(body, '<div class="list-slot"></div><div class="mini-note">Each file becomes its own sheet, named after the file.</div>');
    const dzSlot = $('.dz-slot', body), listSlot = $('.list-slot', body), runBtn = $('.run-btn', body);
    dzSlot.appendChild(makeDropzone({
      label: 'Drop Excel files here', hint: 'or click to browse — choose 2 or more files', accept: '.xlsx,.xls', multiple: true,
      onFiles: (files) => {
        clearError(body);
        const existing = listSlot.querySelector('.file-list') ? getFileListOrder(listSlot.querySelector('.file-list')) : [];
        const merged = existing.concat(files);
        buildFileList(listSlot, merged);
        runBtn.disabled = merged.length < 2;
      }
    }));
    listSlot.addEventListener('change', () => { runBtn.disabled = getFileListOrder($('.file-list', listSlot)).length < 2; });
    runBtn.addEventListener('click', async () => {
      clearError(body);
      const files = listSlot.querySelector('.file-list') ? getFileListOrder(listSlot.querySelector('.file-list')) : [];
      if (files.length < 2) { showError(body, 'Add at least 2 Excel files.'); return; }
      runBtn.disabled = true;
      try {
        const outWb = XLSX.utils.book_new();
        const usedNames = new Set();
        for (const file of files) {
          const buf = await file.arrayBuffer();
          const wb = XLSX.read(buf, { type: 'array' });
          const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 25);
          let sheetName = baseName || 'Sheet';
          let n = 1;
          while (usedNames.has(sheetName)) { sheetName = `${baseName}_${n++}`; }
          usedNames.add(sheetName);
          XLSX.utils.book_append_sheet(outWb, wb.Sheets[wb.SheetNames[0]], sheetName);
        }
        const out = XLSX.write(outWb, { bookType: 'xlsx', type: 'array' });
        showResult(body, { message: `Merged ${files.length} files into one workbook.`, onDownload: () => downloadBlob(new Blob([out], { type: 'application/octet-stream' }), 'merged-workbook.xlsx') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
      finally { runBtn.disabled = false; }
    });
  }
});

/* ---------- Invoice Generator ---------- */
registerTool({
  id: 'invoice-generator', name: 'Invoice Generator', category: 'office',
  desc: 'Create a clean, professional invoice PDF.',
  render(body) {
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field"><span>Your business name</span><input type="text" id="invFrom" placeholder="Acme Co."></div>
        <div class="opt-field"><span>Bill to</span><input type="text" id="invTo" placeholder="Client Name"></div>
      </div>
      <div class="opt-row">
        <div class="opt-field"><span>Invoice #</span><input type="text" id="invNum" placeholder="INV-001"></div>
        <div class="opt-field"><span>Date</span><input type="date" id="invDate"></div>
        <div class="opt-field"><span>Tax %</span><input type="number" id="invTax" value="0" min="0" step="0.1"></div>
      </div>
      <div id="invItems"></div>
      <button class="tspdf-btn tspdf-btn-ghost" id="invAddRow" type="button" style="margin:10px 0;">+ Add line item</button>
      <div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn">Generate invoice PDF</button></div>
      <div class="progress-wrap"><div class="progress-bar-bg"><div class="progress-bar-fg"></div></div><div class="progress-label"></div></div>
      <div class="result-box"><div class="ok-icon">✓</div><p></p><button class="tspdf-btn tspdf-btn-primary result-download">Download result</button></div>
      <div class="msg-error"></div>`;
    const itemsEl = $('#invItems', body);
    function addRow(desc, qty, price) {
      const row = h(`
        <div class="opt-row inv-row" style="align-items:flex-end;">
          <div class="opt-field" style="flex:2;"><span>Description</span><input type="text" class="inv-desc" value="${desc || ''}" placeholder="Web design services"></div>
          <div class="opt-field"><span>Qty</span><input type="number" class="inv-qty" value="${qty || 1}" min="0" step="1"></div>
          <div class="opt-field"><span>Price</span><input type="number" class="inv-price" value="${price || 0}" min="0" step="0.01"></div>
          <button class="fi-remove inv-remove" type="button" title="Remove">✕</button>
        </div>
      `);
      $('.inv-remove', row).addEventListener('click', () => row.remove());
      itemsEl.appendChild(row);
    }
    addRow('', 1, 0);
    $('#invAddRow', body).addEventListener('click', () => addRow('', 1, 0));
    if (!$('#invDate', body).value) $('#invDate', body).value = new Date().toISOString().slice(0, 10);

    $('.run-btn', body).addEventListener('click', async () => {
      clearError(body);
      const from = $('#invFrom', body).value.trim() || 'Your Business';
      const to = $('#invTo', body).value.trim() || 'Client';
      const num = $('#invNum', body).value.trim() || 'INV-001';
      const date = $('#invDate', body).value || new Date().toISOString().slice(0, 10);
      const taxPct = parseFloat($('#invTax', body).value) || 0;
      const rows = $all('.inv-row', body).map(r => ({
        desc: $('.inv-desc', r).value.trim() || 'Item',
        qty: parseFloat($('.inv-qty', r).value) || 0,
        price: parseFloat($('.inv-price', r).value) || 0
      })).filter(r => r.qty > 0);
      if (!rows.length) { showError(body, 'Add at least one line item with a quantity.'); return; }

      try {
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const bold = await doc.embedFont(StandardFonts.HelveticaBold);
        const pageW = 595.28, pageH = 841.89, margin = 40;
        const page = doc.addPage([pageW, pageH]);
        let y = pageH - margin;
        page.drawText('INVOICE', { x: margin, y, size: 26, font: bold, color: rgb(0.31, 0.17, 0.85) });
        page.drawText(`#${num}`, { x: pageW - margin - bold.widthOfTextAtSize(`#${num}`, 12), y: y + 4, size: 12, font: bold, color: rgb(0.3, 0.3, 0.3) });
        y -= 34;
        page.drawText(`Date: ${date}`, { x: pageW - margin - font.widthOfTextAtSize(`Date: ${date}`, 10), y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        y -= 30;
        page.drawText('From', { x: margin, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.5) });
        page.drawText('Bill To', { x: margin + 260, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.5) });
        y -= 14;
        page.drawText(from, { x: margin, y, size: 12, font: bold, color: rgb(0.1, 0.08, 0.16) });
        page.drawText(to, { x: margin + 260, y, size: 12, font: bold, color: rgb(0.1, 0.08, 0.16) });
        y -= 40;
        const colX = [margin, margin + 260, margin + 340, margin + 420];
        const headers = ['Description', 'Qty', 'Price', 'Total'];
        page.drawRectangle({ x: margin, y: y - 18, width: pageW - margin * 2, height: 22, color: rgb(0.31, 0.17, 0.85) });
        headers.forEach((hd, i) => page.drawText(hd, { x: colX[i] + 6, y: y - 13, size: 10, font: bold, color: rgb(1, 1, 1) }));
        y -= 22;
        let subtotal = 0;
        rows.forEach((r, i) => {
          const total = r.qty * r.price;
          subtotal += total;
          if (i % 2 === 0) page.drawRectangle({ x: margin, y: y - 20, width: pageW - margin * 2, height: 20, color: rgb(0.97, 0.96, 1) });
          page.drawText(r.desc.slice(0, 38), { x: colX[0] + 6, y: y - 14, size: 10, font, color: rgb(0.1, 0.08, 0.16) });
          page.drawText(String(r.qty), { x: colX[1] + 6, y: y - 14, size: 10, font, color: rgb(0.1, 0.08, 0.16) });
          page.drawText(r.price.toFixed(2), { x: colX[2] + 6, y: y - 14, size: 10, font, color: rgb(0.1, 0.08, 0.16) });
          page.drawText(total.toFixed(2), { x: colX[3] + 6, y: y - 14, size: 10, font, color: rgb(0.1, 0.08, 0.16) });
          y -= 20;
        });
        y -= 16;
        const tax = subtotal * (taxPct / 100);
        const grand = subtotal + tax;
        function totalLine(label, value, big) {
          const lbl = `${label}`;
          page.drawText(lbl, { x: pageW - margin - 160, y, size: big ? 12 : 10, font: big ? bold : font, color: rgb(0.2, 0.2, 0.2) });
          const valTxt = value.toFixed(2);
          page.drawText(valTxt, { x: pageW - margin - (big ? bold : font).widthOfTextAtSize(valTxt, big ? 12 : 10), y, size: big ? 12 : 10, font: big ? bold : font, color: big ? rgb(0.31, 0.17, 0.85) : rgb(0.2, 0.2, 0.2) });
          y -= big ? 20 : 16;
        }
        totalLine('Subtotal', subtotal, false);
        if (taxPct) totalLine(`Tax (${taxPct}%)`, tax, false);
        totalLine('Total', grand, true);

        const bytes = await doc.save();
        showResult(body, { message: `Invoice ${num} generated — total ${grand.toFixed(2)}.`, onDownload: () => downloadBytes(bytes, `invoice-${num}.pdf`, 'application/pdf') });
      } catch (e) { showError(body, 'Failed: ' + e.message); }
    });
  }
});

/* ---------- Word & Character Counter ---------- */
registerTool({
  id: 'word-counter', name: 'Word & Character Counter', category: 'office',
  desc: 'Count words, characters, sentences and reading time instantly.',
  render(body) {
    body.innerHTML = `
      <textarea id="wcInput" placeholder="Paste or type your text here…" style="width:100%;min-height:180px;padding:14px 16px;border-radius:12px;border:1px solid var(--line);font-family:inherit;font-size:14.5px;resize:vertical;background:var(--paper);color:var(--ink);"></textarea>
      <div class="opt-row" style="margin-top:16px;flex-wrap:wrap;gap:14px;">
        <div class="opt-field"><span>Words</span><div class="wc-stat" id="wcWords">0</div></div>
        <div class="opt-field"><span>Characters</span><div class="wc-stat" id="wcChars">0</div></div>
        <div class="opt-field"><span>Characters (no spaces)</span><div class="wc-stat" id="wcCharsNoSp">0</div></div>
        <div class="opt-field"><span>Sentences</span><div class="wc-stat" id="wcSentences">0</div></div>
        <div class="opt-field"><span>Paragraphs</span><div class="wc-stat" id="wcParas">0</div></div>
        <div class="opt-field"><span>Reading time</span><div class="wc-stat" id="wcReadTime">0 min</div></div>
      </div>
      <style>.wc-stat{font-family:'Fraunces',serif;font-size:24px;color:var(--violet);}</style>`;
    const input = $('#wcInput', body);
    input.addEventListener('input', () => {
      const text = input.value;
      const words = (text.match(/\S+/g) || []).length;
      const chars = text.length;
      const charsNoSp = text.replace(/\s/g, '').length;
      const sentences = (text.match(/[.!?]+(?=\s|$)/g) || []).length;
      const paras = text.split(/\n\s*\n/).filter(p => p.trim()).length;
      const readMin = Math.max(1, Math.round(words / 200));
      $('#wcWords', body).textContent = words;
      $('#wcChars', body).textContent = chars;
      $('#wcCharsNoSp', body).textContent = charsNoSp;
      $('#wcSentences', body).textContent = sentences;
      $('#wcParas', body).textContent = paras;
      $('#wcReadTime', body).textContent = `${readMin} min`;
    });
  }
});

/* ---------- Percentage Calculator ---------- */
registerTool({
  id: 'percentage-calculator', name: 'Percentage Calculator', category: 'office',
  desc: 'Work out percentages, increases and decreases instantly.',
  render(body) {
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field"><span>What is</span><input type="number" id="pcA" value="20"></div>
        <div class="opt-field"><span>% of</span><input type="number" id="pcB" value="200"></div>
      </div>
      <div class="result-box show"><p id="pcResult1" style="font-family:'Fraunces',serif;font-size:22px;">= 40</p></div>
      <div class="opt-row" style="margin-top:20px;">
        <div class="opt-field"><span>Value</span><input type="number" id="pcC" value="50"></div>
        <div class="opt-field"><span>is what % of</span><input type="number" id="pcD" value="200"></div>
      </div>
      <div class="result-box show"><p id="pcResult2" style="font-family:'Fraunces',serif;font-size:22px;">= 25%</p></div>
      <div class="opt-row" style="margin-top:20px;">
        <div class="opt-field"><span>From</span><input type="number" id="pcE" value="100"></div>
        <div class="opt-field"><span>To</span><input type="number" id="pcF" value="120"></div>
      </div>
      <div class="result-box show"><p id="pcResult3" style="font-family:'Fraunces',serif;font-size:22px;">= 20% increase</p></div>`;
    function recalc() {
      const a = parseFloat($('#pcA', body).value) || 0, b = parseFloat($('#pcB', body).value) || 0;
      $('#pcResult1', body).textContent = `= ${(a / 100 * b).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
      const c = parseFloat($('#pcC', body).value) || 0, d = parseFloat($('#pcD', body).value) || 1;
      $('#pcResult2', body).textContent = `= ${(c / d * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
      const e = parseFloat($('#pcE', body).value) || 0, f = parseFloat($('#pcF', body).value) || 0;
      const change = e === 0 ? 0 : ((f - e) / e * 100);
      $('#pcResult3', body).textContent = `= ${Math.abs(change).toLocaleString(undefined, { maximumFractionDigits: 2 })}% ${change >= 0 ? 'increase' : 'decrease'}`;
    }
    $all('input', body).forEach(inp => inp.addEventListener('input', recalc));
    recalc();
  }
});

/* ---------- EMI Calculator ---------- */
registerTool({
  id: 'emi-calculator', name: 'EMI Calculator', category: 'office',
  desc: 'Calculate loan EMI, total interest and total payment.',
  render(body) {
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field"><span>Loan amount</span><input type="number" id="emiP" value="500000" min="0"></div>
        <div class="opt-field"><span>Annual interest %</span><input type="number" id="emiR" value="9" min="0" step="0.01"></div>
        <div class="opt-field"><span>Tenure (months)</span><input type="number" id="emiN" value="60" min="1"></div>
      </div>
      <div class="opt-row" style="margin-top:16px;flex-wrap:wrap;gap:14px;">
        <div class="opt-field"><span>Monthly EMI</span><div class="wc-stat" id="emiOut">₹0</div></div>
        <div class="opt-field"><span>Total interest</span><div class="wc-stat" id="emiInterest">₹0</div></div>
        <div class="opt-field"><span>Total payment</span><div class="wc-stat" id="emiTotal">₹0</div></div>
      </div>
      <style>.wc-stat{font-family:'Fraunces',serif;font-size:22px;color:var(--violet);}</style>`;
    function recalc() {
      const P = parseFloat($('#emiP', body).value) || 0;
      const annR = parseFloat($('#emiR', body).value) || 0;
      const n = parseFloat($('#emiN', body).value) || 1;
      const r = annR / 12 / 100;
      let emi;
      if (r === 0) emi = P / n;
      else emi = P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
      const total = emi * n;
      const interest = total - P;
      const fmt = v => '₹' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
      $('#emiOut', body).textContent = fmt(emi);
      $('#emiInterest', body).textContent = fmt(interest);
      $('#emiTotal', body).textContent = fmt(total);
    }
    $all('input', body).forEach(inp => inp.addEventListener('input', recalc));
    recalc();
  }
});

/* ---------- Age Calculator ---------- */
registerTool({
  id: 'age-calculator', name: 'Age Calculator', category: 'office',
  desc: 'Calculate exact age in years, months and days.',
  render(body) {
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field"><span>Date of birth</span><input type="date" id="ageDob"></div>
        <div class="opt-field"><span>As of</span><input type="date" id="ageAsOf"></div>
      </div>
      <div class="result-box show"><p id="ageResult" style="font-family:'Fraunces',serif;font-size:22px;">Pick a date of birth</p></div>`;
    $('#ageAsOf', body).value = new Date().toISOString().slice(0, 10);
    function recalc() {
      const dobVal = $('#ageDob', body).value;
      if (!dobVal) { $('#ageResult', body).textContent = 'Pick a date of birth'; return; }
      const dob = new Date(dobVal + 'T00:00:00');
      const asOf = new Date(($('#ageAsOf', body).value || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
      if (asOf < dob) { $('#ageResult', body).textContent = '"As of" date is before the date of birth.'; return; }
      let years = asOf.getFullYear() - dob.getFullYear();
      let months = asOf.getMonth() - dob.getMonth();
      let days = asOf.getDate() - dob.getDate();
      if (days < 0) { months -= 1; days += new Date(asOf.getFullYear(), asOf.getMonth(), 0).getDate(); }
      if (months < 0) { years -= 1; months += 12; }
      $('#ageResult', body).textContent = `${years} years, ${months} months, ${days} days`;
    }
    $all('input', body).forEach(inp => inp.addEventListener('input', recalc));
    recalc();
  }
});

/* ---------- Unit Converter ---------- */
registerTool({
  id: 'unit-converter', name: 'Unit Converter', category: 'office',
  desc: 'Convert length, weight, volume and temperature units.',
  render(body) {
    const UNITS = {
      length: { label: 'Length', units: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.34, yd: 0.9144, ft: 0.3048, in: 0.0254 } },
      weight: { label: 'Weight', units: { kg: 1, g: 0.001, mg: 0.000001, lb: 0.453592, oz: 0.0283495, ton: 1000 } },
      volume: { label: 'Volume', units: { l: 1, ml: 0.001, gal: 3.78541, qt: 0.946353, pt: 0.473176, cup: 0.24 } },
      temperature: { label: 'Temperature', units: { C: 'C', F: 'F', K: 'K' } }
    };
    function unitOptions(cat) { return Object.keys(UNITS[cat].units).map(u => `<option value="${u}">${u}</option>`).join(''); }
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field"><span>Category</span>
          <select id="ucCat">${Object.keys(UNITS).map(c => `<option value="${c}">${UNITS[c].label}</option>`).join('')}</select>
        </div>
      </div>
      <div class="opt-row" style="margin-top:12px;">
        <div class="opt-field"><span>Value</span><input type="number" id="ucVal" value="1"></div>
        <div class="opt-field"><span>From</span><select id="ucFrom">${unitOptions('length')}</select></div>
        <div class="opt-field"><span>To</span><select id="ucTo">${unitOptions('length')}</select></div>
      </div>
      <div class="result-box show"><p id="ucResult" style="font-family:'Fraunces',serif;font-size:22px;">= 1</p></div>`;
    const catSel = $('#ucCat', body), fromSel = $('#ucFrom', body), toSel = $('#ucTo', body);
    function refreshUnits() {
      const cat = catSel.value;
      fromSel.innerHTML = unitOptions(cat);
      toSel.innerHTML = unitOptions(cat);
      if (toSel.options.length > 1) toSel.selectedIndex = 1;
      recalc();
    }
    function recalc() {
      const cat = catSel.value;
      const val = parseFloat($('#ucVal', body).value) || 0;
      const from = fromSel.value, to = toSel.value;
      let result;
      if (cat === 'temperature') {
        let celsius;
        if (from === 'C') celsius = val; else if (from === 'F') celsius = (val - 32) * 5 / 9; else celsius = val - 273.15;
        if (to === 'C') result = celsius; else if (to === 'F') result = celsius * 9 / 5 + 32; else result = celsius + 273.15;
      } else {
        const units = UNITS[cat].units;
        result = val * units[from] / units[to];
      }
      $('#ucResult', body).textContent = `= ${result.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${to}`;
    }
    catSel.addEventListener('change', refreshUnits);
    [fromSel, toSel].forEach(sel => sel.addEventListener('change', recalc));
    $('#ucVal', body).addEventListener('input', recalc);
    recalc();
  }
});

/* ---------- Timesheet Calculator ---------- */
registerTool({
  id: 'timesheet-calculator', name: 'Timesheet Calculator', category: 'office',
  desc: 'Add work sessions and total up the hours worked.',
  render(body) {
    body.innerHTML = `
      <div id="tsRows"></div>
      <button class="tspdf-btn tspdf-btn-ghost" id="tsAddRow" type="button" style="margin:10px 0;">+ Add session</button>
      <div class="result-box show"><p id="tsTotal" style="font-family:'Fraunces',serif;font-size:22px;">Total: 0h 0m</p></div>`;
    const rowsEl = $('#tsRows', body);
    function timeToMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
    function recalc() {
      let totalMin = 0;
      $all('.ts-row', body).forEach(row => {
        const s = timeToMin($('.ts-start', row).value), e = timeToMin($('.ts-end', row).value);
        if (s != null && e != null) { let diff = e - s; if (diff < 0) diff += 24 * 60; totalMin += diff; }
      });
      $('#tsTotal', body).textContent = `Total: ${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
    }
    function addRow() {
      const row = h(`
        <div class="opt-row ts-row" style="align-items:flex-end;">
          <div class="opt-field"><span>Start</span><input type="time" class="ts-start" value="09:00"></div>
          <div class="opt-field"><span>End</span><input type="time" class="ts-end" value="17:00"></div>
          <button class="fi-remove ts-remove" type="button" title="Remove">✕</button>
        </div>
      `);
      $('.ts-start', row).addEventListener('input', recalc);
      $('.ts-end', row).addEventListener('input', recalc);
      $('.ts-remove', row).addEventListener('click', () => { row.remove(); recalc(); });
      rowsEl.appendChild(row);
    }
    addRow();
    $('#tsAddRow', body).addEventListener('click', () => { addRow(); recalc(); });
    recalc();
  }
});

/* ---------- Text Diff Checker ---------- */
registerTool({
  id: 'text-diff-checker', name: 'Text Diff Checker', category: 'office',
  desc: 'Compare two texts and highlight what changed, line by line.',
  render(body) {
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field" style="flex:1;"><span>Original text</span><textarea id="diffA" style="width:100%;min-height:160px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);font-family:'JetBrains Mono',monospace;font-size:13px;background:var(--paper);color:var(--ink);"></textarea></div>
        <div class="opt-field" style="flex:1;"><span>Changed text</span><textarea id="diffB" style="width:100%;min-height:160px;padding:12px 14px;border-radius:10px;border:1px solid var(--line);font-family:'JetBrains Mono',monospace;font-size:13px;background:var(--paper);color:var(--ink);"></textarea></div>
      </div>
      <div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn" type="button">Compare</button></div>
      <div id="diffOut" style="margin-top:14px;font-family:'JetBrains Mono',monospace;font-size:13px;line-height:1.8;"></div>`;
    $('.run-btn', body).addEventListener('click', () => {
      const a = $('#diffA', body).value.split('\n');
      const b = $('#diffB', body).value.split('\n');
      // Simple LCS-based line diff
      const n = a.length, m = b.length;
      const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      let i = 0, j = 0; const out = [];
      while (i < n && j < m) {
        if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'removed', text: a[i] }); i++; }
        else { out.push({ type: 'added', text: b[j] }); j++; }
      }
      while (i < n) { out.push({ type: 'removed', text: a[i] }); i++; }
      while (j < m) { out.push({ type: 'added', text: b[j] }); j++; }
      const colors = { same: 'var(--ink-soft)', removed: '#B23A2E', added: '#1D9E75' };
      const bgs = { same: 'transparent', removed: 'rgba(178,58,46,.08)', added: 'rgba(29,158,117,.1)' };
      const prefix = { same: '  ', removed: '− ', added: '+ ' };
      $('#diffOut', body).innerHTML = out.map(l => `<div style="color:${colors[l.type]};background:${bgs[l.type]};padding:2px 8px;white-space:pre-wrap;">${prefix[l.type]}${(l.text || '').replace(/</g, '&lt;')}</div>`).join('');
    });
  }
});

/* ---------- Barcode Generator ---------- */
registerTool({
  id: 'barcode-generator', name: 'Barcode Generator', category: 'office',
  desc: 'Generate a scannable barcode from text or numbers.',
  render(body) {
    body.innerHTML = `
      <div class="opt-row">
        <div class="opt-field" style="flex:1;"><span>Text or number</span><input type="text" id="bcValue" value="123456789012" placeholder="Enter a code"></div>
      </div>
      <div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn" type="button">Generate barcode</button></div>
      <div class="msg-error"></div>
      <div style="text-align:center;margin-top:16px;"><svg id="bcSvg"></svg></div>
      <div class="actions" id="bcDlWrap" style="display:none;"><button class="tspdf-btn tspdf-btn-ghost" id="bcDownload" type="button">Download PNG</button></div>`;
    $('.run-btn', body).addEventListener('click', () => {
      clearError(body);
      const val = $('#bcValue', body).value.trim();
      if (!val) { showError(body, 'Enter a value to encode.'); return; }
      try {
        JsBarcode('#bcSvg', val, { format: 'CODE128', lineColor: '#161327', width: 2, height: 90, displayValue: true });
        $('#bcDlWrap', body).style.display = 'block';
      } catch (e) { showError(body, 'Could not generate a barcode for that value.'); }
    });
    $('#bcDownload', body).addEventListener('click', () => {
      const svg = $('#bcSvg', body);
      const svgData = new XMLSerializer().serializeToString(svg);
      const canvas = document.createElement('canvas');
      const img = new Image();
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      img.onload = () => {
        canvas.width = img.width || 300; canvas.height = img.height || 120;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => downloadBlob(blob, 'barcode.png'));
      };
      img.src = url;
    });
  }
});
