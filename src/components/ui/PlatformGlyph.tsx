import type { CSSProperties } from "react";

/**
 * Official solid brand glyphs for the supported social platforms.
 *
 * SVG paths are inlined verbatim from the design handoff prototype
 * (Content Studio.dc.html) so the glyphs match the design exactly without
 * pulling in a new icon dependency. Lucide's outline brand icons were
 * intentionally dropped for looking dated.
 *
 * Accepts either the studio display label ("Facebook", "GMB", "X", …) or the
 * backend provider slug ("facebook", "google_business", "x", …).
 */

export type PlatformKey =
  | "Facebook"
  | "Instagram"
  | "LinkedIn"
  | "GMB"
  | "X"
  | "Pinterest";

const SLUG_TO_KEY: Record<string, PlatformKey> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  google_business: "GMB",
  gmb: "GMB",
  x: "X",
  twitter: "X",
  pinterest: "Pinterest",
};

/** Brand color per platform (Google uses its multi-color logo, so no single color). */
export const PLATFORM_BRAND_COLOR: Record<PlatformKey, string> = {
  Facebook: "#1877f2",
  Instagram: "#e4405f",
  LinkedIn: "#0a66c2",
  GMB: "#ea4335",
  X: "#0f1419",
  Pinterest: "#e60023",
};

function resolveKey(platform: string): PlatformKey | null {
  const trimmed = (platform || "").trim();
  if (trimmed in PLATFORM_BRAND_COLOR) return trimmed as PlatformKey;
  const slug = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  return SLUG_TO_KEY[slug] ?? SLUG_TO_KEY[trimmed.toLowerCase()] ?? null;
}

type Props = {
  platform: string;
  /** Rendered size in pixels (square). Defaults to 18. */
  size?: number;
  className?: string;
  /** Override the glyph color. Ignored for Google (multi-color). Defaults to the brand color. */
  color?: string;
  title?: string;
};

export default function PlatformGlyph({
  platform,
  size = 18,
  className,
  color,
  title,
}: Props) {
  const key = resolveKey(platform);
  if (!key) return null;

  const common = {
    xmlns: "http://www.w3.org/2000/svg",
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    className,
    role: title ? ("img" as const) : undefined,
    "aria-hidden": title ? undefined : true,
    style: { display: "block" } as CSSProperties,
  };
  const fill = color ?? PLATFORM_BRAND_COLOR[key];

  switch (key) {
    case "Facebook":
      return (
        <svg {...common} fill={fill}>
          {title ? <title>{title}</title> : null}
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
    case "Instagram":
      return (
        <svg {...common} fill={fill}>
          {title ? <title>{title}</title> : null}
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      );
    case "LinkedIn":
      return (
        <svg {...common} fill={fill}>
          {title ? <title>{title}</title> : null}
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    case "GMB":
      // Google 4-color logo — ignores the `color` override.
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path fill="#4285F4" d="M23.52 12.273c0-.851-.076-1.67-.218-2.455H12v4.642h6.458a5.52 5.52 0 0 1-2.394 3.622v3.01h3.878c2.27-2.09 3.578-5.17 3.578-8.82z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.956-1.075 7.942-2.908l-3.878-3.01c-1.075.72-2.45 1.145-4.064 1.145-3.125 0-5.77-2.11-6.714-4.946H1.276v3.11A11.995 11.995 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.286 14.28a7.213 7.213 0 0 1 0-4.56V6.61H1.276a12.01 12.01 0 0 0 0 10.78l4.01-3.11z" />
          <path fill="#EA4335" d="M12 4.773c1.762 0 3.344.606 4.59 1.795l3.44-3.44C17.952 1.19 15.235 0 12 0 7.31 0 3.255 2.69 1.276 6.61l4.01 3.11C6.23 6.884 8.875 4.773 12 4.773z" />
        </svg>
      );
    case "X":
      return (
        <svg {...common} fill={fill}>
          {title ? <title>{title}</title> : null}
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "Pinterest":
      return (
        <svg {...common} fill={fill}>
          {title ? <title>{title}</title> : null}
          <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.746-1.378l-.747 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z" />
        </svg>
      );
    default:
      return null;
  }
}
