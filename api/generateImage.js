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
// See api/generateText.js for full notes. Requires FIREBASE_SERVICE_ACCOUNT_KEY
// to be set in Vercel; fails open (same as today) until it is.
let _adminApp;
function getAdmin() {
  if (_adminApp) return _adminApp;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) return null;
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
    });
  }
  _adminApp = admin;
  return admin;
}

async function verifyUser(req) {
  const admin = getAdmin();
  if (!admin) return { ok: true, uid: null };
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) return { ok: false };
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return { ok: true, uid: decoded.uid };
  } catch (e) {
    return { ok: false };
  }
}

module.exports = async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const auth = await verifyUser(req);
  if (!auth.ok) {
    res.status(401).json({ error: "Please sign in to use AI tools." });
    return;
  }

  const { tool, input } = req.body || {};
  if (!input || typeof input !== "string" || !input.trim()) {
    res.status(400).json({ error: "Missing 'input' description." });
    return;
  }
  if (input.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Description too long — keep it under ${MAX_INPUT_CHARS} characters.` });
    return;
  }

  const systemPrompt = TOOL_PROMPTS[tool] || TOOL_PROMPTS.default;

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
