import { getModelPricing } from "./modelPrices.js";
import { calculateUsdCost } from "./credits.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Call OpenRouter API for text generation
 */
export async function callOpenRouter({ model, messages, maxTokens = 1024 }) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return mockOpenRouterResponse({ model, messages });
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "Avonix Social",
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error (${response.status}): ${err}`);
  }

  return response.json();
}

function mockOpenRouterResponse({ model, messages }) {
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
  if (last.includes("GBP") || last.includes("Google Business")) {
    return `Leading enterprise SEO agency. Optimize your Google Profile to capture local customers.\n\nAddress: 350 Fifth Ave, New York, NY 10118\nWebsite: https://nexadigital.com/\n\n#LocalSEO #LocalBusiness`;
  }
  if (last.includes("review reply") || last.includes("Review:")) {
    return "Thank you for your stellar 5-star review! We are glad our SEO automation delivered great ranking results for your business.";
  }
  return `Strategic search engine optimization helps local businesses capture high-intent organic traffic. By focusing on targeted keywords, companies build long-term authority and increase conversions.\n\nLearn more: https://nexadigital.com/\n\n#EnterpriseSEO #OrganicRanking`;
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
