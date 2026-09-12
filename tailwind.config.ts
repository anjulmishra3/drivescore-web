import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9ebff",
          200: "#bcdcff",
          300: "#8ec6ff",
          400: "#59a6ff",
          500: "#3385ff",
          600: "#1f66f5",
          700: "#1751e1",
          800: "#1943b6",
          900: "#1a3c8f",
        },
        score: {
          good: "#16a34a",
          ok: "#f59e0b",
          bad: "#dc2626",
        },
      },
    },
  },
  plugins: [],
};

export default config;
