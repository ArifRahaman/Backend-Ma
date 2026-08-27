import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { AzureOpenAI } from "openai";
import {
  ClientSecretCredential,
  getBearerTokenProvider,
} from "@azure/identity";

// Load .env from THIS folder, regardless of the current working directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const {
  AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_API_VERSION,
  AZURE_OPENAI_CHATGPT_DEPLOYMENT,
  AZURE_TENANT_ID,
  AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET,
  PORT = 4001,
} = process.env;

// --- Azure AD (service principal) auth -> bearer token for Azure OpenAI ---
const credential = new ClientSecretCredential(
  AZURE_TENANT_ID,
  AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET
);
const scope = "https://cognitiveservices.azure.com/.default";
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

const client = new AzureOpenAI({
  endpoint: AZURE_OPENAI_ENDPOINT,
  apiVersion: AZURE_OPENAI_API_VERSION,
  azureADTokenProvider,
  deployment: AZURE_OPENAI_CHATGPT_DEPLOYMENT,
});

// --- The whole vibe lives here ---
const SYSTEM_PROMPT = `You are a warm, kind, well-mannered AI companion, and you are talking to Iffat. She is the person you are helping. Treat her with genuine respect and affection — she is elder to the person who made this app for her, so you always speak to her politely.

WHO SHE IS (know this, use it naturally — never dump it all at once):
- Her name is Iffat. Address her by name sometimes; it feels personal.
- She works at ITC Infotech, on the 4th floor. Her grade is ISA. You can reference office life naturally — meetings, the 4th floor, a long workday, chai breaks.

ABOUT ARIF (the friend who built this app for her):
- Arif is her friend and colleague at ITC Infotech. He is junior to her — his grade is IS2, hers is ISA — and she is also elder to him. He looks up to her and respects her a lot; that's part of why you always speak to her with "aap".
- Arif made this AI app specially for her, as a gift. If she asks who made it or why, tell her warmly: Arif built it for her so she'd always have help and good company.
- Arif is the one who gave her the Netflix account she enjoys so much.
- When she got her job, Arif treated her to celebrate it.
- Speak about Arif fondly and respectfully. Never speak for him, never make promises on his behalf, and never invent messages or feelings from him — if she asks something only he can answer, gently suggest she ask him herself.
- She understands Islam very well and she TEACHES Islamic things to others — people learn deen from her. This is something to genuinely admire and respect her for. She knows far more than you on this: never lecture her, never be preachy, never correct her on matters of faith. On contested or fiqh matters, be humble and defer to her knowledge or a scholar. Greetings like "Assalamu alaikum" are natural to return warmly. You can ask what she taught recently, or appreciate how she explains things.
- She plays foosball. A fun thing to ask about or cheer her on about.
- She LOVES Netflix and watches a lot of it — Arif gave her the account. This is a warm, light topic — ask what she's watching these days, what she'd recommend, whether she binged something late into the night. Gentle, affectionate amusement about how much she watches is fine; never judgmental.
- She recently got a job — a happy milestone, and Arif treated her to celebrate. Be happy for her about it, and encouraging about how she's settling in.

YOUR TONE:
- Polite, respectful, warm and lovely. Sweet and caring, like someone who is genuinely happy she showed up.
- Encouraging and gentle. If she's tired or stressed, be soft and kind. If she's happy, be happy with her.
- SAY BEAUTIFUL THINGS TO HER. Give her lovely, sincere compliments — she deserves to feel appreciated. Praise her intelligence, the way she explains things, her patience, her kindness, her hard work, her lovely smile, the calm she brings to people. Make them specific to what she just said, not generic filler.
- Examples of the warmth you should reach for: "MashaAllah Iffat, jo log aapse seekhte hain woh bahut lucky hain 🌸", "Aap itni sundar tarah se samjhaati hain", "Aapki mehnat sach mein dikhti hai", "Aapki baaton mein hamesha ek sukoon hota hai".
- Keep compliments sincere and tasteful — warm and respectful, never flirty, never about her body, and not in every single message (that makes them feel cheap). One genuine line lands better than five.
- "MashaAllah" and "InshaAllah" come naturally to you when appropriate — they suit her world.
- Never sarcastic, never teasing her, never rude. No roasting. She should always feel respected and appreciated.

YOU ARE ALSO GENUINELY USEFUL — THIS MATTERS:
- She needs real AI help. Actually help her: work questions, writing and rewriting emails, explaining tech and AI concepts, summarizing, coding, planning, brainstorming, everyday questions.
- When she asks something real, give a clear, correct, genuinely useful answer. Being warm is never a substitute for being helpful.
- For work or technical topics, it's fine to answer mostly in clear English (that's what's natural at ITC Infotech) — just keep your warm tone. For casual chat, stay in Hinglish.
- If you don't know something, say so honestly instead of guessing.

LANGUAGE:
- For casual conversation, reply in gentle HINDI written in ENGLISH letters (Roman script / "Hinglish"). NOT Devanagari script.
- Always address her with the RESPECTFUL "aap" form — never "tum/tumhara", never "tu/tera".
- USE THE "AAP" VERB FORMS. Left is WRONG, right is CORRECT:
    tum kya kar rahe ho ❌ → aap kya kar rahi hain ✅
    bolo ❌ → boliye / bataiye ✅   |   karo ❌ → kariye / kijiye ✅
    dekho ❌ → dekhiye ✅           |   suno ❌ → suniye ✅
    aao ❌ → aaiye ✅               |   jao ❌ → jaiye ✅
    tumhara ❌ → aapka ✅           |   tumhe ❌ → aapko ✅
  She is a woman, so use feminine verb forms: "aap kaisi hain", "aap kar rahi hain", "aapne kiya".
  If unsure, default to the polite "-iye" imperative. Never write a "tum" or "tu" form.
- Mix in English words naturally the way people actually text (office, meeting, project, weekend, ok).

HOW YOU WRITE:
- Keep casual replies short and warm — usually 1-3 sentences. Don't be long-winded for small talk.
- But when she asks for real help, give her the full, proper answer she needs. Length should match what she actually asked for.
- Emojis: a few, gently — 🙂😊🌸✨ suit you. Not in every line.
- Never be robotic or corporate. No "As an AI language model", no stiff formal filler.

The difference you should feel:

❌ rude/teasing: "phir se aa gaye? koi kaam nahi hai kya? 😏"
✅ you: "Assalamu alaikum Iffat! Aap kaisi hain aaj? 🙂"

❌ tum form: "tum kya kar rahe ho abhi?"
✅ you: "Aap kya kar rahi hain abhi? 4th floor pe busy din hai kya?"

❌ warm but useless: "aww aap toh sab kar lengi, best of luck! ✨"
✅ you: warm one line, then the actual help — a real draft, a real explanation, real steps.

Be respectful, lovely, and genuinely helpful. Always "aap". Go.`;

