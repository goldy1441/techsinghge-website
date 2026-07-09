/* ============================================================
   Site chrome: scroll-reveal, animated counters, trust marquee,
   back-to-top button. Runs after app.js/tools.js have mounted
   the tool dashboard so revealed cards already exist in the DOM.
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- Trust marquee (duplicated track for seamless loop) ---------- */
  const marquee = document.getElementById('trustMarquee');
  if (marquee) {
    const items = ['WORKS OFFLINE-FRIENDLY FOR', 'STUDENTS', 'ACCOUNTANTS', 'HR TEAMS', 'FREELANCERS', 'SMALL BUSINESSES', 'DESIGNERS', 'TEACHERS', 'LEGAL TEAMS'];
    const buildTrack = () => items.map((t, i) =>
      `<span class="${i === 0 ? 'tag-label' : ''}">${t}</span>` + (i < items.length - 1 ? '<span class="dot">•</span>' : '')
    ).join('');
    const trackHtml = `<span class="marquee-track">${buildTrack()}</span>`;
    marquee.innerHTML = trackHtml + trackHtml;
  }

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }

  /* ---------- Animated counters (hero stats) ---------- */
  const counters = document.querySelectorAll('.counter');
  const animateCounter = (el) => {
    const target = parseInt(el.dataset.target, 10) || 0;
    if (target === 0) { el.textContent = '0'; return; }
    const dur = 1100;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(eased * target);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window && counters.length) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { animateCounter(entry.target); cio.unobserve(entry.target); }
      });
    }, { threshold: 0.5 });
    counters.forEach(c => cio.observe(c));
  } else {
    counters.forEach(c => { c.textContent = c.dataset.target; });
  }

  /* ---------- Privacy banner mouse-glow ---------- */
  const banner = document.getElementById('privacyBanner');
  if (banner) {
    banner.addEventListener('mousemove', (e) => {
      const rect = banner.getBoundingClientRect();
      banner.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width * 100) + '%');
      banner.style.setProperty('--my', ((e.clientY - rect.top) / rect.height * 100) + '%');
    });
  }

  /* ---------- Back to top ---------- */
  const backBtn = document.getElementById('backToTop');
  if (backBtn) {
    window.addEventListener('scroll', () => {
      backBtn.classList.toggle('show', window.scrollY > 600);
    }, { passive: true });
    backBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  /* ---------- Header: elevate with a shadow once the page scrolls ---------- */
  const siteHeader = document.querySelector('header');
  if (siteHeader) {
    const setScrolled = () => siteHeader.classList.toggle('is-scrolled', window.scrollY > 8);
    setScrolled();
    window.addEventListener('scroll', setScrolled, { passive: true });
  }

  /* ---------- Page fade-in on load ---------- */
  document.documentElement.classList.add('page-ready');

  /* ---------- Mobile nav toggle ---------- */
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.querySelector('.nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('mobile-open');
      navToggle.textContent = open ? '✕' : '☰';
      document.querySelectorAll('.nav-item.has-dropdown.open').forEach(i => i.classList.remove('open'));
    });
  }

  /* ---------- "All Tools" dropdown menu ---------- */
  const isDesktop = () => window.matchMedia('(min-width:1081px)').matches;

  /* Build ONE shared full-width panel from the existing PDF/Excel/AI
     Tools per-item panels (works on every page without editing each
     HTML file). On desktop this replaces the old per-trigger panels,
     which overlapped each other; on mobile the old accordion panels
     are used as-is (see CSS) and this bar stays hidden. */
  let megaBar = null;
  let megaItems = [];
  let openMega = () => {};
  let closeMegaNow = () => {};
  (function buildMegaBar() {
    const header = document.querySelector('header');
    const navEl = header && header.querySelector('nav');
    if (!header || !navEl) return;
    const items = Array.from(navEl.querySelectorAll('.nav-item.has-dropdown'))
      .filter(i => !i.classList.contains('nav-account'));
    if (!items.length) return;
    megaItems = items;

    const bar = document.createElement('div');
    bar.className = 'mega-bar';
    const inner = document.createElement('div');
    inner.className = 'mega-bar-inner';
    const cols = [];

    items.forEach(item => {
      const trigger = item.querySelector('.nav-drop-trigger');
      const panel = item.querySelector(':scope > .dropdown-panel');
      if (!trigger || !panel) { cols.push(null); return; }
      const labelEl = trigger.querySelector('.nav-trig-label');
      const col = document.createElement('div');
      col.className = 'mega-col';
      const title = document.createElement('div');
      title.className = 'mega-col-title';
      title.textContent = labelEl ? labelEl.textContent.trim() : '';
      col.appendChild(title);
      Array.from(panel.children).forEach(child => col.appendChild(child.cloneNode(true)));
      inner.appendChild(col);
      cols.push(col);
    });

    bar.appendChild(inner);
    header.appendChild(bar);
    megaBar = bar;

    let closeTimer = null;
    openMega = (activeItem) => {
      clearTimeout(closeTimer);
      items.forEach((i, idx) => {
        const active = i === activeItem;
        i.classList.toggle('open', active);
        if (cols[idx]) cols[idx].classList.toggle('is-active', active);
      });
      bar.classList.add('open');
    };
    closeMegaNow = () => {
      clearTimeout(closeTimer);
      items.forEach(i => i.classList.remove('open'));
      cols.forEach(c => { if (c) c.classList.remove('is-active'); });
      bar.classList.remove('open');
    };
    const scheduleClose = () => {
      closeTimer = setTimeout(closeMegaNow, 150);
    };
    items.forEach(item => {
      item.addEventListener('mouseenter', () => { if (isDesktop()) openMega(item); });
      item.addEventListener('mouseleave', () => { if (isDesktop()) scheduleClose(); });
    });
    bar.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    bar.addEventListener('mouseleave', () => { if (isDesktop()) scheduleClose(); });
  })();

  const closeAllDropdowns = () => {
    document.querySelectorAll('.nav-item.has-dropdown.open').forEach(i => i.classList.remove('open'));
    closeMegaNow();
  };

  /* Delegated (not per-node) listener so triggers added later — like the
     login/account menu, which auth.js inserts after this script has
     already run — still open/close correctly. */
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.nav-drop-trigger');
    if (trigger) {
      const item = trigger.closest('.nav-item.has-dropdown');
      if (item) {
        e.preventDefault();
        const willOpen = !item.classList.contains('open');
        closeAllDropdowns();
        if (willOpen) {
          if (megaItems.includes(item)) {
            openMega(item);
          } else {
            item.classList.add('open');
          }
        }
        return;
      }
    }

    if (e.target.closest('.dropdown-link, .dropdown-viewall')) {
      closeAllDropdowns();
      if (navLinks && navLinks.classList.contains('mobile-open')) {
        navLinks.classList.remove('mobile-open');
        if (navToggle) navToggle.textContent = '☰';
      }
      return;
    }

    const insideOpenItem = [...document.querySelectorAll('.nav-item.has-dropdown.open')].some(i => i.contains(e.target));
    const insideBar = megaBar && megaBar.contains(e.target);
    if (!insideOpenItem && !insideBar) closeAllDropdowns();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllDropdowns();
  });
});


