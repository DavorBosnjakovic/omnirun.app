/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sora: ["'Sora'", "sans-serif"],
        inter: ["'Inter'", "sans-serif"],
        jakarta: ["'Plus Jakarta Sans'", "sans-serif"],
        lora: ["'Lora'", "serif"],
        jetbrains: ["'JetBrains Mono'", "monospace"],
        grotesk: ["'Space Grotesk'", "sans-serif"],
        atkinson: ["'Atkinson Hyperlegible'", "sans-serif"],
      },
    },
  },
  plugins: [],
}