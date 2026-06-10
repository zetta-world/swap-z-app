import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    screens: {
      "xs": "420px",
      "sm": "640px",
      "md": "768px",
      "lg": "1024px",
      "xl": "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        // ─── Z-SWAP App design system — evolved from landing ──────────────
        // Backgrounds: deeper, more cinematic than the landing
        bg: {
          DEFAULT: "#02030A",   // page — even darker than #04040C for depth
          1:       "#05071A",   // panels
          2:       "#080B22",   // cards
          3:       "#0C1130",   // elevated
          4:       "#121733",   // hover/active
        },
        // Borders & faints
        border: {
          DEFAULT: "#1A2040",
          soft:    "#141A35",
          faint:   "#0E1428",
        },
        // Text scale
        ink: {
          DEFAULT: "#F2F4FF",
          1:       "#E6E9FF",
          2:       "#B9C0E6",
          3:       "#7E89C2",
          4:       "#525C8E",
          5:       "#2E3661",
        },
        // ─── Brand accents (cyan-violet-gold gospel) ─────────────────────
        cyan: {
          DEFAULT: "#00E8FF",
          dim:     "#00B8CC",
          deep:    "#0078A8",
          glow:    "#00E8FF",
        },
        violet: {
          DEFAULT: "#9F5FFF",
          dim:     "#7C3AED",
          deep:    "#4A1E9C",
        },
        gold: {
          DEFAULT: "#F5A623",
          dim:     "#C9A955",
          deep:    "#8E6A12",
        },
        red: {
          DEFAULT: "#FF3B5C",
          dim:     "#C0273F",
        },
        green: {
          DEFAULT: "#00E087",
          dim:     "#009E5E",
        },
        // Tier experience layer — resolves via the CSS var set on <html> by
        // TierAccentProvider; falls back to brand cyan for free/anonymous.
        "tier-accent": "var(--tier-accent)",
        // Risk Aurora palette (used for the SwapCard border that shifts with risk)
        aurora: {
          safe:    "#00E087",
          caution: "#F5A623",
          danger:  "#FF3B5C",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        sans:    ["var(--font-sans)",    "ui-sans-serif", "system-ui"],
        mono:    ["var(--font-mono)",    "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      letterSpacing: {
        widest2: "0.18em",
      },
      backgroundImage: {
        "grad-cyan":      "linear-gradient(135deg, #00E8FF 0%, #9F5FFF 100%)",
        "grad-cyan-soft": "linear-gradient(135deg, rgba(0,232,255,0.85) 0%, rgba(159,95,255,0.85) 100%)",
        "grad-gold":      "linear-gradient(135deg, #F5A623 0%, #C9A955 100%)",
        "grad-aurora":    "linear-gradient(120deg, #00E087, #00E8FF, #9F5FFF, #F5A623)",
        "grain":          "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>\")",
      },
      boxShadow: {
        "glow-cyan":   "0 0 40px -10px rgba(0,232,255,0.45), 0 0 80px -20px rgba(0,232,255,0.25)",
        "glow-violet": "0 0 40px -10px rgba(159,95,255,0.45), 0 0 80px -20px rgba(159,95,255,0.25)",
        "glow-gold":   "0 0 40px -10px rgba(245,166,35,0.45)",
        "glow-red":    "0 0 40px -10px rgba(255,59,92,0.45)",
        "glow-green":  "0 0 40px -10px rgba(0,224,135,0.45)",
        "card":        "0 8px 32px -8px rgba(0,0,0,0.6), 0 2px 8px -2px rgba(0,0,0,0.4)",
        "card-hover":  "0 16px 48px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,232,255,0.12)",
        "inset-soft":  "inset 0 1px 0 0 rgba(255,255,255,0.04)",
      },
      backdropBlur: {
        xs: "2px",
      },
      animation: {
        "pulse-slow":   "pulse 6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "pulse-glow":   "pulseGlow 2.4s ease-in-out infinite",
        "aurora-shift": "auroraShift 12s ease-in-out infinite",
        "spin-slow":    "spin 18s linear infinite",
        "spin-slower":  "spin 36s linear infinite",
        "float":        "float 7s ease-in-out infinite",
        "marquee":      "marquee 40s linear infinite",
        "shimmer":      "shimmer 2.4s ease-in-out infinite",
        "fade-in":      "fadeIn 0.5s ease-out forwards",
        "fade-up":      "fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) forwards",
        "scale-in":     "scaleIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards",
        "scan-line":    "scanLine 3s linear infinite",
      },
      keyframes: {
        pulseGlow: {
          "0%,100%": { opacity: "0.6", filter: "brightness(1)" },
          "50%":     { opacity: "1",   filter: "brightness(1.4)" },
        },
        auroraShift: {
          "0%,100%": { backgroundPosition: "0% 50%" },
          "50%":     { backgroundPosition: "100% 50%" },
        },
        float: {
          "0%,100%": { transform: "translateY(0px)" },
          "50%":     { transform: "translateY(-12px)" },
        },
        marquee: {
          "0%":   { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        shimmer: {
          "0%":   { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        fadeIn: {
          "0%":   { opacity: "0" },
          "100%": { opacity: "1" },
        },
        fadeUp: {
          "0%":   { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          "0%":   { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        scanLine: {
          "0%":   { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
