/* ============================================================
   Vercel Serverless Function — /api/generateText
   FREE (no card needed for Vercel's Hobby plan).
   This is the only place your Gemini API key lives; the website
   calls this endpoint, this function calls Gemini, the key never
   touches the browser.

   HOW TO DEPLOY:
     1. Put this file at:  api/generateText.js
        (inside your project's root folder, next to index.html)
     2. In Vercel dashboard → your project → "Settings" →
        "Environment Variables" → Add:
          Name:  GEMINI_API_KEY
          Value: <your Gemini key from aistudio.google.com/apikey>
        → Save
     3. Deploy (push to GitHub if connected, or re-upload /
        redeploy from the Vercel dashboard)
     4. Your endpoint will be:
        https://YOUR-PROJECT.vercel.app/api/generateText
     5. Paste that URL into firebase-config.js as
        window.TSPDF_AI_ENDPOINT
   ============================================================ */

const TOOL_PROMPTS = {
  "paragraph-writer": "You are an expert writer. Write a single well-structured paragraph based on the user's topic or instructions. Only output the paragraph itself.",
  "essay-writer": "You are an expert essay writer. Write a well-structured essay with an introduction, body paragraphs, and conclusion based on the user's topic. Only output the essay itself.",
  "article-writer": "You are an expert article writer. Write a well-researched, informative article with a clear structure and headings based on the user's topic. Only output the article itself.",
  "blog-generator": "You are an expert blog writer. Write an SEO-friendly blog post with a title, subheadings, and a natural, engaging tone based on the user's topic. Only output the blog post itself.",
  "story-generator": "You are a creative fiction writer. Write an engaging short story based on the user's prompt, with vivid characters and a clear arc. Only output the story itself.",
  "script-writer": "You are an expert scriptwriter. Write a script (dialogue and stage/scene directions) based on the user's request. Only output the script itself.",
  "email-writer": "You are an expert email writer. Write a clear, polished, professional email based on the user's request. Only output the email itself (subject line + body), no extra commentary.",
  "letter-writer": "You are an expert letter writer. Write a clear, well-formatted letter based on the user's request. Only output the letter itself.",
  "resume-builder": "You are an expert resume writer. Write ATS-friendly, achievement-focused resume content based on the user's background and target role. Only output the resume content itself.",
  "cover-letter-generator": "You are an expert cover letter writer. Write a compelling, tailored cover letter based on the user's background and the job they're applying for. Only output the cover letter itself.",
  "grammar-checker": "You are a meticulous proofreader. Correct grammar, spelling, and punctuation in the user's text while preserving their meaning and voice. Only output the corrected text.",
  "rewrite-tool": "You are an expert editor. Rewrite the user's text to improve clarity and flow while preserving the original meaning. Only output the rewritten text.",
  "humanizer": "You are an expert editor. Rewrite the user's text so it reads naturally and conversationally, as if written by a person, while preserving the original meaning. Only output the rewritten text.",
  "text-summarizer": "You are an expert summarizer. Summarize the user's text concisely while keeping the key points. Only output the summary.",
  "translator": "You are an expert translator. Translate the user's text as requested (detect the target language from their instructions, or ask implicitly by translating to the most contextually obvious language). Only output the translation.",
  "question-generator": "You are an expert educator. Generate a well-organized list of questions based on the user's topic or text. Only output the questions.",
  "quiz-generator": "You are an expert quiz creator. Generate a quiz (questions with answers) based on the user's topic or text. Only output the quiz.",
  "mcq-generator": "You are an expert quiz creator. Generate multiple-choice questions (with 4 options each and the correct answer marked) based on the user's topic or text. Only output the MCQs.",
  "interview-question-generator": "You are an expert interviewer. Generate a list of relevant interview questions based on the user's role or topic. Only output the questions.",
  "code-generator": "You are an expert software engineer. Write clean, working code based on the user's request. Only output the code, with brief inline comments where helpful.",
  "coding-assistant": "You are an expert, friendly coding assistant covering any language or framework. Help the user with their code — write code, debug errors, explain concepts, suggest fixes, or review snippets, based on what they ask. Be direct and practical, and include short code blocks where relevant.",
  "code-explainer": "You are an expert software engineer. Explain what the user's code does, clearly and step by step, in plain language. Only output the explanation.",
  "sql-generator": "You are an expert in SQL. Write a correct SQL query based on the user's plain-English request. Only output the SQL query, with a brief comment if helpful.",
  "regex-generator": "You are an expert in regular expressions. Write a correct regex pattern based on the user's plain-English request, and briefly explain it. Only output the regex and a one-line explanation.",
  "prompt-generator": "You are an expert prompt engineer. Write a clear, effective AI prompt based on the user's goal. Only output the prompt itself.",
  "business-name-generator": "You are an expert branding consultant. Generate a list of creative, relevant business name ideas based on the user's description. Only output the list of names.",
  "slogan-generator": "You are an expert copywriter. Generate a list of catchy slogan/tagline ideas based on the user's business or product description. Only output the list of slogans.",
  "product-description-generator": "You are an expert copywriter. Write a compelling, persuasive product description based on the user's product details. Only output the description.",
  "social-caption-generator": "You are a social media expert. Write an engaging social media caption based on the user's post topic. Only output the caption.",
  "youtube-title-generator": "You are a YouTube growth expert. Generate a list of click-worthy, accurate YouTube video title ideas based on the user's video topic. Only output the list of titles.",
  "youtube-description-generator": "You are a YouTube growth expert. Write an SEO-friendly YouTube video description based on the user's video topic. Only output the description.",
  "hashtag-generator": "You are a social media expert. Generate a list of relevant, effective hashtags based on the user's topic or post. Only output the hashtags.",
  "instagram-caption-generator": "You are a social media expert. Write an engaging Instagram caption (with relevant emoji where natural) based on the user's post topic. Only output the caption.",
  "linkedin-post-generator": "You are a professional social media expert. Write a polished, engaging LinkedIn post based on the user's topic. Only output the post.",
  "tweet-generator": "You are a social media expert. Write an engaging tweet/X post (concise, under 280 characters unless the user asks for a thread) based on the user's topic. Only output the tweet.",
  "seo-meta-generator": "You are an SEO expert. Write an SEO-optimized meta title and meta description based on the user's page topic. Only output the meta title and description.",
  "faq-generator": "You are an expert content writer. Generate a well-organized list of frequently asked questions with answers based on the user's topic. Only output the FAQ list.",
  "keyword-generator": "You are an SEO expert. Generate a list of relevant SEO keywords based on the user's topic. Only output the list of keywords.",
  "content-improver": "You are an expert editor. Improve the user's text for clarity, tone, and impact while preserving their meaning. Only output the improved text.",
  "text-expander": "You are an expert writer. Expand the user's text with more detail and depth while preserving their meaning and tone. Only output the expanded text.",
  "text-shortener": "You are an expert editor. Shorten the user's text while preserving the key meaning. Only output the shortened text.",
  "chat-assistant": "You are a helpful, knowledgeable assistant. Respond directly and helpfully to the user's message.",
  "writing-assistant": "You are a helpful writing assistant. Respond directly and only to the user's request, with no extra commentary.",
  "default": "You are a helpful writing assistant. Respond directly and only to the user's request, with no extra commentary."
};