/* ============================================================
   PHASE 2 additions — dark mode, search, header actions
   ============================================================ */
const TOOL_SEARCH_INDEX = [{"n": "Merge PDF", "h": "merge-pdf.html", "c": "organize", "i": "🗂️"}, {"n": "Split PDF", "h": "split-pdf.html", "c": "organize", "i": "🗂️"}, {"n": "Remove Pages", "h": "remove-pdf-pages.html", "c": "organize", "i": "🗂️"}, {"n": "Extract Pages", "h": "extract-pdf-pages.html", "c": "organize", "i": "🗂️"}, {"n": "Organize PDF", "h": "organize-pdf.html", "c": "organize", "i": "🗂️"}, {"n": "Rotate PDF", "h": "rotate-pdf.html", "c": "organize", "i": "🗂️"}, {"n": "Image to PDF", "h": "image-to-pdf.html", "c": "convert", "i": "🔄"}, {"n": "PDF to Image", "h": "pdf-to-image.html", "c": "convert", "i": "🔄"}, {"n": "PDF to Text", "h": "pdf-to-text.html", "c": "convert", "i": "🔄"}, {"n": "Text to PDF", "h": "text-to-pdf.html", "c": "convert", "i": "🔄"}, {"n": "CSV to PDF", "h": "csv-to-pdf.html", "c": "convert", "i": "🔄"}, {"n": "Watermark PDF", "h": "watermark-pdf.html", "c": "edit", "i": "✏️"}, {"n": "Add Page Numbers", "h": "add-page-numbers-pdf.html", "c": "edit", "i": "✏️"}, {"n": "Crop PDF", "h": "crop-pdf.html", "c": "edit", "i": "✏️"}, {"n": "Add Image to PDF", "h": "add-image-to-pdf.html", "c": "edit", "i": "✏️"}, {"n": "Compress PDF", "h": "compress-pdf.html", "c": "optimize", "i": "⚡"}, {"n": "Grayscale PDF", "h": "grayscale-pdf.html", "c": "optimize", "i": "⚡"}, {"n": "Remove Blank Pages", "h": "remove-blank-pdf-pages.html", "c": "optimize", "i": "⚡"}, {"n": "Edit PDF Metadata", "h": "edit-pdf-metadata.html", "c": "edit", "i": "✏️"}, {"n": "Pages Per Sheet", "h": "pages-per-sheet-pdf.html", "c": "organize", "i": "🗂️"}, {"n": "Change PDF Page Size", "h": "change-pdf-page-size.html", "c": "edit", "i": "✏️"}, {"n": "QR Code Generator", "h": "qr-code-generator.html", "c": "convert", "i": "🔄"}, {"n": "Password Generator", "h": "password-generator.html", "c": "convert", "i": "🔄"}, {"n": "View PDF", "h": "view-pdf-online.html", "c": "organize", "i": "🗂️"}, {"n": "Repair PDF", "h": "repair-pdf.html", "c": "optimize", "i": "⚡"}, {"n": "Fill PDF Form", "h": "fill-pdf-form.html", "c": "edit", "i": "✏️"}, {"n": "WEBP to JPG/PNG", "h": "webp-to-jpg-png.html", "c": "convert", "i": "🔄"}, {"n": "HEIC to JPG/PNG", "h": "heic-to-jpg-png.html", "c": "convert", "i": "🔄"}, {"n": "Unlock PDF", "h": "unlock-pdf.html", "c": "optimize", "i": "⚡"}, {"n": "Reverse Page Order", "h": "reverse-pdf-pages.html", "c": "organize", "i": "🗂️"}, {"n": "Split by Page Ranges", "h": "split-pdf-by-pages.html", "c": "organize", "i": "🗂️"}, {"n": "Insert Blank Pages", "h": "insert-blank-pdf-pages.html", "c": "organize", "i": "🗂️"}, {"n": "Duplicate a Page", "h": "duplicate-pdf-page.html", "c": "organize", "i": "🗂️"}, {"n": "Image Format Converter", "h": "image-format-converter.html", "c": "convert", "i": "🔄"}, {"n": "Markdown to PDF", "h": "markdown-to-pdf.html", "c": "convert", "i": "🔄"}, {"n": "Lorem Ipsum PDF Generator", "h": "lorem-ipsum-pdf-generator.html", "c": "convert", "i": "🔄"}, {"n": "PDF Info & Word Count", "h": "pdf-word-count.html", "c": "convert", "i": "🔄"}, {"n": "JSON to PDF", "h": "json-to-pdf.html", "c": "convert", "i": "🔄"}, {"n": "Add Page Border", "h": "add-pdf-border.html", "c": "edit", "i": "✏️"}, {"n": "Header & Footer Text", "h": "pdf-header-footer.html", "c": "edit", "i": "✏️"}, {"n": "Invert PDF Colors", "h": "invert-pdf-colors.html", "c": "edit", "i": "✏️"}, {"n": "Bates Numbering", "h": "bates-numbering-pdf.html", "c": "edit", "i": "✏️"}, {"n": "Image Watermark", "h": "image-watermark.html", "c": "edit", "i": "✏️"}, {"n": "Add Caption to Image", "h": "add-image-caption.html", "c": "edit", "i": "✏️"}, {"n": "WiFi QR Code Generator", "h": "wifi-qr-code-generator.html", "c": "edit", "i": "✏️"}, {"n": "Contact Card QR Code", "h": "contact-card-qr-code.html", "c": "edit", "i": "✏️"}, {"n": "Image Compressor", "h": "compress-image.html", "c": "optimize", "i": "⚡"}, {"n": "Image Resizer", "h": "resize-image.html", "c": "optimize", "i": "⚡"}, {"n": "Image Rotator", "h": "rotate-image.html", "c": "optimize", "i": "⚡"}, {"n": "Batch Rename Files", "h": "batch-rename-files.html", "c": "optimize", "i": "⚡"}, {"n": "Text Case Converter", "h": "text-case-converter.html", "c": "convert", "i": "🔄"}, {"n": "Image Contact Sheet PDF", "h": "image-contact-sheet-pdf.html", "c": "edit", "i": "✏️"}, {"n": "Excel to CSV", "h": "excel-to-csv.html", "c": "office", "i": "💼"}, {"n": "CSV to Excel", "h": "csv-to-excel.html", "c": "office", "i": "💼"}, {"n": "Excel to PDF", "h": "excel-to-pdf.html", "c": "office", "i": "💼"}, {"n": "Excel to JSON", "h": "excel-to-json.html", "c": "office", "i": "💼"}, {"n": "JSON to Excel", "h": "json-to-excel.html", "c": "office", "i": "💼"}, {"n": "Merge Excel Files", "h": "merge-excel-files.html", "c": "office", "i": "💼"}, {"n": "Invoice Generator", "h": "invoice-generator.html", "c": "office", "i": "💼"}, {"n": "Word & Character Counter", "h": "word-character-counter.html", "c": "office", "i": "💼"}, {"n": "Percentage Calculator", "h": "percentage-calculator.html", "c": "office", "i": "💼"}, {"n": "EMI Calculator", "h": "emi-calculator.html", "c": "office", "i": "💼"}, {"n": "Age Calculator", "h": "age-calculator.html", "c": "office", "i": "💼"}, {"n": "Unit Converter", "h": "unit-converter.html", "c": "office", "i": "💼"}, {"n": "Timesheet Calculator", "h": "timesheet-calculator.html", "c": "office", "i": "💼"}, {"n": "Text Diff Checker", "h": "text-diff-checker.html", "c": "office", "i": "💼"}, {"n": "Barcode Generator", "h": "barcode-generator.html", "c": "office", "i": "💼"}];

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- Dark mode toggle ---------- */
  const themeBtn = document.getElementById('themeToggle');
  const root = document.documentElement;
  function applyTheme(t) {
    if (t === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isDark = root.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('tspdf-theme', next); } catch (e) {}
    });
  }

  /* ---------- Search panel ---------- */
  const searchToggle = document.getElementById('searchToggle');
  const searchPanel = document.getElementById('searchPanel');
  const searchBackdrop = document.getElementById('searchBackdrop');
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');

  function renderResults(query) {
    if (!searchResults) return;
    const q = query.trim().toLowerCase();
    const matches = q
      ? TOOL_SEARCH_INDEX.filter(t => t.n.toLowerCase().includes(q))
      : TOOL_SEARCH_INDEX.slice(0, 9);
    if (!matches.length) {
      searchResults.innerHTML = '<div class="search-empty">No tools match “' + query + '”. Try a shorter word.</div>';
      return;
    }
    searchResults.innerHTML = matches.map(t =>
      `<a class="search-result-item" href="${t.h}"><span>${t.i}</span><span>${t.n}</span></a>`
    ).join('');
  }

  function openSearch() {
    if (!searchPanel) return;
    searchPanel.classList.add('open');
    if (searchBackdrop) searchBackdrop.classList.add('open');
    renderResults('');
    setTimeout(() => searchInput && searchInput.focus(), 80);
  }
  function closeSearch() {
    if (!searchPanel) return;
    searchPanel.classList.remove('open');
    if (searchBackdrop) searchBackdrop.classList.remove('open');
  }
  if (searchToggle) {
    searchToggle.addEventListener('click', () => {
      searchPanel.classList.contains('open') ? closeSearch() : openSearch();
    });
  }
  if (searchBackdrop) searchBackdrop.addEventListener('click', closeSearch);
  if (searchInput) searchInput.addEventListener('input', () => renderResults(searchInput.value));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSearch();
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  });

  /* ---------- Newsletter form (client-side stub, no backend yet) ---------- */
  document.querySelectorAll('.newsletter-form, .soon-form').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const msg = form.querySelector('.form-msg');
      const input = form.querySelector('input[type="email"], input');
      if (msg) {
        msg.textContent = "You're on the list — we'll email " + (input ? input.value : 'you') + ' when this launches.';
        msg.classList.add('show');
      }
      form.reset();
    });
  });
});
