/* ============================================================
   AI TOOL SIGN-IN GATE
   Requires a signed-in user before any AI tool is allowed to call
   the AI backend (window.TSPDF_AI_ENDPOINT). Implemented by wrapping
   the global fetch() so it works regardless of script load order or
   how an individual AI tool page wires up its Generate button.
   Loaded on every ai-*.html page, right after auth.js.
   ============================================================ */
(function () {
  var cachedUser = undefined; // undefined = not resolved yet, null = signed out
  document.addEventListener('tspdf-auth-changed', function (e) {
    cachedUser = e.detail ? e.detail.user : null;
  });

  function isSignedIn() {
    if (window.TSPDF_AUTH && typeof TSPDF_AUTH.currentUser === 'function') {
      if (TSPDF_AUTH.currentUser()) return true;
    }
    return !!cachedUser;
  }

  function redirectToLogin() {
    var here = window.location.pathname + window.location.search;
    window.location.href = 'login.html?redirect=' + encodeURIComponent(here) + '&reason=ai-tool';
  }

  var originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!originalFetch) return;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var isAiCall =
      (window.TSPDF_AI_ENDPOINT && url === window.TSPDF_AI_ENDPOINT) ||
      (window.TSPDF_AI_IMAGE_ENDPOINT && url === window.TSPDF_AI_IMAGE_ENDPOINT);

    if (!isAiCall) return originalFetch(input, init);

    // Only enforce the gate if Firebase auth is actually configured on this
    // deployment — if it isn't, fail open so the tool still works.
    if (window.TSPDF_AUTH && !isSignedIn()) {
      redirectToLogin();
      return Promise.reject(new Error('Please sign in to use AI tools.'));
    }

    // Attach the signed-in user's Firebase ID token so the API endpoint can
    // verify the request server-side (client-side checks alone can be
    // bypassed by calling the endpoint directly).
    var attachTokenAndSend = function (idToken) {
      init = init || {};
      var headers = new Headers(init.headers || {});
      if (idToken) headers.set('Authorization', 'Bearer ' + idToken);
      init.headers = headers;
      return originalFetch(input, init);
    };

    if (window.TSPDF_AUTH && typeof TSPDF_AUTH.getIdToken === 'function') {
      return TSPDF_AUTH.getIdToken().then(attachTokenAndSend);
    }
    return attachTokenAndSend(null);
  };
})();
