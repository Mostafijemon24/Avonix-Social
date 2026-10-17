/**
 * Feature D — image title-overlay layout engine test.
 *
 * The layout math is pure and deterministic (the browser canvas uses the same
 * values, so preview == export). These assertions lock the composition rules:
 * horizontally centered, vertically anchored ~59% (slightly below center, never
 * bottom-pinned), wrapped within the safe area, never clipped, Unicode-safe.
 *
 * Run: npm run test:overlay
 */
const {
  computeOverlayLayout,
  wrapText,
  normalizeOverlayConfig,
  buildOverlaySvg,
  OVERLAY_DEFAULTS,
} = await import("../src/services/imageOverlay.js");

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}

const TITLE = "Trusted Family Dermatology Care in Dhaka";
const sizes = {
  square: { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1350 },
  landscape: { w: 1200, h: 675 },
};

for (const [name, { w, h }] of Object.entries(sizes)) {
  console.log(`\n${name} (${w}x${h}):`);
  const L = computeOverlayLayout({ imageWidth: w, imageHeight: h, title: TITLE });

  // Horizontally centered.
  assert(L.centerX === Math.round(w / 2), "title block horizontally centered");

  // Vertical anchor ~59% — slightly below center, not at the bottom edge.
  assert(L.blockCenterY >= Math.round(h * 0.5), "anchor is at or below the vertical center");
  assert(L.blockTopY + L.blockHeight <= h - L.safePadY, "block bottom stays inside the vertical safe area (not bottom-pinned)");
  assert(L.blockTopY >= L.safePadY, "block top stays inside the top safe margin");
  assert(L.withinSafeArea === true, "layout reports within safe area");

  // Safe margins >= 6%.
  assert(L.safePadX >= Math.floor(w * 0.06), "horizontal safe padding >= 6%");
  assert(L.safePadY >= Math.floor(h * 0.06), "vertical safe padding >= 6%");

  // Max text width within 82–88% and inside padding.
  assert(L.maxTextWidth <= Math.round(w * 0.88) && L.maxTextWidth <= w - 2 * L.safePadX, "max text width respects 88% + safe padding");

  // Wrapping + no clipping.
  assert(L.lines.length >= 1 && L.lines.length <= L.config.maxLines, "wraps into >=1 and <= maxLines lines");
  assert(L.clipped === false, "no clipping");
}

/* Default anchor ~0.59 */
console.log("\nDefaults:");
assert(Math.abs(OVERLAY_DEFAULTS.anchorPct - 0.59) < 1e-9, "default vertical anchor is 0.59");
const def = computeOverlayLayout({ imageWidth: 1080, imageHeight: 1080, title: "Short Title" });
assert(def.blockCenterY > 1080 * 0.5 && def.blockCenterY < 1080 * 0.75, "default short title sits below center, above lower edge");

/* Long title wraps without clipping and auto-shrinks within readable bounds */
console.log("\nLong title:");
const longTitle = "Comprehensive Advanced Laser Skin Treatment and Cosmetic Dermatology Services for the Whole Family";
const longL = computeOverlayLayout({ imageWidth: 1080, imageHeight: 1080, title: longTitle });
assert(longL.lines.length <= longL.config.maxLines, "long title capped at maxLines (no overflow)");
assert(longL.blockTopY >= longL.safePadY && longL.blockTopY + longL.blockHeight <= 1080 - longL.safePadY, "long title stays within safe area");
assert(longL.fontSize >= Math.round(1080 * OVERLAY_DEFAULTS.minFontSizePct), "font never shrinks below readable minimum");
for (const line of longL.lines) {
  // estimate width <= maxTextWidth (greedy wrap guarantee, except unbreakable single words)
  const est = line.length * longL.fontSize * 0.54;
  assert(est <= longL.maxTextWidth * 1.02 || line.split(/\s+/).length === 1, `wrapped line fits width: "${line.slice(0, 24)}…"`);
}

/* Non-English (Bengali) renders / wraps without throwing */
console.log("\nUnicode (Bengali):");
const bn = computeOverlayLayout({ imageWidth: 1080, imageHeight: 1080, title: "ঢাকায় নির্ভরযোগ্য পরিবারিক ত্বকের চিকিৎসা সেবা" });
assert(bn.lines.length >= 1, "bengali title produces at least one line");
assert(bn.withinSafeArea, "bengali title stays within safe area");
assert(bn.text.includes("ঢাকা"), "bengali unicode preserved");

/* Position change is reflected in the exported layout */
console.log("\nPosition control:");
const low = computeOverlayLayout({ imageWidth: 1080, imageHeight: 1080, title: TITLE, config: { anchorPct: 0.45 } });
const high = computeOverlayLayout({ imageWidth: 1080, imageHeight: 1080, title: TITLE, config: { anchorPct: 0.75 } });
assert(high.blockCenterY > low.blockCenterY, "raising anchorPct moves the title lower (export reflects position change)");

/* Config clamping */
console.log("\nConfig clamping:");
const clamped = normalizeOverlayConfig({ anchorPct: 5, maxWidthPct: 0.99, safePadXPct: 0.01, maxLines: 99 });
assert(clamped.anchorPct <= 0.9 && clamped.maxWidthPct <= 0.88 && clamped.safePadXPct >= 0.06 && clamped.maxLines <= 6, "out-of-range config is clamped to safe bounds");

/* SVG fallback is well-formed and contains the escaped title */
console.log("\nSVG fallback:");
const L2 = computeOverlayLayout({ imageWidth: 1080, imageHeight: 1080, title: 'A & B "Clinic"' });
const svg = buildOverlaySvg({ layout: L2, imageHref: "https://ex.com/img.jpg" });
assert(svg.startsWith("<svg") && svg.includes("</svg>"), "svg is well-formed");
assert(svg.includes("&amp;") && svg.includes("&quot;"), "special characters are XML-escaped (no injection)");
assert(svg.includes("<image"), "source image embedded in svg");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
