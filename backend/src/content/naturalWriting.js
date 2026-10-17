/**
 * P1 — Natural human writing.
 *
 * Pure, dependency-free text analysis + light deterministic cleanup used to:
 *   1. SCORE a draft for the four "robot tells" the master prompt calls out —
 *      repetitive openings, generic marketing language, robotic transitions,
 *      and keyword stuffing.
 *   2. CLEAN a draft deterministically (cliché → plain phrasing, drop robotic
 *      sentence-starting connectives, trim exact keyword-repeat padding) so the
 *      template path improves even with no AI provider available.
 *   3. Produce human-readable ISSUES that can be fed back into an AI revision
 *      prompt when a provider IS available.
 *
 * It never fabricates facts and never changes meaning — it only removes filler
 * and rephrases boilerplate. Factual accuracy is preserved because no claim,
 * number, name, or URL is ever added. Length-sensitive callers (GMB) can run
 * detection only and skip opening rewrites via options.
 */

/**
 * Generic opener phrases that signal a templated / robotic start. These are the
 * openings we actively vary. Matched case-insensitively at the very start of
 * the copy (after trimming).
 */
export const GENERIC_OPENERS = Object.freeze([
  "here is a clear update from our team",
  "here is a clear update",
  "we have something worth sharing",
  "if you have been searching for the right fit",
  "results matter",
  "every strong brand starts with a clear next step",
  "in today's fast-paced world",
  "in today's digital age",
  "in today's competitive market",
  "in the world of",
  "when it comes to",
  "are you looking for",
  "looking for",
  "searching for effective",
  "searching for the best",
  "searching for",
  "in need of",
  "do you want to",
  "let's face it",
  "picture this",
  "imagine a world",
  "we are excited to announce",
  "we are thrilled to",
  "attention",
]);

/**
 * Marketing clichés → plain, honest rephrasing (or "" to drop). Replacements
 * keep the sentence grammatical and never invent a claim.
 */
export const CLICHE_REPLACEMENTS = Object.freeze([
  [/\btake your business to the next level\b/gi, "help your business grow"],
  [/\btake your \w+ to the next level\b/gi, "move your project forward"],
  [/\bto the next level\b/gi, "forward"],
  [/\blook no further\b/gi, ""],
  [/\bwe'?ve got you covered\b/gi, "we can help"],
  [/\bwe have got you covered\b/gi, "we can help"],
  [/\bunlock the (?:full )?power of\b/gi, "make the most of"],
  [/\bunlock your (?:full )?potential\b/gi, "make progress"],
  [/\belevate your\b/gi, "improve your"],
  [/\bstate[- ]of[- ]the[- ]art\b/gi, "modern"],
  [/\bcutting[- ]edge\b/gi, "modern"],
  [/\bone[- ]stop[- ]shop\b/gi, "single place"],
  [/\bworld[- ]class\b/gi, "high-quality"],
  [/\bbest[- ]in[- ]class\b/gi, "high-quality"],
  [/\bsecond to none\b/gi, "dependable"],
  [/\bgame[- ]?changer\b/gi, "a meaningful improvement"],
  [/\bgame[- ]?changing\b/gi, "meaningful"],
  [/\bseamless(?:ly)?\b/gi, "smooth"],
  [/\bleverage\b/gi, "use"],
  [/\bsynergy\b/gi, "teamwork"],
  [/\bunparalleled\b/gi, "strong"],
  [/\bunmatched\b/gi, "strong"],
  [/\btop[- ]notch\b/gi, "high-quality"],
  [/\brevolutioniz(?:e|ing)\b/gi, "improving"],
  [/\bbespoke\b/gi, "tailored"],
  [/\bturnkey\b/gi, "ready-to-use"],
  [/\bsupercharge\b/gi, "strengthen"],
  [/\bskyrocket\b/gi, "grow"],
  [/\bskyrocket\b/gi, "grow"],
  [/\bempower(?:ing)?\b/gi, "help"],
  [/\bat the end of the day\b/gi, ""],
  [/\bneedless to say\b/gi, ""],
  [/\bit goes without saying\b/gi, ""],
]);

/**
 * Robotic connectives frequently used to start sentences in AI copy. When one
 * opens a sentence we drop it (keeping the sentence itself) for a more human
 * flow. Case-insensitive, sentence-initial only.
 */
export const ROBOTIC_TRANSITIONS = Object.freeze([
  "furthermore",
  "moreover",
  "in conclusion",
  "first and foremost",
  "last but not least",
  "in addition",
  "additionally",
  "as a result",
  "consequently",
  "in summary",
  "to sum up",
  "that being said",
  "with that being said",
  "all in all",
  "without a doubt",
]);

/** Alternative openers used when varying a repeated/generic start. */
const OPENER_POOL = Object.freeze([
  "",
  "Thinking about {topic}?",
  "{topic} doesn't have to be complicated.",
  "A quick note on {topic}.",
  "Here's what matters with {topic}.",
  "Good {topic} starts with the right team.",
  "Need {topic} you can rely on?",
]);

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tidy(text) {
  return String(text || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.,!?;:])(?=[A-Za-z])/g, "$1 ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\s,;:.\-]+/, "")
    .trim();
}

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** The lowercased opening window (first ~60 chars) used for opener detection. */
function openingWindow(text) {
  return String(text || "").trim().toLowerCase().slice(0, 70);
}

