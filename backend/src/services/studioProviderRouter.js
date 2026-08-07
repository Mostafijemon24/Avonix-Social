/**
 * Part 6 — AI picks the best writing model + image provider for a studio batch.
 * Quality-first: prefer paid photoreal image models unless user forces free.
 */
import { callOpenRouter } from "../openrouter.js";

export const WRITING_CANDIDATES = [
  {
    id: "gemini-flash",
    model: process.env.STUDIO_MODEL_GEMINI || "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    strengths: "fast local SEO, service-area copy, GMB tone",
  },
  {
    id: "gpt-4o-mini",
    model: process.env.STUDIO_MODEL_GPT || "openai/gpt-4o-mini",
    label: "GPT-4o mini",
    strengths: "polished marketing hooks, Facebook CTA clarity",
  },
  {
    id: "claude-haiku",
    model: process.env.STUDIO_MODEL_CLAUDE || "anthropic/claude-3.5-haiku",
    label: "Claude 3.5 Haiku",
    strengths: "natural brand voice, LinkedIn insight-led posts",
  },
];

/** Ranked best → cheapest. gpt-image is the quality winner for marketing creatives. */
export const IMAGE_CANDIDATES = [
  {
    id: "gpt-image",
    model: process.env.IMAGE_MODEL || "openai/gpt-image-1",
    source: "ai",
    label: "ChatGPT Images (best quality)",
    strengths:
      "highest photoreal detail, topic-faithful scenes, HD branding/service creatives (paid)",
    qualityRank: 1,
  },
  {
    id: "gemini-image",
    model: process.env.IMAGE_MODEL_GEMINI || "google/gemini-2.5-flash-image",
    source: "ai",
    label: "Gemini Flash Image",
    strengths: "fast paid multimodal images, good local vibe (paid)",
    qualityRank: 2,
  },
  {
    id: "pollinations",
    model: null,
    source: "free",
    label: "Free stack (Pollinations / Pexels)",
    strengths: "$0 fallback only — lower relevance/quality than ChatGPT Images",
    qualityRank: 9,
  },
];

/** true only when explicitly forced to free ($0) mode */
export function preferFreeImages() {
  if (process.env.STUDIO_FREE_IMAGES_ONLY === "1") return true;
  const def = String(process.env.STUDIO_IMAGE_DEFAULT || "quality").toLowerCase();
  return def === "free";
}

function keywordBlob(pageSample = []) {
  return (pageSample || [])
    .slice(0, 8)
    .map((p) => `${p.keywords?.primary || ""} ${p.writingIntent || ""}`)
    .join(" ")
    .toLowerCase();
}

function heuristicPick({
  location,
  masterIntent,
  dominantIntent,
  includeImages,
  pageSample = [],
}) {
  const blob = `${masterIntent || ""} ${dominantIntent || ""} ${location || ""} ${keywordBlob(
    pageSample
  )}`.toLowerCase();

  let writing = WRITING_CANDIDATES[0];
  if (/linkedin|b2b|leadership|professional|insight/.test(blob)) {
    writing = WRITING_CANDIDATES.find((c) => c.id === "claude-haiku") || writing;
  } else if (/facebook|cta|conversion|promo|marketing/.test(blob)) {
    writing = WRITING_CANDIDATES.find((c) => c.id === "gpt-4o-mini") || writing;
  } else if (/local|gmb|google|service area|near/.test(blob) || location) {
    writing = WRITING_CANDIDATES.find((c) => c.id === "gemini-flash") || writing;
  }

  let image = IMAGE_CANDIDATES.find((c) => c.id === "pollinations");

  if (includeImages && process.env.OPENROUTER_API_KEY && !preferFreeImages()) {
    // Quality-first: ChatGPT Images for branding / design / premium trades
    if (
      /brand|logo|design|identity|packag|premium|photo|studio|people|dental|clinic|law|real estate/.test(
        blob
      )
    ) {
      image = IMAGE_CANDIDATES.find((c) => c.id === "gpt-image") || image;
    } else {
      // Still prefer gpt-image for best output; gemini only if explicitly faster path needed
      image =
        IMAGE_CANDIDATES.find((c) => c.id === "gpt-image") ||
        IMAGE_CANDIDATES.find((c) => c.id === "gemini-image") ||
        image;
    }
  }

  return {
    writing,
    image,
    method: "heuristic",
    reason: {
      writing: `Heuristic: matched intent/location to ${writing.label}`,
      image: includeImages
        ? preferFreeImages()
          ? `Heuristic: free stack (${image.label}) — $0 cost`
          : `Heuristic: ${image.label} for maximum relevance + HD quality`
        : "Images disabled for this run",
    },
  };
}

/**
 * Ask a cheap router model which writing + image stack to use for this batch.
 */
