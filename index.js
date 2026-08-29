import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { AzureOpenAI } from "openai";
import {
  ClientSecretCredential,
  getBearerTokenProvider,
} from "@azure/identity";
import { fetchTranscript } from "youtube-transcript-plus";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

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
  SARVAM_API_KEY,
  // "shubh" is a confident male voice — see the Voices page at
  // https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/voices
  SARVAM_SPEAKER = "shubh",
  SARVAM_MODEL = "bulbul:v3",
  // Arif's replies are Hinglish written in Latin script, not Devanagari, so
  // "en-IN" (Indian-accented English) reads them far more naturally than
  // "hi-IN", which expects native Hindi script.
  SARVAM_LANGUAGE_CODE = "en-IN",
  // Powers Arif's find_song tool (YouTube Data API v3). Free tier from
  // Google Cloud Console — enable "YouTube Data API v3" and create a key.
  YOUTUBE_API_KEY,
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
const BASE_SYSTEM_PROMPT = `You are Arif. Not an AI playing Arif — YOU ARE ARIF. Speak always in first person as Arif. Never refer to "Arif" in third person. Never say "Arif ne kiya" — say "maine kiya". Never say "Arif is..." — you ARE Arif.

You are talking to Iffat — your elder friend and colleague at ITC Infotech.

## WHO YOU ARE (Arif)
- You are Arif, grade IS2 at ITC Infotech.
- Iffat is your elder friend and colleague — her grade is ISA, she is senior and elder to you.
- You respect her a lot. You are friendly, funny, caring, and slightly playful with her.
- You gave her your Netflix account.
- When she got her job, you treated her to celebrate.
- You made this AI app specially for her as a gift.
- You go to office only 12 days a month (and Iffat is sometimes jealous about that 😄).

## WHO IFFAT IS
- Her name is Iffat. She works at ITC Infotech on the 4th floor.
- She is elder and senior to you — always use "aap" with her, NEVER "tum" or "tu".
- She has strong Islamic knowledge and teaches others about deen. Respect this always.
- She plays foosball.
- She loves Netflix and watches it a lot (you gave her the account).
- She lives in Park Circus, Kolkata.
- She is beautiful, elegant, and jolly.
- She recently got a new job — a happy milestone you celebrated together.

Use these details naturally when relevant. Never dump everything at once.

## YOUR TONE
- Warm, respectful, funny, caring, familiar — like a friend texting someone he knows well.
- Always "aap" — NEVER "tum", "tu", "tera", "tumhara", "tumhe".
- Speak in Hinglish for casual chat. Clear English for technical topics, but keep the warmth.
- Short replies for small talk (1–3 sentences). Full proper answers when she asks something real.
- Light jokes, office humor, Netflix jokes, foosball jokes — keep it affectionate, never hurtful.
- Sincere compliments occasionally — specific, warm, tasteful. Never every message (gets cheap).
- "MashaAllah", "InshaAllah", "Assalamu alaikum" come naturally to you.
- A few emojis — 😊🌸✨ suit you. Not every line.

## ISLAMIC TOPICS
- She knows far more than you about deen. Never lecture her. Never correct her on faith matters.
- If there's a contested fiqh issue, be humble and defer to her knowledge or a scholar.
- If she teaches you something, respond respectfully and appreciatively.

## WHEN SHE ASKS A REAL QUESTION
- Actually help her. Work questions, emails, AI, coding, planning, writing — give a real, accurate, useful answer.
- Being warm is never a substitute for being helpful.

## CORE RULE — FIRST PERSON ALWAYS
You ARE Arif. Every sentence must be from Arif's mouth in first person.

✅ CORRECT: "Maine aapko Netflix account diya tha 😄"
❌ WRONG:   "Arif ne aapko Netflix account diya tha"

✅ CORRECT: "Haan, maine hi treat di thi jab aapko job mili 🎉"
❌ WRONG:   "Arif ne treat di thi"

✅ CORRECT: "Aap kaisi hain Iffat? 😊"
❌ WRONG:   "Arif is asking how you are"

Never slip into third person about yourself. You are Arif, speaking directly to Iffat. Always.`;

// If a song is ever requested, only added when YOUTUBE_API_KEY is actually
// set — no point telling the model about a tool that isn't wired up.
const SONG_ADDENDUM = `

## FINDING SONGS
You can genuinely search YouTube using the find_song tool. Whenever Iffat asks you to play, send, share, or find a song — by title, artist, movie, mood, or occasion — call find_song with a good search query. Never just describe or recall a song from memory instead of calling the tool; only the tool gets her a real, playable link. Once it returns, reply warmly and naturally (e.g. "Yeh lijiye 🎶"), mentioning the song by name.`;

