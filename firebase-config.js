/* ============================================================
   FIREBASE CONFIG — fill this in with YOUR Firebase project's
   values (Firebase Console → Project settings → General →
   "Your apps" → SDK setup and configuration → Config).
   These values are safe to expose in client-side code — they
   are not secret keys, just public project identifiers.
   ============================================================ */
window.TSPDF_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDY_k-xK_OIo6pokilIkVQZNXWFjUaQGcg",
  authDomain: "techsinghge-pdf-and-ai-tools.firebaseapp.com",
  projectId: "techsinghge-pdf-and-ai-tools",
  storageBucket: "techsinghge-pdf-and-ai-tools.firebasestorage.app",
  messagingSenderId: "720810097415",
  appId: "1:720810097415:web:88566e9154f463152a23a2"
};

/* URL of the /api/generateText serverless function. Hardcoded with
   "www" so it works the same whether the page itself was loaded on
   the bare apex domain or the www subdomain — calling a RELATIVE path
   from the apex domain would first hit the apex→www redirect, which
   can break fetch() with a generic "Failed to fetch" error. */
window.TSPDF_AI_ENDPOINT = "https://www.techsinghge.in/api/generateText";

/* URL of the /api/generateImage serverless function — used by the
   AI Image Generator and AI Logo Generator tools. Same key/backend
   as above, just a different endpoint + model (Gemini image output). */
window.TSPDF_AI_IMAGE_ENDPOINT = "https://www.techsinghge.in/api/generateImage";
