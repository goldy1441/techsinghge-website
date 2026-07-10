/* ============================================================
   SITE ENHANCEMENTS — notifications bell, favorites, share
   buttons, the homepage Featured/Trending tab switcher, and the
   honest click-to-rate widget. Every piece checks for its own
   elements before wiring up, so this file is safe to include on
   every page site-wide.
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {

  /* ---------- Notifications bell ---------- */
  (function () {
    var toggle = document.getElementById('notifToggle');
    var panel = document.getElementById('notifPanel');
    var dot = document.getElementById('notifDot');
    if (!toggle || !panel) return;
    if (localStorage.getItem('tspdf-notif-seen') === '1' && dot) dot.style.display = 'none';
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        localStorage.setItem('tspdf-notif-seen', '1');
        if (dot) dot.style.display = 'none';
      }
    });
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== toggle) panel.classList.remove('open');
    });
  })();

  /* ---------- Favorites (heart toggle on featured/tool cards) ---------- */
  (function () {
    var KEY = 'tspdf-favorites';
    function getFavs() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
    function setFavs(list) { localStorage.setItem(KEY, JSON.stringify(list)); }
    var favs = getFavs();
    document.querySelectorAll('.feat-icon-btn.fav-btn').forEach(function (btn) {
      var id = btn.dataset.toolId;
      if (favs.indexOf(id) > -1) btn.classList.add('is-fav');
      btn.addEventListener('click', function () {
        var list = getFavs();
        var idx = list.indexOf(id);
        if (idx > -1) { list.splice(idx, 1); btn.classList.remove('is-fav'); }
        else { list.push(id); btn.classList.add('is-fav'); }
        setFavs(list);
      });
    });
  })();

  /* ---------- Share (Web Share API, falls back to copy link) ---------- */
  document.querySelectorAll('.feat-icon-btn.share-btn, .icon-btn.share-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var url = btn.dataset.shareUrl || window.location.href;
      var title = btn.dataset.shareTitle || document.title;
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
      } else {
        navigator.clipboard && navigator.clipboard.writeText(url);
        var old = btn.textContent;
        btn.textContent = '✓';
        setTimeout(function () { btn.textContent = old; }, 1200);
      }
    });
  });

  /* ---------- Featured Tools tab switcher (homepage) ---------- */
  (function () {
    var tabs = document.querySelectorAll('.feat-tab');
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        document.querySelectorAll('.feat-panel').forEach(function (p) { p.classList.remove('active'); });
        var target = document.getElementById(tab.dataset.panel);
        if (target) target.classList.add('active');
      });
    });
  })();

  /* ---------- Honest click-to-rate widget (no pre-filled fake scores) ---------- */
  document.querySelectorAll('.rate-widget').forEach(function (widget) {
    var key = 'tspdf-rating:' + (widget.dataset.rateKey || window.location.pathname);
    var stars = widget.querySelectorAll('.rw-star');
    var msg = widget.querySelector('.rw-msg');
    var saved = localStorage.getItem(key);
    function paint(n) {
      stars.forEach(function (s, i) { s.classList.toggle('active', i < n); });
    }
    if (saved) { paint(parseInt(saved, 10)); if (msg) msg.textContent = 'Thanks for rating!'; }
    stars.forEach(function (star, i) {
      star.addEventListener('click', function () {
        localStorage.setItem(key, String(i + 1));
        paint(i + 1);
        if (msg) msg.textContent = 'Thanks for rating!';
      });
    });
  });

  /* ---------- Newsletter forms with class "real-newsletter-form" (footer + popup) ----------
     Saves the email to Firestore (collection: newsletter_subscribers). Firebase is already
     initialized by auth.js (loaded before this file runs). If Firestore isn't reachable for
     any reason, we still show the "Thanks!" message so the page never looks broken. */
  document.querySelectorAll('.real-newsletter-form').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = form.querySelector('.form-msg');
      var emailInput = form.querySelector('input[type="email"]');
      var email = emailInput ? emailInput.value.trim() : '';
      var btn = form.querySelector('button[type="submit"]');

      function finish() {
        if (msg) msg.textContent = "Thanks! We'll be in touch.";
        form.reset();
        if (btn) btn.disabled = false;
      }

      if (btn) btn.disabled = true;

      if (window.firebase && firebase.apps && firebase.apps.length && email && firebase.firestore) {
        firebase.firestore().collection('newsletter_subscribers').add({
          email: email,
          page: window.location.pathname,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(finish).catch(function (err) {
          console.error('Newsletter save failed:', err);
          finish(); // don't expose the failure to the visitor
        });
      } else {
        finish();
      }
    });
  });

});

/* ================= Subscribe popup (corner card, homepage only) =================
   Deliberately isolated in its own DOMContentLoaded listener + try/catch, so a bug
   anywhere else on the page (bell dropdown, tabs, ratings, etc.) can never stop
   this from running. */
document.addEventListener('DOMContentLoaded', function () {
  try {
    var subPopup = document.getElementById('subscribePopup');
    if (!subPopup) return;

    var SUB_DISMISS_KEY = 'tspdf-subscribe-popup-dismissed';
    var SUB_DISMISS_DAYS = 3;
    var lastDismissed = parseInt(localStorage.getItem(SUB_DISMISS_KEY) || '0', 10);
    var daysSince = (Date.now() - lastDismissed) / (1000 * 60 * 60 * 24);
    var alreadySubscribed = localStorage.getItem('tspdf-subscribed') === '1';

    function hideSubPopup() {
      subPopup.classList.remove('show');
    }
    function dismissSubPopup() {
      localStorage.setItem(SUB_DISMISS_KEY, String(Date.now()));
      hideSubPopup();
    }

    if (!alreadySubscribed && daysSince > SUB_DISMISS_DAYS) {
      setTimeout(function () {
        subPopup.classList.add('show');
      }, 6000);
    }

    var subCloseBtn = document.getElementById('subscribePopupClose');
    if (subCloseBtn) subCloseBtn.addEventListener('click', dismissSubPopup);

    var subForm = subPopup.querySelector('.real-newsletter-form');
    if (subForm) {
      subForm.addEventListener('submit', function () {
        localStorage.setItem('tspdf-subscribed', '1');
        setTimeout(hideSubPopup, 1800);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideSubPopup();
    });
  } catch (err) {
    console.error('Subscribe popup init failed:', err);
  }
});