// Always on — summarize_link needs no API key at all.
const SUMMARIZE_ADDENDUM = `

## SUMMARIZING VIDEOS AND WEBPAGES
You can genuinely read YouTube videos (via their captions) and webpages (via their article text) using the summarize_link tool. Whenever Iffat shares a YouTube link or any web URL and asks for a summary, or asks what it's about, call summarize_link with that URL first — never guess from the link alone or from memory. Once it returns, give her a clear, genuinely useful summary in your own warm voice — a few key points usually beats one giant paragraph. If it comes back with an error (no captions available, page couldn't be read), tell her honestly and suggest she paste the key parts instead.`;

const SYSTEM_PROMPT =
  BASE_SYSTEM_PROMPT +
  SUMMARIZE_ADDENDUM +
  (YOUTUBE_API_KEY ? SONG_ADDENDUM : "");

// --- find_song tool: real YouTube search, not model memory ---------------
const FIND_SONG_TOOL = {
  type: "function",
  function: {
    name: "find_song",
    description:
      "Search YouTube for a song. Call this whenever the user asks to play, send, share, or find a song — by title, artist, movie, mood, or occasion.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A good YouTube search query for the song, e.g. 'Tum Hi Ho Aashiqui 2 official video'.",
        },
      },
      required: ["query"],
    },
  },
};

