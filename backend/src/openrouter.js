import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getModelPricing } from "./modelPrices.js";
import { calculateUsdCost } from "./credits.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "generated");

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function publicUploadUrl(filename) {
  const base = (process.env.API_PUBLIC_URL || process.env.APP_URL || "http://localhost:4000").replace(
    /\/$/,
    ""
  );
  // Served at /api/uploads/generated/... when proxied, or /uploads/generated on API port
  return `${base}/api/uploads/generated/${filename}`;
}

/** Persist data-URL / remote image to uploads so Meta can fetch a public HTTPS URL */
export async function persistImageUrl(imageUrl) {
  if (!imageUrl) return null;
  if (/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  ensureUploadDir();
  const match = String(imageUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return imageUrl;

  const ext = match[1].includes("png")
    ? "png"
    : match[1].includes("webp")
      ? "webp"
      : match[1].includes("jpeg") || match[1].includes("jpg")
        ? "jpg"
        : "png";
  const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return publicUploadUrl(filename);
}

/**
 * Call OpenRouter API for text generation
 */
export async function callOpenRouter({ model, messages, maxTokens = 1024, modalities }) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return mockOpenRouterResponse({ model, messages, modalities });
  }

  const body = { model, messages, max_tokens: maxTokens };
  if (modalities) body.modalities = modalities;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "Avonix Social",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${err}`);
  }

  return response.json();
}

/** Strip URLs, emails, hashtags, emoji, and non-Latin script from English post copy */
export function stripLinksAndEmojis(text) {
  return sanitizeEnglishPost(String(text || ""));
}

/** Keep Latin business copy; drop CJK/Arabic/Cyrillic glitches from model output */
export function sanitizeEnglishPost(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "")
    .replace(/#[\p{L}\p{N}_]+/gu, "")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E0}-\u{1F1FF}]/gu,
      ""
    )
    // CJK, Hangul, Arabic, Cyrillic — models sometimes inject these mid-word
    .replace(/[\u3000-\u303F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF\u0600-\u06FF\u0400-\u04FF]/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function enforceWordLimit(text, maxWords) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ");
}

/**
 * Generate a related image via OpenRouter image-capable model.
 * Returns { ok, url } where url is a public HTTPS or persisted upload URL.
 */
export async function generateImage({ prompt }) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#ea580c"/>
      </linearGradient></defs>
      <rect width="1080" height="1080" fill="url(#g)"/>
      <text x="540" y="520" fill="#fff" font-size="42" font-family="Arial" text-anchor="middle">Avonix Social</text>
      <text x="540" y="580" fill="#fdba74" font-size="24" font-family="Arial" text-anchor="middle">Demo image</text>
    </svg>`;
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const url = await persistImageUrl(dataUrl);
    return { ok: true, url, mock: true };
  }

  const models = [
    process.env.IMAGE_MODEL,
    "google/gemini-2.5-flash-image",
    "google/gemini-3.1-flash-image-preview",
    "google/gemini-2.5-flash-image-preview",
  ].filter(Boolean);

  let lastErr = null;
  for (const model of models) {
    try {
      const data = await callOpenRouter({
        model,
        maxTokens: 1024,
        modalities: ["image", "text"],
        messages: [{ role: "user", content: prompt }],
      });

      const message = data?.choices?.[0]?.message;
      const images = message?.images || [];
      if (images[0]?.image_url?.url) {
        const url = await persistImageUrl(images[0].image_url.url);
        return { ok: true, url, mock: false, model };
      }
      if (images[0]?.imageUrl) {
        const url = await persistImageUrl(images[0].imageUrl);
        return { ok: true, url, mock: false, model };
      }

      const content = message?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          const u = part?.image_url?.url || part?.imageUrl || part?.url;
          if (u) {
            const url = await persistImageUrl(u);
            return { ok: true, url, mock: false, model };
          }
          if (part?.type === "image_url" && part?.image_url?.url) {
            const url = await persistImageUrl(part.image_url.url);
            return { ok: true, url, mock: false, model };
          }
        }
      }

      lastErr = new Error(`Image model ${model} returned no image URL`);
    } catch (err) {
      lastErr = err;
      if (!String(err.message).includes("404")) break;
    }
  }

  throw lastErr || new Error("Image generation failed. Set IMAGE_MODEL in backend/.env");
}

function mockOpenRouterResponse({ model, messages, modalities }) {
  if (modalities?.includes("image")) {
    return {
      id: "mock-img-" + Date.now(),
      model,
      choices: [
        {
          message: {
            role: "assistant",
            content: "demo",
            images: [{ image_url: { url: "" } }],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      _mock: true,
    };
  }

  const promptText = messages.map((m) => m.content).join(" ");
  const promptTokens = Math.ceil(promptText.length / 4);
  const content = generateMockContent(messages);
  const completionTokens = Math.ceil(content.length / 4);

  return {
    id: "mock-" + Date.now(),
    model,
    choices: [{ message: { role: "assistant", content } }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
    _mock: true,
  };
}

function generateMockContent(messages) {
  const last = messages[messages.length - 1]?.content || "";
  if (last.includes("review reply") || last.includes("Review:")) {
    return "Thank you for your stellar 5-star review! We are glad our SEO automation delivered great ranking results for your business.";
  }
  if (last.includes("Google Business Profile")) {
    return "Looking for trusted local expertise in your area. Our team helps nearby businesses improve visibility, win more customers, and stay consistent online. Stop by or message us to learn how we can support your next growth goal.";
  }
  if (last.includes("Instagram")) {
    return "Your brand deserves a clear first impression. We craft visuals and messaging that help local customers recognize and trust you faster.";
  }
  if (last.includes("LinkedIn")) {
    return "Strong local brands win when strategy and execution stay aligned. We help teams clarify positioning, improve discoverability, and turn attention into qualified conversations.";
  }
  return "Elevate how local customers discover your brand. Focused messaging and consistent presence help you stand out, build trust, and convert interest into real business outcomes.";
}

/**
 * Extract usage from OpenRouter response.
 * Returns null if usage metrics are missing (no credits should be deducted).
 */
export function extractUsage(data, model) {
  if (!data?.usage) return null;

  const usage = data.usage;
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? promptTokens + completionTokens;

  const pricing = getModelPricing(model);
  if (!pricing) return null;

  // Prefer OpenRouter-reported cost if available, else calculate from cached per-token prices
  const apiCostUsd =
    usage.cost != null
      ? Number(usage.cost)
      : calculateUsdCost({
          promptTokens,
          completionTokens,
          promptPrice: pricing.promptPrice,
          completionPrice: pricing.completionPrice,
        });

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    apiCostUsd,
    promptPrice: pricing.promptPrice,
    completionPrice: pricing.completionPrice,
    modelName: pricing.name,
  };
}
