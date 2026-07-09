/* ============================================================
   Techsinghe Smart Tools — fully client-side PDF toolkit
   Uses: pdf-lib (build/edit PDFs), pdf.js (read/render PDFs),
         JSZip (bundle multi-file results), PapaParse (CSV)
   Nothing here ever uploads a file anywhere.
   ============================================================ */

const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib || {};

/* ---------------- small DOM helpers ---------------- */
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
async function fileToUint8(file) {
  return new Uint8Array(await file.arrayBuffer());
}
function downloadBytes(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  downloadBlob(blob, filename);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------------- workspace chrome helpers ---------------- */
function showError(root, text) {
  const box = $('.msg-error', root);
  if (!box) return;
  box.textContent = text;
  box.classList.add('show');
}
function clearError(root) {
  const box = $('.msg-error', root);
  if (box) { box.classList.remove('show'); box.textContent = ''; }
}
function setProgress(root, pct, label) {
  const wrap = $('.progress-wrap', root);
  if (!wrap) return;
  wrap.classList.add('show');
  $('.progress-bar-fg', wrap).style.width = pct + '%';
  $('.progress-label', wrap).textContent = label || (pct + '%');
}
function hideProgress(root) {
  const wrap = $('.progress-wrap', root);
  if (wrap) wrap.classList.remove('show');
}
function showResult(root, { message, onDownload }) {
  const box = $('.result-box', root);
  box.classList.add('show');
  $('p', box).textContent = message;
  const btn = $('.result-download', box);
  btn.onclick = onDownload;
}
function baseWorkspaceMarkup(extra) {
  return `
    <div class="dz-slot"></div>
    <div class="msg-error"></div>
    ${extra || ''}
    <div class="actions"><button class="tspdf-btn tspdf-btn-primary run-btn" disabled>Run</button></div>
    <div class="progress-wrap"><div class="progress-bar-bg"><div class="progress-bar-fg"></div></div><div class="progress-label"></div></div>
    <div class="result-box"><div class="ok-icon">✓</div><p></p><button class="tspdf-btn tspdf-btn-primary result-download">Download result</button></div>
  `;
}
/* baseWorkspaceMarkup returns several sibling elements (not a single root),
   so it must be mounted via innerHTML — h() only ever returns the FIRST
   top-level element and silently drops the rest (run button, progress bar,
   result box, etc). Use mountWorkspace() wherever baseWorkspaceMarkup() is used. */
function mountWorkspace(body, extra) {
  body.innerHTML = baseWorkspaceMarkup(extra);
}

/* ---------------- dropzone ---------------- */
function makeDropzone({ label, hint, accept, multiple, onFiles }) {
  const zone = h(`
    <div class="dropzone" tabindex="0">
      <div class="dz-icon">📄</div>
      <p><b>${label}</b><br>${hint}</p>
      <input type="file" hidden accept="${accept || ''}" ${multiple ? 'multiple' : ''}>
    </div>
  `);
  const input = $('input', zone);
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter') input.click(); });
  input.addEventListener('change', () => { if (input.files.length) onFiles(Array.from(input.files)); });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', e => {
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  });
  return zone;
}

