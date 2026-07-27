/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // アプリ本体と同じトークン
        paper: "#fff8f3",
        card: "#ffffff",
        stub: "#fff0e4",
        ink: { DEFAULT: "#2b1608", 60: "rgba(43,22,8,.6)", 40: "rgba(43,22,8,.4)" },
        orange: { DEFAULT: "#f2570d", soft: "#ffe4d1" },
        amber: "#ffb020",
        line: "rgba(43,22,8,.10)",
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', "system-ui", "sans-serif"],
        mono: ['"Space Mono"', "ui-monospace", "monospace"],
      },
      maxWidth: { content: "1120px" },
    },
  },
  plugins: [],
};
