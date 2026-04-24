/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sora: ["'Sora'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      colors: {
        // Omnirun brand palette
        brand: {
          bg: "#2F3238",
          surface: "#383C43",
          panel: "#262A2F",
          border: "#555B63",
          text: "#DCE0E4",
          muted: "#9CA3AF",
          green: "#2DB87A",
          greenHover: "#5DE8A0",
        },
      },
    },
  },
  plugins: [],
};