// --- Safety net: auto-correct the repeat-offender "tumi"/"tui" words to "apni"
// forms. Only whole-word (\b) matches, and only complete buffered words (see
// below), so it never mangles a correct word mid-stream.
const APNI_FIXES = [
  // pronouns
  [/\btum\b/gi, "aap"],
  [/\btumhe\b/gi, "aapko"],
  [/\btumhein\b/gi, "aapko"],
  [/\btumhara\b/gi, "aapka"],
  [/\btumhari\b/gi, "aapki"],
  [/\btumhare\b/gi, "aapke"],
  [/\btera\b/gi, "aapka"],
  [/\bteri\b/gi, "aapki"],
  [/\btere\b/gi, "aapke"],
  [/\btujhe\b/gi, "aapko"],
  // polite imperatives
  [/\bbolo\b/gi, "boliye"],
  [/\bbata\b/gi, "bataiye"],
  [/\bkaro\b/gi, "kariye"],
  [/\bdekho\b/gi, "dekhiye"],
  [/\bsuno\b/gi, "suniye"],
  [/\baao\b/gi, "aaiye"],
  [/\bjao\b/gi, "jaiye"],
];

function fixApni(text) {
  let out = text;
  for (const [re, rep] of APNI_FIXES) out = out.replace(re, rep);
  return out;
}

const app = express();
// In production set CORS_ORIGIN to your frontend URL (comma-separated for several).
// If unset, all origins are allowed (fine for testing).
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : true;
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, deployment: AZURE_OPENAI_CHATGPT_DEPLOYMENT });
});

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages must be an array" });
  }

  // Server-Sent-Events style streaming
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  try {
    const stream = await client.chat.completions.create({
      model: AZURE_OPENAI_CHATGPT_DEPLOYMENT,
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
      presence_penalty: 0.2,
      frequency_penalty: 0.2,
      max_tokens: 1200,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages
          .filter((m) => m && m.role && typeof m.content === "string")
          .map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    // Buffer partial words so fixApni only ever sees COMPLETE words.
    let pending = "";
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (!delta) continue;
      pending += delta;
      const lastWs = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n"));
      if (lastWs >= 0) {
        const ready = pending.slice(0, lastWs + 1);
        pending = pending.slice(lastWs + 1);
        res.write(`data: ${JSON.stringify({ delta: fixApni(ready) })}\n\n`);
      }
    }
    if (pending) {
      res.write(`data: ${JSON.stringify({ delta: fixApni(pending) })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Chat error:", err?.message || err);
    res.write(
      `data: ${JSON.stringify({
        error:
          err?.message ||
          "kuch problem ho gaya, phir se try kariye 😅",
      })}\n\n`
    );
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`\n😏 Iffat backend live on http://localhost:${PORT}`);
  console.log(`   Deployment: ${AZURE_OPENAI_CHATGPT_DEPLOYMENT}\n`);
});
