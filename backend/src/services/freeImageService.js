/**
 * Fully free image stack for Content Studio.
 *
 * Priority (best free AI → free stock):
 *  1. Pollinations Flux — AI generate, free (optional free API key for higher limits / no logo)
 *  2. Pexels — free stock (PEXELS_API_KEY)
 *  3. Unsplash — free stock (UNSPLASH_ACCESS_KEY)
 *
 * Keys are free to create; leave blank and Pollinations still works anonymously
 * (slower rate limits).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clampSize(n, fallback) {
  const v = Number(n) || fallback;
  return Math.min(2048, Math.max(256, Math.round(v)));
}

function searchQuery({ keyword, location, heading }) {
  const parts = [keyword, location, heading]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").slice(0, 120) || "professional business workplace";
}

/**
 * Pollinations GET image URL (Flux). Optional POLLINATIONS_API_KEY (free signup).
 * @see https://enter.pollinations.ai/keys
 */
export function buildPollinationsUrl({ prompt, width, height, seed }) {
  const w = clampSize(width, 1200);
  const h = clampSize(height, 630);
  const s = seed || Math.floor(Math.random() * 1e9);
  const encoded = encodeURIComponent(String(prompt || "").slice(0, 1800));
  const key = (process.env.POLLINATIONS_API_KEY || "").trim();
  const model = process.env.POLLINATIONS_MODEL || "flux";
  const params = new URLSearchParams({
    width: String(w),
    height: String(h),
    nologo: "true",
    enhance: "true",
    model,
    seed: String(s),
  });
  if (key) params.set("key", key);
  return `https://image.pollinations.ai/prompt/${encoded}?${params.toString()}`;
}

async function pexelsImageUrl({ keyword, location, heading, width, height }) {
  const key = (process.env.PEXELS_API_KEY || "").trim();
  if (!key) return null;

  const q = searchQuery({ keyword, location, heading });
  const orient = width >= height * 1.2 ? "landscape" : height >= width * 1.2 ? "portrait" : "square";
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", q);
  url.searchParams.set("per_page", "8");
  url.searchParams.set("orientation", orient);

  const res = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error("[freeImage Pexels]", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  const photos = Array.isArray(data?.photos) ? data.photos : [];
  if (!photos.length) return null;

  const pick = photos[Math.floor(Math.random() * photos.length)];
  const src =
    pick?.src?.landscape ||
    pick?.src?.large2x ||
    pick?.src?.large ||
    pick?.src?.original ||
    null;
  return src
    ? {
        url: src,
        source: "free",
        provider: "pexels",
        attribution: pick?.photographer ? `Photo by ${pick.photographer} on Pexels` : "Pexels",
      }
    : null;
}

async function unsplashImageUrl({ keyword, location, heading }) {
  const key = (process.env.UNSPLASH_ACCESS_KEY || "").trim();
  if (!key) return null;

  const q = searchQuery({ keyword, location, heading });
  const url = new URL("https://api.unsplash.com/photos/random");
  url.searchParams.set("query", q);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("content_filter", "high");

  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${key}`,
      "Accept-Version": "v1",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error("[freeImage Unsplash]", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  const src = data?.urls?.regular || data?.urls?.full || data?.urls?.raw;
  if (!src) return null;
  const name = data?.user?.name;
  return {
    url: src,
    source: "free",
    provider: "unsplash",
    attribution: name ? `Photo by ${name} on Unsplash` : "Unsplash",
  };
}

/**
 * Resolve one free image. Prefer AI (Pollinations), then stock APIs.
 */
export async function resolveFreeImage({
  prompt,
  keyword,
  location,
  heading,
  width,
  height,
  preferStock = false,
}) {
  const order = preferStock
    ? ["pexels", "unsplash", "pollinations"]
    : ["pollinations", "pexels", "unsplash"];

  for (const provider of order) {
    try {
      if (provider === "pollinations") {
        return {
          url: buildPollinationsUrl({ prompt, width, height }),
          source: "free",
          provider: "pollinations",
        };
      }
      if (provider === "pexels") {
        const hit = await pexelsImageUrl({ keyword, location, heading, width, height });
        if (hit?.url) return hit;
      }
      if (provider === "unsplash") {
        const hit = await unsplashImageUrl({ keyword, location, heading });
        if (hit?.url) return hit;
      }
    } catch (err) {
      console.error(`[freeImage ${provider}]`, err.message);
    }
  }

  // Last resort: Pollinations URL even if earlier path failed oddly
  return {
    url: buildPollinationsUrl({ prompt, width, height }),
    source: "free",
    provider: "pollinations",
  };
}

/**
 * Delay between free AI gens to respect anonymous rate limits (~15s)
 * or faster when POLLINATIONS_API_KEY is set (~3–5s).
 */
export async function freeImageRateLimitPause() {
  const hasKey = !!(process.env.POLLINATIONS_API_KEY || "").trim();
  const ms = Number(
    process.env.FREE_IMAGE_DELAY_MS || (hasKey ? 4000 : 12000)
  );
  if (ms > 0) await sleep(ms);
}

export function freeImageStackStatus() {
  return {
    pollinations: true,
    pollinationsKey: !!(process.env.POLLINATIONS_API_KEY || "").trim(),
    pexels: !!(process.env.PEXELS_API_KEY || "").trim(),
    unsplash: !!(process.env.UNSPLASH_ACCESS_KEY || "").trim(),
    preferFree:
      String(process.env.STUDIO_IMAGE_DEFAULT || "free").toLowerCase() === "free" ||
      process.env.STUDIO_FREE_IMAGES_ONLY === "1",
  };
}