/** Return the matched generic opener (lowercased) or null. */
export function detectGenericOpening(text) {
  const head = openingWindow(text);
  for (const op of GENERIC_OPENERS) {
    if (head.startsWith(op)) return op;
  }
  return null;
}

/** All marketing-cliché phrases present in the text (unique, lowercased). */
export function detectCliches(text) {
  const hay = String(text || "");
  const hits = new Set();
  for (const [re] of CLICHE_REPLACEMENTS) {
    const m = hay.match(new RegExp(re.source, "gi"));
    if (m) m.forEach((x) => hits.add(x.toLowerCase().trim()));
  }
  return [...hits].filter(Boolean);
}

/** All robotic sentence-initial transitions present. */
export function detectRoboticTransitions(text) {
  const hay = String(text || "");
  const hits = new Set();
  for (const t of ROBOTIC_TRANSITIONS) {
    const re = new RegExp(`(^|[.!?]\\s+|\\n+)\\s*${escapeRe(t)}\\b`, "gi");
    if (re.test(hay)) hits.add(t);
  }
  return [...hits];
}

/**
 * Keyword-stuffing analysis for a phrase. Returns occurrences + density (share
 * of total words that belong to the phrase) and whether it exceeds the limit.
 */
export function analyzeKeywordStuffing(text, phrase, { maxOccurrences = 4, maxDensity = 0.06 } = {}) {
  const w = words(text);
  const total = w.length || 1;
  const p = words(phrase);
  if (!p.length) return { phrase, occurrences: 0, density: 0, stuffed: false };
  let occurrences = 0;
  for (let i = 0; i + p.length <= w.length; i++) {
    let hit = true;
    for (let j = 0; j < p.length; j++) {
      if (w[i + j] !== p[j]) { hit = false; break; }
    }
    if (hit) { occurrences++; i += p.length - 1; }
  }
  const density = (occurrences * p.length) / total;
  return {
    phrase,
    occurrences,
    density,
    stuffed: occurrences > maxOccurrences || density > maxDensity,
  };
}

/**
 * Score a draft's naturalness. Higher is better (0–100).
 * @returns {{score, issues, genericOpening, cliches, roboticTransitions, stuffing}}
 */
