/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'panel': '#0b1220',
        'panelAlt': '#0f172a',
      }
    },
  },
  plugins: [],
}