/**
 * Deterministic, pure title-overlay layout + SVG builder for generated post
 * images.
 *
 * No raster/image dependency is introduced: the layout math here is pure JS and
 * fully unit-testable, the browser composites the actual pixels on a <canvas>
 * (so the live preview IS the exported asset and Unicode/Bengali render
 * natively through the system fonts), and this module additionally provides a
 * self-contained SVG fallback for server-side rendering when a browser export
 * is unavailable.
 *
 * Composition rules (Feature D):
 *   • Horizontally centered.
 *   • Vertically anchored around ~59% of the height (slightly below center) and
 *     NEVER pinned to the bottom edge — the block is clamped to keep clear space
 *     beneath it inside the vertical safe area.
 *   • Max text width ~82–88% of the image width, with >=6% safe padding on
 *     every side.
 *   • Line wrapping enabled; font auto-shrinks only as far as a readable minimum
 *     so text is never clipped.
 */

export const OVERLAY_DEFAULTS = {
  enabled: true,
  anchorPct: 0.59, // vertical center of the title block (fraction of height)
  align: "center",
  maxWidthPct: 0.86, // clamped to 0.82–0.88
  safePadXPct: 0.06, // >= 6% horizontal safe padding
  safePadYPct: 0.06, // >= 6% vertical safe padding
  fontSizePct: 0.062, // base font size as a fraction of height
  minFontSizePct: 0.038, // never shrink below this (keep it readable)
  fontWeight: 800,
  lineHeightMult: 1.18,
  color: "#ffffff",
  panel: true, // subtle contrast panel behind the text
  panelColor: "#0f172a",
  panelOpacity: 0.42,
  maxLines: 4,
};

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Rough average glyph-width factor relative to font size. Deterministic so the
 * layout is identical on the server (tests) and the client preview. The browser
 * canvas measures text precisely at draw time; this estimate only drives wrap
 * decisions and is intentionally a touch conservative to avoid overflow.
 */
const AVG_GLYPH_FACTOR = 0.54;

export function estimateTextWidth(text, fontSize, factor = AVG_GLYPH_FACTOR) {
  return String(text).length * fontSize * factor;
}

/** Greedy word-wrap to fit `maxWidth`. A single over-long word is kept on its own line. */
export function wrapText(text, fontSize, maxWidth, factor = AVG_GLYPH_FACTOR) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontSize, factor) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function normalizeOverlayConfig(config = {}) {
  const c = { ...OVERLAY_DEFAULTS, ...(config || {}) };
  c.anchorPct = clamp(Number(c.anchorPct) || OVERLAY_DEFAULTS.anchorPct, 0.3, 0.9);
  c.maxWidthPct = clamp(Number(c.maxWidthPct) || OVERLAY_DEFAULTS.maxWidthPct, 0.82, 0.88);
  c.safePadXPct = clamp(Number(c.safePadXPct) || OVERLAY_DEFAULTS.safePadXPct, 0.06, 0.2);
  c.safePadYPct = clamp(Number(c.safePadYPct) || OVERLAY_DEFAULTS.safePadYPct, 0.06, 0.2);
  c.fontSizePct = clamp(Number(c.fontSizePct) || OVERLAY_DEFAULTS.fontSizePct, 0.03, 0.12);
  c.minFontSizePct = clamp(
    Number(c.minFontSizePct) || OVERLAY_DEFAULTS.minFontSizePct,
    0.025,
    c.fontSizePct
  );
  c.lineHeightMult = clamp(Number(c.lineHeightMult) || OVERLAY_DEFAULTS.lineHeightMult, 1, 1.6);
  c.maxLines = clamp(Math.round(Number(c.maxLines) || OVERLAY_DEFAULTS.maxLines), 1, 6);
  c.panelOpacity = clamp(Number(c.panelOpacity ?? OVERLAY_DEFAULTS.panelOpacity), 0, 1);
  return c;
}

/**
 * Compute the deterministic layout for a title overlay on an image of the given
 * pixel dimensions. The returned block is horizontally centered, vertically
 * anchored around `anchorPct`, wrapped to fit the safe width, and auto-shrunk
 * only to the readable minimum. The block is clamped to the vertical safe area
 * so text is never clipped and never flush with the bottom edge.
 */