export function scoreNaturalness(text, { keywords = {}, maxOccurrences = 4 } = {}) {
  const issues = [];
  const genericOpening = detectGenericOpening(text);
  const cliches = detectCliches(text);
  const robotic = detectRoboticTransitions(text);
  const templateInstructions = detectTemplateInstructions(text);
  const genericSelfRef = detectGenericSelfRef(text);
  const duplicateSentences = detectDuplicateSentences(text);

  const phrases = [keywords.primary, keywords.secondary]
    .concat(keywords.secondaryKeywords || keywords.general || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const seen = new Set();
  const stuffing = [];
  for (const ph of phrases) {
    const key = ph.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const a = analyzeKeywordStuffing(text, ph, { maxOccurrences });
    if (a.stuffed) stuffing.push(a);
  }

  let score = 100;
  if (genericOpening) {
    score -= 20;
    issues.push(`Opens with a generic/templated line ("${genericOpening}"). Start with something specific to this business.`);
  }
  if (cliches.length) {
    score -= Math.min(30, cliches.length * 10);
    issues.push(`Contains generic marketing clichés: ${cliches.join(", ")}. Replace with plain, specific language.`);
  }
  if (robotic.length) {
    score -= Math.min(20, robotic.length * 8);
    issues.push(`Uses robotic transitions: ${robotic.join(", ")}. Remove or rephrase for natural flow.`);
  }
  if (stuffing.length) {
    score -= Math.min(30, stuffing.length * 15);
    issues.push(
      `Keyword stuffing detected (${stuffing
        .map((s) => `"${s.phrase}" ×${s.occurrences}`)
        .join(", ")}). Use the keyword naturally, not repeatedly.`
    );
  }
  if (templateInstructions.length) {
    score -= Math.min(30, templateInstructions.length * 20);
    issues.push(
      `Contains robotic button-instruction text (${templateInstructions
        .map((s) => `"${s}"`)
        .join(", ")}). The CTA is a native button/link — never write "Click X to read the details" in the body.`
    );
  }
  if (duplicateSentences.length) {
    score -= Math.min(30, duplicateSentences.length * 15);
    issues.push(
      `Contains repeated sentences (${duplicateSentences.length}). Remove duplicate sentences and repeated conclusions.`
    );
  }
  if (genericSelfRef.length) {
    score -= Math.min(15, genericSelfRef.length * 8);
    issues.push(
      `Contains generic self-referential phrasing (${genericSelfRef.join(
        ", "
      )}). Do not auto-insert "our agency"/"we specialize in"/superlatives unless the verified brand voice supports it.`
    );
  }

  return {
    score: Math.max(0, score),
    natural: score >= 70,
    issues,
    genericOpening,
    cliches,
    roboticTransitions: robotic,
    stuffing,
    templateInstructions,
    duplicateSentences,
    genericSelfRef,
  };
}

/** Deterministic index into the opener pool from a seed string. */
function seededIndex(seed, len) {
  const s = String(seed || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return len ? h % len : 0;
}

/** Replace a generic opening sentence with a varied, topic-aware alternative. */
export function varyOpening(text, { topic = "", seed = "" } = {}) {
  const body = String(text || "").trim();
  const op = detectGenericOpening(body);
  if (!op) return body;

  // Remove the generic opening sentence (up to the first sentence terminator).
  const after = body.slice(op.length).replace(/^[\s,;:.\-–—!?]+/, "");
  const t = String(topic || "").trim().toLowerCase();
  const pool = t ? OPENER_POOL : OPENER_POOL.filter((p) => !p.includes("{topic}"));
  const pick = pool[seededIndex(`${seed}|${op}`, pool.length)] || "";
  const replacement = pick.replace(/\{topic\}/g, t);
  const joined = replacement ? `${replacement} ${after}` : after;
  // Capitalize first letter.
  return tidy(joined.replace(/^([a-z])/, (m) => m.toUpperCase()));
}

/** Replace marketing clichés with plain phrasing. */
export function replaceCliches(text) {
  let out = String(text || "");
  for (const [re, repl] of CLICHE_REPLACEMENTS) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), repl);
  }
  return tidy(out);
}

/** Drop robotic connectives that start a sentence (keep the sentence). */
export function stripRoboticTransitions(text) {
  let out = String(text || "");
  for (const t of ROBOTIC_TRANSITIONS) {
    out = out.replace(
      new RegExp(`(^|[.!?]\\s+|\\n+)\\s*${escapeRe(t)}\\s*,?\\s*`, "gi"),
      (m, pre) => pre
    );
  }
  // Recapitalize sentence starts we may have lowercased by dropping a word.
  out = out.replace(/([.!?]\s+|\n+|^)([a-z])/g, (m, pre, c) => pre + c.toUpperCase());
  return tidy(out);
}

/**
 * Remove exact keyword-phrase repetition beyond `maxOccurrences`, operating on
 * whole sentences so grammar is preserved. A sentence whose ONLY substantive
 * content is a keyword repeat (after the limit) is dropped.
 */
export function reduceKeywordStuffing(text, phrase, { maxOccurrences = 4 } = {}) {
  const ph = String(phrase || "").trim().toLowerCase();
  if (!ph) return String(text || "");
  const phRe = new RegExp(escapeRe(ph), "i");
  // Split into sentences but keep paragraph breaks.
  const paras = String(text || "").split(/\n{2,}/);
  let count = 0;
  const outParas = paras.map((para) => {
    const sentences = para.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((sen) => {
      if (!phRe.test(sen)) return true;
      count++;
      if (count <= maxOccurrences) return true;
      // Beyond limit: drop only short sentences that are mostly the keyword.
      const wc = words(sen).length;
      return wc > words(ph).length + 6;
    });
    return kept.join(" ");
  });
  return tidy(outParas.join("\n\n"));
}

/**
 * Full deterministic humanization pass.
 * @param {string} text
 * @param {{primary?:string, secondaryKeywords?:string[], seed?:string, varyOpening?:boolean, maxOccurrences?:number}} opts
 */
export function humanizeDraft(text, opts = {}) {
  const { primary = "", seed = "", varyOpening: doVary = true, maxOccurrences = 4 } = opts;
  let out = String(text || "");
  out = replaceCliches(out);
  out = stripRoboticTransitions(out);
  const phrases = [primary].concat(opts.secondaryKeywords || []).filter(Boolean);
  for (const ph of phrases) {
    out = reduceKeywordStuffing(out, ph, { maxOccurrences });
  }
  if (doVary) out = varyOpening(out, { topic: primary, seed });
  return tidy(out);
}

