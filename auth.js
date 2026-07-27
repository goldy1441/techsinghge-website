/* ============================================================
   AUTH — Firebase email/password + Google sign-in, and
   swaps the header's "Log in / Start Free" links for an
   account badge + logout button once the user is signed in.
   Loaded on every page (after firebase-config.js).
   ============================================================ */
(function () {
  if (!window.firebase || !window.TSPDF_FIREBASE_CONFIG || window.TSPDF_FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
    // Firebase not configured yet — skip silently so the rest of the site still works.
    return;
  }
  firebase.initializeApp(window.TSPDF_FIREBASE_CONFIG);
  const auth = firebase.auth();

  function initials(name, email) {
    const src = (name || email || "?").trim();
    return src.slice(0, 2).toUpperCase();
  }

  function renderLoggedIn(user) {
    const navLinks = document.getElementById("navLinks");
    if (!navLinks) return;
    // Already rendered on this page load (auth state can fire more than once) — skip.
    if (navLinks.querySelector(".nav-account")) return;

    const loginLink = navLinks.querySelector('a[href="login.html"]');
    const signupLink = navLinks.querySelector('a[href="signup.html"]');
    if (loginLink) loginLink.remove();
    if (!signupLink) return;

    const first = (user.displayName || user.email || "Account").split(" ")[0];
    const tag = initials(user.displayName, user.email);

    const wrap = document.createElement("div");
    wrap.className = "nav-item has-dropdown nav-account";
    wrap.innerHTML = `
      <button type="button" class="nav-drop-trigger nav-account-trigger">
        <span class="nav-avatar">${tag}</span>${first} <span class="caret">▾</span>
      </button>
      <div class="dropdown-panel nav-account-panel">
        <div class="nav-account-email">${user.email || ""}</div>
        <a class="dropdown-link" href="account.html"><span class="dd-icon">⚙️</span><span><b>Account settings</b><small>Password &amp; profile details</small></span></a>
        <div class="dropdown-divider"></div>
        <button type="button" class="dropdown-link nav-account-logout"><span class="dd-icon">🚪</span><span><b>Log out</b><small>Sign out of this device</small></span></button>
      </div>
    `;
    signupLink.replaceWith(wrap);

    wrap.querySelector(".nav-account-logout").addEventListener("click", () => {
      auth.signOut().then(() => { window.location.href = "index.html"; });
    });
  }

  function renderLoggedOut() {
    // Each page load renders the default "Log in / Start Free" links fresh from
    // the HTML, so there's nothing to restore here — this only runs once the
    // (already logged-out) page has rendered its normal markup.
  }

  auth.onAuthStateChanged((user) => {
    if (user) renderLoggedIn(user);
    else renderLoggedOut();
    document.dispatchEvent(new CustomEvent("tspdf-auth-changed", { detail: { user } }));
  });

  /* ---------- Exposed helpers used by login.html / signup.html forms ---------- */
  window.TSPDF_AUTH = {
    signUp(email, password) {
      return auth.createUserWithEmailAndPassword(email, password);
    },
    logIn(email, password) {
      return auth.signInWithEmailAndPassword(email, password);
    },
    googleSignIn() {
      const provider = new firebase.auth.GoogleAuthProvider();
      return auth.signInWithPopup(provider);
    },
    logOut() {
      return auth.signOut();
    },
    getIdToken() {
      const user = auth.currentUser;
      return user ? user.getIdToken() : Promise.resolve(null);
    },
    currentUser() {
      return auth.currentUser;
    },
    onChange(cb) {
      return auth.onAuthStateChanged(cb);
    },
    /* Sends a "reset your password" email — used by both the login page's
       "Forgot password?" link and the account page (in case someone knows
       their email but not their current password). */
    sendPasswordReset(email) {
      return auth.sendPasswordResetEmail(email);
    },
    /* Changing a password requires re-proving the current one first
       (Firebase rejects updatePassword on a "stale" sign-in otherwise). */
    changePassword(currentPassword, newPassword) {
      const user = auth.currentUser;
      if (!user || !user.email) return Promise.reject(new Error("You need to be signed in to change your password."));
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      return user.reauthenticateWithCredential(cred).then(() => user.updatePassword(newPassword));
    },
    updateDisplayName(name) {
      const user = auth.currentUser;
      if (!user) return Promise.reject(new Error("You need to be signed in to do that."));
      return user.updateProfile({ displayName: name });
    }
  };
})();
