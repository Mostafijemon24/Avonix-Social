/**
 * OpenRouter Model Price Cache
 * Fetches real-time per-token USD prices from OpenRouter API.
 * Refreshes on startup and every 12 hours.
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** @type {Record<string, { promptPrice: number, completionPrice: number, name: string }>} */
let modelPrices = {};
let lastFetched = null;

const FALLBACK_PRICES = {
  "google/gemini-2.5-flash": {
    promptPrice: 0.0000003,
    completionPrice: 0.0000025,
    name: "Gemini 2.5 Flash",
  },
  "google/gemini-2.0-flash-001": {
    promptPrice: 0.0000001,
    completionPrice: 0.0000004,
    name: "Gemini 2.0 Flash",
  },
  "openai/gpt-4o-mini": {
    promptPrice: 0.00000015,
    completionPrice: 0.0000006,
    name: "GPT-4o Mini",
  },
  "openai/gpt-4o": {
    promptPrice: 0.0000025,
    completionPrice: 0.00001,
    name: "GPT-4o",
  },
  "anthropic/claude-3.5-sonnet": {
    promptPrice: 0.000003,
    completionPrice: 0.000015,
    name: "Claude 3.5 Sonnet",
  },
  "anthropic/claude-3-haiku": {
    promptPrice: 0.00000025,
    completionPrice: 0.00000125,
    name: "Claude 3 Haiku",
  },
  "meta-llama/llama-3.1-8b-instruct": {
    promptPrice: 0.000000015,
    completionPrice: 0.000000015,
    name: "Llama 3.1 8B",
  },
};

function loadFallbackPrices() {
  modelPrices = { ...FALLBACK_PRICES };
  lastFetched = new Date();
  console.log(`Using fallback model prices (${Object.keys(modelPrices).length} models)`);
}

export async function fetchModelPrices() {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const cache = {};

    for (const model of data.data || []) {
      if (model.pricing?.prompt != null && model.pricing?.completion != null) {
        cache[model.id] = {
          promptPrice: parseFloat(model.pricing.prompt),
          completionPrice: parseFloat(model.pricing.completion),
          name: model.name || model.id,
        };
      }
    }

    if (Object.keys(cache).length === 0) throw new Error("No models returned");

    modelPrices = cache;
    lastFetched = new Date();
    console.log(`Model prices updated: ${Object.keys(modelPrices).length} models`);
    return modelPrices;
  } catch (error) {
    console.error("Failed to fetch model prices:", error.message);
    if (Object.keys(modelPrices).length === 0) loadFallbackPrices();
    return modelPrices;
  }
}

export function getModelPricing(modelId) {
  if (modelPrices[modelId]) return modelPrices[modelId];
  if (FALLBACK_PRICES[modelId]) return FALLBACK_PRICES[modelId];
  return null;
}

/** Resolve a usable model id if the preferred one is missing from the live cache */
export function resolveAvailableModel(preferred) {
  if (preferred && getModelPricing(preferred)) return preferred;
  const candidates = [
    preferred,
    process.env.DEFAULT_AI_MODEL,
    "google/gemini-2.5-flash",
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "anthropic/claude-3-haiku",
  ].filter(Boolean);

  for (const id of candidates) {
    if (getModelPricing(id)) return id;
  }

  // Last resort: first model in live cache
  const first = Object.keys(modelPrices)[0];
  return first || "openai/gpt-4o-mini";
}

export function getAllModelPrices() {
  return { ...modelPrices };
}

export function getPriceCacheStats() {
  return {
    modelCount: Object.keys(modelPrices).length,
    lastFetched: lastFetched?.toISOString() ?? null,
  };
}

export function startPriceRefreshInterval() {
  fetchModelPrices();
  setInterval(fetchModelPrices, REFRESH_INTERVAL_MS);
}