/**
 * Robotic "button instruction" sentences that must NEVER appear in a post body.
 * The real CTA is a native button (GBP) or a bottom link (feed) attached by the
 * publishing layer — a quoted "Click X to read the details on this page" line is
 * exactly the template tell the master prompt forbids. Removed on every platform.
 */
export const TEMPLATE_INSTRUCTION_RES = Object.freeze([
  /\bclick\s+(?:here\s+)?["“'»]?\s*(?:learn more|visit website|book(?:\s+now)?|call(?:\s+now)?|sign\s*up|order(?:\s+online)?|shop|contact us|get directions)\s*["”'«]?\b[^.!?\n]*[.!?]?/gi,
  /\bclick\s+["“'»]?\s*(?:learn more|here)\s*["”'«]?\b[^.!?\n]*\bto\s+(?:read|see|view|find)\b[^.!?\n]*[.!?]?/gi,
  /\b(?:click|tap|press|hit)\s+the\s+(?:link|button)\b[^.!?\n]*[.!?]?/gi,
  /\b(?:visit|check\s+out)\s+(?:this|the)\s+page\s+to\s+(?:learn|read|see|discover)\b[^.!?\n]*[.!?]?/gi,
  /\blink\s+in\s+(?:bio|profile)\b[^.!?\n]*[.!?]?/gi,
]);

/** Matches found in `text`, for scoring / AI-refine feedback. */
export function detectTemplateInstructions(text) {
  const hay = String(text || "");
  const hits = new Set();
  for (const re of TEMPLATE_INSTRUCTION_RES) {
    const m = hay.match(new RegExp(re.source, re.flags));
    if (m) m.forEach((x) => hits.add(x.trim()));
  }
  return [...hits];
}

/** Remove robotic button-instruction sentences from a body (safe on all platforms). */
export function stripTemplateInstructions(text) {
  let out = String(text || "");
  for (const re of TEMPLATE_INSTRUCTION_RES) {
    out = out.replace(new RegExp(re.source, re.flags), " ");
  }
  return tidy(out);
}

/**
 * Generic self-referential / promotional phrasing the master prompt says must
 * not be inserted automatically ("our agency", "we are proud to", superlatives).
 * Detection only — these are advisory because blind removal can break grammar;
 * they are fed to the AI-refine prompt instead.
 */
export const GENERIC_SELFREF_RES = Object.freeze([
  /\bour agency\b/gi,
  /\bwe are proud to\b/gi,
  /\bwe are thrilled to\b/gi,
  /\bwe specialize in\b/gi,
  /\byour trusted partner\b/gi,
  /\bone[- ]stop[- ]shop\b/gi,
  /\btrusted (?:name|choice|partner) in\b/gi,
]);

export function detectGenericSelfRef(text) {
  const hay = String(text || "");
  const hits = new Set();
  for (const re of GENERIC_SELFREF_RES) {
    const m = hay.match(new RegExp(re.source, re.flags));
    if (m) m.forEach((x) => hits.add(x.toLowerCase().trim()));
  }
  return [...hits];
}

/** Normalize a sentence for duplicate comparison (case/space/punct-insensitive). */
function normalizeSentence(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitIntoSentences(para) {
  return String(para || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Duplicate / near-duplicate sentences present in the text (normalized form). */
export function detectDuplicateSentences(text, { minChars = 24 } = {}) {
  const seen = new Set();
  const dupes = new Set();
  for (const para of String(text || "").split(/\n{2,}/)) {
    for (const sen of splitIntoSentences(para)) {
      const norm = normalizeSentence(sen);
      if (norm.length < minChars) continue;
      if (seen.has(norm)) dupes.add(norm);
      else seen.add(norm);
    }
  }
  return [...dupes];
}

/**
 * Remove repeated sentences (keep first occurrence), preserving paragraph breaks.
 * Only de-dupes substantive sentences (>= minChars normalized) so short natural
 * repeats (e.g. a one-word line) are left alone.
 */
export function dedupeSentences(text, { minChars = 24 } = {}) {
  const seen = new Set();
  const outParas = String(text || "")
    .split(/\n{2,}/)
    .map((para) => {
      const kept = splitIntoSentences(para).filter((sen) => {
        const norm = normalizeSentence(sen);
        if (norm.length < minChars) return true;
        if (seen.has(norm)) return false;
        seen.add(norm);
        return true;
      });
      return kept.join(" ");
    })
    .filter((p) => p.trim().length);
  return tidy(outParas.join("\n\n"));
}
