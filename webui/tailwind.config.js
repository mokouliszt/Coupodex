/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        card: "var(--card)",
        stub: "var(--stub)",
        ink: "var(--ink)",
        orange: { DEFAULT: "var(--orange)", soft: "var(--orange-soft)" },
        amber: "var(--amber)",
        teal: "var(--teal)",
        danger: "var(--danger)",
        spent: "var(--spent)",
        line: "var(--line)",
      },
      fontFamily: {
        mono: ["Space Mono", "ui-monospace", "monospace"],
        sans: ["-apple-system", "Roboto", "Noto Sans JP", "Hiragino Sans", "sans-serif"],
      },
      borderRadius: { xl: "16px", "2xl": "20px" },
    },
  },
  plugins: [],
};
