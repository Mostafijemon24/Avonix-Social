/**
 * Browser-side title-overlay renderer. Mirrors the backend layout rules in
 * `backend/src/services/imageOverlay.js` so the on-screen preview is identical
 * to the exported/published asset (the same canvas code produces both).
 *
 * Composition: horizontally centered; vertically anchored ~59% (slightly below
 * center, never bottom-pinned); wrapped within a >=6% safe margin; font
 * auto-shrinks only to a readable minimum so text is never clipped; Unicode /
 * Bengali render natively through the browser's fonts.
 */

export type OverlayDraftConfig = {
  enabled?: boolean;
  title?: string;
  anchorPct?: number;
  fontSizePct?: number;
  color?: string;
  panel?: boolean;
  panelOpacity?: number;
};

type FullConfig = {
  anchorPct: number;
  maxWidthPct: number;
  safePadXPct: number;
  safePadYPct: number;
  fontSizePct: number;
  minFontSizePct: number;
  fontWeight: number;
  lineHeightMult: number;
  color: string;
  panel: boolean;
  panelColor: string;
  panelOpacity: number;
  maxLines: number;
};

export const OVERLAY_DEFAULTS: FullConfig = {
  anchorPct: 0.59,
  maxWidthPct: 0.86,
  safePadXPct: 0.06,
  safePadYPct: 0.06,
  fontSizePct: 0.062,
  minFontSizePct: 0.038,
  fontWeight: 800,
  lineHeightMult: 1.18,
  color: "#ffffff",
  panel: true,
  panelColor: "#0f172a",
  panelOpacity: 0.42,
  maxLines: 4,
};

const FONT_STACK =
  "'Hind Siliguri','Noto Sans Bengali','Segoe UI',system-ui,Arial,sans-serif";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export function normalizeConfig(c: OverlayDraftConfig = {}): FullConfig {
  const m = { ...OVERLAY_DEFAULTS };
  m.anchorPct = clamp(Number(c.anchorPct ?? m.anchorPct) || m.anchorPct, 0.3, 0.9);
  m.fontSizePct = clamp(Number(c.fontSizePct ?? m.fontSizePct) || m.fontSizePct, 0.03, 0.12);
  m.minFontSizePct = Math.min(m.minFontSizePct, m.fontSizePct);
  m.color = c.color || m.color;
  m.panel = c.panel ?? m.panel;
  m.panelOpacity = clamp(Number(c.panelOpacity ?? m.panelOpacity), 0, 1);
  return m;
}

/** Greedy word-wrap using a precise measuring function (ctx.measureText). */
function wrap(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

type Layout = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  blockTopY: number;
  blockHeight: number;
  centerX: number;
  safePadX: number;
  safePadY: number;
  maxTextWidth: number;
};

function computeLayout(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  cfg: FullConfig
): Layout {
  const safePadX = Math.round(width * cfg.safePadXPct);
  const safePadY = Math.round(height * cfg.safePadYPct);
  const maxTextWidth = Math.max(
    1,
    Math.min(Math.round(width * cfg.maxWidthPct), width - 2 * safePadX)
  );

  let fontSize = Math.round(height * cfg.fontSizePct);
  const minFont = Math.max(1, Math.round(height * cfg.minFontSizePct));
  const setFont = (size: number) => {
    ctx.font = `${cfg.fontWeight} ${size}px ${FONT_STACK}`;
  };
  const measure = (s: string) => ctx.measureText(s).width;

  setFont(fontSize);
  let lines = wrap(title, maxTextWidth, measure);
  const maxBlockHeight = Math.round(height * (1 - 2 * cfg.safePadYPct));
  const fits = () =>
    lines.length <= cfg.maxLines && lines.length * fontSize * cfg.lineHeightMult <= maxBlockHeight;
  while (!fits() && fontSize > minFont) {
    fontSize -= 1;
    setFont(fontSize);
    lines = wrap(title, maxTextWidth, measure);
  }
  if (lines.length > cfg.maxLines) lines = lines.slice(0, cfg.maxLines);

  const lineHeight = Math.round(fontSize * cfg.lineHeightMult);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const half = Math.round(blockHeight / 2);
  const minCenter = safePadY + half;
  const maxCenter = height - safePadY - half;
  let blockCenterY = Math.round(height * cfg.anchorPct);
  blockCenterY = clamp(blockCenterY, minCenter, Math.max(minCenter, maxCenter));

  return {
    lines,
    fontSize,
    lineHeight,
    blockTopY: blockCenterY - half,
    blockHeight,
    centerX: Math.round(width / 2),
    safePadX,
    safePadY,
    maxTextWidth,
  };
}

/** Draw image (cover-fit) + title overlay onto `canvas` at the given pixel size. */
export function drawTitleOverlay(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  width: number,
  height: number,
  title: string,
  draft: OverlayDraftConfig
) {
  const cfg = normalizeConfig(draft);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // cover-fit the source image.
  const iw = img.naturalWidth || width;
  const ih = img.naturalHeight || height;
  const scale = Math.max(width / iw, height / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);

  const text = String(title || "").trim();
  if (draft.enabled === false) return; // overlay disabled → image only
  if (!text) return;

  const L = computeLayout(ctx, width, height, text, cfg);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  if (cfg.panel) {
    const padX = Math.round(L.fontSize * 0.6);
    const padY = Math.round(L.fontSize * 0.5);
    const panelW = Math.min(L.maxTextWidth + 2 * padX, width);
    ctx.save();
    ctx.globalAlpha = cfg.panelOpacity;
    ctx.fillStyle = cfg.panelColor;
    const r = Math.round(L.fontSize * 0.4);
    roundRect(
      ctx,
      L.centerX - panelW / 2,
      L.blockTopY - padY,
      panelW,
      L.blockHeight + 2 * padY,
      r
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = Math.max(1, Math.round(L.fontSize * 0.08));
  ctx.fillStyle = cfg.color;
  L.lines.forEach((line, i) => {
    const y = L.blockTopY + Math.round(L.lineHeight * (i + 0.78));
    ctx.strokeText(line, L.centerX, y);
    ctx.fillText(line, L.centerX, y);
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Render the final composited image to a JPEG data URL (kept well under the
 * server body limit). Returns null if the source image is cross-origin tainted.
 */
export function exportOverlayDataURL(
  img: HTMLImageElement,
  title: string,
  draft: OverlayDraftConfig,
  maxDim = 1440
): string | null {
  const iw = img.naturalWidth || 1080;
  const ih = img.naturalHeight || 1080;
  const scale = Math.min(1, maxDim / Math.max(iw, ih));
  const width = Math.round(iw * scale);
  const height = Math.round(ih * scale);
  const canvas = document.createElement("canvas");
  drawTitleOverlay(canvas, img, width, height, title, draft);
  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null; // tainted canvas (cross-origin without CORS)
  }
}