export async function selectBestStudioProviders({
  websiteUrl,
  location,
  masterIntent,
  dominantIntent,
  pageSample = [],
  includeImages = false,
  forceImageSource, // "auto"|"ai"|"free"|undefined
}) {
  const heuristic = heuristicPick({
    location,
    masterIntent,
    dominantIntent,
    includeImages,
    pageSample,
  });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return finalizeDecision(heuristic, { includeImages, forceImageSource });
  }

  const writingList = WRITING_CANDIDATES.map(
    (c) => `- ${c.id}: ${c.label} — ${c.strengths}`
  ).join("\n");
  const imageList = IMAGE_CANDIDATES.map(
    (c) =>
      `- ${c.id}: ${c.label} (${c.source}, qualityRank=${c.qualityRank}) — ${c.strengths}`
  ).join("\n");
  const samples = (pageSample || [])
    .slice(0, 5)
    .map(
      (p) =>
        `• ${p.url || ""} | intent=${p.writingIntent || "n/a"} | kw=${p.keywords?.primary || ""}`
    )
    .join("\n");

  try {
    const data = await callOpenRouter({
      model: process.env.ROUTER_MODEL || "openai/gpt-4o-mini",
      maxTokens: 320,
      messages: [
        {
          role: "system",
          content: `You are Avonix Social's provider router. Goal: MAXIMUM image relevance to the service keyword + HD quality for social posts.
Rules:
- Prefer gpt-image whenever OpenRouter is available and images are enabled (best photoreal marketing creatives).
- Use gemini-image only if speed matters more than fidelity.
- Use pollinations ONLY if the user explicitly wants free/$0, or paid image APIs are unavailable.
- Writing: pick the best tone fit for the niche.
Return ONLY JSON: {writingId, imageId, writingReason, imageReason}. No markdown.`,
        },
        {
          role: "user",
          content: `Website: ${websiteUrl || "n/a"}
Location: ${location || "n/a"}
Master intent: ${masterIntent || "n/a"}
Dominant intent: ${dominantIntent || "n/a"}
Include images: ${includeImages ? "yes" : "no"}
User free-only mode: ${preferFreeImages() ? "YES — must choose pollinations" : "NO — optimize for best quality (prefer gpt-image)"}
Force source: ${forceImageSource || "auto (you decide)"}

Writing candidates:
${writingList}

Image candidates (lower qualityRank = better):
${imageList}

Page samples:
${samples || "(none)"}

Choose the single best writingId and imageId for ALL posts in this batch.`,
        },
      ],
    });

    const content = data?.choices?.[0]?.message?.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return finalizeDecision(heuristic, { includeImages, forceImageSource });

    const parsed = JSON.parse(m[0]);
    const writing =
      WRITING_CANDIDATES.find((c) => c.id === parsed.writingId) || heuristic.writing;
    let image =
      IMAGE_CANDIDATES.find((c) => c.id === parsed.imageId) || heuristic.image;

    if (!includeImages) {
      image = IMAGE_CANDIDATES.find((c) => c.id === "pollinations") || image;
    } else if (!preferFreeImages() && image.source === "free" && process.env.OPENROUTER_API_KEY) {
      // Guardrail: never let the router accidentally pick free when quality mode is on
      image = IMAGE_CANDIDATES.find((c) => c.id === "gpt-image") || image;
    }

    return finalizeDecision(
      {
        writing,
        image,
        method: data._mock ? "heuristic+ai-mock" : "ai",
        reason: {
          writing: String(parsed.writingReason || "").trim() || `AI selected ${writing.label}`,
          image: includeImages
            ? String(parsed.imageReason || "").trim() || `AI selected ${image.label}`
            : "Images disabled for this run",
        },
      },
      { includeImages, forceImageSource }
    );
  } catch (err) {
    console.error("[studioProviderRouter]", err.message);
    return finalizeDecision(heuristic, { includeImages, forceImageSource });
  }
}

function finalizeDecision(pick, { includeImages, forceImageSource }) {
  let image = pick.image;
  let reason = { ...pick.reason };

  if (forceImageSource === "free") {
    image = IMAGE_CANDIDATES.find((c) => c.id === "pollinations") || image;
    reason.image = "User forced Free stack ($0)";
  } else if (forceImageSource === "ai" && includeImages) {
    image =
      IMAGE_CANDIDATES.find((c) => c.id === "gpt-image") ||
      IMAGE_CANDIDATES.find((c) => c.source === "ai") ||
      image;
    reason.image = `User forced Paid AI → ${image.label}`;
  } else if (
    includeImages &&
    !preferFreeImages() &&
    process.env.OPENROUTER_API_KEY &&
    image?.source === "free"
  ) {
    image = IMAGE_CANDIDATES.find((c) => c.id === "gpt-image") || image;
    reason.image = `Quality mode override → ${image.label}`;
  }

  return {
    ok: true,
    method: pick.method,
    writing: {
      id: pick.writing.id,
      model: pick.writing.model,
      label: pick.writing.label,
      reason: reason.writing,
    },
    image: {
      id: image.id,
      model: image.model,
      source: image.source,
      label: image.label,
      reason: reason.image,
    },
    candidates: {
      writing: WRITING_CANDIDATES.map((c) => ({ id: c.id, label: c.label })),
      image: IMAGE_CANDIDATES.map((c) => ({
        id: c.id,
        label: c.label,
        source: c.source,
        qualityRank: c.qualityRank,
      })),
    },
  };
}
