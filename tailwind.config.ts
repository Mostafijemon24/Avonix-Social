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
        sans: ["var(--font-plus-jakarta)", "Plus Jakarta Sans", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        orange: {
          500: "#ff6600",
          600: "#e65c00",
          700: "#cc5200",
          950: "#3d1a00",
        },
        navy: {
          950: "#070d1d",
          900: "#0a1124",
          800: "#111a35",
          700: "#2a3759",
          600: "#3a506b",
        },
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
