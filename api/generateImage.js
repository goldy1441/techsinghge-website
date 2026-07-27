/* ============================================================
   Vercel Serverless Function — /api/generateImage
   FREE (no card needed for Vercel's Hobby plan).
   This is the only place your Gemini API key lives; the website
   calls this endpoint, this function calls Gemini's image model,
   the key never touches the browser.

   HOW TO DEPLOY:
     1. Put this file at:  api/generateImage.js
        (inside your project's root folder, next to index.html)
     2. In Vercel dashboard → your project → "Settings" →
        "Environment Variables" → make sure this exists (it's the
        SAME key already used by api/generateText.js):
          Name:  GEMINI_API_KEY
          Value: <your Gemini key from aistudio.google.com/apikey>
        → Save
     3. Deploy (push to GitHub if connected, or re-upload /
        redeploy from the Vercel dashboard)
     4. Your endpoint will be:
        https://YOUR-PROJECT.vercel.app/api/generateImage
     5. Paste that URL into firebase-config.js as
        window.TSPDF_AI_IMAGE_ENDPOINT
   ============================================================ */

const TOOL_PROMPTS = {
  "image-generator": "Generate a single high-quality, photorealistic or artistic image (as requested) based on the user's description. Do not add any text, watermark, or borders unless explicitly asked.",
  "logo-generator": "Generate a single clean, modern, professional logo based on the user's description. The logo should work well on a plain white or transparent background, use simple bold shapes and at most 2-3 colors, avoid photorealistic detail, and avoid any watermark or extra text beyond what the user explicitly asked to include (such as a brand name).",
  "default": "Generate a single high-quality image based on the user's description."
};

const MAX_INPUT_CHARS = 2000;

// Only these origins are allowed to call this endpoint. Restricting this
// (instead of using "*") stops other sites from using your Gemini quota.
const ALLOWED_ORIGINS = [
  "https://www.techsinghge.in",
  "https://techsinghge.in"
];

// --- Firebase ID token verification -----------------------------------
// See api/generateText.js for full notes. SECURITY: fails CLOSED now —
// missing service-account config or a missing/invalid token both reject
// the request; neither case is allowed through.
let _adminApp;
let _adminInitError = null;
function getAdmin() {
  if (_adminApp) return _adminApp;
  if (_adminInitError) return null;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    _adminInitError = "FIREBASE_SERVICE_ACCOUNT_KEY is not set";
    return null;
  }
  try {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
      });
    }
    _adminApp = admin;
    return admin;
  } catch (e) {
    console.error("Firebase Admin init failed:", e);
    _adminInitError = e.message || "init failed";
    return null;
  }
}

async function verifyUser(req) {
  const admin = getAdmin();
  if (!admin) return { ok: false, code: 500, error: _adminInitError };
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) return { ok: false, code: 401 };
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return { ok: true, uid: decoded.uid };
  } catch (e) {
    return { ok: false, code: 401 };
  }
}

// --- Minimal in-memory rate limiting -----------------------------------
// Same reliability caveat as api/generateText.js (does NOT hold across
// serverless instances — use Upstash Redis/Vercel KV for real production
// limits). Image generation is capped tighter than text since it's more
// expensive per request.
const _rateBuckets = new Map();
const RATE_LIMIT_MAX = 8; // requests
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes, per uid
function checkRateLimit(uid) {
  const now = Date.now();
  const bucket = _rateBuckets.get(uid);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    _rateBuckets.set(uid, { start: now, count: 1 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    res.status(400).json({ error: "Content-Type must be application/json." });
    return;
  }

  const auth = await verifyUser(req);
  if (!auth.ok) {
    if (auth.code === 500) {
      console.error("Auth verification unavailable:", auth.error);
      res.status(500).json({ error: "Server is temporarily misconfigured. Please try again shortly." });
    } else {
      res.status(401).json({ error: "Please sign in to use AI tools." });
    }
    return;
  }

  if (!checkRateLimit(auth.uid)) {
    res.status(429).json({ error: "Too many image requests — please wait a few minutes and try again." });
    return;
  }

  const body = req.body || {};
  const { tool, input } = body;

  if (typeof tool !== "undefined" && typeof tool !== "string") {
    res.status(400).json({ error: "Invalid 'tool' value." });
    return;
  }
  if (!input || typeof input !== "string" || !input.trim()) {
    res.status(400).json({ error: "Missing 'input' description." });
    return;
  }
  if (input.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Description too long — keep it under ${MAX_INPUT_CHARS} characters.` });
    return;
  }

  const systemPrompt = Object.prototype.hasOwnProperty.call(TOOL_PROMPTS, tool)
    ? TOOL_PROMPTS[tool]
    : TOOL_PROMPTS.default;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\nUser's request: ${input}` }]
            }
          ],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"]
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini image error:", errText);
      res.status(502).json({ error: "AI image provider error. Please try again." });
      return;
    }

    const data = await geminiRes.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData && p.inlineData.data);
    const textPart = parts.find((p) => p.text);

    if (!imagePart) {
      res.status(502).json({
        error:
          (textPart && textPart.text) ||
          "No image was generated. Try rephrasing your description."
      });
      return;
    }

    res.status(200).json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType || "image/png"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong generating the image." });
  }
};
