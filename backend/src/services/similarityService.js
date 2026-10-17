/**
 * P1 — Recent-post similarity detection.
 *
 * Compares a new draft against recent posts for the SAME website + platform so
 * we only revise when MEANINGFUL duplication is detected (not on every run).
 * Uses word-shingling + Jaccard similarity — cheap, deterministic, no AI, no
 * false triggers from shared boilerplate hashtags/URLs (which are stripped
 * before comparison).
 *
 * The pure functions (shingles/jaccard/similarityScore/findMostSimilar) are
 * unit-testable offline; findRecentSimilar adds the scoped DB lookup.
 */
import prisma from "../db.js";

const DEFAULT_K = 3;
const DEFAULT_THRESHOLD = Number(process.env.STUDIO_SIMILARITY_THRESHOLD || 0.5);
const DEFAULT_RECENT_LIMIT = Number(process.env.STUDIO_SIMILARITY_RECENT || 12);

/** Normalize copy for comparison: drop URLs, hashtags, punctuation, case. */
export function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#[a-z0-9_]+/gi, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Set of k-word shingles for the normalized text. */
export function shingles(text, k = DEFAULT_K) {
  const words = normalizeForCompare(text).split(" ").filter(Boolean);
  const set = new Set();
  if (words.length < k) {
    if (words.length) set.add(words.join(" "));
    return set;
  }
  for (let i = 0; i + k <= words.length; i++) {
    set.add(words.slice(i, i + k).join(" "));
  }
  return set;
}

/** Jaccard similarity of two sets (0–1). */
export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** Similarity score (0–1) between two texts. */
export function similarityScore(a, b, { k = DEFAULT_K } = {}) {
  return jaccard(shingles(a, k), shingles(b, k));
}

/**
 * Compare a draft against a list of prior posts.
 * @param {string} draft
 * @param {Array<{id?:string, content:string}>} posts
 * @returns {{duplicate:boolean, maxScore:number, mostSimilar:object|null, comparedCount:number}}
 */
export function findMostSimilar(draft, posts = [], { k = DEFAULT_K, threshold = DEFAULT_THRESHOLD } = {}) {
  const draftShingles = shingles(draft, k);
  let maxScore = 0;
  let mostSimilar = null;
  for (const post of posts) {
    const score = jaccard(draftShingles, shingles(post.content, k));
    if (score > maxScore) {
      maxScore = score;
      mostSimilar = { ...post, score };
    }
  }
  return {
    duplicate: maxScore >= threshold,
    maxScore,
    mostSimilar,
    comparedCount: posts.length,
  };
}

/**
 * Scoped DB lookup: find the most similar recent post for the same website +
 * platform (same user/workspace). Excludes archived posts and an optional self.
 */
export async function findRecentSimilar({
  userId,
  workspaceId,
  websiteOrigin,
  platform,
  content,
  excludeId = null,
  limit = DEFAULT_RECENT_LIMIT,
  threshold = DEFAULT_THRESHOLD,
  k = DEFAULT_K,
} = {}) {
  if (!userId || !content) {
    return { duplicate: false, maxScore: 0, mostSimilar: null, comparedCount: 0 };
  }
  const where = {
    userId,
    archived: false,
    ...(workspaceId ? { workspaceId } : {}),
    ...(websiteOrigin ? { websiteOrigin } : {}),
    ...(platform ? { platform } : {}),
    ...(excludeId ? { id: { not: excludeId } } : {}),
  };
  const recent = await prisma.studioPost.findMany({
    where,
    select: { id: true, content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return findMostSimilar(content, recent, { k, threshold });
}