/* ---------------- draggable file list (for merge / image-to-pdf ordering) ---------------- */
function buildFileList(container, files) {
  container.innerHTML = '';
  const ul = h('<ul class="file-list"></ul>');
  container.appendChild(ul);
  files.forEach(file => {
    const li = h(`
      <li class="file-item" draggable="true">
        <span class="fi-handle">⠿</span>
        <span class="fi-name"></span>
        <span class="fi-size"></span>
        <button class="fi-remove" title="Remove">✕</button>
      </li>
    `);
    li.__file = file;
    $('.fi-name', li).textContent = file.name;
    $('.fi-size', li).textContent = fmtSize(file.size);
    li.querySelector('.fi-remove').addEventListener('click', () => { li.remove(); container.dispatchEvent(new Event('change')); });
    ul.appendChild(li);
  });
  wireDragReorder(ul, '.file-item');
  return ul;
}
function getFileListOrder(ul) {
  return $all('.file-item', ul).map(li => li.__file);
}
function wireDragReorder(container, itemSelector) {
  let dragEl = null;
  container.addEventListener('dragstart', e => {
    const item = e.target.closest(itemSelector);
    if (!item) return;
    dragEl = item;
    item.classList.add('dragging');
  });
  container.addEventListener('dragend', e => {
    const item = e.target.closest(itemSelector);
    if (item) item.classList.remove('dragging');
    dragEl = null;
  });
  container.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragEl) return;
    const after = getDragAfterElement(container, itemSelector, e.clientX, e.clientY);
    if (after == null) container.appendChild(dragEl);
    else container.insertBefore(dragEl, after);
  });
}
function getDragAfterElement(container, itemSelector, x, y) {
  const items = $all(itemSelector, container).filter(el => !el.classList.contains('dragging'));
  let closest = { offset: Number.NEGATIVE_INFINITY, el: null };
  for (const el of items) {
    const box = el.getBoundingClientRect();
    const offsetY = y - box.top - box.height / 2;
    const offsetX = x - box.left - box.width / 2;
    const offset = box.height > 60 && box.width < container.clientWidth * 0.6
      ? offsetY // grid-ish item -> prioritize vertical position
      : offsetY;
    if (offset < 0 && offset > closest.offset) closest = { offset, el };
  }
  return closest.el;
}

/* ---------------- PDF thumbnail rendering via pdf.js ---------------- */
async function renderThumbs(bytes, maxW) {
  maxW = maxW || 140;
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  const pdf = await loadingTask.promise;
  const thumbs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = maxW / vp1.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    thumbs.push({ dataUrl: canvas.toDataURL('image/png'), width: vp1.width, height: vp1.height });
  }
  return { thumbs, numPages: pdf.numPages, pdfProxy: pdf };
}

/* ---------------- Page grid component (select / drag reorder / rotate / delete) ---------------- */
function buildPageGrid(container, thumbs, opts) {
  opts = opts || {};
  container.innerHTML = '';
  const grid = h('<div class="pg-grid"></div>');
  container.appendChild(grid);
  const blankSet = opts.blankSet || new Set();

  thumbs.forEach((t, i) => {
    const item = h(`
      <div class="pg-item" draggable="${opts.drag ? 'true' : 'false'}" data-idx="${i}" data-rot="0">
        ${opts.checkbox ? '<label class="pg-check"><input type="checkbox" class="pg-checkbox"></label>' : ''}
        <div class="pg-thumb-wrap"><img src="${t.dataUrl}"></div>
        <div class="pg-controls">
          <span class="pg-num">Page ${i + 1}</span>
          <span>
            ${opts.rotate ? '<button class="pg-rotate" data-dir="l" title="Rotate left">⟲</button><button class="pg-rotate" data-dir="r" title="Rotate right">⟳</button>' : ''}
            ${opts.del ? '<button class="pg-del" title="Remove page">🗑</button>' : ''}
          </span>
        </div>
      </div>
    `);
    if (blankSet.has(i)) item.classList.add('blank-flag');
    if (opts.preSelected && opts.preSelected.has(i)) {
      item.classList.add('selected');
      const cb = $('.pg-checkbox', item);
      if (cb) cb.checked = true;
    }
    const cb = $('.pg-checkbox', item);
    if (cb) cb.addEventListener('change', () => item.classList.toggle('selected', cb.checked));
    if (opts.rotate) {
      $all('.pg-rotate', item).forEach(btn => btn.addEventListener('click', () => {
        let rot = parseInt(item.dataset.rot, 10);
        rot = (rot + (btn.dataset.dir === 'l' ? -90 : 90) + 360) % 360;
        item.dataset.rot = rot;
        $('.pg-thumb-wrap', item).style.transform = `rotate(${rot}deg)`;
      }));
    }
    if (opts.del) {
      $('.pg-del', item).addEventListener('click', () => { item.remove(); if (opts.onChange) opts.onChange(); });
    }
    grid.appendChild(item);
  });

  if (opts.drag) wireDragReorder(grid, '.pg-item');

  return {
    getOrder: () => $all('.pg-item', grid).map(el => parseInt(el.dataset.idx, 10)),
    getSelected: () => $all('.pg-item', grid).filter(el => el.classList.contains('selected')).map(el => parseInt(el.dataset.idx, 10)),
    getRotation: (idx) => {
      const el = grid.querySelector(`.pg-item[data-idx="${idx}"]`);
      return el ? parseInt(el.dataset.rot, 10) : 0;
    },
    selectAll: (val) => $all('.pg-item', grid).forEach(el => {
      el.classList.toggle('selected', val);
      const cb = $('.pg-checkbox', el);
      if (cb) cb.checked = val;
    }),
    removeIdx: (idx) => { const el = grid.querySelector(`.pg-item[data-idx="${idx}"]`); if (el) el.remove(); },
    grid
  };
}