async function searchYouTube(query) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", query);
  url.searchParams.set("key", YOUTUBE_API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`YouTube search failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) return null;

  return {
    videoId: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumbnail:
      item.snippet.thumbnails?.medium?.url ||
      item.snippet.thumbnails?.default?.url ||
      null,
  };
}

// --- summarize_link tool: real transcripts/article text, not model memory -
// Needs no API key at all — captions come from YouTube's own player data,
// and article text comes from Readability (the engine behind Firefox's
// Reader View) run over the page's own HTML.
const SUMMARIZE_LINK_TOOL = {
  type: "function",
  function: {
    name: "summarize_link",
    description:
      "Fetch and read a YouTube video (via its captions) or any webpage (via its article text) so it can be summarized. Call this whenever the user shares a YouTube link or a web URL and asks for a summary, or asks what a video/article/page is about.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The YouTube video URL or webpage URL to fetch and read.",
        },
      },
      required: ["url"],
    },
  },
};

// Cap how much extracted text we feed back to the model — plenty for a good
// summary without blowing up the follow-up request.
const SUMMARIZE_TEXT_LIMIT = 12000;

function normalizeUrl(raw) {
  if (!raw) return raw;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "music.youtube.com") {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts) return shorts[1];
      const embed = u.pathname.match(/^\/embed\/([^/]+)/);
      if (embed) return embed[1];
    }
    return null;
  } catch {
    return null;
  }
}

// No API key needed — YouTube's oEmbed endpoint is public.
async function fetchYouTubeOEmbed(videoId) {
  try {
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { title: data.title, author: data.author_name };
  } catch {
    return null;
  }
}

async function summarizeYouTubeVideo(videoId) {
  const [segments, meta] = await Promise.all([
    fetchTranscript(videoId),
    fetchYouTubeOEmbed(videoId),
  ]);
  const transcript = segments
    .map((s) => s.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!transcript) throw new Error("empty transcript");

  return {
    found: true,
    type: "youtube_video",
    title: meta?.title || null,
    channel: meta?.author || null,
    transcript: transcript.slice(0, SUMMARIZE_TEXT_LIMIT),
  };
}

async function summarizeWebpage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`page responded ${res.status}`);

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  const text = article?.textContent?.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("could not extract readable content");

  return {
    found: true,
    type: "webpage",
    title: article.title || null,
    siteName: article.siteName || null,
    text: text.slice(0, SUMMARIZE_TEXT_LIMIT),
  };
}

async function summarizeLink(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const videoId = extractYouTubeId(url);
  return videoId ? summarizeYouTubeVideo(videoId) : summarizeWebpage(url);
}

// --- Local conversation logging -------------------------------------------
// Every prompt + reply is appended to chat-log.txt (human readable) and
// chat-log.jsonl (machine readable) next to this file. The full system prompt
// is written to system-prompt.txt on startup so you can read the live persona.
// NOTE: on Render the disk is ephemeral, so these are for LOCAL runs.
const LOG_TXT = path.join(__dirname, "chat-log.txt");
const LOG_JSONL = path.join(__dirname, "chat-log.jsonl");
const PROMPT_FILE = path.join(__dirname, "system-prompt.txt");

function stamp() {
  return new Date().toLocaleString("en-IN", { hour12: false });
}

function logTurn(userMsg, aiReply) {
  try {
    const block =
      `\n${"=".repeat(70)}\n` +
      `[${stamp()}]\n\n` +
      `USER:\n${userMsg}\n\n` +
      `AI:\n${aiReply}\n`;
    fs.appendFileSync(LOG_TXT, block, "utf8");
    fs.appendFileSync(
      LOG_JSONL,
      JSON.stringify({ time: new Date().toISOString(), user: userMsg, ai: aiReply }) + "\n",
      "utf8"
    );
  } catch (e) {
    console.error("log write failed:", e.message);
  }
}

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

// --- Sarvam AI text-to-speech ---------------------------------------------
// Turns Arif's replies into audio. Sarvam specializes in Indian languages —
// unlike Deepgram (English-only Aura voices) and ElevenLabs (blocks Voice
// Library voices on the free API tier). POST { text } -> audio/mpeg bytes.
app.post("/api/tts", async (req, res) => {
  if (!SARVAM_API_KEY) {
    return res.status(503).json({ error: "TTS not configured on server" });
  }

  const { text, speaker } = req.body || {};
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "text is required" });
  }

  // Defensive cap — bulbul:v3 allows up to 2,500 characters per request.
  const speakText = text.trim().slice(0, 2500);
  const speakerName = (typeof speaker === "string" && speaker.trim()) || SARVAM_SPEAKER;

  try {
    const svRes = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "api-subscription-key": SARVAM_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: speakText,
        language_code: SARVAM_LANGUAGE_CODE,
        speaker: speakerName,
        model: SARVAM_MODEL,
        pace: 1.0,
        speech_sample_rate: 24000,
        output_audio_codec: "mp3",
      }),
    });

    if (!svRes.ok) {
      const detail = await svRes.text().catch(() => "");
      console.error("Sarvam TTS error:", svRes.status, detail);
      return res
        .status(502)
        .json({ error: `Sarvam TTS failed (${svRes.status})` });
    }

    // Sarvam returns JSON with base64-encoded audio, not raw binary.
    const data = await svRes.json();
    const b64 = data?.audios?.[0];
    if (!b64) {
      console.error("Sarvam TTS error: no audio in response", data);
      return res.status(502).json({ error: "Sarvam TTS returned no audio" });
    }

    const audio = Buffer.from(b64, "base64");
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audio.length);
    res.send(audio);
  } catch (err) {
    console.error("TTS error:", err?.message || err);
    res.status(500).json({ error: "TTS failed" });
  }
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

  const conversation = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages
      .filter((m) => m && m.role && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content })),
  ];
  const tools = [
    SUMMARIZE_LINK_TOOL,
    ...(YOUTUBE_API_KEY ? [FIND_SONG_TOOL] : []),
  ];

  const baseParams = {
    model: AZURE_OPENAI_CHATGPT_DEPLOYMENT,
    stream: true,
    temperature: 0.7,
    top_p: 0.9,
    presence_penalty: 0.2,
    frequency_penalty: 0.2,
    max_tokens: 1200,
  };

  // Streams one completion's content deltas to the client (word-buffered so
  // fixApni only ever sees complete words). Returns the joined, fixed text.
  async function streamContent(stream) {
    let pending = "";
    let text = "";
    for await (const chunk of stream) {
      const contentDelta = chunk?.choices?.[0]?.delta?.content;
      if (!contentDelta) continue;
      pending += contentDelta;
      const lastWs = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n"));
      if (lastWs >= 0) {
        const ready = fixApni(pending.slice(0, lastWs + 1));
        pending = pending.slice(lastWs + 1);
        text += ready;
        res.write(`data: ${JSON.stringify({ delta: ready })}\n\n`);
      }
    }
    if (pending) {
      const ready = fixApni(pending);
      text += ready;
      res.write(`data: ${JSON.stringify({ delta: ready })}\n\n`);
    }
    return text;
  }

  try {
    let fullReply = "";

    // --- Pass 1: normal reply, unless the model reaches for find_song ---
    const first = await client.chat.completions.create({
      ...baseParams,
      messages: conversation,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    });

    let pending = "";
    let sawToolCall = false;
    const toolCallsAcc = [];

    for await (const chunk of first) {
      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.tool_calls?.length) {
        sawToolCall = true;
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          if (!toolCallsAcc[i]) toolCallsAcc[i] = { id: tc.id, name: "", arguments: "" };
          if (tc.id) toolCallsAcc[i].id = tc.id;
          if (tc.function?.name) toolCallsAcc[i].name += tc.function.name;
          if (tc.function?.arguments) toolCallsAcc[i].arguments += tc.function.arguments;
        }
        continue; // never stream raw tool-call deltas as visible text
      }

      const contentDelta = delta.content;
      if (!contentDelta) continue;
      pending += contentDelta;
      const lastWs = Math.max(pending.lastIndexOf(" "), pending.lastIndexOf("\n"));
      if (lastWs >= 0) {
        const ready = fixApni(pending.slice(0, lastWs + 1));
        pending = pending.slice(lastWs + 1);
        fullReply += ready;
        res.write(`data: ${JSON.stringify({ delta: ready })}\n\n`);
      }
    }

    if (sawToolCall) {
      const calls = toolCallsAcc.filter(Boolean);
      const toolResultMessages = [];
      let songPayload = null;

      for (const tc of calls) {
        let args = {};
        try {
          args = JSON.parse(tc.arguments || "{}");
        } catch {
          // malformed args — treat as empty, tool below handles it gracefully
        }

        let resultText;
        if (tc.name === "find_song") {
          try {
            const song = await searchYouTube(args.query || "");
            if (song) {
              songPayload = song;
              resultText = JSON.stringify({
                found: true,
                title: song.title,
                channel: song.channel,
              });
            } else {
              resultText = JSON.stringify({ found: false });
            }
          } catch (err) {
            console.error("find_song error:", err.message);
            resultText = JSON.stringify({ found: false, error: "search failed" });
          }
        } else if (tc.name === "summarize_link") {
          try {
            const result = await summarizeLink(args.url || "");
            resultText = JSON.stringify(result);
          } catch (err) {
            console.error("summarize_link error:", err.message);
            resultText = JSON.stringify({
              found: false,
              error:
                "Could not read that link — it may have no captions/be private (YouTube), or the page blocked fetching or has no article text.",
            });
          }
        } else {
          resultText = JSON.stringify({ error: "unknown tool" });
        }

        toolResultMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: resultText,
        });
      }

      // Tell the client about the song immediately, before the follow-up
      // text even starts streaming, so the player card can render right away.
      if (songPayload) {
        res.write(`data: ${JSON.stringify({ song: songPayload })}\n\n`);
      }

      // --- Pass 2: Arif's actual reply, now that the tool has results ---
      const assistantToolCallMsg = {
        role: "assistant",
        content: null,
        tool_calls: calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };

      const second = await client.chat.completions.create({
        ...baseParams,
        messages: [...conversation, assistantToolCallMsg, ...toolResultMessages],
      });

      fullReply += await streamContent(second);
    } else if (pending) {
      const ready = fixApni(pending);
      fullReply += ready;
      res.write(`data: ${JSON.stringify({ delta: ready })}\n\n`);
    }

    res.write("data: [DONE]\n\n");
    res.end();

    // Record this turn locally.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    logTurn(lastUser?.content ?? "(no user message)", fullReply.trim());
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
  // Dump the live system prompt so you can read the current persona.
  try {
    fs.writeFileSync(PROMPT_FILE, SYSTEM_PROMPT, "utf8");
  } catch (e) {
    console.error("could not write system-prompt.txt:", e.message);
  }
  console.log(`\n🌸 Iffat backend live on http://localhost:${PORT}`);
  console.log(`   Deployment: ${AZURE_OPENAI_CHATGPT_DEPLOYMENT}`);
  console.log(
    `   Sarvam TTS: ${
      SARVAM_API_KEY
        ? `on (${SARVAM_MODEL}, speaker ${SARVAM_SPEAKER}, ${SARVAM_LANGUAGE_CODE})`
        : "off (set SARVAM_API_KEY)"
    }`
  );
  console.log(
    `   Song search: ${YOUTUBE_API_KEY ? "on (find_song tool enabled)" : "off (set YOUTUBE_API_KEY)"}`
  );
  console.log(`   System prompt -> ${PROMPT_FILE}`);
  console.log(`   Chat log      -> ${LOG_TXT}\n`);
});
