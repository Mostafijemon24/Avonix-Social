import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Primary accent. Historically "orange" — now the violet brand ramp.
        // Kept under the `orange` key so existing bg-orange-*/text-orange-*/
        // shadow-orange utilities flip to violet without a global rename.
        orange: {
          100: "#efeaff",
          300: "#a594ff",
          400: "#8268ff",
          500: "#6d4dff",
          600: "#5a3de0",
          700: "#4c33cc",
          800: "#3a259e",
          950: "#efeaff",
        },
        // Surfaces. Historically dark "navy" — now the light surface ramp
        // (950 = page bg, 900 = white panel, 800 = inset card2, 700/600 = lines).
        navy: {
          950: "#f6f7fb",
          900: "#ffffff",
          800: "#f3f5fb",
          700: "#e2e7f1",
          600: "#cfd6e4",
        },
        // Semantic tokens matching the design handoff exactly.
        accent: {
          DEFAULT: "#6d4dff",
          soft: "rgba(109,77,255,0.10)",
          border: "rgba(109,77,255,0.32)",
        },
        ink: "#161d33",
        muted: "#58627e",
        dim: "#8f98b2",
        line: "rgba(18,26,48,0.09)",
        // Brand colors for platform glyphs.
        brand: {
          fb: "#1877f2",
          ig: "#e4405f",
          li: "#0a66c2",
          x: "#0f1419",
          pin: "#e60023",
        },
      },
      boxShadow: {
        accent: "0 1px 2px rgba(109,77,255,0.12)",
        card: "0 1px 2px rgba(18,26,48,0.04)",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out forwards",
      },
    },
  },
  plugins: [],
};

export default config;
