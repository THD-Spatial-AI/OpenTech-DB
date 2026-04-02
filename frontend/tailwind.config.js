/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ── "Kinetic Monolith" material palette ──────────────────────────────
      colors: {
        // Surface hierarchy (no-line rule: depth via tonal shifts)
        "surface":                   "#f7f9fb",
        "surface-container-low":     "#f2f4f6",
        "surface-container-lowest":  "#ffffff",
        "surface-container":         "#eceef0",
        "surface-container-high":    "#e6e8eb",
        "surface-container-highest": "#e0e3e5",
        // On-surface text tokens
        "on-surface":                "#191c1e",
        "on-surface-variant":        "#434655",
        "on-background":             "#191c1e",
        // Primary (indigo)
        "primary":                   "#4d4b9e",
        "primary-container":         "#6564b9",
        "on-primary":                "#ffffff",
        "on-primary-container":      "#e2dfff",
        "primary-fixed":             "#e2dfff",
        "primary-fixed-dim":         "#c3c0ff",
        "on-primary-fixed-variant":  "#3e3c8f",
        "inverse-primary":           "#c3c0ff",
        // Secondary (slate-blue)
        "secondary":                 "#5b5d72",
        "secondary-container":       "#dfe1f9",
        "on-secondary":              "#ffffff",
        "on-secondary-container":    "#181a2c",
        "secondary-fixed-dim":       "#b9c7df",
        // Tertiary (burnt orange) — warnings / cost deltas
        "tertiary":                  "#943700",
        "tertiary-container":        "#ffede6",
        "on-tertiary":               "#ffffff",
        "on-tertiary-container":     "#ffede6",
        "on-tertiary-fixed-variant": "#7d2d00",
        "tertiary-fixed-dim":        "#ffb596",
        // Utility
        "outline":                   "#737686",
        "outline-variant":           "#c3c6d7",
        "error-container":           "#ffdad6",
        "surface-tint":              "#5654a8",
      },
      // ── Typography: Space Grotesk (display) + Inter (data) ──────────────
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body:     ["Inter", "sans-serif"],
        label:    ["Inter", "sans-serif"],
      },
      // ── Border radius: crisp / technical ─────────────────────────────────
      borderRadius: {
        DEFAULT: "0.125rem", // sm — crisp, technical
        lg:      "0.25rem",
        xl:      "0.5rem",
        "2xl":   "0.75rem", // max allowed by design spec
        full:    "0.75rem",
      },
    },
  },
  plugins: [],
}