export function computeOverlayLayout({ imageWidth, imageHeight, title, config }) {
  const W = Math.max(1, Math.round(imageWidth || 0));
  const H = Math.max(1, Math.round(imageHeight || 0));
  const c = normalizeOverlayConfig(config);
  const text = String(title || "").trim();

  const safePadX = Math.round(W * c.safePadXPct);
  const safePadY = Math.round(H * c.safePadYPct);
  const maxTextWidth = Math.max(1, Math.min(Math.round(W * c.maxWidthPct), W - 2 * safePadX));

  let fontSize = Math.round(H * c.fontSizePct);
  const minFont = Math.max(1, Math.round(H * c.minFontSizePct));
  let lines = wrapText(text, fontSize, maxTextWidth);

  const maxBlockHeight = Math.round(H * (1 - 2 * c.safePadYPct));
  const fits = () => {
    const lh = fontSize * c.lineHeightMult;
    return lines.length <= c.maxLines && lines.length * lh <= maxBlockHeight;
  };
  while (!fits() && fontSize > minFont) {
    fontSize -= 1;
    lines = wrapText(text, fontSize, maxTextWidth);
  }
  // Hard cap so text can never spill off-canvas even at the readable minimum.
  if (lines.length > c.maxLines) lines = lines.slice(0, c.maxLines);

  const lineHeight = Math.round(fontSize * c.lineHeightMult);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);

  // Center the block at anchorPct, then clamp so the whole block stays within
  // the vertical safe area (guarantees clear space below and no bottom-edge pin).
  const half = Math.round(blockHeight / 2);
  const minCenter = safePadY + half;
  const maxCenter = H - safePadY - half;
  let blockCenterY = Math.round(H * c.anchorPct);
  blockCenterY = clamp(blockCenterY, minCenter, Math.max(minCenter, maxCenter));
  const blockTopY = blockCenterY - half;

  return {
    width: W,
    height: H,
    text,
    lines,
    fontSize,
    lineHeight,
    blockHeight,
    blockTopY,
    blockCenterY,
    centerX: Math.round(W / 2),
    safePadX,
    safePadY,
    maxTextWidth,
    anchorPct: c.anchorPct,
    config: c,
    // True layout invariants (asserted by tests):
    withinSafeArea:
      blockTopY >= safePadY && blockTopY + blockHeight <= H - safePadY,
    clipped: false,
  };
}

function escapeXml(s) {
  return String(s).replace(
    /[<>&'"]/g,
    (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch])
  );
}

/**
 * Build a self-contained SVG string that renders the overlay (optionally
 * embedding the source image). Server-side fallback only — the primary path is
 * the browser canvas export, which uses these same layout values.
 */
export function buildOverlaySvg({ layout, imageHref = null, config }) {
  const c = normalizeOverlayConfig(config || layout.config);
  const {
    width: W,
    height: H,
    lines,
    fontSize,
    lineHeight,
    blockTopY,
    centerX,
    blockHeight,
    maxTextWidth,
  } = layout;
  const fontStack =
    "'Hind Siliguri','Noto Sans Bengali','Segoe UI',system-ui,Arial,sans-serif";

  const img = imageHref
    ? `<image href="${escapeXml(
        imageHref
      )}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="#0f172a"/>`;

  const panelPadX = Math.round(fontSize * 0.6);
  const panelPadY = Math.round(fontSize * 0.5);
  const panelW = Math.min(maxTextWidth + 2 * panelPadX, W);
  const panel = c.panel
    ? `<rect x="${centerX - Math.round(panelW / 2)}" y="${blockTopY - panelPadY}" width="${panelW}" height="${
        blockHeight + 2 * panelPadY
      }" rx="${Math.round(fontSize * 0.4)}" fill="${c.panelColor}" fill-opacity="${c.panelOpacity}"/>`
    : "";

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${centerX}" y="${
          blockTopY + Math.round(lineHeight * (i + 0.78))
        }">${escapeXml(line)}</tspan>`
    )
    .join("");

  const strokeW = Math.max(1, Math.round(fontSize * 0.04));
  const text = `<text text-anchor="middle" font-family="${fontStack}" font-size="${fontSize}" font-weight="${c.fontWeight}" fill="${c.color}" style="paint-order:stroke" stroke="rgba(0,0,0,0.35)" stroke-width="${strokeW}">${tspans}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${img}${panel}${text}</svg>`;
}