/* ---------------- loading text-to-pdf word wrap helper ---------------- */
function wrapText(text, font, size, maxWidth) {
  const lines = [];
  text.split(/\r?\n/).forEach(paragraph => {
    if (paragraph === '') { lines.push(''); return; }
    const words = paragraph.split(' ');
    let cur = '';
    words.forEach(word => {
      const test = cur ? cur + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    });
    lines.push(cur);
  });
  return lines;
}

/* ================================================================
   Dashboard: tool registry + rendering
   ================================================================ */
const TOOLS = []; // filled by tools.js
function registerTool(t) { TOOLS.push(t); }

/* Maps every tool id -> its dedicated SEO landing page (see TOOL_ROUTES in
   tool-routes.js, loaded before this file). Falls back to the in-page
   overlay workspace if a route isn't defined, so nothing breaks if
   tool-routes.js is ever missing from a page. */
function toolHref(id) {
  if (typeof TOOL_ROUTES !== 'undefined' && TOOL_ROUTES[id]) return TOOL_ROUTES[id] + '.html';
  return null;
}

function renderDashboard() {
  const cats = { organize: 'cat-organize', convert: 'cat-convert', edit: 'cat-edit', optimize: 'cat-optimize', office: 'cat-office' };
  Object.values(cats).forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  TOOLS.forEach((t, i) => {
    const href = toolHref(t.id);
    const card = h(`
      <a class="tool-card" ${href ? `href="${href}"` : 'href="javascript:void(0)"'}>
        <span class="badge-local">FREE</span>
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <h4>${t.name}</h4>
        <p>${t.desc}</p>
      </a>
    `);
    if (!href) card.addEventListener('click', () => openTool(t.id));
    const target = document.getElementById(cats[t.category]);
    if (target) target.appendChild(card);
  });
}

function openTool(id) {
  const tool = TOOLS.find(t => t.id === id);
  if (!tool) return;
  const overlay = $('#wsOverlay');
  if (!overlay) return; // this page has no overlay markup (e.g. a dedicated tool page)
  $('#wsTitle').textContent = tool.name;
  const body = $('#wsBody');
  body.innerHTML = '';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  tool.render(body);
}
function closeTool() {
  $('#wsOverlay')?.classList.remove('open');
  const body = $('#wsBody');
  if (body) body.innerHTML = '';
  document.body.style.overflow = '';
}
$('#wsCloseBtn')?.addEventListener('click', closeTool);
$('#wsBackBtn')?.addEventListener('click', closeTool);
$('#wsOverlay')?.addEventListener('click', e => { if (e.target.id === 'wsOverlay') closeTool(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTool(); });

/* Mounts a single tool's workspace directly inline into a container —
   used by dedicated tool pages (e.g. merge-pdf.html) instead of the
   modal overlay used on the homepage dashboard. */
function mountToolInline(id, container) {
  const tool = TOOLS.find(t => t.id === id);
  if (!tool || !container) return false;
  container.innerHTML = '';
  tool.render(container);
  return true;
}

document.addEventListener('DOMContentLoaded', () => {
  renderDashboard();
  const embed = document.getElementById('toolEmbedBody');
  if (embed && embed.dataset.toolId) {
    const ok = mountToolInline(embed.dataset.toolId, embed);
    if (!ok) embed.innerHTML = '<p class="mini-note">This tool could not be loaded. Please refresh the page.</p>';
  }
});
