/* ============================================================
   ⚠️ LEGACY / NOT IN PRODUCTION — moved to _legacy/ on 23 Jul 2026.

   firebase-config.js's window.TSPDF_AI_ENDPOINT points at
   https://www.techsinghge.in/api/generateText (the Vercel serverless
   function in /api/generateText.js), which is the live production
   backend. No page on the site currently references this file.

   Kept here only as a documented fallback/reference in case you ever
   want to move off Vercel to Cloudflare Workers — it is NOT deployed
   and NOT called by anything today. If you confirm you'll never need
   it, it's safe to delete outright.
   ============================================================ */

/* ============================================================
   Cloudflare Worker — generateText
   FREE alternative to Firebase Cloud Functions (no card, no
   billing plan needed). This is the only place your Gemini API
   key lives; the website calls this Worker, the Worker calls
   Gemini, the key never touches the browser.

   HOW TO DEPLOY (no terminal needed):
     1. Go to https://dash.cloudflare.com → sign up free (no card)
     2. Left sidebar → "Workers & Pages" → "Create" → "Create Worker"
     3. Give it a name, e.g. "techsinghge-ai" → Deploy (deploys a
        blank starter worker first)
     4. Click "Edit code" → delete everything in the editor →
        paste this WHOLE file in → click "Deploy"
     5. Go to the Worker's "Settings" → "Variables and Secrets" →
        "Add" → Name: GEMINI_API_KEY, Value: <your Gemini key>,
        Type: Secret → Save and deploy
     6. Copy the Worker's URL (looks like
        https://techsinghge-ai.YOUR-SUBDOMAIN.workers.dev)
     7. Paste that URL into firebase-config.js as
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

// CHANGE THIS to your real website's origin before going live,
// e.g. "https://www.techsinghge.in" — restricting it stops other
// sites from using your free Gemini quota.
const ALLOWED_ORIGIN = "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Use POST" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    const { tool, input } = body || {};
    if (!input || typeof input !== "string" || !input.trim()) {
      return new Response(JSON.stringify({ error: "Missing 'input' text." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
    if (input.length > MAX_INPUT_CHARS) {
      return new Response(
        JSON.stringify({ error: `Input too long — keep it under ${MAX_INPUT_CHARS} characters.` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    const systemPrompt = TOOL_PROMPTS[tool] || TOOL_PROMPTS.default;

    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
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
        return new Response(JSON.stringify({ error: "AI provider error. Please try again." }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }

      const data = await geminiRes.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

      if (!text) {
        return new Response(JSON.stringify({ error: "No text was generated. Please try again." }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }

      return new Response(JSON.stringify({ text }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: "Something went wrong generating text." }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }
  }
};
