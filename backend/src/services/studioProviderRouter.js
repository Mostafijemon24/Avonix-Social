/**
 * Part 6 — AI picks the best writing model + image provider for a studio batch.
 * Multiple candidates; one decision used for the whole run.
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

export const IMAGE_CANDIDATES = [
  {
    id: "gpt-image",
    model: process.env.IMAGE_MODEL || "openai/gpt-image-1",
    source: "ai",
    label: "ChatGPT Images",
    strengths: "photoreal professional scenes, high detail",
  },
  {
    id: "gemini-image",
    model: "google/gemini-2.5-flash-image",
    source: "ai",
    label: "Gemini Flash Image",
    strengths: "fast multimodal images, local vibe scenes",
  },
  {
    id: "pollinations",
    model: null,
    source: "free",
    label: "Free stack (Pollinations + Pexels/Unsplash)",
    strengths: "fully free AI + stock fallback, optional free API keys",
  },
];

function preferFreeImages() {
  if (process.env.STUDIO_FREE_IMAGES_ONLY === "1") return true;
  const def = String(process.env.STUDIO_IMAGE_DEFAULT || "free").toLowerCase();
  return def === "free";
}

function heuristicPick({ location, masterIntent, dominantIntent, includeImages }) {
  const blob = `${masterIntent || ""} ${dominantIntent || ""} ${location || ""}`.toLowerCase();

  let writing = WRITING_CANDIDATES[0];
  if (/linkedin|b2b|leadership|professional|insight/.test(blob)) {
    writing = WRITING_CANDIDATES.find((c) => c.id === "claude-haiku") || writing;
  } else if (/facebook|cta|conversion|promo|marketing/.test(blob)) {
    writing = WRITING_CANDIDATES.find((c) => c.id === "gpt-4o-mini") || writing;
  } else if (/local|gmb|google|service area|near/.test(blob) || location) {
    writing = WRITING_CANDIDATES.find((c) => c.id === "gemini-flash") || writing;
  }

  // Default: fully free image stack (Pollinations / Pexels / Unsplash)
  let image = IMAGE_CANDIDATES.find((c) => c.id === "pollinations");
  if (
    includeImages &&
    !preferFreeImages() &&
    process.env.OPENROUTER_API_KEY
  ) {
    if (/photo|real|studio|people|hands|premium/.test(blob)) {
      image = IMAGE_CANDIDATES.find((c) => c.id === "gpt-image") || image;
    } else {
      image = IMAGE_CANDIDATES.find((c) => c.id === "gemini-image") || image;
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
          : `Heuristic: selected ${image.label} for visual quality vs cost`
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
  forceImageSource, // "auto"|"ai"|"free"|undefined — user override after AI pick
}) {
  const heuristic = heuristicPick({
    location,
    masterIntent,
    dominantIntent,
    includeImages,
  });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return finalizeDecision(heuristic, { includeImages, forceImageSource });
  }

  const writingList = WRITING_CANDIDATES.map(
    (c) => `- ${c.id}: ${c.label} — ${c.strengths}`
  ).join("\n");
  const imageList = IMAGE_CANDIDATES.map(
    (c) => `- ${c.id}: ${c.label} (${c.source}) — ${c.strengths}`
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
      maxTokens: 280,
      messages: [
        {
          role: "system",
          content:
            "You are a routing analyst for Avonix Social. Prefer free image providers when quality is good enough. Pick ONE writing candidate and ONE image candidate. Return ONLY JSON: {writingId, imageId, writingReason, imageReason}. No markdown.",
        },
        {
          role: "user",
          content: `Website: ${websiteUrl || "n/a"}
Location: ${location || "n/a"}
Master intent: ${masterIntent || "n/a"}
Dominant intent: ${dominantIntent || "n/a"}
Include images: ${includeImages ? "yes" : "no"}
Prefer free images: ${preferFreeImages() ? "YES — choose pollinations unless quality is clearly insufficient" : "optional"}

Writing candidates:
${writingList}

Image candidates:
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

  // User hard override after AI suggestion
  if (forceImageSource === "free") {
    image = IMAGE_CANDIDATES.find((c) => c.id === "pollinations") || image;
    reason.image = "User forced Free (Pollinations)";
  } else if (forceImageSource === "ai" && includeImages) {
    if (image.source !== "ai") {
      image =
        IMAGE_CANDIDATES.find((c) => c.id === "gpt-image") ||
        IMAGE_CANDIDATES.find((c) => c.source === "ai") ||
        image;
    }
    reason.image = `User forced AI images → ${image.label}`;
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
      image: IMAGE_CANDIDATES.map((c) => ({ id: c.id, label: c.label, source: c.source })),
    },
  };
}