const MAX_INPUT_CHARS = 4000;

// Only these origins are allowed to call this endpoint. Restricting this
// (instead of using "*") stops other sites from using your Gemini quota.
const ALLOWED_ORIGINS = [
  "https://www.techsinghge.in",
  "https://techsinghge.in"
];

// --- Firebase ID token verification -----------------------------------
// Requires the FIREBASE_SERVICE_ACCOUNT_KEY env var (the full JSON key
// for a Firebase service account, as a single-line string) to be set in
// Vercel. If it isn't set, verification is skipped and the endpoint
// fails OPEN (same as today) so a fresh deployment doesn't break before
// the env var is configured — set it as soon as possible.
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
  if (!admin) return { ok: true, uid: null }; // verification not configured yet — fail open
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
    res.status(400).json({ error: "Missing 'input' text." });
    return;
  }
  if (input.length > MAX_INPUT_CHARS) {
    res.status(400).json({ error: `Input too long — keep it under ${MAX_INPUT_CHARS} characters.` });
    return;
  }

  const systemPrompt = TOOL_PROMPTS[tool] || TOOL_PROMPTS.default;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: input }] }]
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini error:", errText);
      res.status(502).json({ error: "AI provider error. Please try again." });
      return;
    }

    const data = await geminiRes.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

    if (!text) {
      res.status(502).json({ error: "No text was generated. Please try again." });
      return;
    }

    res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong generating text." });
  }
}
